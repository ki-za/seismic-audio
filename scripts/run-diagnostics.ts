import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const appPort = Number(process.env.APP_PORT ?? 5197);
const bridgePort = Number(process.env.BRIDGE_PORT ?? 8897);
const host = '127.0.0.1';
const appUrl = `http://${host}:${appPort}`;
const bridgeUrl = `http://${host}:${bridgePort}`;
const station = process.env.TEST_STATION ?? 'RD432';
const skipArchive = process.env.SKIP_ARCHIVE === '1';
const children: ChildProcessWithoutNullStreams[] = [];
const logs: Record<string, string[]> = { bridge: [], vite: [], smoke: [] };

function start(name: keyof typeof logs, command: string, args: string[], env: Record<string, string> = {}) {
	const child = spawn(command, args, {
		env: { ...process.env, ...env },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	children.push(child);
	child.stdout.on('data', (data) => capture(name, data));
	child.stderr.on('data', (data) => capture(name, data));
	return child;
}

function capture(name: keyof typeof logs, data: Buffer) {
	for (const line of data.toString().split('\n')) {
		if (!line.trim()) continue;
		logs[name].push(line);
		logs[name] = logs[name].slice(-30);
	}
}

async function waitFor(url: string, timeoutMs = 20_000) {
	const started = Date.now();
	let lastError = '';
	while (Date.now() - started < timeoutMs) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
			lastError = `HTTP ${response.status}`;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		await delay(400);
	}
	throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function json<T>(url: string): Promise<T> {
	const response = await fetch(url);
	const text = await response.text();
	if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}: ${text}`);
	return JSON.parse(text) as T;
}

function summarizeWindow(window: {
	channel: string;
	station?: string;
	source?: string;
	windowSeconds: number;
	playbackSeconds: number;
	sourceSampleRate: number;
	renderedSampleRate: number;
	samples: number[];
	availableSeconds: number;
	metadata?: unknown;
	metrics?: unknown;
}) {
	return {
		source: window.source ?? 'bridge',
		station: window.station ?? null,
		channel: window.channel,
		windowSeconds: window.windowSeconds,
		playbackSeconds: window.playbackSeconds,
		sourceSampleRate: window.sourceSampleRate,
		renderedSampleRate: window.renderedSampleRate,
		sampleCount: window.samples.length,
		expectedDurationSeconds: Number((window.samples.length / window.renderedSampleRate).toFixed(3)),
		availableSeconds: Number(window.availableSeconds.toFixed(3)),
		metadata: window.metadata ?? null,
		metrics: window.metrics ?? null,
		firstFiveSamples: window.samples.slice(0, 5)
	};
}

async function runSmoke() {
	return new Promise<Record<string, unknown>>((resolve, reject) => {
		let output = '';
		const child = spawn('npx', ['tsx', 'scripts/browser-smoke.ts'], {
			env: { ...process.env, APP_URL: appUrl },
			stdio: ['ignore', 'pipe', 'pipe']
		});
		children.push(child);
		child.stdout.on('data', (data) => {
			output += data.toString();
			capture('smoke', data);
		});
		child.stderr.on('data', (data) => capture('smoke', data));
		child.on('exit', (code) => {
			if (code !== 0) return reject(new Error(`browser smoke exited ${code}`));
			try {
				resolve(JSON.parse(output));
			} catch (error) {
				reject(error);
			}
		});
	});
}

function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	start('bridge', 'npx', ['tsx', 'bridge/server.ts'], { BRIDGE_PORT: String(bridgePort) });
	start('vite', 'npx', ['vite', '--host', host, '--port', String(appPort), '--strictPort'], {
		VITE_BRIDGE_BASE: bridgeUrl,
		VITE_BRIDGE_WS: bridgeUrl.replace(/^http/, 'ws')
	});

	await waitFor(`${bridgeUrl}/status`);
	await waitFor(appUrl);
	await delay(1500);

	const status = await json(`${bridgeUrl}/status`);
	const localShort = await json(`${bridgeUrl}/window?windowSeconds=900&playbackSeconds=10&quality=balanced`);
	const localLong = await json(`${bridgeUrl}/window?windowSeconds=900&playbackSeconds=300&quality=balanced`);
	const archive = skipArchive
		? { skipped: true }
		: summarizeWindow(await json(`${bridgeUrl}/raspberryshake/window?station=${station}&windowSeconds=900&playbackSeconds=10&quality=installation-safe`));
	const browser = await runSmoke();

	console.log(JSON.stringify({
		ok: true,
		appUrl,
		bridgeUrl,
		status,
		windows: {
			localShort: summarizeWindow(localShort),
			localLong: summarizeWindow(localLong),
			archive
		},
		browser,
		logs
	}, null, 2));
}

try {
	await main();
} catch (error) {
	console.error(JSON.stringify({
		ok: false,
		error: error instanceof Error ? error.message : String(error),
		logs
	}, null, 2));
	process.exitCode = 1;
} finally {
	for (const child of children.reverse()) {
		if (!child.killed) child.kill('SIGTERM');
	}
}
