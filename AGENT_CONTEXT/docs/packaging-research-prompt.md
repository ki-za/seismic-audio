# Packaging Research Prompt: Seismic Audio

## Role

You are a packaging/distribution research agent. Your task is to recommend the easiest reliable way to package **Seismic Audio** so normal users can download and run it on **Windows, macOS, and Linux**.

Do not implement. Research, compare options, and produce a practical recommendation.

## Project snapshot

This project is currently:

```text
SvelteKit + TypeScript UI
Bun TypeScript bridge/server
Browser Web Audio playback
Static adapter already configured for SvelteKit
```

Important files:

```text
package.json
svelte.config.js
vite.config.ts
bridge/server.ts
bridge/*.ts
src/routes/+page.svelte
src/lib/**
static/**
```

Current scripts:

```json
{
  "dev": "vite --host 0.0.0.0",
  "build": "vite build",
  "preview": "vite preview --host 0.0.0.0",
  "bridge": "bun run bridge/server.ts",
  "show": "bun run bridge & bun run dev",
  "diagnose": "bun run scripts/run-diagnostics.ts"
}
```

Current quickstart still says npm, but project uses Bun and has `bun.lock`.

## User goal

Make the app extremely easy to download and run on:

```text
Windows
macOS
Linux
```

Target user should not need to know Bun, SvelteKit, Vite, or command-line development workflows.

The preferred outcome is something like:

```text
Download installer/app archive
Open app
App starts UI and local bridge automatically
User can use synthetic mode immediately
Optional Raspberry Shake / UDP mode works when configured
```

## Constraints to consider

### Runtime shape

The app currently has two runtime pieces:

```text
Desktop/browser UI
↔ local HTTP/WebSocket/API bridge/server
↔ synthetic data, UDP Raspberry Shake DATACAST, archive/station data
```

Research must account for how the bridge runs in packaged form.

Questions:

- Can Bun compile the bridge into native executables for Windows/macOS/Linux?
- Should the bridge be a sidecar process?
- Should the bridge be rewritten/embedded in another runtime?
- Can the app avoid a server for static/archive/synthetic-only mode?
- What breaks with UDP access, localhost ports, firewalls, app sandboxing, and code signing?

### Cross-platform ease

Optimize for:

```text
lowest maintenance burden
smallest credible installer/download
fewest user setup steps
reliable auto-start of local bridge
clear release workflow from GitHub Actions
```

Avoid recommendations that require users to install Bun/Node manually.

### Current architecture preference

Prefer approaches that preserve current code shape unless there is a strong reason not to:

```text
SvelteKit UI stays mostly unchanged
bridge/server.ts stays mostly unchanged at first
packaging wraps existing app before major rewrites
```

## Options to evaluate

At minimum, compare:

1. **Tauri desktop app + bundled bridge sidecar**
   - SvelteKit static build loaded by Tauri WebView
   - Bun-compiled bridge sidecar or alternative binary sidecar
   - Tauri starts/stops sidecar

2. **Electron app + bundled Node/Bun bridge**
   - Larger download, easier JS process integration
   - Cross-platform installer maturity

3. **Pure static web app / GitHub Pages / hosted demo**
   - No install
   - What features work without the bridge?
   - Could synthetic/archive mode work here?

4. **Local CLI package only**
   - Bun/npm package, `bunx`, Homebrew, winget, etc.
   - Probably less friendly, but evaluate as developer path

5. **Single native/server binary + browser launch**
   - Compile bridge/server to executable
   - Serve static UI from embedded assets
   - Open browser automatically
   - Could use Bun compile, Go, Rust, or another route

6. **PWA/installable web app**
   - Offline support, no native UDP access
   - Limitations for live hardware mode

## Required output

Produce a concise research report with these sections:

```text
1. Executive recommendation
2. Best path for this project
3. Comparison table
4. Packaging architecture diagram
5. Bridge/runtime strategy
6. Release/build workflow proposal
7. Platform risks: Windows/macOS/Linux
8. What to prototype first
9. Open questions for the senior
10. Sources / docs checked
```

## Decision standard

Choose the route that best satisfies:

```text
Normal user can run it easily
Implementation is realistic for this repo
Cross-platform release is maintainable
Live bridge can be started automatically
Synthetic mode works out of the box
Future Raspberry Shake / UDP mode remains possible
```

## Expected recommendation style

Be decisive. Do not only list options.

Use this pattern:

```text
Recommended: <path>
Because: <short rationale>
Reject for now: <paths>
Prototype: <smallest next experiment>
```

## Useful commands to inspect locally

```bash
cat package.json
cat svelte.config.js
cat vite.config.ts
ls bridge src static docs
bun run build
bun run diagnose
```

If running commands, report results and failures.

## Important note

Do **not** make broad code changes. This is a research task. If you create notes, put them under:

```text
docs/packaging-research-output.md
```
