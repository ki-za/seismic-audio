// ── Tier 2–3 Domain Diagnostics ──
// Pure unit-level checks for value objects, state machine, use cases.
// Run: npx tsx scripts/domain-diag.ts

import {
	providerFromStationId,
	providerLabel,
	isArchiveProvider,
	type ProviderId,
} from "../src/lib/domain/provider-id";
import {
	nslcForStation,
	nslcToChannelHint,
	parseChannelHint,
	channelHintForStation,
	type NSLC,
} from "../src/lib/domain/station";
import {
	transitionLoadState,
	initialLoadState,
	loadStateLabel,
	type LoadStateSnapshot,
} from "../src/lib/domain/load-state";
import {
	selectProvider,
	compareAudioSettings,
	advanceLoadState,
	getStationNSLC,
} from "../src/lib/application/seismic-audio-session";
import type { AudioSettingsSnapshot } from "../src/lib/domain/types";

let failures = 0;
function assert(label: string, condition: boolean, detail?: string) {
	if (condition) {
		console.log(`  ✅ ${label}`);
	} else {
		console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
		failures += 1;
	}
}

// ── ProviderId ──

console.log("\n📦 ProviderId");
assert("local → bridge", providerFromStationId("local") === "bridge");
assert(
	"RD432 → raspberryshake",
	providerFromStationId("RD432") === "raspberryshake",
);
assert("label bridge", providerLabel("bridge") === "Local Bridge");
assert(
	"label raspberryshake",
	providerLabel("raspberryshake") === "Raspberry Shake Archive",
);
assert("isArchive bridge", isArchiveProvider("bridge") === false);
assert(
	"isArchive raspberryshake",
	isArchiveProvider("raspberryshake") === true,
);

// ── StationId + NSLC ──

console.log("\n📦 Station / NSLC");
assert("RD432 NSLC exists", nslcForStation("RD432") !== null);
assert("local NSLC is null", nslcForStation("local") === null);

const rd432 = nslcForStation("RD432")!;
assert("NSLC.network", rd432.network === "AM");
assert("NSLC.station", rd432.station === "RD432");
assert("NSLC.location", rd432.location === "00");
assert("NSLC.channel", rd432.channel === "EHZ");

const hint = nslcToChannelHint({
	network  : "AM",
	station  : "RD432",
	location : "00",
	channel  : "EHZ",
});
assert("toChannelHint", hint === "AM.RD432.00.EHZ");

const parsed = parseChannelHint("AM.RD432.00.EHZ");
assert("parseChannelHint ok", parsed !== null);
if (parsed) {
	assert("parse network", parsed.network === "AM");
	assert("parse station", parsed.station === "RD432");
	assert("parse location", parsed.location === "00");
	assert("parse channel", parsed.channel === "EHZ");
}
assert("parse bad hint", parseChannelHint("garbage") === null);
assert("parse too short", parseChannelHint("A.B.C") === null);
assert(
	"channelHintForStation RD432",
	channelHintForStation("RD432") === "AM.RD432.00.EHZ",
);

// ── LoadState machine ──

console.log("\n📦 LoadState");
const idle = initialLoadState();
assert("initial is idle", idle.state === "idle");
assert("loadStateLabel idle", loadStateLabel("idle") === "Idle");

const loading = transitionLoadState(idle, { kind: "START_LOAD" });
assert("idle → loading", loading.state === "loading");

const loaded = transitionLoadState(loading, {
	kind             : "LOAD_SUCCEEDED",
	requestedChannel : "EHZ",
	actualChannel    : "EHZ",
});
assert("loading → loaded (exact match)", loaded.state === "loaded");

const fallback = transitionLoadState(loading, {
	kind             : "LOAD_SUCCEEDED",
	requestedChannel : "EHZ",
	actualChannel    : "SHZ",
});
assert("loading → fallback (different channel)", fallback.state === "fallback");

const failed = transitionLoadState(loading, {
	kind  : "LOAD_FAILED",
	error : "timeout",
});
assert(
	"loading → failed",
	failed.state === "failed" && failed.error === "timeout",
);

const stale = transitionLoadState(loaded, { kind: "SETTINGS_CHANGED" });
assert("loaded → stale", stale.state === "stale");

const staleToStale = transitionLoadState(stale, { kind: "SETTINGS_CHANGED" });
assert("stale stays stale", staleToStale.state === "stale");

const idleUnchanged = transitionLoadState(idle, { kind: "SETTINGS_CHANGED" });
assert("idle ignores settings change", idleUnchanged.state === "idle");

// ── SelectProvider use case ──

console.log("\n📦 SelectProvider");
const localProvider = selectProvider("local");
assert("local provider id", localProvider.id === "bridge");
assert("local provider label", localProvider.label === "Local Bridge");
assert("local provider archive", localProvider.isArchive === false);

const rsProvider = selectProvider("RD432");
assert("RS provider id", rsProvider.id === "raspberryshake");
assert("RS provider label", rsProvider.label === "Raspberry Shake Archive");
assert("RS provider archive", rsProvider.isArchive === true);

// ── CompareAudioSettings use case ──

console.log("\n📦 CompareAudioSettings");
const base: AudioSettingsSnapshot = {
	soundMode      : "soft",
	listeningFocus : "gentle",
	compression: {
		thresholdDb : -18,
		ratio       : 4,
		attackMs    : 5,
		releaseMs   : 90,
		makeupDb    : 3,
	},
	renderQuality      : "balanced",
	playbackSeconds    : 60,
	renderedSampleRate : 48000,
};

const same = compareAudioSettings(base, base);
assert("identical → no changes", same.anyChanged === false);

const differentMode = compareAudioSettings({ ...base, soundMode: "raw" }, base);
assert(
	"soundMode change detected",
	differentMode.anyChanged === true && differentMode.soundModeChanged,
);

const differentComp = compareAudioSettings(
	{
		...base,
		compression: { ...base.compression, ratio: 8 },
	},
	base,
);
assert(
	"compression change detected",
	differentComp.anyChanged === true && differentComp.compressionChanged,
);

const nullLoaded = compareAudioSettings(base, null);
assert("null loaded → no changes", nullLoaded.anyChanged === false);

const multiChange = compareAudioSettings(
	{
		soundMode      : "raw",
		listeningFocus : "scientific",
		compression: {
			thresholdDb : -12,
			ratio       : 8,
			attackMs    : 10,
			releaseMs   : 180,
			makeupDb    : 6,
		},
		renderQuality      : "studio",
		playbackSeconds    : 30,
		renderedSampleRate : 48000,
	},
	base,
);
assert("all changed", multiChange.changedLabels.length === 5);
assert(
	"labels include sound mode",
	multiChange.changedLabels.includes("sound mode"),
);
assert("labels include focus", multiChange.changedLabels.includes("focus"));
assert(
	"labels include compression",
	multiChange.changedLabels.includes("compression"),
);

// ── advanceLoadState ──

console.log("\n📦 advanceLoadState");
const advOk = advanceLoadState(idle, {
	ok               : true,
	requestedChannel : "EHZ",
	actualChannel    : "EHZ",
});
assert("advance success → loaded", advOk.state === "loaded");

const advFallback = advanceLoadState(idle, {
	ok               : true,
	requestedChannel : "EHZ",
	actualChannel    : "SHZ",
});
assert("advance fallback → fallback", advFallback.state === "fallback");

const advFail = advanceLoadState(idle, { ok: false, error: "timeout" });
assert(
	"advance fail → failed",
	advFail.state === "failed" && advFail.error === "timeout",
);

// ── getStationNSLC ──

console.log("\n📦 getStationNSLC");
assert("RD432 has NSLC", getStationNSLC("RD432")?.channel === "EHZ");
assert("local has no NSLC", getStationNSLC("local") === null);

// ── Tier 3: UI flow simulation ──

console.log("\n📦 Tier 3: UI flow simulation");
// Simulate: user selects station, loads, then changes settings
const initial = initialLoadState();
assert("start idle", initial.state === "idle");

const afterLoading = transitionLoadState(initial, { kind: "START_LOAD" });
assert("→ loading", afterLoading.state === "loading");

const afterSuccess = transitionLoadState(afterLoading, {
	kind             : "LOAD_SUCCEEDED",
	requestedChannel : "EHZ",
	actualChannel    : "EHZ",
});
assert("→ loaded", afterSuccess.state === "loaded");

// User changes soundMode — settings comparison should detect it
const loadedSettings: AudioSettingsSnapshot = {
	soundMode      : "soft",
	listeningFocus : "gentle",
	compression: {
		thresholdDb : -18,
		ratio       : 4,
		attackMs    : 5,
		releaseMs   : 90,
		makeupDb    : 3,
	},
	renderQuality      : "balanced",
	playbackSeconds    : 60,
	renderedSampleRate : 48000,
};
const currentSettings: AudioSettingsSnapshot = {
	...loadedSettings,
	soundMode: "raw",
};
const comparison = compareAudioSettings(currentSettings, loadedSettings);
assert(
	"settings changed detected",
	comparison.anyChanged && comparison.soundModeChanged,
);

// LoadState responds to settings change
const afterSettingsChange = transitionLoadState(afterSuccess, {
	kind: "SETTINGS_CHANGED",
});
assert("→ stale after settings change", afterSettingsChange.state === "stale");

// Stale state triggers reload, which succeeds
const afterReload = transitionLoadState(afterSettingsChange, {
	kind: "START_LOAD",
});
assert("stale → loading on reload", afterReload.state === "loading");
const afterReloadOk = transitionLoadState(afterReload, {
	kind             : "LOAD_SUCCEEDED",
	requestedChannel : "EHZ",
	actualChannel    : "EHZ",
});
assert("→ loaded again", afterReloadOk.state === "loaded");

// ── Summary ──

console.log(
	failures
		? `\n❌ ${failures} test(s) failed`
		: "\n✅ All domain diagnostics passed",
);
process.exit(failures ? 1 : 0);
