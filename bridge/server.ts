import dgram from 'node:dgram';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { parseDatacastPacket } from './datacast';
import { RollingRecorder } from './recorder';
import { startSyntheticFeed } from './synthetic';

const udpPort = Number.parseInt(process.env.UDP_PORT ?? '8888', 10);
const httpPort = Number.parseInt(process.env.BRIDGE_PORT ?? '8787', 10);
const mode = (process.env.INPUT_MODE ?? 'synthetic') as 'synthetic' | 'udp';
const recorder = new RollingRecorder({ sourceSampleRate: 100, maxHours: 72 });

if (mode === 'synthetic') {
	startSyntheticFeed(recorder);
	console.log('synthetic feed started');
} else {
	const udp = dgram.createSocket('udp4');
	udp.on('message', (data) => {
		try {
			const packet = parseDatacastPacket(data);
			recorder.ingest(packet.channel, packet.timestampMs, packet.samples);
		} catch (error) {
			console.warn('bad DATACAST packet', error);
		}
	});
	udp.bind(udpPort, '0.0.0.0', () => console.log(`listening for DATACAST UDP on ${udpPort}`));
}

const server = http.createServer((request, response) => {
	const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
	response.setHeader('Access-Control-Allow-Origin', '*');

	if (url.pathname === '/status') {
		return sendJson(response, recorder.status(mode, udpPort));
	}

	if (url.pathname === '/window') {
		const windowSeconds = Number.parseFloat(url.searchParams.get('windowSeconds') ?? '3600');
		const playbackSeconds = Number.parseFloat(url.searchParams.get('playbackSeconds') ?? '60');
		const channel = url.searchParams.get('channel') ?? undefined;
		const quality = parseQuality(url.searchParams.get('quality'));
		return sendJson(response, recorder.makeWindow({ channel, windowSeconds, playbackSeconds, quality }));
	}

	response.statusCode = 404;
	response.end('not found');
});

const wss = new WebSocketServer({ server });
setInterval(() => {
	const message = JSON.stringify(recorder.status(mode, udpPort));
	for (const client of wss.clients) {
		if (client.readyState === client.OPEN) client.send(message);
	}
}, 1000);

server.listen(httpPort, () => console.log(`seismic bridge listening on http://localhost:${httpPort}`));

function parseQuality(value: string | null) {
	if (value === 'studio' || value === 'balanced' || value === 'installation-safe') return value;
	return 'balanced';
}

function sendJson(response: http.ServerResponse, data: unknown) {
	response.setHeader('Content-Type', 'application/json');
	response.end(JSON.stringify(data));
}
