import { $ } from "bun";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const releaseDir = "release/windows-portable";
const zipPath    = "release/seismic-audio-windows-portable.zip";
const appDir     = join(releaseDir, "app");
const exePath    = join(releaseDir, "seismic-audio.exe");

await rm(releaseDir, { recursive: true, force: true });
await rm(zipPath, { force: true });
await mkdir(appDir, { recursive: true });

await $`bun run build`;
await cp("build", appDir, { recursive: true });

await $`bun build --compile --target=bun-windows-x64-baseline bridge/server.ts --outfile ${exePath}`;

await writeFile(
	join(releaseDir, "START-SEISMIC-AUDIO.bat"),
	`@echo off
setlocal
cd /d "%~dp0"
set INPUT_MODE=synthetic
set BRIDGE_PORT=8787
set PACKAGED_APP_DIR=%~dp0app
start "Seismic Audio Server" seismic-audio.exe
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8787
echo Seismic Audio should now be open in your browser.
echo You can close this window. To stop the app, close the Seismic Audio Server window.
pause
`,
);

await writeFile(
	join(releaseDir, "README-FIRST.txt"),
	`Seismic Audio - Windows portable build

How to run:
1. Extract the ZIP folder.
2. Double-click START-SEISMIC-AUDIO.bat.
3. Your browser should open to http://127.0.0.1:8787.
4. Use Synthetic / LAN bridge, then Load Window, then Play Loaded Loop.

If Windows asks about network access, allow private/local network access.
The app only needs localhost for the built-in bridge unless you configure UDP hardware later.

To stop:
Close the Seismic Audio Server window.
`,
);

await $`cd release && zip -qr seismic-audio-windows-portable.zip windows-portable`;

console.log(`Windows portable folder ready: ${releaseDir}`);
console.log(`Windows portable ZIP ready: ${zipPath}`);
