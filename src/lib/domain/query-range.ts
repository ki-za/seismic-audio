export const MAX_WINDOW_SECONDS = 12 * 60 * 60;
export const MAX_PLAYBACK_SECONDS = 15 * 60;

export type QuerySeconds = {
	windowSeconds   : number;
	playbackSeconds : number;
};

export function clampQuerySeconds(input: QuerySeconds): QuerySeconds {
	return {
		windowSeconds   : Math.min(MAX_WINDOW_SECONDS, Math.max(1, input.windowSeconds)),
		playbackSeconds : Math.min(MAX_PLAYBACK_SECONDS, Math.max(1, input.playbackSeconds)),
	};
}

export function formatQueryDuration(seconds: number): string {
	if (seconds < 90) return `${Math.round(seconds)} sec`;
	if (seconds < 5400) return `${formatNumber(seconds / 60)} min`;
	return `${formatNumber(seconds / 3600)} hr`;
}

export function isoFromDateTimeLocal(date: string, time: string): string {
	return new Date(`${date}T${time}`).toISOString();
}

export function queryRangeSummary(input: {
	startISO        : string;
	windowSeconds   : number;
	playbackSeconds : number;
}) {
	const endISO = new Date(new Date(input.startISO).getTime() + input.windowSeconds * 1000).toISOString();
	return {
		endISO,
		windowLabel      : formatQueryDuration(input.windowSeconds),
		playbackLabel    : formatQueryDuration(input.playbackSeconds),
		compressionRatio : `${formatNumber(input.windowSeconds / input.playbackSeconds)}x`,
	};
}

function formatNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
