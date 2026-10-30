# Process City — design and interaction contract

The product makes system activity visible so people can identify resource-heavy application families, inspect process relationships and learn how CPU and memory change. It does not establish why an operating system is slow or prove that memory growth is a leak.

## Screen hierarchy

1. A short, always-visible purpose statement and the resource-discovery action.
2. The city, occupying the primary viewing area, with a compact source/CPU/RAM line.
3. A thin replay/comparison/capture dock.
4. Contextual detail only: a selected-process inspector or resource-discovery card.
5. Specialist controls in Tools: Processes, Experiences, Capture & replay, Settings.

The default screen has no permanent inspector, process table, rescue card or export-card stack. The About dialog explains purpose, mappings, source limits, memory-growth interpretation and keyboard controls. Both languages use the bundled Vazirmatn family.

## Ownership of movement

The first-visit introduction uses names and measurements from the accepted snapshot. It lasts about 3.3 seconds, can be skipped, and remembers completion locally. Reduced-motion preferences skip the reveal. It can be replayed from Settings.

Orbit, pan and zoom are manual by default. A cinematic tour is explicitly enabled in Settings. Pointer/keyboard interaction with the city, manual process selection, resource discovery, replay or starting a rescue returns camera ownership to the user. Automatic moves must never pull a user away while they inspect a process.

## Resource discovery

Families follow creation-time-checked observed ancestry. Executable-name hints affect architecture only. CPU is the sum of available readings normalized to total machine capacity; an all-unknown family has no CPU ranking. Partial sums are marked as lower bounds. Memory ranking sums **private bytes**, not working sets or machine physical RAM.

Discovery pins the family found at selection while its numbers keep updating. Refreshing the current leader is explicit. An exited family has an empty-state message. High usage alone is not labeled faulty.

## Time and comparison

The split view shares a camera and stable plots. Each side uses its own working-set heights, CPU-window illumination and sustained-growth water. Reference and selected/current timestamps remain visible. The comparison boundary has a draggable handle and a native range control for keyboard access.

The in-memory tape retains at most 90 frames and 25,000 process samples; JSON imports are limited to 12 MB and validate schema, monotonic times, identities, parent links and counters. Incoming sampling continues while viewing a frozen replay tape. Source labels remain explicit. The demo story is generated synthetic data and never replaces live readings silently.

## Contextual rescue

The simulation-only challenge starts from Experiences. Its compact HUD appears over the city while the game is active, rather than occupying the default screen. A persistent synthetic process is chosen as the source. A fresh analysis window makes growth discoverable within the challenge. Only accepted samples advance game time; a correct selection contains the synthetic leak, then waits for water and memory recovery. The server has no termination endpoint.

## Rendering and capture

Three.js supplies perspective geometry, instanced building bodies and windows, limited shadows and a low-resolution floor reflection. Normal animation is capped around 25 fps. Adaptive mode lowers pixel ratio, disables shadows/reflections and reduces cadence if rendering stays slow. Low and high quality can also be chosen explicitly. Hidden pages suspend animation; paused/reduced-motion views reduce rendering. The city caps at 110 buildings, with a bounded retained-plot history.

The common renderer falls back to Canvas 2D if WebGL cannot initialize or its context is lost. `?renderer=2d` explicitly exercises this path. Both renderers support selection, camera controls, source-marked capture and comparison. All GPU resources and event listeners must be released on replacement or export completion.

PNG and video exports include source and sample time. Video uses a fixed copy of the selected recording, a separate output canvas and a local encoder. The tab should stay visible while rendering. MP4 is preferred when supported; WebM is the fallback. Cancelling closes capture tracks and releases the render world. No recording or live process snapshot is automatically uploaded.

## Verification

Check default, loading, unavailable CPU, stale collector, selected/exited process, empty filter, recording replay, invalid import, active rescue, encoding, cancellation and unsupported encoder states. Use real browser checks at 320, 375, 414, 768 and desktop widths, including keyboard navigation and console output. Commit only synthetic screenshots and fixtures.
## Reading process relationships

Building selection raycasts both the instanced bodies and their visible architectural roofs. Bounds are recomputed at selection time because Three caches an instanced bounding sphere even when it was calculated for an empty city. Every roof carries its process identity; a hit uses geometric depth order, and empty space never selects a process. Regression tests cover empty and stale bounds, relocated buildings, roof ownership and empty-space clicks.

Ground streets use half-grid lanes and short driveways, so they do not run through intermediate building footprints. Selecting a process reveals its observed parent in amber and direct children in blue, with arrows from parent to child. Roof rings, role/name/PID labels and a navigable family diagram provide redundant cues beyond color. These links are process ancestry, not network traffic or data flow.

The bounded skyline always admits the selected process, its available parent and its 12 largest children before filling remaining plots by working-set memory. At most 12 child paths are emphasized to avoid a dense graph; the inspector discloses this limit and offers the complete child list. Missing parents and childless processes are explicit states. Resource-discovery mode keeps its application-family view, independent of the relationship focus.

Relation labels keep a readable screen size, avoid each other and have leader lines back to their roofs. Mobile uses fewer labels and a lower details sheet. Canvas fallback preserves the same semantic direction, colors and relation navigation.
