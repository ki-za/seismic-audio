// ── Seeded Deterministic PRNG ──
// Pure math — no browser/node/framework dependencies.
//
// Simple xorshift32 PRNG for deterministic noise generation.
// Same seed → same sequence across runs.

/**
 * Create a seeded xorshift32 PRNG.
 *
 * @param seed — Initial seed (integer).
 * @returns    — A function that returns [0, 1) on each call.
 */
export function createXorshift32(seed: number): () => number {
	let state = seed | 0;
	return () => {
		state ^= state << 13;
		state ^= state >> 17;
		state ^= state << 5;
		return (state >>> 0) / 4294967296;
	};
}
