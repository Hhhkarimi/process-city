# Contributing

Process City keeps its collector local and read-only. Contributions should preserve the clear separation between synthetic and live data.

## Add a city theme

1. Add a unique `Theme` entry to `src/themes.ts`, with English/Persian names, readable colors and one supported geometry (`building`, `tree`, `station`, `reef`).
2. A new geometry belongs in `src/city.ts`; preserve hit testing and process identity.
3. Include a screenshot in demo mode. Do not commit snapshots of private live processes.
4. Check desktop and narrow screens, reduced-motion mode and keyboard selection through the process list.
5. Run `npm test` and `npm run build`.

## Collector or metric changes

Include fixtures and tests for CPU intervals, protected processes, PID reuse and stale data. Do not substitute simulated readings after a collector failure, collect command lines or add termination actions to a read-only monitor.

A memory-growth warning is a heuristic, never a definitive leak diagnosis. Document threshold changes and expected false positives. Keep data buffers bounded.

Use an issue to describe a bug, including Windows/Node versions and what you expected. Share a minimal sanitized sample instead of full private process data.
