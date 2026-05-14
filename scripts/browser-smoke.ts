import { chromium } from "playwright";

const appUrl = process.env.APP_URL ?? "http://localhost:5173";

const browser = await chromium.launch({
	headless       : true,
	executablePath : process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
});
const page = await browser.newPage();
const consoleMessages : string[] = [];
const pageErrors      : string[] = [];

page.on("console", (message) =>
	consoleMessages.push(`${message.type()}: ${message.text()}`),
);
page.on("pageerror", (error) => pageErrors.push(error.message));

await page.goto(appUrl, { waitUntil: "networkidle" });
await page.getByTestId("load-window").click();
await page.waitForTimeout(800);
const evidenceBeforePlay = await page
	.getByTestId("loaded-evidence")
	.innerText();
const loadedState = await page
	.getByTestId("loaded-evidence")
	.getAttribute("data-state");
const fingerprintBefore = await page
	.getByTestId("loaded-evidence")
	.getAttribute("data-fingerprint");
await page.getByTestId("begin-listening").click();
await page.waitForTimeout(1200);
const activeFingerprint = await page
	.getByTestId("loaded-evidence")
	.getAttribute("data-active-fingerprint");
await page.getByRole("button", { name: "clear" }).click();
await page.waitForTimeout(100);
const fingerprintAfterSoundChange = await page
	.getByTestId("loaded-evidence")
	.getAttribute("data-fingerprint");

const bridgeStatus = await page.getByTestId("bridge-status").innerText();
const audioLevel   = await page
	.getByTestId("audio-meter")
	.getAttribute("data-level");
const error = (await page
	.getByTestId("error-message")
	.isVisible()
	.catch(() => false))
	? await page.getByTestId("error-message").innerText()
	: null;

console.log(
	JSON.stringify(
		{
			appUrl,
			bridgeStatus,
			evidenceBeforePlay,
			loadedState,
			fingerprintBefore,
			activeFingerprint,
			fingerprintAfterSoundChange,
			audioSettingsChangeObservable:
				fingerprintBefore !== fingerprintAfterSoundChange,
			playbackMatchesLoadedSettings : activeFingerprint === fingerprintBefore,
			audioLevel                    : Number(audioLevel ?? 0),
			audioDetected                 : Number(audioLevel ?? 0) > 0.001,
			error,
			consoleMessages,
			pageErrors,
		},
		null,
		2,
	),
);

await browser.close();
