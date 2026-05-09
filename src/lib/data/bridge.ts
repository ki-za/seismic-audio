import { appError, unknownError, type AppError } from '$lib/core/errors';
import type { AudioWindow, BridgeStatus, RenderQuality } from '$lib/types';

const bridgeBase = 'http://localhost:8787';

export async function getStatus(): Promise<BridgeStatus> {
	try {
		const response = await fetch(`${bridgeBase}/status`);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return response.json();
	} catch (error) {
		throw unknownError(error, {
			code: 'BRIDGE_OFFLINE',
			title: 'Seismic bridge is not reachable',
			message: 'The Svelte app is running, but the TypeScript bridge at localhost:8787 did not answer.',
			recovery: 'Run npm run show, or run npm run bridge in another terminal before using the browser app.'
		});
	}
}

export async function getAudioWindow(options: {
	channel?: string;
	station?: string;
	source?: 'bridge' | 'raspberryshake';
	windowSeconds: number;
	playbackSeconds: number;
	quality?: RenderQuality;
}): Promise<AudioWindow> {
	const params = new URLSearchParams({
		windowSeconds: String(options.windowSeconds),
		playbackSeconds: String(options.playbackSeconds),
		quality: options.quality ?? 'balanced'
	});
	if (options.channel) params.set('channel', options.channel);
	if (options.station) params.set('station', options.station);

	try {
		const path = options.source === 'raspberryshake' ? '/raspberryshake/window' : '/window';
		const response = await fetch(`${bridgeBase}${path}?${params}`);
		if (!response.ok) {
			const body = await response.json().catch(() => null);
			throw new Error(body?.error ?? `HTTP ${response.status}`);
		}
		const window = (await response.json()) as AudioWindow;
		if (window.samples.length === 0) {
			throw appError({
				code: 'AUDIO_WINDOW_EMPTY',
				title: 'No seismic samples are available yet',
				message: 'The bridge answered, but it has no samples to compress into audio.',
				recovery: 'Wait for synthetic or UDP data to arrive, then press Begin listening again.'
			});
		}
		return window;
	} catch (error) {
		if (isAppError(error)) throw error;
		throw unknownError(error, {
			code: 'BRIDGE_BAD_RESPONSE',
			title: 'Could not load compressed seismic audio',
			message: 'The browser could not fetch the selected time window from the TypeScript bridge.',
			recovery: 'Check that the bridge terminal is still running and that localhost:8787/window responds.'
		});
	}
}

export function connectStatus(onStatus: (status: BridgeStatus) => void, onState?: (state: string) => void) {
	const socket = new WebSocket('ws://localhost:8787');
	socket.onopen = () => onState?.('connected');
	socket.onclose = () => onState?.('disconnected');
	socket.onerror = () => onState?.('error');
	socket.onmessage = (event) => onStatus(JSON.parse(event.data));
	return () => socket.close();
}

export function isAppError(error: unknown): error is AppError {
	return Boolean(error && typeof error === 'object' && 'code' in error && 'recovery' in error);
}
