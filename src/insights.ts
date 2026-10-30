import type { CitySnapshot } from "./model.ts";
import { districtRoot } from "./districts.ts";

export type InsightMetric = "cpu" | "memory";
export interface ApplicationInsight {
  key: string;
  name: string;
  members: Set<string>;
  cpu: number | null;
  cpuComplete: boolean;
  privateBytes: number;
}
/** Group only by observed ancestry. Name hints never establish process ownership. */
export function applicationInsights(
  snapshot: CitySnapshot,
): ApplicationInsight[] {
  const groups = new Map<string, ApplicationInsight>();
  for (const p of snapshot.processes) {
    const root = districtRoot(p, snapshot.processes);
    let group = groups.get(root.key);
    if (!group) {
      group = {
        key: root.key,
        name: root.name,
        members: new Set(),
        cpu: null,
        cpuComplete: true,
        privateBytes: 0,
      };
      groups.set(root.key, group);
    }
    group.members.add(p.key);
    group.privateBytes += p.privateBytes;
    if (p.cpu === null) group.cpuComplete = false;
    else group.cpu = (group.cpu ?? 0) + p.cpu;
  }
  return [...groups.values()];
}
export function busiestApplication(
  snapshot: CitySnapshot,
  metric: InsightMetric,
): ApplicationInsight | null {
  const groups = applicationInsights(snapshot);
  const ranked = groups
    .filter((g) => metric === "memory" || g.cpu !== null)
    .sort((a, b) =>
      metric === "memory"
        ? b.privateBytes - a.privateBytes
        : (b.cpu ?? -1) - (a.cpu ?? -1),
    );
  return ranked[0] ?? null;
}
