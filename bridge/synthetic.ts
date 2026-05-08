import type { RollingRecorder } from './recorder';

export function startSyntheticFeed(recorder: RollingRecorder) {
	let timestampMs = Date.now();
	let phase = 0;
	let eventEnergy = 0;

	setInterval(() => {
		const samples: number[] = [];
		if (Math.random() < 0.015) eventEnergy = 1;

		for (let i = 0; i < 100; i += 1) {
			phase += 0.015;
			eventEnergy *= 0.995;
			const ground = Math.sin(phase) * 80 + Math.sin(phase * 0.17) * 180;
			const event = Math.sin(i * 0.7) * eventEnergy * 9000;
			const noise = (Math.random() * 2 - 1) * 45;
			samples.push(Math.round(ground + event + noise));
		}

		recorder.ingest('SYN', timestampMs, samples);
		timestampMs += 1000;
	}, 1000);
}
