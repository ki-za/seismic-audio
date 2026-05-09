// ── Domain: ProviderId ──
// Pure value object. No I/O, no framework dependencies.

export type ProviderId = "bridge" | "raspberryshake";

const PROVIDER_LABELS: Record<ProviderId, string> = {
	bridge         : "Local Bridge",
	raspberryshake : "Raspberry Shake Archive",
};

export function providerLabel(provider: ProviderId): string {
	return PROVIDER_LABELS[provider];
}

export function isArchiveProvider(provider: ProviderId): boolean {
	return provider === "raspberryshake";
}

/**
 * Derive ProviderId from a station id.
 * 'local' maps to the bridge provider; everything else is archive.
 */
export function providerFromStationId(stationId: string): ProviderId {
	return stationId === "local" ? "bridge" : "raspberryshake";
}
