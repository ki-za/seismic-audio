<script lang="ts">
	import { DEFAULT_DSP_TUNING } from '$lib/application/dsp-tuning';
</script>

<!--
  ── DSP Tuning User Guide ──
  Inlines the defaults from the DSP module as a reference.
  Render with: <DspTuningGuide />
-->

<div class="dsp-guide">
	<h2>DSP Tuning Guide</h2>
	<p class="lede">
		These three DSP stages run <em>before</em> the Web Audio compressor and limiter,
		processing raw seismic samples into the signal you hear. Each stage can be
		toggled independently so you can A/B its effect in real time.
	</p>

	<!-- ── Impulse Suppression ── -->
	<section>
		<h3>󰓦 Impulse suppression <small>Hampel / median click repair</small></h3>
		<p>
			Seismic recordings often contain isolated high-energy transients — pops, clicks,
			or spikes from local noise, instrument glitches, or ground motion near the sensor.
			This stage detects them using the <strong>Hampel identifier</strong>: for each
			sample it looks at the surrounding neighbourhood, computes the local median and MAD
			(median absolute deviation), and flags anything that sticks out too far.
		</p>

		<dl>
			<dt>
				Radius
				<span class="default">default: {DEFAULT_DSP_TUNING.impulse.radius}</span>
			</dt>
			<dd>
				How many neighbours on each side to inspect. <strong>Higher = wider detection</strong>
				but also more computation. A radius of 3 checks 6 neighbours per sample;
				8 checks 16. Seismic clicks are usually 1–3 samples wide, so radius 3–5
				covers most cases. Raise it only if you hear longer bursts.
			</dd>

			<dt>
				Threshold (MAD)
				<span class="default">default: {DEFAULT_DSP_TUNING.impulse.thresholdMAD}</span>
			</dt>
			<dd>
				How many MAD units a sample must deviate from the local median to be
				considered an impulse. <strong>Lower = more aggressive detection.</strong>
				At 6 MAD, subtle thumps get caught; at 13 only extreme transients are
				repaired. Start near 10 and dial down until clicks vanish.
			</dd>

			<dt>
				Blend
				<span class="default">default: {DEFAULT_DSP_TUNING.impulse.blend.toFixed(1)}</span>
			</dt>
			<dd>
				Wet/dry knob for the repair itself. At <strong>1.0</strong>, flagged samples
				are fully interpolated (replaced). At <strong>0.5</strong>, half of the original
				impulse leaks through — useful when you want to hear that a click <em>was</em>
				there without letting it sting. Set to <strong>0.0</strong> to bypass
				all repair while keeping detection active (diagnostic mode).
			</dd>
		</dl>
	</section>

	<!-- ── Asymmetric Saturation ── -->
	<section>
		<h3>󰀘 Asymmetric saturation <small>P1 — harmonic warmth</small></h3>
		<p>
			A nonlinear waveshaper that adds <strong>harmonic density</strong> — think of it
			as controlled analogue-style warmth. The asymmetry introduces even harmonics
			(mostly 2nd), which the ear interprets as richness rather than harshness.
			Seismic signals are often cold and clinical; this stage gives them body.
		</p>

		<dl>
			<dt>
				Drive
				<span class="default">default: {DEFAULT_DSP_TUNING.saturation.drive.toFixed(1)}</span>
			</dt>
			<dd>
				How hard the signal hits the saturator. <strong>Higher = more harmonic
				content.</strong> At 1.0 it's nearly clean; at 4.0 you get noticeable
				warm compression on peaks. Seismic signals have huge dynamic range,
				so drive often needs to be pushed higher than you'd expect.
			</dd>

			<dt>
				Knee
				<span class="default">default: {DEFAULT_DSP_TUNING.saturation.knee.toFixed(2)}</span>
			</dt>
			<dd>
				How gradually the saturator transitions from linear to clipped.
				<strong>Higher = sharper knee</strong> (more obvious distortion character).
				<strong>Lower = softer knee</strong> (smoother, more transparent saturation).
				At 0.98 the knee is subtle — saturation creeps in. At 0.6 the transition
				is very gentle.
			</dd>

			<dt>
				Asymmetry
				<span class="default">default: {DEFAULT_DSP_TUNING.saturation.asymmetry.toFixed(2)}</span>
			</dt>
			<dd>
				A DC offset applied before saturation and subtracted after.
				<strong>Higher = more even harmonics</strong> (2nd harmonic generates
				warmth). At 0.0 the saturator is symmetric and produces only odd
				harmonics (harsher). At 0.25 the asymmetry is pronounced and the
				signal feels "tubey." Seismic material responds well to asymmetry
				around 0.06–0.12.
			</dd>

			<dt>
				Wet/dry
				<span class="default">default: {DEFAULT_DSP_TUNING.saturation.wetDryMix.toFixed(2)}</span>
			</dt>
			<dd>
				Parallel blend. <strong>0.0 = completely dry</strong> (bypassed),
				<strong>0.5 = half</strong>. Because saturation changes timbre significantly,
				it's almost always used in parallel (wet/dry &lt; 0.4). Start at 0.15
				and raise until you hear the warmth you want.
			</dd>

			<dt>
				Trim (dB)
				<span class="default">default: {DEFAULT_DSP_TUNING.saturation.outputTrimDb.toFixed(1)} dB</span>
			</dt>
			<dd>
				Output make-up gain. <strong>Negative values reduce level</strong> to
				compensate for the saturation's added energy. The saturator can push
				RMS up by 1–3 dB; trim lets you match the perceived loudness so
				A/B comparisons are fair.
			</dd>
		</dl>
	</section>

	<!-- ── Downward Expander ── -->
	<section>
		<h3>󰝥 Downward expander <small>P1 — noise gate with comfort noise</small></h3>
		<p>
			Seismic recordings have a noise floor — wind, instrument hum, distant traffic —
			that becomes audible during quiet passages. A downward expander <strong>reduces
			the level of everything below a threshold</strong>, effectively widening the
			dynamic range. Unlike a hard gate, it's smooth and adds a tiny bed of shaped
			noise ("comfort noise") so silence never feels digitally dead.
		</p>

		<dl>
			<dt>
				Threshold (dB)
				<span class="default">default: {DEFAULT_DSP_TUNING.expander.thresholdDb} dB</span>
			</dt>
			<dd>
				The level below which expansion begins. <strong>Higher = more
				expansion</strong> (quieter sounds get attenuated). Seismic noise
				floors are typically around -45 to -55 dB. Start at -50 and lower
				(less aggressive) or raise (more aggressive). If you hear the noise
				floor "pumping" between threshold crossings, the threshold is too high.
			</dd>

			<dt>
				Ratio
				<span class="default">default: {DEFAULT_DSP_TUNING.expander.ratio.toFixed(1)}:1</span>
			</dt>
			<dd>
				How much gain reduction is applied per dB below threshold.
				<strong>Higher ratio = steeper expansion.</strong> At 1.2:1 the
				effect is subtle — signals 10 dB below threshold get ≈2 dB reduction.
				At 3:1 the same signal gets ~18 dB reduction. Seismic expanders
				work best at 1.5–2.0:1.
			</dd>

			<dt>
				Depth (dB)
				<span class="default">default: {DEFAULT_DSP_TUNING.expander.maxDepthDb} dB</span>
			</dt>
			<dd>
				The maximum amount of gain reduction applied. <strong>Higher = deeper
				quieting.</strong> At 20 dB, the quietest passages get very quiet
				(but comfort noise keeps them alive). At 4 dB, the effect is barely
				noticeable. This prevents the expander from ever fully silencing
				the signal.
			</dd>

			<dt>
				Attack (ms)
				<span class="default">default: {DEFAULT_DSP_TUNING.expander.attackMs} ms</span>
			</dt>
			<dd>
				How quickly the expander closes when the signal drops below threshold.
				<strong>Faster = tighter</strong> but can sound grabby on fast material.
				Seismic signals change slowly; 20–40 ms is a sweet spot. At 5 ms you
				might hear the gain change as a tiny "breathe" on percussive events.
			</dd>

			<dt>
				Release (ms)
				<span class="default">default: {DEFAULT_DSP_TUNING.expander.releaseMs} ms</span>
			</dt>
			<dd>
				How quickly the expander opens back up when the signal rises above
				threshold. <strong>Faster = more responsive</strong> but can cause
				audible pumping. <strong>Slower = smoother</strong> but the noise
				floor takes longer to return. Seismic benefits from slow releases
				(350–800 ms) to avoid pumping on long swells.
			</dd>
		</dl>
	</section>

	<!-- ── Signal flow diagram ── -->
	<section class="flow">
		<h3>󰐊 Signal flow</h3>
		<pre>raw samples → [impulse suppression] → [saturation] → [expander] → Web Audio chain</pre>
		<p>
			The DSP pipeline runs during <strong>playback preparation</strong>,
			before the samples reach the Web Audio compressor, limiter, and
			listening-focus filter. This means the DSP stages shape the raw
			seismic material; the Web Audio nodes then apply the final polish.
			Changes to DSP tuning take effect on the <strong>next playback</strong>.
		</p>
	</section>

	<!-- ── Quick start ── -->
	<section class="start">
		<h3>󰐥 Quick start</h3>
		<ol>
			<li>
				<strong>Impulse suppression:</strong> Load audio, turn <em>Blend</em> down to 0
				to hear what's being removed, then bring it up to taste. Adjust <em>Threshold</em>
				until only the clicks you actually want to remove are flagged.
			</li>
			<li>
				<strong>Saturation:</strong> Start with <em>Wet/dry</em> at 0.15 and
				<em>Asymmetry</em> at 0.06. Raise <em>Drive</em> until the signal
				has weight. Adjust <em>Trim</em> to match perceived loudness for A/B.
			</li>
			<li>
				<strong>Expander:</strong> Enable it, set <em>Threshold</em> just above
				the noise floor (you'll hear the noise drop in and out). Dial
				<em>Depth</em> to taste — deep reduction makes quiet passages very
				quiet, which can be dramatic or distracting. Slow <em>Release</em>
				for natural-sounding expansion.
			</li>
		</ol>
	</section>

	<section class="reset">
		<p>
			Use the <strong>Reset DSP to defaults</strong> button at the bottom of the
			panel to restore factory values: impulse suppression on, saturation and
			expander off.
		</p>
	</section>
</div>

<style>
	.dsp-guide {
		font-size: 0.9rem;
		line-height: 1.6;
		color: #c8bda9;
		max-width: 50rem;
	}
	.dsp-guide h2 {
		margin: 0 0 0.75rem;
		font-size: 1.15rem;
		color: #f5efe3;
	}
	.dsp-guide h3 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
		color: #d9a95f;
	}
	.dsp-guide h3 small {
		color: #8f806e;
		font-weight: 400;
	}
	.dsp-guide .lede {
		margin: 0 0 1.25rem;
		color: #f5efe3;
	}
	.dsp-guide section {
		margin-bottom: 1.5rem;
		padding-bottom: 1.25rem;
		border-bottom: 1px solid rgba(255,255,255,0.06);
	}
	.dsp-guide section:last-child { border-bottom: 0; }
	.dsp-guide p { margin: 0 0 0.5rem; }
	.dsp-guide dl { margin: 0.5rem 0 0.25rem; }
	.dsp-guide dt {
		margin-top: 0.65rem;
		font-weight: 600;
		color: #f5efe3;
	}
	.dsp-guide .default {
		font-weight: 400;
		font-size: 0.8rem;
		color: #8f806e;
	}
	.dsp-guide dd { margin: 0.15rem 0 0.15rem 0.5rem; }
	.dsp-guide ol { margin: 0.25rem 0; padding-left: 1.15rem; }
	.dsp-guide li { margin-bottom: 0.6rem; }
	.dsp-guide pre {
		background: rgba(255,255,255,0.04);
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		font-size: 0.8rem;
		color: #f0b76a;
		overflow-x: auto;
	}
	.dsp-guide .reset {
		color: #8f806e;
		font-size: 0.82rem;
	}
</style>
