<script lang="ts">
	import { isAppError, buildAudioSettingsSnapshot, buildRequestKey, fingerprintAudioSettings, getAudioPlayer, getBridgeStatus, connectBridgeStatus, loadWindow, playPrepared, prepareSamplesChunked, exportWav, makeExportName, makeExportMetadata, selectProvider, compareAudioSettings, advanceLoadState, raspberryShakeStations, searchStations, toStationChoice } from '$lib/composition/main';
	import { 
		DEFAULT_DSP_TUNING,
		type DspTuningState
	} from '$lib/application/dsp-tuning';
	import { initialLoadState, loadStateLabel } from '$lib/domain/load-state';
	import { MAX_PLAYBACK_SECONDS, MAX_WINDOW_SECONDS, clampQuerySeconds, formatQueryDuration, isoFromDateTimeLocal, queryRangeSummary } from '$lib/domain/query-range';
	import type { AppError } from '$lib/core/errors';
	import type { LoadStateSnapshot } from '$lib/domain/load-state';
	import type { ProviderInfo, SettingsComparison } from '$lib/composition/main';
	import type { AudioWindow, BridgeStatus, CompressionSettings, ListeningFocus, PlaybackChoice, RenderQuality, SoundMode, StationChoice, WindowChoice } from '$lib/types';

	const windows: WindowChoice[] = [
		{ label: '15 min', seconds: 15 * 60 },
		{ label: '1 hour', seconds: 60 * 60 },
		{ label: '6 hours', seconds: 6 * 60 * 60 },
		{ label: '12 hours', seconds: MAX_WINDOW_SECONDS }
	];
	const playbacks: PlaybackChoice[] = [
		{ label: '10 sec', seconds: 10 },
		{ label: '30 sec', seconds: 30 },
		{ label: '1 min', seconds: 60 },
		{ label: '5 min', seconds: 5 * 60 },
		{ label: '15 min', seconds: MAX_PLAYBACK_SECONDS }
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
	const localStation: StationChoice = { id: 'local', name: 'Synthetic / LAN bridge', place: 'local bridge feed', channelHint: 'bridge channel', status: 'synthetic' };
	const favouriteStationMetadata = [
		{ id: 'S99EB', place: 'Mexico' },
		{ id: 'R9B86', place: 'Canada' },
		{ id: 'S2C02', place: 'South Africa' },
		{ id: 'R135F', place: 'Iceland' },
		{ id: 'R4C3D', place: 'China' }
	] as const;
	const favouriteStationIds: string[] = favouriteStationMetadata.map((station) => station.id);
	const favouriteStations = raspberryShakeStations
		.filter((station) => favouriteStationIds.includes(station.code))
		.map(toStationChoice);
	const archiveStationsById = new Map(raspberryShakeStations.map((station) => [station.code, toStationChoice(station)]));

	let status = $state<BridgeStatus | null>(null);
	let connection = $state('connecting');
	let selectedWindowSeconds = $state(windows[1].seconds);
	let selectedPlaybackSeconds = $state(playbacks[2].seconds);
	let queryStartDate = $state(defaultStartParts(windows[1].seconds).date);
	let queryStartTime = $state(defaultStartParts(windows[1].seconds).time);
	let queryControlsOpen = $state(false);
	let windowAmount = $state(1);
	let windowUnit = $state<'minutes' | 'hours'>('hours');
	let playbackAmount = $state(1);
	let playbackUnit = $state<'seconds' | 'minutes'>('minutes');
	let selectedStationId = $state(localStation.id);
	let stationSearch = $state('');
	let soundMode = $state<SoundMode>('soft');
	let renderQuality = $state<RenderQuality>('balanced');
	let listeningFocus = $state<ListeningFocus>('gentle');
	let compression = $state<CompressionSettings>({ thresholdDb: -18, ratio: 4, attackMs: 5, releaseMs: 90, makeupDb: 3 });
	let isPlaying = $state(false);
	type PlayPhase = 'idle' | 'loading' | 'rendering' | 'starting' | 'playing';
	let playPhase = $state<PlayPhase>('idle');
	let dspProgress = $state(0);
	let isLoading = $state(false);
	let showMode = $state(false);
	let error = $state<AppError | null>(null);
	let audioLevel = $state(0);
	let lastAudioWindow = $state<AudioWindow | null>(null);
	let loadedRequestKey = $state<string | null>(null);
	let loadedWindowId = $state<string | null>(null);
	let loadedFingerprint = $state<string | null>(null);
	let loadedSettingsSnapshot = $state<ReturnType<typeof buildAudioSettingsSnapshot> | null>(null);
	let activeFingerprint = $state<string | null>(null);
	let isExporting = $state(false);
	let loadState = $state<LoadStateSnapshot>(initialLoadState());
	let dspTuning = $state<DspTuningState>(structuredClone(DEFAULT_DSP_TUNING));
	let dspSectionOpen = $state(false);

	const player = getAudioPlayer();
	player.setLevelCallback((level) => (audioLevel = level));

	const selectedWindow = $derived(windows.find((choice) => choice.seconds === selectedWindowSeconds) ?? { label: formatQueryDuration(selectedWindowSeconds), seconds: selectedWindowSeconds });
	const selectedPlayback = $derived(playbacks.find((choice) => choice.seconds === selectedPlaybackSeconds) ?? { label: formatQueryDuration(selectedPlaybackSeconds), seconds: selectedPlaybackSeconds });
	const visibleArchiveStations = $derived(searchStations(raspberryShakeStations, stationSearch, favouriteStationIds, 30).map(toStationChoice));
	const selectedStation = $derived(selectedStationId === localStation.id ? localStation : archiveStationsById.get(selectedStationId) ?? favouriteStations[0] ?? localStation);
	const queryStartISO = $derived(isoFromDateTimeLocal(queryStartDate, queryStartTime));
	const querySummary = $derived(queryRangeSummary({ startISO: queryStartISO, windowSeconds: selectedWindowSeconds, playbackSeconds: selectedPlaybackSeconds }));
	const queryIsValid = $derived(selectedWindowSeconds <= MAX_WINDOW_SECONDS && selectedPlaybackSeconds <= MAX_PLAYBACK_SECONDS);
	const compressionText = $derived(`${selectedWindow.label} → ${selectedPlayback.label}`);
	const availabilityText = $derived(selectedStation.id === 'local' ? (status ? formatDuration(status.secondsStored) : 'no data yet') : 'archive request uses now - 35 min');
	const bridgeText = $derived(status ? `${status.samplesStored.toLocaleString()} local samples · ${status.channels.join(', ') || 'no local channel yet'}` : 'waiting for bridge');
	const activeChannel = $derived(selectedStation.id === 'local' ? (status?.channels[0] ?? selectedStation.channelHint) : selectedStation.channelHint.split('.').pop() ?? selectedStation.channelHint);
	const selectedQuality = $derived(renderQualities.find((choice) => choice.value === renderQuality) ?? renderQualities[1]);
	const selectedRequestKey = $derived(buildRequestKey({ provider: selectedStation.id === 'local' ? 'bridge' : 'raspberryshake', stationId: selectedStation.id, channel: selectedStation.id === 'local' ? status?.channels[0] : undefined, windowSeconds: selectedWindowSeconds, playbackSeconds: selectedPlaybackSeconds, renderQuality, startISO: queryStartISO }));
	const selectedFingerprint = $derived(fingerprintAudioSettings(buildAudioSettingsSnapshot({ soundMode, listeningFocus, compression, renderQuality, playbackSeconds: selectedPlaybackSeconds, renderedSampleRate: lastAudioWindow?.renderedSampleRate ?? 0 })));
	const loadedStateDerived = $derived(loadStateLabel(loadState.state));
	const loadedState = $derived(isLoading ? 'loading' : loadState.state);
	const soundState = $derived(!loadedFingerprint ? 'not loaded' : selectedFingerprint !== loadedFingerprint ? 'changed · replay to hear' : activeFingerprint === loadedFingerprint && isPlaying ? 'playing · applied' : 'loaded · ready');
	const providerInfo = $derived(selectProvider(selectedStationId));
	const settingsComparison: SettingsComparison = $derived(
		compareAudioSettings(
			buildAudioSettingsSnapshot({ soundMode, listeningFocus, compression, renderQuality, playbackSeconds: selectedPlaybackSeconds, renderedSampleRate: lastAudioWindow?.renderedSampleRate ?? 0 }),
			loadedSettingsSnapshot
		)
	);

	$effect(() => {
		getBridgeStatus().then((next) => (status = next)).catch(() => (connection = 'offline'));
		return connectBridgeStatus((next) => (status = next), (next) => (connection = next));
	});

	async function loadWindowAction() {
		error = null;
		isLoading = true;
		loadState = { state: 'loading' };
		try {
			const loaded = await loadWindow(selectedRequestKey, makeAudioRequest(), {
				soundMode, listeningFocus, compression, renderQuality, playbackSeconds: selectedPlaybackSeconds
			});
			lastAudioWindow = loaded.window;
			loadedRequestKey = loaded.requestKey;
			loadedWindowId = loaded.windowId;
			loadedFingerprint = loaded.settingsFingerprint;
			loadedSettingsSnapshot = loaded.settingsSnapshot;
			loadState = advanceLoadState(loadState, {
				ok: true,
				requestedChannel: activeChannel,
				actualChannel: loaded.window.channel
			});
		} catch (caught) {
			loadState = advanceLoadState(loadState, {
				ok: false,
				error: caught instanceof Error ? caught.message : String(caught)
			});
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
		// Phase 0: load window if stale or not yet loaded
		if (!lastAudioWindow || loadState.state === 'stale') {
			playPhase = 'loading';
			await loadWindowAction();
		}
		if (!lastAudioWindow) {
			playPhase = 'idle';
			return;
		}
		try {
			// Phase 1: prepare samples in chunks with progress feedback
			playPhase = 'rendering';
			const samples = await prepareSamplesChunked(
				lastAudioWindow.samples,
				soundMode,
				(pct) => { dspProgress = Math.round(pct * 100); },
				lastAudioWindow.renderedSampleRate,
				dspTuning,
			);
			// Phase 2: start Web Audio (creates/resumes AudioContext, wires nodes)
			playPhase = 'starting';
			await playPrepared(samples, lastAudioWindow.renderedSampleRate, soundMode, compression, listeningFocus);
			// Phase 3: playing
			playPhase = 'playing';
			isPlaying = true;
			loadedFingerprint = selectedFingerprint;
			activeFingerprint = selectedFingerprint;
			dspProgress = 0;
		} catch (caught) {
			playPhase = 'idle';
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
			const audioWindow = lastAudioWindow ?? (await loadWindow(selectedRequestKey, makeAudioRequest(), {
				soundMode, listeningFocus, compression, renderQuality, playbackSeconds: selectedPlaybackSeconds
			})).window;
			lastAudioWindow = audioWindow;
			await exportWav({
				window: audioWindow,
				soundMode,
				compression,
				listeningFocus,
				wavFilename: makeExportName({
					stationId: selectedStation.id,
					channel: audioWindow.channel,
					windowSeconds: audioWindow.windowSeconds,
					playbackSeconds: audioWindow.playbackSeconds,
					soundMode,
					renderQuality
				}, 'wav'),
				metadataFilename: makeExportName({
					stationId: selectedStation.id,
					channel: audioWindow.channel,
					windowSeconds: audioWindow.windowSeconds,
					playbackSeconds: audioWindow.playbackSeconds,
					soundMode,
					renderQuality
				}, 'json'),
				metadata: makeExportMetadata({
					window: audioWindow,
					soundMode,
					renderQuality,
					listeningFocus,
					compression,
					windowId: loadedWindowId ?? '',
					settingsFingerprint: selectedFingerprint
				})
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

	function applyWindowSeconds(seconds: number) {
		selectedWindowSeconds = clampQuerySeconds({ windowSeconds: seconds, playbackSeconds: selectedPlaybackSeconds }).windowSeconds;
		windowAmount = selectedWindowSeconds >= 3600 ? selectedWindowSeconds / 3600 : selectedWindowSeconds / 60;
		windowUnit = selectedWindowSeconds >= 3600 ? 'hours' : 'minutes';
	}

	function applyPlaybackSeconds(seconds: number) {
		selectedPlaybackSeconds = clampQuerySeconds({ windowSeconds: selectedWindowSeconds, playbackSeconds: seconds }).playbackSeconds;
		playbackAmount = selectedPlaybackSeconds >= 60 ? selectedPlaybackSeconds / 60 : selectedPlaybackSeconds;
		playbackUnit = selectedPlaybackSeconds >= 60 ? 'minutes' : 'seconds';
	}

	function applyGranularWindow() {
		applyWindowSeconds(windowAmount * (windowUnit === 'hours' ? 3600 : 60));
	}

	function applyGranularPlayback() {
		applyPlaybackSeconds(playbackAmount * (playbackUnit === 'minutes' ? 60 : 1));
	}

	function makeAudioRequest() {
		return {
			windowSeconds: selectedWindowSeconds,
			playbackSeconds: selectedPlaybackSeconds,
			quality: renderQuality,
			startISO: queryStartISO,
			...(selectedStation.id === 'local'
				? { source: 'bridge' as const, channel: status?.channels[0] }
				: { source: 'raspberryshake' as const, station: selectedStation.id })
		};
	}

	function stop() {
		player.stop();
		isPlaying = false;
		playPhase = 'idle';
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

	function defaultStartParts(windowSeconds: number) {
		const date = new Date(Date.now() - 35 * 60_000 - windowSeconds * 1000);
		return {
			date: date.toISOString().slice(0, 10),
			time: date.toTimeString().slice(0, 5)
		};
	}

</script>

<svelte:document onfullscreenchange={() => (showMode = Boolean(document.fullscreenElement))} />

<main class={showMode ? 'show' : ''}>
	<section class="hero">
		<p class="eyebrow">Seismic Audio Dashboard</p>
		<h1>7 Signals.</h1>
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
				<p>Provider <small>{providerInfo.label}</small></p>
				<div class="buttons">
					<button class={providerInfo.id === 'bridge' ? 'selected' : ''} onclick={() => (selectedStationId = localStation.id)}>󰓅 Bridge</button>
					<button class={providerInfo.id === 'raspberryshake' ? 'selected' : ''} onclick={() => (selectedStationId = favouriteStations[0]?.id ?? 'RD432')}>󰀂 Archive</button>
				</div>
				<p class="readout">{providerInfo.isArchive ? 'Archive uses data.raspberryshake.org, -35 min delay' : 'Local bridge buffer, rolling window'}</p>
			</div>

			<div class="group wide">
				<p>Station / location <small>selected ≠ loaded</small></p>
				<div class="station-search">
					<label>
						<span>Search by station code or place</span>
						<input bind:value={stationSearch} placeholder="R0066, California, Jamaica…" autocomplete="off" />
					</label>
				</div>
				<div class="station-list">
					<button class={localStation.id === selectedStationId ? 'selected' : ''} onclick={() => (selectedStationId = localStation.id)}>
						<strong>{localStation.name}</strong>
						<span>{localStation.place} · {localStation.id === selectedStationId ? loadedState : 'untested'}</span>
					</button>
					{#if !stationSearch.trim()}
						{#each favouriteStations as station (station.id)}
							<button class={station.id === selectedStationId ? 'selected' : ''} onclick={() => (selectedStationId = station.id)}>
								<strong>★ {station.name}</strong>
								<span>{station.place} · {station.id === selectedStationId ? loadedState : 'untested'}</span>
							</button>
						{/each}
					{:else}
						{#each visibleArchiveStations as station (station.id)}
							<button class={station.id === selectedStationId ? 'selected' : ''} onclick={() => (selectedStationId = station.id)}>
								<strong>{station.name}</strong>
								<span>{station.place} · {station.id === selectedStationId ? loadedState : 'untested'}</span>
							</button>
						{/each}
					{/if}
				</div>
				<p class="readout">Selected channel target: {activeChannel}</p>
			</div>

			<div class="group wide evidence" data-testid="loaded-evidence" data-state={loadedState} data-fingerprint={selectedFingerprint} data-active-fingerprint={activeFingerprint ?? ''}>
				<p>Loaded evidence <small>{loadedStateDerived}</small></p>
				{#if lastAudioWindow}
					<p class="readout">Provider: {providerInfo.label}</p>
					<p class="readout">NSLC: {lastAudioWindow.network ?? '--'}.{lastAudioWindow.station ?? selectedStation.id}.{lastAudioWindow.location ?? '--'}.{lastAudioWindow.channel}</p>
					{#if lastAudioWindow.metadata?.requestedChannel && lastAudioWindow.metadata.requestedChannel !== lastAudioWindow.channel}
						<p class="readout">Fallback: requested {lastAudioWindow.metadata.requestedChannel}, got {lastAudioWindow.channel}</p>
					{/if}
					<p class="readout">Range: {lastAudioWindow.startISO ?? 'rolling buffer'} → {lastAudioWindow.endISO ?? 'now'}</p>
					<p class="readout">Render: {lastAudioWindow.renderedSampleRate.toLocaleString()} Hz · {lastAudioWindow.samples.length.toLocaleString()} samples · {(lastAudioWindow.samples.length / lastAudioWindow.renderedSampleRate).toFixed(1)}s</p>
					<p class="readout">Metrics: RMS {lastAudioWindow.metrics?.rms.toFixed(4)} · Peak {lastAudioWindow.metrics?.peak.toFixed(4)} · ZCR {lastAudioWindow.metrics?.zeroCrossingRate?.toFixed(4) ?? '—'}</p>
					<p class="readout">Sound: {soundMode} · {listeningFocus} · sig {selectedFingerprint} · {soundState}</p>
					{#if settingsComparison.anyChanged}
						<p class="readout warn">⚡ Settings changed: {settingsComparison.changedLabels.join(', ')} — replay to apply</p>
					{/if}
					{#if loadState.state === 'fallback'}
						<p class="readout warn">⚠ Loaded via fallback channel</p>
					{/if}
					{#if loadState.error}
						<p class="readout error">⛔ {loadState.error}</p>
					{/if}
					{#if lastAudioWindow.metadata?.attemptedChannels?.length}
						<p class="readout">Tried: {lastAudioWindow.metadata.attemptedChannels.map((attempt) => `${attempt.channel}:${attempt.status}`).join(', ')}</p>
					{/if}
				{:else}
					<p class="readout">State: not loaded. Press Load Window to fetch evidence before playback/export.</p>
				{/if}
			</div>

			<div class="group wide query-panel">
				<p>Query <small>max 12h data · 15m compressed</small></p>
				<div class="query-section">
					<span>Quick source range</span>
					<div class="buttons">
						{#each windows as choice (choice.seconds)}
							<button class={choice.seconds === selectedWindowSeconds ? 'selected' : ''} onclick={() => applyWindowSeconds(choice.seconds)}>{choice.label}</button>
						{/each}
					</div>
				</div>
				<div class="query-section">
					<span>Quick compress into</span>
					<div class="buttons">
						{#each playbacks as choice (choice.seconds)}
							<button class={choice.seconds === selectedPlaybackSeconds ? 'selected' : ''} onclick={() => applyPlaybackSeconds(choice.seconds)}>{choice.label}</button>
						{/each}
					</div>
				</div>
				<p class="readout">{querySummary.windowLabel} earth time → {querySummary.playbackLabel} audio · {querySummary.compressionRatio}</p>
				<button class="dsp-toggle" onclick={() => (queryControlsOpen = !queryControlsOpen)}>
					<span class="dsp-arrow">{queryControlsOpen ? '▾' : '▸'}</span>
					More granular controls
				</button>
				{#if queryControlsOpen}
					<div class="granular-query">
						<label>Data starts at date <input type="date" bind:value={queryStartDate} /></label>
						<label>Data starts at time <input type="time" bind:value={queryStartTime} /></label>
						<label>Request length <input type="number" min="1" max={windowUnit === 'hours' ? 12 : 720} step="0.25" bind:value={windowAmount} oninput={applyGranularWindow} /></label>
						<label>Unit <select bind:value={windowUnit} onchange={applyGranularWindow}><option value="minutes">minutes</option><option value="hours">hours</option></select></label>
						<label>Compress into <input type="number" min="1" max={playbackUnit === 'minutes' ? 15 : 900} step="1" bind:value={playbackAmount} oninput={applyGranularPlayback} /></label>
						<label>Unit <select bind:value={playbackUnit} onchange={applyGranularPlayback}><option value="seconds">seconds</option><option value="minutes">minutes</option></select></label>
						<p class="readout">Range: {queryStartISO} → {querySummary.endISO}</p>
						{#if !queryIsValid}
							<p class="readout error">Maximum request is 12 hours of data and 15 minutes of compressed audio.</p>
						{/if}
					</div>
				{/if}
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

				<div class="group wide dsp-section">
				<div class="dsp-header-row">
					<button class="dsp-toggle" onclick={() => (dspSectionOpen = !dspSectionOpen)}>
						<span class="dsp-arrow">{dspSectionOpen ? '▾' : '▸'}</span>
						DSP Tuning
						<small>
							{dspTuning.impulse.enabled ? 'impulse ' : ''}
							{dspTuning.saturation.enabled ? 'saturation ' : ''}
							{dspTuning.expander.enabled ? 'expander' : ''}
							{!dspTuning.impulse.enabled && !dspTuning.saturation.enabled && !dspTuning.expander.enabled ? 'all off' : ''}
						</small>
					</button>
					<a class="dsp-docs-link" href="/dsp-guide" title="DSP tuning guide">󰈙</a>
				</div>
				{#if dspSectionOpen}
					<div class="dsp-controls">
						<div class="dsp-stage">
							<label class="dsp-stage-header">
								<input type="checkbox" bind:checked={dspTuning.impulse.enabled} />
								Impulse suppression <small>Hampel / median click repair</small>
							</label>
							<div class="knobs">
								<label>Radius <input type="range" min="1" max="8" bind:value={dspTuning.impulse.radius} /> <span>{dspTuning.impulse.radius}</span></label>
								<label>Threshold <input type="range" min="4" max="14" step="0.5" bind:value={dspTuning.impulse.thresholdMAD} /> <span>{dspTuning.impulse.thresholdMAD} MAD</span></label>
								<label>Blend <input type="range" min="0" max="1" step="0.05" bind:value={dspTuning.impulse.blend} /> <span>{dspTuning.impulse.blend.toFixed(2)}</span></label>
							</div>
						</div>
						<div class="dsp-stage">
							<label class="dsp-stage-header">
								<input type="checkbox" bind:checked={dspTuning.saturation.enabled} />
								Asymmetric saturation <small>P1 — harmonic warmth</small>
							</label>
							<div class="knobs">
								<label>Drive <input type="range" min="1" max="4" step="0.1" bind:value={dspTuning.saturation.drive} /> <span>{dspTuning.saturation.drive.toFixed(1)}</span></label>
								<label>Knee <input type="range" min="0.4" max="0.98" step="0.02" bind:value={dspTuning.saturation.knee} /> <span>{dspTuning.saturation.knee.toFixed(2)}</span></label>
								<label>Asymmetry <input type="range" min="0" max="0.25" step="0.01" bind:value={dspTuning.saturation.asymmetry} /> <span>{dspTuning.saturation.asymmetry.toFixed(2)}</span></label>
								<label>Wet/dry <input type="range" min="0" max="0.5" step="0.05" bind:value={dspTuning.saturation.wetDryMix} /> <span>{dspTuning.saturation.wetDryMix.toFixed(2)}</span></label>
								<label>Trim <input type="range" min="-6" max="0" step="0.5" bind:value={dspTuning.saturation.outputTrimDb} /> <span>{dspTuning.saturation.outputTrimDb.toFixed(1)} dB</span></label>
							</div>
						</div>
						<div class="dsp-stage">
							<label class="dsp-stage-header">
								<input type="checkbox" bind:checked={dspTuning.expander.enabled} />
								Downward expander <small>P1 — noise gate with comfort noise</small>
							</label>
							<div class="knobs">
								<label>Threshold <input type="range" min="-70" max="-30" bind:value={dspTuning.expander.thresholdDb} /> <span>{dspTuning.expander.thresholdDb} dB</span></label>
								<label>Ratio <input type="range" min="1.2" max="3" step="0.1" bind:value={dspTuning.expander.ratio} /> <span>{dspTuning.expander.ratio.toFixed(1)}:1</span></label>
								<label>Depth <input type="range" min="4" max="20" bind:value={dspTuning.expander.maxDepthDb} /> <span>{dspTuning.expander.maxDepthDb} dB</span></label>
								<label>Attack <input type="range" min="5" max="60" bind:value={dspTuning.expander.attackMs} /> <span>{dspTuning.expander.attackMs} ms</span></label>
								<label>Release <input type="range" min="100" max="1000" bind:value={dspTuning.expander.releaseMs} /> <span>{dspTuning.expander.releaseMs} ms</span></label>
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>

		<div class="actions">
			<button data-testid="load-window" onclick={loadWindowAction} disabled={isLoading || !queryIsValid}>{isLoading ? 'Loading…' : 'Load Window'}</button>
			<button class="primary" data-testid="begin-listening" onclick={playLoaded} disabled={playPhase === 'loading' || playPhase === 'rendering' || playPhase === 'starting'}>
				{playPhase === 'loading' ? 'Loading window…' : playPhase === 'rendering' ? `Processing samples… ${dspProgress}%` : playPhase === 'starting' ? 'Starting audio…' : isPlaying ? 'Restart Loaded Loop' : 'Play Loaded Loop'}
			</button>
			<button onclick={stop}>Stop</button>
			<button onclick={downloadWav} disabled={isExporting || !lastAudioWindow}>{isExporting ? 'Rendering WAV…' : 'Download WAV + metadata'}</button>
			<button onclick={showMode ? exitShowMode : enterShowMode}>{showMode ? 'Exit show mode' : 'Fullscreen show mode'}</button>
		</div>

		<button class="dsp-reset" onclick={() => { dspTuning = structuredClone(DEFAULT_DSP_TUNING); }}>Reset DSP to defaults</button>

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
