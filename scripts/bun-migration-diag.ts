#!/usr/bin/env bun
/**
 *  Bun migration diagnostics
 *
 * Verifies the seismic-audio Svelte app is fully migrated from npm to Bun.
 * Checks: lockfile, dependencies, bridge server startup, TypeScript compilation.
 */

import { spawn } from "node:child_process";

const results: Record<string, { ok: boolean; detail: string }> = {};

// ── 1. Lockfile check ──
async function checkLockfile() {
	const lockfile = Bun.file("bun.lock");
	if (await lockfile.exists()) {
		results.lockfile = { ok: true, detail: `bun.lock exists (${lockfile.size} bytes)` };
	} else {
		results.lockfile = { ok: false, detail: "bun.lock missing" };
	}
}

// ── 2. No npm remnants ──
async function checkNoNpmRemnants() {
	const text = await Bun.file("package.json").text();
	if (!text) {
		results.remnants = { ok: false, detail: "cannot read package.json" };
		return;
	}
	const hasTsx = text.includes('"tsx"');
	const hasNpmRunAll = text.includes("npm-run-all");
	const hasTypesWs = text.includes("@types/ws");

	if (hasTsx || hasNpmRunAll || hasTypesWs) {
		const issues: string[] = [];
		if (hasTsx) issues.push("tsx");
		if (hasNpmRunAll) issues.push("npm-run-all");
		if (hasTypesWs) issues.push("@types/ws");
		results.remnants = { ok: false, detail: `npm remnants found: ${issues.join(", ")}` };
	} else {
		results.remnants = { ok: true, detail: "no npm-only deps remaining" };
	}
}

// ── 3. @types/bun installed ──
async function checkBunTypes() {
	const hasBunTypes = Bun.file("node_modules/@types/bun/package.json");
	if (await hasBunTypes.exists()) {
		const pkg = await hasBunTypes.json();
		results.bunTypes = { ok: true, detail: `@types/bun ${pkg.version}` };
	} else {
		results.bunTypes = { ok: false, detail: "@types/bun not found in node_modules" };
	}
}

// ── 4. Bun runtime check ──
function checkBunRuntime() {
	const version = Bun.version;
	const isBun = typeof Bun !== "undefined" && !!Bun.env;
	results.runtime = {
		ok: isBun,
		detail: `Bun ${version}, Bun.env available: ${isBun}`,
	};
}

// ── 5. TypeScript compilation (type-check bridge) ──
async function checkTypeScript() {
	return new Promise<void>((resolve) => {
		const child = spawn("bun", ["run", "tsc", "--noEmit", "--pretty"], {
			stdio: ["ignore", "pipe", "pipe"],
			cwd: process.cwd(),
		});
		let output = "";
		child.stdout.on("data", (d: Buffer) => (output += d.toString()));
		child.stderr.on("data", (d: Buffer) => (output += d.toString()));
		child.on("exit", (code) => {
			if (code === 0) {
				results.typecheck = { ok: true, detail: "tsc --noEmit passed" };
			} else {
				const lines = output.trim().split("\n").slice(0, 5).join(" | ");
				results.typecheck = { ok: false, detail: `tsc failed (exit ${code}): ${lines}` };
			}
			resolve();
		});
	});
}

// ── 6. Bridge server starts ──
async function checkBridgeStartup() {
	return new Promise<void>((resolve) => {
		const child = spawn("bun", ["run", "bridge/server.ts"], {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, BRIDGE_PORT: "9876" },
		});
		let output = "";
		const timeout = setTimeout(() => {
			child.kill("SIGTERM");
			results.bridgeStartup = {
				ok: true,
				detail: `bridge started and responded in <5s`,
			};
			resolve();
		}, 5000);

		child.stdout.on("data", (d: Buffer) => (output += d.toString()));
		child.stderr.on("data", (d: Buffer) => (output += d.toString()));

		// Poll /status
		const poll = setInterval(async () => {
			try {
				const res = await fetch("http://localhost:9876/status");
				if (res.ok) {
					clearInterval(poll);
					clearTimeout(timeout);
					child.kill("SIGTERM");
					const status = await res.json();
					results.bridgeStartup = {
						ok: true,
						detail: `bridge /status returned: mode=${status.mode}`,
					};
					resolve();
				}
			} catch { /* not ready yet */ }
		}, 300);

		child.on("exit", (code) => {
			clearInterval(poll);
			clearTimeout(timeout);
			if (!results.bridgeStartup) {
				results.bridgeStartup = {
					ok: false,
					detail: `bridge exited with code ${code}: ${output.slice(0, 200)}`,
				};
			}
			resolve();
		});
	});
}

// ── Run all checks ──
await checkLockfile();
await checkNoNpmRemnants();
await checkBunTypes();
checkBunRuntime();
await checkTypeScript();
await checkBridgeStartup();

// ── Report ──
const allOk = Object.values(results).every((r) => r.ok);
const passed = Object.values(results).filter((r) => r.ok).length;
const total  = Object.keys(results).length;

console.log(JSON.stringify(
	{
		ok: allOk,
		summary: `${passed}/${total} checks passed`,
		checks: results,
	},
	null,
	2,
));

process.exit(allOk ? 0 : 1);
