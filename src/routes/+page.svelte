<script lang="ts">
	import { browserAudioRenderer, browserFileDownloader, createBrowserAudioPlayer } from '$lib/adapters/browser-audio';
	import { exportAudioWindow, loadAudioWindow, playAudioWindow } from '$lib/application/seismic-audio-session';
	import { buildAudioSettingsSnapshot, buildRequestKey, fingerprintAudioSettings, isStale } from '$lib/domain/audio-state';
	import { bridgeAudioWindowSource, isAppError } from '$lib/data/bridge';
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
		{ id: 'local', name: 'Synthetic / LAN bridge', place: 'local bridge feed', channelHint: 'bridge channel', status: 'synthetic' },
		{ id: 'RD432', name: 'RD432', place: 'Raspberry Shake AM network', channelHint: 'AM.RD432.00.EHZ', status: 'archive' },
		{ id: 'R5022', name: 'R5022', place: 'Raspberry Shake AM network', channelHint: 'AM.R5022.00.EHZ', status: 'archive' },
		{ id: 'RCA97', name: 'RCA97', place: 'Raspberry Shake AM network', channelHint: 'AM.RCA97.00.EHZ', status: 'archive' },
		{ id: 'R83E1', name: 'R83E1', place: 'Raspberry Shake AM network', channelHint: 'AM.R83E1.00.EHZ', status: 'archive' },
		{ id: 'R5156', name: 'R5156', place: 'Raspberry Shake AM network', channelHint: 'AM.R5156.00.EHZ', status: 'archive' }
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
	let isLoading = $state(false);
	let showMode = $state(false);
	let error = $state<AppError | null>(null);
	let audioLevel = $state(0);
	let lastAudioWindow = $state<AudioWindow | null>(null);
	let loadedRequestKey = $state<string | null>(null);
	let loadedWindowId = $state<string | null>(null);
	let loadedFingerprint = $state<string | null>(null);
	let activeFingerprint = $state<string | null>(null);
	let isExporting = $state(false);

	const player = createBrowserAudioPlayer();
	player.setLevelCallback((level) => (audioLevel = level));

	const selectedWindow = $derived(windows.find((choice) => choice.seconds === selectedWindowSeconds) ?? windows[0]);
	const selectedPlayback = $derived(playbacks.find((choice) => choice.seconds === selectedPlaybackSeconds) ?? playbacks[0]);
	const selectedStation = $derived(stations.find((station) => station.id === selectedStationId) ?? stations[0]);
	const compressionText = $derived(`${selectedWindow.label} → ${selectedPlayback.label}`);
	const availabilityText = $derived(selectedStation.id === 'local' ? (status ? formatDuration(status.secondsStored) : 'no data yet') : 'archive request uses now - 35 min');
	const bridgeText = $derived(status ? `${status.samplesStored.toLocaleString()} local samples · ${status.channels.join(', ') || 'no local channel yet'}` : 'waiting for bridge');
	const activeChannel = $derived(selectedStation.id === 'local' ? (status?.channels[0] ?? selectedStation.channelHint) : selectedStation.channelHint);
	const selectedQuality = $derived(renderQualities.find((choice) => choice.value === renderQuality) ?? renderQualities[1]);
	const selectedRequestKey = $derived(buildRequestKey({ provider: selectedStation.id === 'local' ? 'bridge' : 'raspberryshake', stationId: selectedStation.id, channel: selectedStation.id === 'local' ? status?.channels[0] : undefined, windowSeconds: selectedWindowSeconds, playbackSeconds: selectedPlaybackSeconds, renderQuality }));
	const selectedFingerprint = $derived(fingerprintAudioSettings(buildAudioSettingsSnapshot({ soundMode, listeningFocus, compression, renderQuality, playbackSeconds: selectedPlaybackSeconds, renderedSampleRate: lastAudioWindow?.renderedSampleRate ?? 0 })));
	const loadedState = $derived(isLoading ? 'loading' : !lastAudioWindow ? 'untested' : isStale(selectedRequestKey, loadedRequestKey) ? 'stale' : lastAudioWindow.metadata?.requestedChannel && lastAudioWindow.metadata.requestedChannel !== lastAudioWindow.channel ? 'fallback' : 'loaded');
	const soundState = $derived(!loadedFingerprint ? 'not loaded' : selectedFingerprint !== loadedFingerprint ? 'changed · replay to hear' : activeFingerprint === loadedFingerprint && isPlaying ? 'playing · applied' : 'loaded · ready');

	$effect(() => {
		bridgeAudioWindowSource.getStatus().then((next) => (status = next)).catch(() => (connection = 'offline'));
		return bridgeAudioWindowSource.connectStatus((next) => (status = next), (next) => (connection = next));
	});

	async function loadWindow() {
		error = null;
		isLoading = true;
		try {
			const loaded = await loadAudioWindow({
				source: bridgeAudioWindowSource,
				requestKey: selectedRequestKey,
				request: makeAudioRequest(),
				settings: { soundMode, listeningFocus, compression, renderQuality, playbackSeconds: selectedPlaybackSeconds }
			});
			lastAudioWindow = loaded.window;
			loadedRequestKey = loaded.requestKey;
			loadedWindowId = loaded.windowId;
			loadedFingerprint = loaded.settingsFingerprint;
		} catch (caught) {
			error = isAppError(caught)
				? caught
				: {
						code: 'AUDIO_LOAD_FAILED',
						title: 'Audio window load failed',
						message: 'The browser could not fetch the selected seismic window.',
						recovery: 'Check bridge/archive status, then press Load Window again.',
						details: caught instanceof Error ? caught.message : String(caught)
					};
		} finally {
			isLoading = false;
		}
	}

	async function playLoaded() {
		error = null;
		if (!lastAudioWindow || loadedState === 'stale') await loadWindow();
		if (!lastAudioWindow) return;
		isPlaying = true;
		try {
			await playAudioWindow({ player, window: lastAudioWindow, soundMode, compression, listeningFocus });
			loadedFingerprint = selectedFingerprint;
			activeFingerprint = selectedFingerprint;
		} catch (caught) {
			isPlaying = false;
			error = isAppError(caught)
				? caught
				: {
						code: 'AUDIO_PLAYBACK_FAILED',
						title: 'Audio playback failed',
						message: 'The browser could not start or render the compressed seismic sound.',
						recovery: 'Click Play Loaded Loop again. If the browser asks for audio permission, allow it.',
						details: caught instanceof Error ? caught.message : String(caught)
					};
		}
	}

	async function downloadWav() {
		error = null;
		isExporting = true;
		try {
			const audioWindow = lastAudioWindow ?? (await loadAudioWindow({
				source: bridgeAudioWindowSource,
				requestKey: selectedRequestKey,
				request: makeAudioRequest(),
				settings: { soundMode, listeningFocus, compression, renderQuality, playbackSeconds: selectedPlaybackSeconds }
			})).window;
			lastAudioWindow = audioWindow;
			await exportAudioWindow({
				renderer: browserAudioRenderer,
				downloader: browserFileDownloader,
				window: audioWindow,
				soundMode,
				compression,
				listeningFocus,
				wavFilename: makeExportName(audioWindow, 'wav'),
				metadataFilename: makeExportName(audioWindow, 'json'),
				metadataBlob: makeMetadataBlob(audioWindow)
			});
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

	function makeAudioRequest() {
		return {
			windowSeconds: selectedWindowSeconds,
			playbackSeconds: selectedPlaybackSeconds,
			quality: renderQuality,
			...(selectedStation.id === 'local'
				? { source: 'bridge' as const, channel: status?.channels[0] }
				: { source: 'raspberryshake' as const, station: selectedStation.id })
		};
	}

	function stop() {
		player.stop();
		isPlaying = false;
		activeFingerprint = null;
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

	function makeExportName(window: AudioWindow, extension: 'wav' | 'json') {
		const channel = window.channel.replace(/[^a-z0-9_-]/gi, '-');
		const station = window.station ?? selectedStation.id;
		return `seismic-${station}-${channel}-${window.windowSeconds}s-to-${window.playbackSeconds}s-${soundMode}-${renderQuality}.${extension}`;
	}

	function makeMetadataBlob(window: AudioWindow) {
		return new Blob([
			JSON.stringify(
				{
					source: window.source ?? 'bridge',
					network: window.network,
					station: window.station,
					location: window.location,
					channel: window.channel,
					startISO: window.startISO,
					endISO: window.endISO,
					windowSeconds: window.windowSeconds,
					playbackSeconds: window.playbackSeconds,
					availableSeconds: window.availableSeconds,
					sourceSampleRate: window.sourceSampleRate,
					renderedSampleRate: window.renderedSampleRate,
					soundMode,
					renderQuality,
					listeningFocus,
					compression,
					loadedWindowId,
					audioSettingsFingerprint: selectedFingerprint,
					renderMetrics: window.metrics ?? null,
					loadMetadata: window.metadata,
					processing: ['linear resample to playback duration', 'mean removal', '98th-percentile normalization', 'edge fade', 'high-pass', 'low-pass', 'tanh saturation', 'dynamics compression', 'gain'],
					exportedAtISO: new Date().toISOString()
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
				<p>Station / location <small>selected ≠ loaded</small></p>
				<div class="station-list">
					{#each stations as station (station.id)}
						<button class={station.id === selectedStationId ? 'selected' : ''} onclick={() => (selectedStationId = station.id)}>
							<strong>{station.name}</strong>
							<span>{station.place} · {station.id === selectedStationId ? loadedState : 'untested'}</span>
						</button>
					{/each}
				</div>
				<p class="readout">Selected channel target: {activeChannel}</p>
			</div>

			<div class="group wide evidence" data-testid="loaded-evidence" data-state={loadedState} data-fingerprint={selectedFingerprint} data-active-fingerprint={activeFingerprint ?? ''}>
				<p>Loaded evidence <small>{loadedState}</small></p>
				{#if lastAudioWindow}
					<p class="readout">Source: {lastAudioWindow.source ?? 'bridge'} · {lastAudioWindow.metadata?.requestHost ?? 'local bridge'}</p>
					<p class="readout">Target: {lastAudioWindow.network ?? 'local'}.{lastAudioWindow.station ?? selectedStation.id}.{lastAudioWindow.location ?? '--'}.{lastAudioWindow.metadata?.requestedChannel ?? activeChannel}</p>
					<p class="readout">Actual: {lastAudioWindow.network ?? 'local'}.{lastAudioWindow.station ?? selectedStation.id}.{lastAudioWindow.location ?? '--'}.{lastAudioWindow.channel}</p>
					<p class="readout">Range: {lastAudioWindow.startISO ?? 'rolling buffer'} → {lastAudioWindow.endISO ?? 'now'}</p>
					<p class="readout">Render: {lastAudioWindow.renderedSampleRate.toLocaleString()} Hz · {lastAudioWindow.samples.length.toLocaleString()} samples</p>
					<p class="readout">Metrics: RMS {lastAudioWindow.metrics?.rms.toFixed(4)} · Peak {lastAudioWindow.metrics?.peak.toFixed(4)}</p>
					<p class="readout">Sound: {soundMode} · {listeningFocus} · {selectedFingerprint} · {soundState}</p>
					{#if lastAudioWindow.metadata?.attemptedChannels?.length}
						<p class="readout">Tried: {lastAudioWindow.metadata.attemptedChannels.map((attempt) => `${attempt.channel}:${attempt.status}`).join(', ')}</p>
					{/if}
				{:else}
					<p class="readout">State: not loaded. Press Load Window to fetch evidence before playback/export.</p>
				{/if}
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
			<button data-testid="load-window" onclick={loadWindow} disabled={isLoading}>{isLoading ? 'Loading…' : 'Load Window'}</button>
			<button class="primary" data-testid="begin-listening" onclick={playLoaded}>{isPlaying ? 'Restart Loaded Loop' : 'Play Loaded Loop'}</button>
			<button onclick={stop}>Stop</button>
			<button onclick={downloadWav} disabled={isExporting || !lastAudioWindow}>{isExporting ? 'Rendering WAV…' : 'Download WAV + metadata'}</button>
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
