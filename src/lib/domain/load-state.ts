// ── Domain: LoadState ──
// Pure state machine. No I/O, no framework dependencies.
//
// Models the lifecycle of a loaded audio window through the UI:
//   idle → loading → loaded → stale → (reload)
//                   ↘ failed ↗

export type LoadState = 'idle' | 'loading' | 'loaded' | 'stale' | 'fallback' | 'failed';

export type LoadEvent =
	| { kind: 'START_LOAD' }
	| { kind: 'LOAD_SUCCEEDED'; requestedChannel: string; actualChannel: string }
	| { kind: 'LOAD_FAILED'; error: string }
	| { kind: 'SETTINGS_CHANGED' };

export type LoadStateSnapshot = {
	state: LoadState;
	error?: string;
};

export function initialLoadState(): LoadStateSnapshot {
	return { state: 'idle' };
}

export function transitionLoadState(current: LoadStateSnapshot, event: LoadEvent): LoadStateSnapshot {
	switch (event.kind) {
		case 'START_LOAD':
			return { state: 'loading' };

		case 'LOAD_SUCCEEDED': {
			const isFallback = event.requestedChannel !== event.actualChannel;
			return { state: isFallback ? 'fallback' : 'loaded' };
		}

		case 'LOAD_FAILED':
			return { state: 'failed', error: event.error };

		case 'SETTINGS_CHANGED':
			if (current.state === 'loaded' || current.state === 'fallback') {
				return { state: 'stale' };
			}
			return current;

		default:
			return current;
	}
}

/**
 * Human-readable label for display.
 */
export function loadStateLabel(state: LoadState): string {
	const labels: Record<LoadState, string> = {
		idle:      'Idle',
		loading:   'Loading…',
		loaded:    'Loaded',
		stale:     'Stale — settings changed',
		fallback:  'Loaded (fallback channel)',
		failed:    'Failed'
	};
	return labels[state];
}
