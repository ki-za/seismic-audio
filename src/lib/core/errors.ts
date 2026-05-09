export type AppErrorCode =
	| 'BRIDGE_OFFLINE'
	| 'BRIDGE_BAD_RESPONSE'
	| 'AUDIO_BLOCKED'
	| 'AUDIO_WINDOW_EMPTY'
	| 'AUDIO_LOAD_FAILED'
	| 'AUDIO_PLAYBACK_FAILED'
	| 'AUDIO_EXPORT_FAILED'
	| 'UNKNOWN_ERROR';

export type AppError = {
	code: AppErrorCode;
	title: string;
	message: string;
	recovery: string;
	details?: string;
};

export function appError(input: AppError): AppError {
	return input;
}

export function unknownError(error: unknown, fallback: Omit<AppError, 'details'>): AppError {
	return {
		...fallback,
		details: error instanceof Error ? error.message : String(error)
	};
}

export function isAppError(error: unknown): error is AppError {
	return Boolean(error && typeof error === 'object' && 'code' in error && 'recovery' in error);
}
