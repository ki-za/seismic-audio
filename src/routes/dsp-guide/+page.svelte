<script lang="ts">
	import DspTuningGuide from '$lib/content/dsp-tuning-guide.svelte';
</script>

<svelte:head>
	<title>DSP Tuning Guide</title>
</svelte:head>

<div class="page">
	<nav>
		<a href="/">󰁍 Back to dashboard</a>
	</nav>
	<DspTuningGuide />
</div>

<style>
	.page {
		max-width: 54rem;
		margin: 2rem auto;
		padding: 0 1.25rem 3rem;
	}
	nav { margin-bottom: 1.5rem; }
	a {
		color: #8f806e;
		font-size: 0.85rem;
		text-decoration: none;
	}
	a:hover { color: #f0b76a; }
</style>
