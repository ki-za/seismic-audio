<script lang="ts">
	import { audioBufferToWavBlob, CompressedSeismicPlayer, renderProcessedSeismicBuffer } from '$lib/audio/sonifier';
	import { connectStatus, getAudioWindow, getStatus, isAppError } from '$lib/data/bridge';
	import type { AppError } from '$lib/core/errors';
	import type { AudioWindow, BridgeStatus, CompressionSettings, ListeningFocus, PlaybackChoice, RenderQuality, SoundMode, StationChoice, WindowChoice } from '$lib/types';

	const windows: WindowChoice[] = [
		{ label: '15 min', seconds: 15 * 60 },
		{ label: '1 hour', seconds: 60 * 60 },
		{ label: '6 hours', seconds: 6 * 60 * 60 },
		{ label: '24 hours', seconds: 24 * 60 * 60 },
		{ label: '48 hours', seconds: 48 * 60 * 60 },
		{ label: '72 hours', seconds: 72 * 60 * 60 }
	];
	const playbacks: PlaybackChoice[] = [
		{ label: '10 sec', seconds: 10 },
		{ label: '30 sec', seconds: 30 },
		{ label: '1 min', seconds: 60 },
		{ label: '5 min', seconds: 5 * 60 }
	];
	const soundModes: SoundMode[] = ['soft', 'clear', 'raw', 'deep', 'bright'];
	const renderQualities: { label: string; value: RenderQuality; description: string }[] = [
		{ label: 'Studio', value: 'studio', description: 'maximum detail' },
		{ label: 'Balanced', value: 'balanced', description: 'recommended' },
		{ label: 'Installation-safe', value: 'installation-safe', description: 'lighter long loops' }
	];
	const listeningFoci: { label: string; value: ListeningFocus }[] = [
		{ label: 'Gentle room', value: 'gentle' },
		{ label: 'Event punch', value: 'event' },
		{ label: 'Texture', value: 'texture' },
		{ label: 'Scientific-ish', value: 'scientific' }
	];
	const stations: StationChoice[] = [
		{ id: 'local', name: 'Local Shake', place: 'This room / LAN', channelHint: 'bridge channel', status: 'live' },
		{ id: 'rboom', name: 'Raspberry Boom', place: 'low-frequency air pressure', channelHint: 'HDF', status: 'stub' },
		{ id: 'fdsn', name: 'Archive station', place: 'known event replay', channelHint: 'EHZ', status: 'archive' }
	];

	let status = $state<BridgeStatus | null>(null);
	let connection = $state('connecting');
	let selectedWindowSeconds = $state(windows[1].seconds);
	let selectedPlaybackSeconds = $state(playbacks[2].seconds);
	let selectedStationId = $state(stations[0].id);
	let soundMode = $state<SoundMode>('soft');
	let renderQuality = $state<RenderQuality>('balanced');
	let listeningFocus = $state<ListeningFocus>('gentle');
	let compression = $state<CompressionSettings>({ thresholdDb: -18, ratio: 4, attackMs: 5, releaseMs: 90, makeupDb: 3 });
	let isPlaying = $state(false);
	let showMode = $state(false);
	let error = $state<AppError | null>(null);
	let audioLevel = $state(0);
	let lastAudioWindow = $state<AudioWindow | null>(null);
	let isExporting = $state(false);

	const player = new CompressedSeismicPlayer();
	player.setLevelCallback((level) => (audioLevel = level));

	const selectedWindow = $derived(windows.find((choice) => choice.seconds === selectedWindowSeconds) ?? windows[0]);
	const selectedPlayback = $derived(playbacks.find((choice) => choice.seconds === selectedPlaybackSeconds) ?? playbacks[0]);
	const selectedStation = $derived(stations.find((station) => station.id === selectedStationId) ?? stations[0]);
	const compressionText = $derived(`${selectedWindow.label} → ${selectedPlayback.label}`);
	const availabilityText = $derived(status ? formatDuration(status.secondsStored) : 'no data yet');
	const bridgeText = $derived(status ? `${status.samplesStored.toLocaleString()} samples · ${status.channels.join(', ') || 'no channel yet'}` : 'waiting for bridge');
	const activeChannel = $derived(status?.channels[0] ?? selectedStation.channelHint);
	const selectedQuality = $derived(renderQualities.find((choice) => choice.value === renderQuality) ?? renderQualities[1]);

	$effect(() => {
		getStatus().then((next) => (status = next)).catch(() => (connection = 'offline'));
		return connectStatus((next) => (status = next), (next) => (connection = next));
	});

	async function begin() {
		error = null;
		isPlaying = true;
		try {
			const audioWindow = await getAudioWindow({
				windowSeconds: selectedWindowSeconds,
				playbackSeconds: selectedPlaybackSeconds,
				channel: status?.channels[0],
				quality: renderQuality
			});
			lastAudioWindow = audioWindow;
			await player.play(audioWindow, soundMode, compression, listeningFocus);
		} catch (caught) {
			isPlaying = false;
			error = isAppError(caught)
				? caught
				: {
						code: 'AUDIO_PLAYBACK_FAILED',
						title: 'Audio playback failed',
						message: 'The browser could not start or render the compressed seismic sound.',
						recovery: 'Click Begin listening again. If the browser asks for audio permission, allow it.',
						details: caught instanceof Error ? caught.message : String(caught)
					};
		}
	}

	async function downloadWav() {
		error = null;
		isExporting = true;
		try {
			const audioWindow =
				lastAudioWindow ??
				(await getAudioWindow({
					windowSeconds: selectedWindowSeconds,
					playbackSeconds: selectedPlaybackSeconds,
					channel: status?.channels[0],
					quality: renderQuality
				}));
			lastAudioWindow = audioWindow;
			const buffer = await renderProcessedSeismicBuffer(audioWindow, soundMode, compression, listeningFocus);
			downloadBlob(audioBufferToWavBlob(buffer), makeExportName(audioWindow, 'wav'));
			downloadBlob(makeMetadataBlob(audioWindow), makeExportName(audioWindow, 'json'));
		} catch (caught) {
			error = {
				code: 'AUDIO_EXPORT_FAILED',
				title: 'WAV export failed',
				message: 'The browser could not render the seismic loop into a downloadable WAV.',
				recovery: 'Try a shorter playback duration, then export again.',
				details: caught instanceof Error ? caught.message : String(caught)
			};
		} finally {
			isExporting = false;
		}
	}

	function stop() {
		player.stop();
		isPlaying = false;
	}

	async function enterShowMode() {
		showMode = true;
		await document.documentElement.requestFullscreen?.();
	}

	function exitShowMode() {
		showMode = false;
		document.exitFullscreen?.();
	}

	function formatDuration(seconds: number) {
		if (seconds < 90) return `${Math.floor(seconds)} sec`;
		if (seconds < 5400) return `${Math.floor(seconds / 60)} min`;
		return `${(seconds / 3600).toFixed(1)} hr`;
	}

	function downloadBlob(blob: Blob, filename: string) {
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = filename;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	function makeExportName(window: AudioWindow, extension: 'wav' | 'json') {
		const channel = window.channel.replace(/[^a-z0-9_-]/gi, '-');
		return `seismic-${channel}-${window.windowSeconds}s-to-${window.playbackSeconds}s-${soundMode}-${renderQuality}.${extension}`;
	}

	function makeMetadataBlob(window: AudioWindow) {
		return new Blob([
			JSON.stringify(
				{
					channel: window.channel,
					windowSeconds: window.windowSeconds,
					playbackSeconds: window.playbackSeconds,
					availableSeconds: window.availableSeconds,
					sourceSampleRate: window.sourceSampleRate,
					renderedSampleRate: window.renderedSampleRate,
					soundMode,
					renderQuality,
					listeningFocus,
					compression,
					processing: ['linear resample to playback duration', 'mean removal', '98th-percentile normalization', 'edge fade', 'high-pass', 'low-pass', 'tanh saturation', 'dynamics compression', 'gain'],
					exportedAt: new Date().toISOString()
				},
				null,
				2
			)
		], { type: 'application/json' });
	}
</script>

<svelte:document onfullscreenchange={() => (showMode = Boolean(document.fullscreenElement))} />

<main class={showMode ? 'show' : ''}>
	<section class="hero">
		<p class="eyebrow">Seismic Audio Dashboard</p>
		<h1>Listening to compressed earth time.</h1>
		<p class="subtle">{selectedStation.name} · {compressionText} · {selectedQuality.label}. Recorded: {availabilityText}.</p>
	</section>

	<section class="orb" aria-label="seismic visual" style:--energy={Math.max(audioLevel, status ? Math.min(1, status.samplesStored / 360000) : 0)}>
		<div></div>
	</section>

	<section class="panel" aria-label="sound engineer controls">
		<div class="status" data-testid="bridge-status"><span class={connection}></span>{connection} · {status?.mode ?? 'unknown'} · {bridgeText}</div>
		<div class="meter" aria-label="audio output meter" data-testid="audio-meter" data-level={audioLevel.toFixed(4)}><span style:width={`${audioLevel * 100}%`}></span></div>

		{#if connection !== 'connected'}
			<p class="hint">Bridge not connected. Run <code>npm run bridge</code> or <code>npm run show</code>.</p>
		{/if}

		<div class="dashboard-grid">
			<div class="group wide">
				<p>Station / location <small>stub routing</small></p>
				<div class="station-list">
					{#each stations as station (station.id)}
						<button class={station.id === selectedStationId ? 'selected' : ''} onclick={() => (selectedStationId = station.id)}>
							<strong>{station.name}</strong>
							<span>{station.place} · {station.status}</span>
						</button>
					{/each}
				</div>
				<p class="readout">Selected channel target: {activeChannel}</p>
			</div>

			<div class="group">
				<p>Time window</p>
				<div class="buttons">
					{#each windows as choice (choice.seconds)}
						<button class={choice.seconds === selectedWindowSeconds ? 'selected' : ''} onclick={() => (selectedWindowSeconds = choice.seconds)}>{choice.label}</button>
					{/each}
				</div>
			</div>

			<div class="group">
				<p>Playback duration</p>
				<div class="buttons">
					{#each playbacks as choice (choice.seconds)}
						<button class={choice.seconds === selectedPlaybackSeconds ? 'selected' : ''} onclick={() => (selectedPlaybackSeconds = choice.seconds)}>{choice.label}</button>
					{/each}
				</div>
			</div>

			<div class="group">
				<p>Sound character</p>
				<div class="buttons">
					{#each soundModes as mode (mode)}
						<button class={mode === soundMode ? 'selected' : ''} onclick={() => (soundMode = mode)}>{mode}</button>
					{/each}
				</div>
			</div>

			<div class="group">
				<p>Listening focus</p>
				<div class="buttons">
					{#each listeningFoci as focus (focus.value)}
						<button class={focus.value === listeningFocus ? 'selected' : ''} onclick={() => (listeningFocus = focus.value)}>{focus.label}</button>
					{/each}
				</div>
			</div>

			<div class="group wide">
				<p>Detail / performance <small>{selectedQuality.description}</small></p>
				<div class="buttons">
					{#each renderQualities as quality (quality.value)}
						<button class={quality.value === renderQuality ? 'selected' : ''} onclick={() => (renderQuality = quality.value)}>{quality.label}</button>
					{/each}
				</div>
				{#if selectedPlaybackSeconds >= 300 && renderQuality === 'studio'}
					<p class="readout">Studio detail for 5 minute loops may take longer to render or export.</p>
				{/if}
			</div>

			<div class="group wide">
				<p>Compressor <small>Web Audio dynamics</small></p>
				<div class="knobs">
					<label>Threshold <input type="range" min="-40" max="0" bind:value={compression.thresholdDb} /> <span>{compression.thresholdDb} dB</span></label>
					<label>Ratio <input type="range" min="1" max="20" step="0.5" bind:value={compression.ratio} /> <span>{compression.ratio}:1</span></label>
					<label>Attack <input type="range" min="1" max="80" bind:value={compression.attackMs} /> <span>{compression.attackMs} ms</span></label>
					<label>Release <input type="range" min="20" max="500" bind:value={compression.releaseMs} /> <span>{compression.releaseMs} ms</span></label>
					<label>Makeup <input type="range" min="0" max="12" bind:value={compression.makeupDb} /> <span>+{compression.makeupDb} dB</span></label>
				</div>
			</div>
		</div>

		<div class="actions">
			<button class="primary" data-testid="begin-listening" onclick={begin}>{isPlaying ? 'Restart loop' : 'Begin loop'}</button>
			<button onclick={stop}>Stop</button>
			<button onclick={downloadWav} disabled={isExporting}>{isExporting ? 'Rendering WAV…' : 'Download WAV + metadata'}</button>
			<button onclick={showMode ? exitShowMode : enterShowMode}>{showMode ? 'Exit show mode' : 'Fullscreen show mode'}</button>
		</div>

		{#if error}
			<div class="error" data-testid="error-message">
				<strong>{error.title}</strong>
				<p>{error.message}</p>
				<p><b>Fix:</b> {error.recovery}</p>
				{#if error.details}<small>{error.code}: {error.details}</small>{/if}
			</div>
		{/if}
	</section>
</main>
