import type { CityProcess } from "./model.ts";

// These are observed process links. A matching executable name is never an edge.
export function processRelations(
  processes: CityProcess[],
  selected: string | null,
) {
  const process = processes.find((p) => p.key === selected) ?? null;
  const parent = process
    ? (processes.find(
        (p) => p.key === process.parentKey && p.key !== process.key,
      ) ?? null)
    : null;
  const children = process
    ? processes
        .filter((p) => p.parentKey === process.key && p.key !== process.key)
        .sort((a, b) => b.rssBytes - a.rssBytes || a.key.localeCompare(b.key))
    : [];
  const members = new Set(
    [process, parent, ...children].filter((p) => p !== null).map((p) => p.key),
  );
  const highlighted = new Set(
    [process, parent, ...children.slice(0, 12)]
      .filter((p) => p !== null)
      .map((p) => p.key),
  );
  return { process, parent, children, members, highlighted };
}

/** Keep a selected building's direct relatives in the bounded skyline, even when small. */
export function visibleProcesses(
  processes: CityProcess[],
  selected: string | null,
): CityProcess[] {
  const family = processRelations(processes, selected);
  const priority = [
    family.process,
    family.parent,
    ...family.children.slice(0, 12),
  ].filter((p) => p !== null);
  const byMemory = [...processes].sort(
    (a, b) => b.rssBytes - a.rssBytes || a.key.localeCompare(b.key),
  );
  return [
    ...new Map([...priority, ...byMemory].map((p) => [p.key, p])).values(),
  ].slice(0, 110);
}

/** Route on half-grid lanes, with short driveway spurs. No intermediate building centres. */
export function streetRoute(
  parent: { x: number; z: number },
  child: { x: number; z: number },
) {
  return [
    parent,
    { x: parent.x + 0.5, z: parent.z },
    { x: parent.x + 0.5, z: child.z + 0.5 },
    { x: child.x + 0.5, z: child.z + 0.5 },
    { x: child.x + 0.5, z: child.z },
    child,
  ].filter(
    (p, i, points) => !i || p.x !== points[i - 1].x || p.z !== points[i - 1].z,
  );
}

export const relationColors = {
  parent: "#ffcc80",
  child: "#73e8ff",
  selected: "#f5fbff",
};
