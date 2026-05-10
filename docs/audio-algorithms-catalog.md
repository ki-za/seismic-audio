# Production Audio DSP Algorithms for Seismic Sonification

> Gateway document for implementing Tier 4 sound-quality processing.
>
> Purpose: scout the algorithm landscape, explain why each technique matters, and provide language-agnostic pseudocode suitable for implementation in any DSP-capable environment.
>
> Target use case: massively time-compressed seismic waveform audio, where 24–72 hours of ~100 Hz ground-motion data becomes a 1–5 minute audio loop.

---

## 1. Executive Summary

The core problem is not "make it pretty." The core problem is: **time-compressed seismic data exposes every discontinuity, spike, noise floor, and resampling flaw as audible audio artifacts.**

The production chain should therefore do four things:

1. **Prevent artifacts before they are amplified**
   - better resampling
   - de-clicking
   - anti-aliasing
   - transient control

2. **Control harshness without erasing seismic identity**
   - de-essing
   - dynamic EQ
   - multiband dynamics

3. **Add density and warmth without fake synthesis**
   - asymmetric saturation
   - tape-style nonlinear shaping
   - subtle harmonic enhancement

4. **Finish like audio, not raw sensor data**
   - loudness normalization
   - true-peak limiting
   - dithering for 16-bit export
   - mono-safe spatialization when stereo is enabled

The most important first pass:

```text
resample → prepare/normalize → de-click → de-ess → multiband dynamics
→ saturation → limiter → LUFS normalization → dither
```

For real-time browser playback, use simplified native-node versions where possible. For export, use the heavier pure-DSP versions.

---

## 2. Input Assumptions

Algorithms receive mono floating-point audio after initial preparation.

```text
Input:
  samples: mono floating-point buffer
  range: approximately [-1.0, +1.0]
  sampleRate: 12 kHz to 48 kHz
  duration: 5 seconds to 300 seconds

Already done upstream:
  DC offset removal
  robust peak normalization
  edge fades
  light gain trim

Not yet done:
  anti-aliasing
  transient repair
  proper dynamics
  de-essing
  stereo processing
  LUFS normalization
  dithering
```

The algorithms below are language-agnostic. They use generic functions such as `lowpass`, `highpass`, `median`, `fft`, `inverseFFT`, and `biquad`. Implementation language does not matter.

---

## 3. Shared DSP Helpers

### Summary

These helper functions appear throughout the algorithms.

### Rationale

Most dynamics processors need the same basic pieces: dB conversion, smoothing, clamping, and envelope following. Build these once and unit-test hard.

### Pseudocode

```text
function clamp(value, minValue, maxValue):
    if value < minValue:
        return minValue
    if value > maxValue:
        return maxValue
    return value


function dbToLinear(db):
    return 10 ^ (db / 20)


function linearToDb(value):
    safeValue = max(abs(value), verySmallNumber)
    return 20 * log10(safeValue)


function smoothingCoefficient(timeMs, sampleRate):
    seconds = timeMs / 1000
    return exp(-1 / (seconds * sampleRate))


function smoothEnvelope(previous, target, attackMs, releaseMs, sampleRate):
    if target > previous:
        coefficient = smoothingCoefficient(attackMs, sampleRate)
    else:
        coefficient = smoothingCoefficient(releaseMs, sampleRate)

    return coefficient * previous + (1 - coefficient) * target


function mix(dry, wet, amount):
    return dry * (1 - amount) + wet * amount
```

---

# P0 Essential Algorithms

---

## 4. Polyphase Windowed-Sinc Resampler

### Priority

🔴 P0 — Essential

### Summary

A high-quality resampler that replaces linear interpolation. It uses a bank of precomputed windowed-sinc filters to reconstruct values between source samples.

### Rationale

Linear interpolation is fast but crude. It causes high-frequency droop, imaging artifacts, and poor rejection of garbage that later saturation and compression will exaggerate.

For seismic sonification, resampling happens before the data becomes "finished audio." Any artifact created here becomes part of the audible earth signal. Bad foundation, bad house.

### User Story

As a listener, I want the compressed seismic audio to sound clean and intentional, not like a cheap preview render full of brittle digital edges.

As a developer, I want one resampling function with preview and export quality modes.

### Signal Position

```text
raw seismic window
→ polyphase resampler
→ prepare/normalize
→ de-click
→ tone/dynamics
```

### Parameters

```text
filterTaps: 16–256
phaseCount: 512–4096
cutoff: 0.90–0.96 of Nyquist
windowType: Kaiser, Hann, Blackman, Lanczos
kaiserBeta: 5–10
```

### Pseudocode

```text
function resamplePolyphase(input, outputLength, options):
    if input is empty or outputLength is zero:
        return emptyBuffer

    ratio = input.length / outputLength

    filterTable = buildWindowedSincTable(
        phaseCount = options.phaseCount,
        taps = options.filterTaps,
        cutoff = options.cutoff,
        window = options.windowType
    )

    output = newBuffer(outputLength)

    for outputIndex from 0 to outputLength - 1:
        sourcePosition = outputIndex * ratio
        sourceCenter = floor(sourcePosition)
        fractionalPart = sourcePosition - sourceCenter

        phaseIndex = round(fractionalPart * (options.phaseCount - 1))
        coefficients = filterTable[phaseIndex]

        accumulator = 0
        weightSum = 0

        for tapIndex from 0 to options.filterTaps - 1:
            offset = tapIndex - floor(options.filterTaps / 2)
            sourceIndex = sourceCenter + offset

            if sourceIndex is inside input:
                sample = input[sourceIndex]
            else:
                sample = 0

            coefficient = coefficients[tapIndex]

            accumulator += sample * coefficient
            weightSum += coefficient

        if weightSum is not zero:
            output[outputIndex] = accumulator / weightSum
        else:
            output[outputIndex] = 0

    return output


function buildWindowedSincTable(phaseCount, taps, cutoff, window):
    table = emptyList

    for phaseIndex from 0 to phaseCount - 1:
        fractionalOffset = phaseIndex / phaseCount
        coefficients = newList

        for tapIndex from 0 to taps - 1:
            center = (taps - 1) / 2
            x = tapIndex - center - fractionalOffset

            sincValue = sinc(cutoff * x)
            windowValue = evaluateWindow(window, tapIndex, taps)

            coefficient = cutoff * sincValue * windowValue
            append coefficient to coefficients

        normalize coefficients so their sum is 1
        append coefficients to table

    return table


function sinc(x):
    if abs(x) is very small:
        return 1

    return sin(pi * x) / (pi * x)
```

### Implementation Notes

Use lower tap counts for preview and higher tap counts for export.

```text
preview:
  taps = 16–32
  phases = 512–1024

export:
  taps = 64–256
  phases = 2048–4096
```

---

## 5. Hampel / Median Impulse Suppressor

### Priority

🔴 P0 — Essential

### Summary

A conservative de-clicker that detects isolated outlier samples using the local median and median absolute deviation.

### Rationale

Seismic events can create sharp spikes. Some are meaningful. Some are single-sample instrument pops or resampling defects. This algorithm only repairs obvious local outliers, so it avoids flattening real earthquake transients.

### User Story

As a listener, I want the audio to avoid sudden painful ticks and pops without smoothing away the feeling of seismic impact.

As a developer, I want a safe de-clicking pass that is easy to reason about and easy to bypass.

### Signal Position

```text
prepared mono buffer
→ impulse suppressor
→ de-esser / dynamics
```

### Parameters

```text
radius: 3–8 samples
thresholdMAD: 6–12
maxRepairLength: 1–5 samples
blend: 0.5–1.0
```

### Pseudocode

```text
function suppressImpulses(input, options):
    output = copy(input)

    radius = options.radius
    threshold = options.thresholdMAD

    index = radius

    while index < input.length - radius:
        neighborhood = emptyList

        for offset from -radius to radius:
            if offset is not 0:
                append input[index + offset] to neighborhood

        localMedian = median(neighborhood)

        deviations = emptyList
        for value in neighborhood:
            append abs(value - localMedian) to deviations

        mad = median(deviations) + verySmallNumber
        score = abs(input[index] - localMedian) / mad

        if score > threshold:
            repairStart = index
            repairEnd = index

            while repairEnd + 1 is valid:
                nextScore = abs(input[repairEnd + 1] - localMedian) / mad

                if nextScore <= threshold:
                    break

                if repairEnd - repairStart + 1 >= options.maxRepairLength:
                    break

                repairEnd += 1

            leftValue = output[repairStart - 1]
            rightValue = input[repairEnd + 1]

            for repairIndex from repairStart to repairEnd:
                t = (repairIndex - repairStart + 1) / (repairEnd - repairStart + 2)
                repaired = interpolateLinear(leftValue, rightValue, t)

                output[repairIndex] = mix(
                    input[repairIndex],
                    repaired,
                    options.blend
                )

            index = repairEnd + 1
        else:
            index += 1

    return output
```

### Implementation Notes

Do not make the window large. Big median windows become smoothing tools. Here we only want click repair.

---

## 6. Look-Ahead Limiter With Soft Clip Safety

### Priority

🔴 P0 — Essential

### Summary

A limiter that looks ahead a few milliseconds, reduces gain before peaks arrive, and uses soft clipping as a final guard.

### Rationale

A single huge spike can dominate normalization or punch through the output chain. A look-ahead limiter prevents overload without the ugly flat top of hard clipping.

### User Story

As a gallery visitor, I should not get stabbed by sudden sensor spikes.

As a developer, I want the final chain to survive worst-case seismic transients.

### Signal Position

```text
tone / dynamics / saturation
→ look-ahead limiter
→ loudness normalization
→ final true-peak check
```

### Parameters

```text
ceilingDb: -3 to -0.5 dB
lookAheadMs: 1–10 ms
releaseMs: 50–300 ms
softClipKnee: 0.75–0.98
softClipDrive: 1.0–1.5
```

### Pseudocode

```text
function lookAheadLimiter(input, sampleRate, options):
    output = newBuffer(input.length)

    ceiling = dbToLinear(options.ceilingDb)
    lookAheadSamples = millisecondsToSamples(options.lookAheadMs, sampleRate)
    releaseCoefficient = smoothingCoefficient(options.releaseMs, sampleRate)

    currentGain = 1

    for index from 0 to input.length - 1:
        futurePeak = 0

        for lookOffset from 0 to lookAheadSamples:
            futureIndex = index + lookOffset

            if futureIndex >= input.length:
                break

            futurePeak = max(futurePeak, abs(input[futureIndex]))

        if futurePeak > ceiling:
            targetGain = ceiling / futurePeak
        else:
            targetGain = 1

        if targetGain < currentGain:
            currentGain = targetGain
        else:
            currentGain = releaseCoefficient * currentGain +
                          (1 - releaseCoefficient) * targetGain

        delayedIndex = index - lookAheadSamples

        if delayedIndex >= 0:
            limited = input[delayedIndex] * currentGain
            clipped = softClip(limited, options.softClipDrive, options.softClipKnee)
            output[delayedIndex] = clamp(clipped, -ceiling, ceiling)

    copy or process remaining tail samples safely

    return output


function softClip(sample, drive, knee):
    driven = sample * drive
    magnitude = abs(driven)

    if magnitude <= knee:
        return driven

    excess = magnitude - knee
    availableHeadroom = 1 - knee

    curved = knee + availableHeadroom * tanh(excess / availableHeadroom)

    return sign(driven) * curved
```

### Implementation Notes

Native compressor nodes are not true mastering limiters. Use this in offline export first. Later, move it into a real-time DSP processor if needed.

---

## 7. Integrated LUFS Normalization

### Priority

🔴 P0 — Essential

### Summary

Measures perceived loudness using a BS.1770-style approach and applies gain so different exports play back at consistent subjective loudness.

### Rationale

Peak normalization lies. Two loops with the same peak can feel wildly different in loudness. Gallery playback wants comfort and consistency, not just "no clipping."

### User Story

As an installer, I want different seismic loops to play at consistent perceived loudness without constantly adjusting the amp.

As a listener, I want long playback to feel stable and non-fatiguing.

### Signal Position

```text
final processed audio
→ LUFS measurement
→ gain adjustment
→ true-peak limiter
→ dither
```

### Parameters

```text
targetLUFS: -20 to -16 LUFS
recommendedGalleryStart: -18 LUFS
truePeakCeilingDb: -1 dB
blockLengthMs: 400 ms
hopMs: 100 ms
absoluteGate: -70 LUFS
relativeGate: integrated loudness - 10 LU
```

### Pseudocode

```text
function normalizeLoudness(input, sampleRate, targetLUFS):
    measuredLUFS = measureIntegratedLUFS(input, sampleRate)

    if measuredLUFS is invalid:
        return input

    gainDb = targetLUFS - measuredLUFS
    gain = dbToLinear(gainDb)

    output = newBuffer(input.length)

    for index from 0 to input.length - 1:
        output[index] = input[index] * gain

    output = lookAheadLimiter(output, sampleRate, finalSafetyLimiterOptions)

    return output


function measureIntegratedLUFS(input, sampleRate):
    weighted = applyKWeightingFilter(input, sampleRate)

    blockSize = millisecondsToSamples(400, sampleRate)
    hopSize = millisecondsToSamples(100, sampleRate)

    blocks = emptyList

    for blockStart from 0 to weighted.length - blockSize step hopSize:
        sumSquares = 0

        for index from blockStart to blockStart + blockSize - 1:
            sumSquares += weighted[index] * weighted[index]

        meanSquare = sumSquares / blockSize
        loudness = -0.691 + 10 * log10(meanSquare + verySmallNumber)

        append { loudness, meanSquare } to blocks

    absoluteGatedBlocks = blocks where loudness > -70

    if absoluteGatedBlocks is empty:
        return negativeInfinity

    preliminaryMeanSquare = average(meanSquare of absoluteGatedBlocks)
    preliminaryLUFS = -0.691 + 10 * log10(preliminaryMeanSquare)

    relativeThreshold = preliminaryLUFS - 10

    finalBlocks = absoluteGatedBlocks where loudness > relativeThreshold

    if finalBlocks is empty:
        return preliminaryLUFS

    finalMeanSquare = average(meanSquare of finalBlocks)

    return -0.691 + 10 * log10(finalMeanSquare)
```

### Implementation Notes

A fully compliant implementation needs accurate K-weighting filters and true-peak oversampling. For first production pass, integrated LUFS plus conservative peak ceiling is already a major upgrade.

---

## 8. TPDF Dither for 16-Bit Export

### Priority

🔴 P0 — Essential

### Summary

Adds tiny triangular noise before converting floating-point audio to 16-bit integer PCM.

### Rationale

Truncating float audio to 16-bit creates quantization distortion. Dither trades that distortion for a very low, benign noise floor.

### User Story

As a listener, I want quiet tails and low-level texture to decay naturally instead of turning gritty.

As a developer, I want export to behave like real audio mastering, not raw numeric truncation.

### Signal Position

```text
final limited floating-point audio
→ dither
→ integer PCM encoding
```

### Parameters

```text
bitDepth: 16
ditherType: TPDF
amount: roughly 1 LSB
```

### Pseudocode

```text
function convertFloatToIntWithTPDFDither(input, bitDepth):
    maxInteger = 2^(bitDepth - 1) - 1
    minInteger = -2^(bitDepth - 1)
    lsb = 1 / maxInteger

    output = newIntegerBuffer(input.length)

    for index from 0 to input.length - 1:
        randomA = randomNumberBetween0And1()
        randomB = randomNumberBetween0And1()

        triangularNoise = (randomA - randomB) * lsb

        dithered = input[index] + triangularNoise
        clipped = clamp(dithered, -1, 1)

        integerValue = round(clipped * maxInteger)
        integerValue = clamp(integerValue, minInteger, maxInteger)

        output[index] = integerValue

    return output
```

### Implementation Notes

Dither once. Last step. No processing after.

---

# P1 High-Impact Algorithms

---

## 9. Asymmetric Soft-Knee Saturation

### Priority

🟡 P1 — High Impact

### Summary

A nonlinear waveshaper that adds soft harmonic density. Unlike plain `tanh`, it supports knee control and asymmetry for richer even harmonics.

### Rationale

Raw seismic audio can feel thin, harsh, or sterile. Saturation helps it feel warmer and more physical. Asymmetry creates even harmonics, which often read as warmth.

### User Story

As a listener, I want seismic audio to feel powerful and embodied, not like a dry sensor feed.

As a developer, I want a better drop-in replacement for naive tanh saturation.

### Signal Position

```text
EQ / de-ess / dynamics
→ saturation
→ limiter
```

### Parameters

```text
drive: 1.1–3.0
knee: 0.6–0.95
asymmetry: 0.0–0.2
wetDryMix: 0.05–0.4
outputTrimDb: -3 to 0 dB
oversampling: 2x or 4x if available
```

### Pseudocode

```text
function asymmetricSaturation(input, options):
    output = newBuffer(input.length)

    trim = dbToLinear(options.outputTrimDb)

    for index from 0 to input.length - 1:
        dry = input[index]

        biased = dry + options.asymmetry
        wet = softClip(biased, options.drive, options.knee)

        biasOnly = softClip(options.asymmetry, options.drive, options.knee)
        wet = wet - biasOnly

        blended = mix(dry, wet, options.wetDryMix)
        output[index] = blended * trim

    return output
```

### Implementation Notes

Nonlinear processing can create aliasing. Oversample if possible, especially in bright modes.

---

## 10. Tape-Style Saturation

### Priority

🟡 P1 core if subtle, ⚪ P3 if exaggerated

### Summary

A stateful saturator that combines soft clipping, asymmetry, memory/hysteresis, and high-frequency damping.

### Rationale

Tape-style processing makes harsh signals denser and rounder. This is useful for gallery sound where "warm but still real" is better than "clinically accurate but painful."

### User Story

As a curator, I want the earth signal to feel tactile and massive without becoming synthetic music.

### Signal Position

```text
corrective dynamics
→ tape saturation
→ limiter
```

### Parameters

```text
drive: 1.1–2.5
bias: 0.0–0.15
hysteresis: 0.0–0.2
highFrequencyDamping: 5–14 kHz
wetDryMix: 0.05–0.5
```

### Pseudocode

```text
function tapeSaturation(input, sampleRate, options):
    output = newBuffer(input.length)

    memory = 0
    highFrequencyDampingState = 0
    dampingCoefficient = coefficientForLowpass(options.highFrequencyDamping, sampleRate)

    for index from 0 to input.length - 1:
        dry = input[index]

        memory = 0.995 * memory + 0.005 * dry

        driven = dry * options.drive
        biased = driven + options.bias + memory * options.hysteresis

        wet = tanh(biased)

        biasCompensation = tanh(options.bias)
        wet = wet - biasCompensation

        highFrequencyDampingState =
            dampingCoefficient * highFrequencyDampingState +
            (1 - dampingCoefficient) * wet

        wet = highFrequencyDampingState

        output[index] = mix(dry, wet, options.wetDryMix)

    return output
```

### Implementation Notes

This is not a full physical tape simulation. It is a practical character stage.

---

## 11. Three-Band Multiband Compressor

### Priority

🟡 P1 — High Impact

### Summary

Splits the signal into low, mid, and high bands, compresses each independently, then recombines them.

### Rationale

A single compressor treats low rumble, mid activity, and high harshness as one blob. That causes pumping and dullness. Multiband compression lets each region breathe differently.

### User Story

As a listener, I want the audio to feel controlled and full without high-frequency spikes or low-frequency pumping.

As a developer, I want the dynamics processor to understand frequency zones.

### Signal Position

```text
corrective EQ
→ multiband compressor
→ saturation
```

### Parameters

```text
lowCrossoverHz: 150–350 Hz
highCrossoverHz: 2000–5000 Hz

per band:
  thresholdDb
  ratio
  attackMs
  releaseMs
  makeupDb
```

### Pseudocode

```text
function threeBandCompressor(input, sampleRate, options):
    lowBand = linkwitzRileyLowpass(input, sampleRate, options.lowCrossoverHz)

    withoutLow = subtractBuffers(input, lowBand)

    midBand = linkwitzRileyLowpass(withoutLow, sampleRate, options.highCrossoverHz)

    highBand = subtractBuffers(withoutLow, midBand)

    compressedLow = compressSingleBand(lowBand, sampleRate, options.lowBand)
    compressedMid = compressSingleBand(midBand, sampleRate, options.midBand)
    compressedHigh = compressSingleBand(highBand, sampleRate, options.highBand)

    output = sumBuffers(compressedLow, compressedMid, compressedHigh)

    return output


function compressSingleBand(input, sampleRate, parameters):
    output = newBuffer(input.length)

    envelope = 0
    smoothedGainDb = 0

    for index from 0 to input.length - 1:
        sample = input[index]

        envelope = smoothEnvelope(
            previous = envelope,
            target = abs(sample),
            attackMs = parameters.attackMs,
            releaseMs = parameters.releaseMs,
            sampleRate = sampleRate
        )

        levelDb = linearToDb(envelope)
        amountOverThreshold = levelDb - parameters.thresholdDb

        if amountOverThreshold > 0:
            compressedOver = amountOverThreshold / parameters.ratio
            gainReductionDb = compressedOver - amountOverThreshold
        else:
            gainReductionDb = 0

        smoothedGainDb =
            0.95 * smoothedGainDb +
            0.05 * gainReductionDb

        gain = dbToLinear(smoothedGainDb + parameters.makeupDb)

        output[index] = sample * gain

    return output
```

### Implementation Notes

Use phase-coherent crossovers. Linkwitz-Riley 4th order is a good default because bands sum cleanly.

---

## 12. Relative-Threshold De-Esser

### Priority

🟡 P1 — High Impact

### Summary

Detects when the high-frequency band becomes too dominant relative to the full signal, then reduces that high band dynamically.

### Rationale

Harshness in seismic sonification is not always loud overall. Sometimes it is loud only in the upper band. A relative detector catches brightness spikes better than a fixed threshold.

### User Story

As a listener, I want the sound to stay detailed but not hissy, spitty, or piercing.

### Signal Position

```text
prepared/de-clicked audio
→ de-esser
→ multiband compressor or saturation
```

### Parameters

```text
detectorFrequencyHz: 2000–8000 Hz
relativeThresholdDb: -20 to 0 dB
maxReductionDb: 3–12 dB
attackMs: 0.5–5 ms
releaseMs: 30–200 ms
```

### Pseudocode

```text
function relativeDeEsser(input, sampleRate, options):
    output = newBuffer(input.length)

    highBand = highpass(input, sampleRate, options.detectorFrequencyHz)

    highEnvelope = 0
    fullEnvelope = 0
    smoothedReductionDb = 0

    for index from 0 to input.length - 1:
        highEnvelope = smoothEnvelope(
            highEnvelope,
            abs(highBand[index]),
            options.attackMs,
            options.releaseMs,
            sampleRate
        )

        fullEnvelope = smoothEnvelope(
            fullEnvelope,
            abs(input[index]),
            options.attackMs,
            options.releaseMs,
            sampleRate
        )

        relativeBrightnessDb = linearToDb(highEnvelope / (fullEnvelope + verySmallNumber))

        if relativeBrightnessDb > options.relativeThresholdDb:
            excess = relativeBrightnessDb - options.relativeThresholdDb
            targetReductionDb = -min(excess, options.maxReductionDb)
        else:
            targetReductionDb = 0

        smoothedReductionDb =
            0.9 * smoothedReductionDb +
            0.1 * targetReductionDb

        highGain = dbToLinear(smoothedReductionDb)

        lowPart = input[index] - highBand[index]
        controlledHigh = highBand[index] * highGain

        output[index] = lowPart + controlledHigh

    return output
```

### Implementation Notes

This is a de-esser and a simple dynamic high shelf in spirit. It should act only when the top end gets rude.

---

## 13. Dynamic EQ / Adaptive Resonance Cut

### Priority

🟡 P1 — High Impact

### Summary

A narrow or shelving EQ band whose gain changes dynamically based on the energy in that band.

### Rationale

Static filters are blunt. Dynamic EQ cuts harshness only when it appears. This preserves detail during quiet or balanced sections.

### User Story

As a listener, I want bright seismic textures to stay alive without turning into knife-edge noise.

As a developer, I want adaptive filtering rather than a fixed lowpass for every input.

### Signal Position

```text
after de-click
→ dynamic EQ
→ saturation / compressor
```

### Parameters

```text
frequencyHz: 500–9000 Hz
Q: 0.5–8
thresholdDb: -40 to -12 dB
maxCutDb: 1–9 dB
attackMs: 2–20 ms
releaseMs: 80–300 ms
```

### Pseudocode

```text
function dynamicResonanceCut(input, sampleRate, options):
    output = newBuffer(input.length)

    targetBand = bandpass(input, sampleRate, options.frequencyHz, options.Q)

    envelope = 0
    smoothedCutDb = 0

    for index from 0 to input.length - 1:
        envelope = smoothEnvelope(
            envelope,
            abs(targetBand[index]),
            options.attackMs,
            options.releaseMs,
            sampleRate
        )

        levelDb = linearToDb(envelope)

        if levelDb > options.thresholdDb:
            excess = levelDb - options.thresholdDb
            targetCutDb = -min(excess, options.maxCutDb)
        else:
            targetCutDb = 0

        smoothedCutDb =
            0.9 * smoothedCutDb +
            0.1 * targetCutDb

        cutAmount = 1 - dbToLinear(smoothedCutDb)

        output[index] = input[index] - targetBand[index] * cutAmount

    return output
```

### Implementation Notes

Use this for upper-mid glare or whistle-like sensor artifacts. Do not stack too many dynamic notches; that becomes invisible mastering goo.

---

## 14. Downward Expander With Comfort Noise

### Priority

🟡 P1 — High Impact

### Summary

Reduces low-level noise during quiet passages, but adds a very quiet shaped noise bed so silence does not feel digitally dead.

### Rationale

Hard gating sounds broken. Dead air in an installation can feel like the app stopped. A soft expander plus comfort noise keeps the space alive.

### User Story

As a gallery visitor, I want quiet seismic periods to feel like geological stillness, not a failed speaker.

### Signal Position

```text
tone/dynamics
→ expander / comfort noise
→ limiter / LUFS
```

### Parameters

```text
thresholdDb: -60 to -35 dB
ratio: 1.2–2.5
maxDepthDb: 6–18 dB
attackMs: 10–50 ms
releaseMs: 200–1000 ms
comfortNoiseLevelDb: -70 to -55 dB
noiseColor: white, pink, brown, or measured quiet-profile
```

### Pseudocode

```text
function expanderWithComfortNoise(input, sampleRate, options):
    output = newBuffer(input.length)

    envelope = 0
    smoothedGainDb = 0
    noiseState = 0

    for index from 0 to input.length - 1:
        sample = input[index]

        envelope = smoothEnvelope(
            envelope,
            abs(sample),
            options.attackMs,
            options.releaseMs,
            sampleRate
        )

        levelDb = linearToDb(envelope)

        if levelDb < options.thresholdDb:
            belowThreshold = options.thresholdDb - levelDb
            targetGainDb = -min(
                options.maxDepthDb,
                belowThreshold * (options.ratio - 1)
            )
        else:
            targetGainDb = 0

        smoothedGainDb =
            0.98 * smoothedGainDb +
            0.02 * targetGainDb

        expanded = sample * dbToLinear(smoothedGainDb)

        quietAmount = clamp(
            -smoothedGainDb / options.maxDepthDb,
            0,
            1
        )

        whiteNoise = randomNumberBetweenMinus1And1()

        if options.noiseColor is "pink":
            noiseState = 0.98 * noiseState + 0.02 * whiteNoise
            shapedNoise = noiseState
        else:
            shapedNoise = whiteNoise

        comfortNoise = shapedNoise * dbToLinear(options.comfortNoiseLevelDb)

        output[index] = expanded + comfortNoise * quietAmount

    return output
```

### Implementation Notes

Comfort noise should be felt more than heard. Keep it subtle.

---

## 15. Mono-Safe Pseudo-Stereo

### Priority

🟡 P1 — High Impact when stereo output is enabled

### Summary

Creates stereo width by generating a side signal from delayed and filtered versions of the mono input, then recombining as mid/side.

### Rationale

Mono seismic audio can feel flat. But gallery playback often collapses to mono somewhere. Mid/side widening keeps the mono sum safe.

### User Story

As a visitor, I want the sound to feel spacious in stereo but not disappear or comb-filter badly in mono.

### Signal Position

```text
finished mono tone
→ pseudo-stereo
→ stereo limiter or output
```

### Parameters

```text
sideDelayMs: 3–12 ms
sideHighpassHz: 500–1000 Hz
sideLowpassHz: 6000–12000 Hz
width: 0.05–0.35
```

### Pseudocode

```text
function monoSafePseudoStereo(monoInput, sampleRate, options):
    delayed = delay(monoInput, millisecondsToSamples(options.sideDelayMs, sampleRate))

    side = highpass(delayed, sampleRate, options.sideHighpassHz)
    side = lowpass(side, sampleRate, options.sideLowpassHz)

    left = newBuffer(monoInput.length)
    right = newBuffer(monoInput.length)

    for index from 0 to monoInput.length - 1:
        mid = monoInput[index]
        sideValue = side[index] * options.width

        left[index] = mid + sideValue
        right[index] = mid - sideValue

    return stereoBuffer(left, right)
```

### Mono Compatibility

```text
monoSum = (left + right) / 2
monoSum = original mid
```

That is the whole trick. Good cave magic.

---

# P2 Polish Algorithms

---

## 16. Spectral Gate With Smoothing

### Priority

🟢 P2 — Nice Polish

### Summary

An FFT-based noise reducer that estimates a noise profile, reduces bins near the noise floor, and smooths gain changes over time and frequency.

### Rationale

Some seismic windows contain broadband hiss or static. A normal expander cannot separate noise from signal by frequency. A spectral gate can.

But beware: overuse creates metallic "musical noise."

### User Story

As a listener, I want noisy quiet sections to feel cleaner, but not underwater or synthetic.

### Signal Position

```text
offline only:
de-clicked signal
→ spectral gate
→ tone/dynamics
```

### Parameters

```text
fftSize: 512–4096
hopSize: fftSize / 4
noiseProfileDuration: 1–5 seconds
reductionDb: 3–15 dB
spectralFloorDb: -60 to -40 dB
frequencySmoothingBins: 2–8
timeSmoothingFrames: 2–8
```

### Pseudocode

```text
function spectralGate(input, sampleRate, options):
    frames = shortTimeFourierTransform(
        input,
        fftSize = options.fftSize,
        hopSize = options.hopSize
    )

    noiseProfile = estimateNoiseProfile(frames, options.noiseProfileDuration)

    previousGainByBin = arrayFilledWith(1)

    for each frame in frames:
        magnitudes = getMagnitudes(frame)
        phases = getPhases(frame)

        gainByBin = newArray(length of magnitudes)

        for bin from 0 to magnitudes.length - 1:
            noiseMagnitude = noiseProfile[bin] + verySmallNumber
            signalMagnitude = magnitudes[bin]

            snrDb = linearToDb(signalMagnitude / noiseMagnitude)

            if snrDb < options.openThresholdDb:
                gain = dbToLinear(-options.reductionDb)
            else:
                gain = 1

            minimumGain = dbToLinear(options.spectralFloorDb)
            gainByBin[bin] = max(gain, minimumGain)

        gainByBin = smoothAcrossFrequency(gainByBin, options.frequencySmoothingBins)

        for bin from 0 to gainByBin.length - 1:
            gainByBin[bin] =
                0.75 * previousGainByBin[bin] +
                0.25 * gainByBin[bin]

        applyGainToMagnitudes(frame, gainByBin)

        previousGainByBin = gainByBin

    output = inverseShortTimeFourierTransform(frames)

    return output
```

### Implementation Notes

Offline only for now. Do not ship as default until auditioned hard.

---

## 17. Noise-Shaped Dither

### Priority

🟢 P2 — Nice Polish

### Summary

A dither variant that feeds quantization error forward so some noise energy moves into less audible frequency regions.

### Rationale

TPDF dither is safe and transparent. Noise shaping can sound slightly cleaner at low levels but is less neutral if the file will be processed again.

### User Story

As a mastering/export user, I want the final listener WAV to have clean low-level decay.

### Signal Position

```text
final float audio
→ noise-shaped dither
→ integer PCM
```

### Parameters

```text
bitDepth: 16
ditherAmount: about 1 LSB
shaperStrength: low to moderate
```

### Pseudocode

```text
function convertWithNoiseShapedDither(input, bitDepth):
    maxInteger = 2^(bitDepth - 1) - 1

    output = newIntegerBuffer(input.length)

    previousError1 = 0
    previousError2 = 0

    for index from 0 to input.length - 1:
        shapedError =
            1.5 * previousError1 -
            0.5 * previousError2

        dither = triangularRandomNoise() / maxInteger

        candidate = input[index] + shapedError + dither
        candidate = clamp(candidate, -1, 1)

        quantizedInteger = round(candidate * maxInteger)
        reconstructedFloat = quantizedInteger / maxInteger

        quantizationError = candidate - reconstructedFloat

        previousError2 = previousError1
        previousError1 = quantizationError

        output[index] = quantizedInteger

    return output
```

### Implementation Notes

Default to TPDF. Offer noise-shaped dither only as an export option.

---

# P3 Artistic Algorithms

---

## 18. Harmonic Exciter

### Priority

⚪ P3 — Artistic Flavor

### Summary

Creates subtle upper harmonics from a high-passed signal and blends them back in.

### Rationale

An exciter can add presence without simply boosting EQ. But it can also make noise sharper, so it belongs in artistic or carefully tuned polish modes.

### User Story

As a sound designer, I want some seismic textures to shimmer or glow without turning up the whole treble band.

### Signal Position

```text
after cleanup
→ parallel exciter
→ limiter
```

### Parameters

```text
exciterBandStartHz: 1500–5000 Hz
drive: 1–4
mix: 0.02–0.15
maxAddedLevelDb: -30 to -12 dB
```

### Pseudocode

```text
function harmonicExciter(input, sampleRate, options):
    highBand = highpass(input, sampleRate, options.exciterBandStartHz)

    output = newBuffer(input.length)

    maxAdded = dbToLinear(options.maxAddedLevelDb)

    for index from 0 to input.length - 1:
        driven = highBand[index] * options.drive

        harmonic = abs(driven)

        harmonic = highpassSingleSampleOrBuffer(harmonic)
        harmonic = clamp(harmonic, -maxAdded, maxAdded)

        output[index] =
            input[index] +
            harmonic * options.mix

    return output
```

### Implementation Notes

Use tiny mix values. This is spice, not food.

---

## 19. Wavefolder

### Priority

⚪ P3 — Artistic Flavor

### Summary

Folds waveform peaks back on themselves instead of clipping them.

### Rationale

Wavefolding creates complex harmonics and a more synthetic, instrument-like quality. Useful for creative modes, not scientific or raw comparison modes.

### User Story

As an artist, I want an optional mode where seismic events become more sculptural and strange while still driven by real earth data.

### Signal Position

```text
parallel mid-band branch
→ wavefolder
→ blend with dry signal
```

### Parameters

```text
drive: 1–6
foldCount: 1–4
mix: 0.02–0.2
bandLimitBefore: yes
oversample: strongly recommended
```

### Pseudocode

```text
function wavefolder(input, options):
    output = newBuffer(input.length)

    for index from 0 to input.length - 1:
        dry = input[index]
        folded = dry * options.drive

        for foldIndex from 0 to options.foldCount - 1:
            if folded > 1:
                folded = 2 - folded

            if folded < -1:
                folded = -2 - folded

        folded = clamp(folded, -1, 1)

        output[index] = mix(dry, folded, options.mix)

    return output
```

### Implementation Notes

Do this on a band-limited branch. Full-band wavefolding aliases fast.

---

## 20. Slow Wow / Flutter / Filter Drift

### Priority

⚪ P3 — Artistic Flavor

### Summary

Applies very subtle time or filter modulation to make long loops breathe.

### Rationale

Long seismic loops can feel static. Slow modulation adds life, but it also moves the source away from strict representation. Keep it optional.

### User Story

As a sound designer, I want certain installation modes to feel alive over long listening periods.

### Signal Position

```text
late artistic stage
after core cleanup and tone
before final limiter
```

### Parameters

```text
wowRateHz: 0.05–0.5 Hz
wowDepthMs: 0.1–2 ms
flutterRateHz: 3–8 Hz
flutterDepthMs: 0.01–0.2 ms
mix: 0.02–0.2
```

### Pseudocode

```text
function wowFlutterDelay(input, sampleRate, options):
    output = newBuffer(input.length)

    delayBuffer = circularBuffer(maxDelaySamples)
    writeIndex = 0

    for index from 0 to input.length - 1:
        timeSeconds = index / sampleRate

        wow =
            sin(2 * pi * options.wowRateHz * timeSeconds) *
            options.wowDepthMs

        flutter =
            sin(2 * pi * options.flutterRateHz * timeSeconds) *
            options.flutterDepthMs

        delayMs = options.baseDelayMs + wow + flutter
        delaySamples = millisecondsToSamples(delayMs, sampleRate)

        write delayBuffer[writeIndex] = input[index]

        readPosition = writeIndex - delaySamples
        wet = readCircularBufferWithLinearInterpolation(delayBuffer, readPosition)

        output[index] = mix(input[index], wet, options.mix)

        writeIndex = advanceCircularIndex(writeIndex)

    return output
```

### Implementation Notes

Use identical modulation for left and right if mono compatibility matters. Modulating only side signal can work, but test mono sum.

---

## 21. Haas Delay Widening

### Priority

⚪ P3 — Artistic Flavor

### Summary

Creates width by delaying one side by a few milliseconds.

### Rationale

Fast, easy, and risky. Haas widening creates comb filtering when collapsed to mono. It should not be the primary stereo method for installations.

### User Story

As a sound designer, I want a quick width effect for artistic previews, while keeping the safer mono-compatible widener for production.

### Signal Position

```text
upper-band parallel send
→ short delay
→ stereo blend
```

### Parameters

```text
delayMs: 2–15 ms
wetMix: 0.02–0.2
highpassBeforeDelay: 700–1500 Hz
```

### Pseudocode

```text
function haasWidener(monoInput, sampleRate, options):
    upperBand = highpass(monoInput, sampleRate, options.highpassHz)
    delayedUpperBand = delay(upperBand, millisecondsToSamples(options.delayMs, sampleRate))

    left = newBuffer(monoInput.length)
    right = newBuffer(monoInput.length)

    for index from 0 to monoInput.length - 1:
        dry = monoInput[index]

        left[index] = dry + upperBand[index] * options.wetMix
        right[index] = dry + delayedUpperBand[index] * options.wetMix

    return stereoBuffer(left, right)
```

### Implementation Notes

Use low wet amounts. Always test mono collapse.

---

# 22. Recommended Production Chains

---

## Core Export Chain

### Summary

This is the recommended high-quality offline/export path.

```text
raw seismic samples
→ polyphase windowed-sinc resampling
→ prepare samples
→ Hampel impulse suppression
→ relative de-esser
→ dynamic EQ if needed
→ three-band compressor
→ asymmetric saturation
→ downward expander / comfort noise
→ look-ahead limiter
→ integrated LUFS normalization
→ true-peak safety limiter
→ TPDF dither
→ 16-bit WAV
```

### Pseudocode

```text
function renderCoreExport(rawInput, outputLength, sampleRate, options):
    audio = resamplePolyphase(rawInput, outputLength, options.resampler)

    audio = prepareSamples(audio, options.prepare)

    audio = suppressImpulses(audio, options.impulseSuppressor)

    audio = relativeDeEsser(audio, sampleRate, options.deEsser)

    if options.dynamicEQ.enabled:
        audio = dynamicResonanceCut(audio, sampleRate, options.dynamicEQ)

    audio = threeBandCompressor(audio, sampleRate, options.multibandCompressor)

    audio = asymmetricSaturation(audio, options.saturation)

    if options.expander.enabled:
        audio = expanderWithComfortNoise(audio, sampleRate, options.expander)

    audio = lookAheadLimiter(audio, sampleRate, options.limiter)

    audio = normalizeLoudness(audio, sampleRate, options.targetLUFS)

    audio = lookAheadLimiter(audio, sampleRate, options.truePeakLimiter)

    integerPCM = convertFloatToIntWithTPDFDither(audio, bitDepth = 16)

    return integerPCM
```

---

## Real-Time Browser Chain Without Custom Audio Processor

### Summary

This is the simpler live path using built-in audio nodes.

```text
audio source
→ highpass filter
→ lowpass filter
→ waveshaper with asymmetric curve
→ native compressor as safety limiter
→ gain
→ optional pseudo-stereo routing
→ analyser
→ speakers
```

### Pseudocode

```text
function configureRealtimeGraph(context, source, mode):
    highpass = createHighpassFilter(mode.highpassHz)
    lowpass = createLowpassFilter(mode.lowpassHz)

    saturator = createWaveShaper()
    saturator.curve = createAsymmetricSaturationCurve(mode.saturation)
    saturator.oversampling = mode.oversampling

    compressor = createDynamicsCompressor()
    compressor.threshold = mode.compressorThreshold
    compressor.ratio = mode.compressorRatio
    compressor.attack = mode.compressorAttack
    compressor.release = mode.compressorRelease
    compressor.knee = mode.compressorKnee

    makeupGain = createGain(mode.makeupGain)

    analyser = createAnalyser()

    connect source to highpass
    connect highpass to lowpass
    connect lowpass to saturator
    connect saturator to compressor
    connect compressor to makeupGain
    connect makeupGain to analyser
    connect analyser to destination
```

### Implementation Notes

This does not fully replace the offline chain. It is a practical live approximation.

---

## Real-Time Chain With Custom Audio Processor

### Summary

Once custom sample processing exists, move the smart processors into one real-time module.

```text
audio source
→ custom DSP processor:
    de-esser
    dynamic EQ
    multiband compressor
    saturator
    expander
    limiter
    pseudo-stereo
→ analyser
→ speakers
```

### Pseudocode

```text
function processAudioBlock(inputBlock, state, parameters):
    block = inputBlock

    block = relativeDeEsserBlock(block, state.deEsser, parameters.deEsser)

    block = dynamicEQBlock(block, state.dynamicEQ, parameters.dynamicEQ)

    block = multibandCompressorBlock(
        block,
        state.multiband,
        parameters.multiband
    )

    block = saturationBlock(block, parameters.saturation)

    block = expanderBlock(block, state.expander, parameters.expander)

    block = limiterBlock(block, state.limiter, parameters.limiter)

    if parameters.stereo.enabled:
        stereoBlock = pseudoStereoBlock(block, state.stereo, parameters.stereo)
        return stereoBlock

    return block
```

---

# 23. Rollout Plan

## Phase 1 — Fix the foundation

Ship these first:

```text
P0:
  polyphase resampler
  Hampel impulse suppressor
  look-ahead limiter
  LUFS normalization
  TPDF dither
```

Why: these fix the "unacceptably bad" class of problems.

---

## Phase 2 — Make it feel produced

Ship next:

```text
P1:
  asymmetric saturation
  relative de-esser
  three-band compressor
  dynamic EQ
  expander with comfort noise
  mono-safe pseudo-stereo
```

Why: these create the gallery-quality lift.

---

## Phase 3 — Add polish

Ship after listening tests:

```text
P2:
  spectral gate
  noise-shaped dither
  refined adaptive filters
```

Why: useful, but easy to overdo.

---

## Phase 4 — Artistic modes

Ship behind explicit creative modes:

```text
P3:
  tape-style saturation when pushed
  harmonic exciter
  wavefolder
  wow/flutter
  Haas widening
```

Why: these change the identity of the signal. Good art tools, not neutral science tools.

---

# 24. Testing Checklist

For every algorithm, test these cases:

```text
empty input
complete silence
single huge spike
dense earthquake transient
long low-level quiet section
near-zero signal
short 5-second loop
long 300-second loop
12 kHz render rate
48 kHz render rate
mono sum after stereo widening
bypass matched against processed output
```

For listening tests:

```text
A/B raw vs processed
level-match before judging
test on headphones
test on small speakers
test on gallery speakers
test mono collapse
listen for fatigue over at least 10 minutes
```

For metrics:

```text
peak level
true peak if available
integrated LUFS
crest factor
RMS before/after
number of repaired clicks
gain reduction per band
de-esser reduction amount
limiter gain reduction
```

---

# 25. Final Guidance

Do not implement everything at once.

Start by making the audio technically trustworthy:

```text
better resampling
less clicking
safe limiting
consistent loudness
proper dither
```

Then make it beautiful:

```text
frequency-aware dynamics
gentle saturation
adaptive harshness control
mono-safe space
living quiet floor
```

The north star:

> Preserve the seismic character, but remove the parts that only exist because digital playback is cruel.