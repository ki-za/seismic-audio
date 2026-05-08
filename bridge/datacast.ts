export type ShakePacket = {
	channel: string;
	timestampMs: number;
	samples: number[];
};

export function parseDatacastPacket(data: Buffer): ShakePacket {
	const text = data.toString('utf8').trim().replace(/^\{/, '').replace(/\}$/, '');
	const parts = text.split(',').map((part) => part.trim().replace(/^['\"]|['\"]$/g, ''));

	if (parts.length < 3) {
		throw new Error(`too few DATACAST fields: ${text}`);
	}

	return {
		channel: parts[0],
		timestampMs: Number.parseInt(parts[1], 10),
		samples: parts.slice(2).filter(Boolean).map((part) => Number.parseInt(part, 10))
	};
}
