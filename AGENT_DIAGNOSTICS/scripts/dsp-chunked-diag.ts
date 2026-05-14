// ── Chunked DSP smoke test ──
// Verifies prepareSamplesChunked produces identical output to prepareSamples
// and reports progress correctly.
// Run: bun run AGENT_DIAGNOSTICS/scripts/dsp-chunked-diag.ts

import {
	prepareSamples,
	prepareSamplesChunked,
} from "../../src/lib/domain/sonification";
import type { SoundMode } from "../../src/lib/domain/types";

let failures = 0;
function assert(label: string, condition: boolean, detail?: string) {
	if (condition) {
		console.log(`  ✅ ${label}`);
	} else {
		console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
		failures += 1;
	}
}

async function main() {
	// ── Small array (synchronous path) ──
	console.log("\n📦 Small array (< 500k)");
	const smallInput = Array.from({ length: 100 }, (_, i) => Math.sin(i * 0.1));
	const syncOutput = prepareSamples(smallInput, "soft");

	const progressLog: number[] = [];
	const chunkedOutput = await prepareSamplesChunked(smallInput, "soft", (pct) =>
		progressLog.push(pct),
	);

	assert("same length", syncOutput.length === chunkedOutput.length);
	let allMatch = true;
	for (let i = 0; i < syncOutput.length; i += 1) {
		if (Math.abs(syncOutput[i] - chunkedOutput[i]) > 1e-10) {
			allMatch = false;
			break;
		}
	}
	assert("identical output (small)", allMatch);
	assert("progress reported", progressLog.length === 1);
	assert("progress = 1.0", progressLog[0] === 1);

	// ── Large array (chunked path) ──
	console.log("\n📦 Large array (> 500k)");
	const largeInput = Array.from(
		{ length: 1_200_000 },
		() => Math.random() * 2 - 1,
	);
	const syncLarge = prepareSamples(largeInput, "raw");

	const largeProgress: number[] = [];
	const chunkedLarge = await prepareSamplesChunked(largeInput, "raw", (pct) =>
		largeProgress.push(pct),
	);

	assert("same length", syncLarge.length === chunkedLarge.length);
	let largeMatch = true;
	for (let i = 0; i < syncLarge.length; i += 1) {
		if (Math.abs(syncLarge[i] - chunkedLarge[i]) > 1e-10) {
			largeMatch = false;
			console.log(
				`  mismatch at index ${i}: ${syncLarge[i]} vs ${chunkedLarge[i]}`,
			);
			break;
		}
	}
	assert("identical output (large)", largeMatch);
	assert("multiple progress callbacks", largeProgress.length >= 3);
	assert(
		"first progress ≈ 0.05",
		Math.abs(largeProgress[0] - 0.05) < 0.02,
		`got ${largeProgress[0].toFixed(4)}`,
	);
	assert(
		"final progress >= 0.99",
		largeProgress[largeProgress.length - 1] >= 0.99,
		`got ${largeProgress[largeProgress.length - 1].toFixed(4)}`,
	);
	assert(
		"progress monotonic",
		largeProgress.every((p, i) => i === 0 || p >= largeProgress[i - 1]),
	);

	// ── Edge: empty array ──
	console.log("\n📦 Empty array");
	const emptyProgress: number[] = [];
	const emptyOutput = await prepareSamplesChunked([], "soft", (pct) =>
		emptyProgress.push(pct),
	);
	assert("empty output", emptyOutput.length === 0);
	assert("progress reported", emptyProgress.length === 1);

	// ── Edge: exactly chunk size ──
	console.log("\n📦 Exactly 500k (threshold boundary)");
	const exactInput = Array.from(
		{ length: 500_000 },
		() => Math.random() * 2 - 1,
	);
	const exactProgress: number[] = [];
	await prepareSamplesChunked(exactInput, "soft", (pct) =>
		exactProgress.push(pct),
	);
	assert("synchronous path for ≤500k", exactProgress.length === 1);

	console.log(
		failures
			? `\n❌ ${failures} failure(s)`
			: "\n✅ All chunked DSP diagnostics passed",
	);
	process.exit(failures ? 1 : 0);
}

main().catch((err) => {
	console.error("Diagnostic crash:", err);
	process.exit(1);
});
