import { chromium } from 'playwright';

const appUrl = process.env.APP_URL ?? 'http://localhost:5173';

const browser = await chromium.launch({
	headless: true,
	executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium'
});
const page = await browser.newPage();
const consoleMessages: string[] = [];
const pageErrors: string[] = [];

page.on('console', (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
page.on('pageerror', (error) => pageErrors.push(error.message));

await page.goto(appUrl, { waitUntil: 'networkidle' });
await page.getByTestId('begin-listening').click();
await page.waitForTimeout(1200);

const bridgeStatus = await page.getByTestId('bridge-status').innerText();
const audioLevel = await page.getByTestId('audio-meter').getAttribute('data-level');
const error = await page.getByTestId('error-message').isVisible().catch(() => false)
	? await page.getByTestId('error-message').innerText()
	: null;

console.log(JSON.stringify({
	appUrl,
	bridgeStatus,
	audioLevel: Number(audioLevel ?? 0),
	audioDetected: Number(audioLevel ?? 0) > 0.001,
	error,
	consoleMessages,
	pageErrors
}, null, 2));

await browser.close();
