import { stat } from "node:fs/promises";
import { join } from "node:path";

const root = "release/windows-portable";
const checks = [
	{ label: "release folder", path: root },
	{ label: "Windows executable", path: join(root, "seismic-audio.exe") },
	{ label: "start batch file", path: join(root, "START-SEISMIC-AUDIO.bat") },
	{ label: "friend README", path: join(root, "README-FIRST.txt") },
	{ label: "static app index", path: join(root, "app", "index.html") },
	{ label: "portable ZIP", path: "release/seismic-audio-windows-portable.zip" },
];

let ok = true;
for (const check of checks) {
	try {
		const info = await stat(check.path);
		console.log(`✓ ${check.label}: ${check.path} (${info.size} bytes)`);
	} catch {
		ok = false;
		console.error(`✗ ${check.label}: missing ${check.path}`);
	}
}

if (!ok) process.exit(1);

console.log("Portable Windows package layout looks ready.");
console.log("Test on Windows by double-clicking START-SEISMIC-AUDIO.bat.");
