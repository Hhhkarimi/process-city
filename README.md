# Process City

**Your computer, a living city.**

A visual Windows process monitor and learning tool. Find resource-heavy application families, inspect their process relationships, and replay how CPU and memory changed — inside a living 3D city.

[Try the simulation](https://process-city-hhhkarimi.vercel.app) · [دموی فارسی](https://process-city-hhhkarimi.vercel.app/?lang=fa) · [راهنمای فارسی](README.fa.md)

![Process City observatory](docs/screenshots/desktop.png)

## The v3 experience

The city owns the screen. Its purpose is stated above it; detailed controls open only when requested.

- **A real 3D city:** perspective, manual orbit/pan/zoom, soft shadows, restrained floor reflections and four architectural worlds. An adaptive quality mode reduces rendering cost on slower machines. A Canvas 2D fallback is used when WebGL is unavailable; append `?renderer=2d` to test it.
- **A first-visit reveal:** measured process rows fade into a rising city. It lasts about three seconds, is skippable, remembers completion locally, and respects reduced-motion preferences. Replay it from Tools → Settings.
- **Find the resource-heavy family:** the main action ranks observed parent-child families by available CPU or summed private memory, highlights the selected family and explains the reading. Inspection stays pinned as its numbers update; finding the current leader again is explicit. Missing CPU counters stay unknown; partial sums are marked as lower bounds. High usage is not a fault diagnosis.
- **Before / now:** drag the split boundary to compare a reference frame with the displayed city using the same camera. Buildings, CPU lights and growth water reflect each frame's own data. The dock also scrubs and replays the rolling buffer at 1×/4×/12×. The generated 60-second demo story is available immediately.
- **Optional experiences:** Tools → Experiences contains the 45-second, simulation-only flood-rescue challenge and synthetic CPU/memory scenarios. Select and inspect the culprit, contain it, and watch water and memory recover. No real process is terminated.
- **Capture a moment:** Tools → Capture & replay creates a local landscape/portrait video, roughly 12 seconds from up to the last recorded minute, or a source-marked PNG. MP4 is used when supported, with WebM fallback. Versioned JSON recordings can also be saved and opened. Keep the tab visible while rendering a clip.

**A quiet default:** the inspector opens only after a selection. Process tables, themes, scenarios and export settings live in a keyboard-accessible Tools dialog. Automatic camera moves are opt-in; manual interaction returns control to the user. Persian and English use a bundled Vazirmatn font. [Design and interaction contract](docs/DESIGN.md).

## Two modes, honestly labeled

| Mode            | Data source                                     | Where it runs                                                    |
| --------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| Demo simulation | Synthetic, deterministic Windows-like processes | Any modern browser, including the hosted demo                    |
| Live Windows    | Windows process and system counters             | Your own Windows machine through a loopback-only local collector |

The hosted site **cannot read your computer**. The demo buttons do not allocate real CPU or memory. Real process data is never uploaded to the demo host.

## Run on Windows

Requirements: Windows 10/11, Windows PowerShell 5.1 or newer, Node.js 22.18+ or 24+, and npm. No administrator access is requested. Some protected processes do not expose CPU counters; these show `—` rather than invented zero readings.

```powershell
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4317** and choose **Live Windows**. The local server starts its own hidden PowerShell collector. Closing it also stops that collector.

Use `http://127.0.0.1:4317/?lang=fa&mode=live` to open directly in Persian live mode. Live mode is only auto-selected on a loopback hostname.

### Restricted environments: two-terminal mode

If child-process launch is blocked, keep the collector and server in separate terminals. Both commands run locally; no policy or permission changes are needed.

Terminal 1, from this project folder:

```powershell
New-Item -ItemType Directory -Path work -Force | Out-Null
$cityFile = Join-Path (Get-Location) 'work\live.json'
.\server\collect.ps1 -OutputFile $cityFile
```

Terminal 2, from the same folder:

```powershell
$cityFile = Join-Path (Get-Location) 'work\live.json'
npm start -- --collector-file $cityFile
```

Open the same loopback URL and select **Live Windows**. Stop both terminals with Ctrl+C when finished. The collector file contains local process names and metrics; `work/` is ignored by Git.

For the browser-only demo or UI development:

```sh
npm ci
npm run dev
```

The development server opens at `http://127.0.0.1:5174`. Its `/api` proxy connects only to the local server on port 4317. Demo-only use also works on macOS/Linux; the real collector is Windows-only.

## Explore the city

- Click a building or choose a row in Tools → Processes to open its inspector. Close it to return to the full city.
- Search by process name or PID. Sort by memory, CPU or name. Filter processes with sustained private-memory growth.
- In 3D, drag to orbit, Shift-drag to pan, +/− to zoom and 0/Escape to reset. Arrow keys orbit a focused canvas. The 2D fallback uses drag/arrow panning.
- Toggle process labels and parent-child streets. The searchable process list includes all collected processes; the map is limited to 110 buildings for predictable rendering cost.
- Pause freezes sampling and animation; resume reads the current counters again.
- Capture & replay contains the source-marked PNG, video, recording and raw-snapshot exports.
- Persian and English UI, bundled Vazirmatn font, reduced-motion support and an accessible process list alongside the visual canvas.

## Make a little chaos

In **Simulation**, open Tools → Experiences and enable **CPU surge** to load the synthetic Node district. Enable **Memory leak** to grow `memory-lab.exe` by 24 MB per update. Its building expands; a growth signal eventually raises floodwater. **Recover city** stops the scenarios and gradually releases synthetic leaked memory.

### What the water actually means

A memory-growth signal requires all of:

- at least 6 observations spanning at least 12 seconds;
- at least 16 MB and 15% increase in **private memory**;
- increases in at least 70% of intervals within the retained window.

The detector uses up to 30 samples (about one minute at the normal two-second cadence). Floodwater scales with the combined positive growth of flagged processes. **This is a visual heuristic, not proof of a leak**: caches, compilers and legitimate workloads may grow memory. Working-set size determines buildings; private bytes determine the growth heuristic.

## Themes and contributions

Four included themes: **Neon metropolis**, **Emerald forest**, **Orbital station**, **Deep aquarium**. Each changes the palette and building geometry.

Add a typed `Theme` entry to `src/themes.ts`. Geometry variants are implemented in `src/city.ts`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the checks and theme contract.

## Implementation

- `server/collect.ps1`: read-only native Windows sampling via `GetProcesses`, Tool Help parent IDs, `GetSystemTimes` and `GlobalMemoryStatusEx`. No WMI/CIM dependency, command lines, file paths, usernames or environment variables are collected.
- `server/collector.ts`: bounded JSON-lines collection or external collector-file ingestion.
- `server/http.ts`: loopback-only HTTP service and static application; explicit Host and Origin validation; no cross-origin data sharing; no write or process-termination endpoints.
- `src/model.ts`: validated raw snapshot schema.
- `src/metrics.ts`: CPU deltas, process identity, memory growth, bounded histories and events.
- `src/city.ts`: common renderer contract, WebGL fallback and source-marked PNG capture.
- `src/city3d.ts`: bounded Three.js city, instanced bodies/windows, ray selection, camera, split comparison and adaptive quality.
- `src/city2d.ts`: retained Canvas renderer and split comparison fallback.
- `src/layout.ts`: stable, bounded application-neighborhood plots.
- `src/insights.ts`: observed process-family aggregation and honest unknown/partial CPU handling.
- `src/shell.ts` / `src/experience-shell.ts`: quiet bilingual shell, contextual inspector, Tools dialog and time dock.
- `src/main.ts`: bilingual UI, collection lifecycle and explicit source states.
- `src/districts.ts`: executable-name styles and cycle-safe application ancestry.
- `src/tape.ts`: bounded recording, validated JSON import and frame comparison.
- `src/rescue.ts`: simulation-clock rescue state machine, with a memory-recovery gate.
- `src/experience.ts`: cinematic direction, recording controls, challenge and video UI.
- `src/showcase.ts`: a reproducible, clearly labeled synthetic story.
- `src/video.ts`: local canvas capture, encoder fallback, cancellation and stream cleanup.

CPU percentages use **total machine capacity**: one saturated logical core on a four-core system is about 25%. The first reading needs a second sample. Per-process CPU may be unavailable or not sum exactly to the system CPU counter. Physical RAM usage comes from system availability; process working sets are not summed because shared pages can be counted more than once.

Process identity combines PID and creation time when available, so recycled PIDs do not inherit old histories. Parent links are rejected when the observed parent started after its child. Missing creation times limit identity confidence. Collection spans a short interval, rather than an atomic operating-system snapshot.

## Test and build

```sh
npm test
npm run build
```

The 30-test suite covers family discovery, partial CPU readings, stable/bounded 3D layouts, CPU normalization, PID reuse, parent identity, memory-growth thresholds, noisy histories, bounded events, collector payload validation, simulation behavior and HTTP origin/path/method boundaries. GitHub Actions runs the same tests and build on Linux; actual collection is additionally tested on Windows.

Optional **real** bounded workloads for checking your local monitor (never launched by the UI):

```powershell
node --experimental-strip-types tools/workload.ts memory
node --experimental-strip-types tools/workload.ts cpu
```

The memory fixture retains at most 96 MB and exits after 20 seconds. The CPU fixture uses one core for 15 seconds. Observe their printed PIDs in Live Windows. These fixtures are distinct from the browser's synthetic scenario buttons.

## Deploy the demo

Import this repository into Vercel using the **Vite** preset: build `npm run build`, output `dist`, Node 24. No environment variables are required. This deploys only the simulation interface. The Windows collector remains local; Vercel is not used as a remote process-monitoring backend.

## Scope

Version 3 is a read-only Windows monitor and browser simulation. It includes a bounded local replay buffer and explicit recording/video downloads; it has no remote-device monitoring, autostart service, installer or persistent historical database. Reloading clears the in-memory recording unless you saved it. Exports may contain process names. No telemetry or analytics is included. The monitoring app and PowerShell collector themselves consume some resources, which are included in live readings.

## License

Application: [MIT](LICENSE). The Three.js renderer is covered by its [MIT notice](public/licenses/three-MIT.txt). The bundled [Vazirmatn](https://github.com/rastikerdar/vazirmatn) variable font is by Saber Rastikerdar and contributors and is distributed under [SIL OFL](public/fonts/OFL-Vazirmatn.txt).
