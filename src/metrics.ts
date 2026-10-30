import {
  processKey,
  type RawSnapshot,
  type CitySnapshot,
  type CityProcess,
  type CityEvent,
  type HistoryPoint,
} from "./model.ts";
const MB = 1024 * 1024;
export function cpuPercent(
  previous: number | null,
  current: number | null,
  elapsed: number,
  cores: number,
): number | null {
  if (
    previous === null ||
    current === null ||
    elapsed <= 0 ||
    cores < 1 ||
    current < previous
  )
    return null;
  return Math.max(
    0,
    Math.min(100, ((current - previous) / elapsed / cores) * 100),
  );
}
export function growthSignal(history: HistoryPoint[]): {
  growthMB: number;
  growthRate: number;
  growing: boolean;
} {
  if (history.length < 2) return { growthMB: 0, growthRate: 0, growing: false };
  const first = history[0],
    last = history[history.length - 1],
    seconds = (last.time - first.time) / 1000;
  const growthMB = (last.privateBytes - first.privateBytes) / MB;
  const positive = history
    .slice(1)
    .filter((p, i) => p.privateBytes > history[i].privateBytes).length;
  return {
    growthMB,
    growthRate: seconds > 0 ? (growthMB / seconds) * 60 : 0,
    growing:
      seconds >= 12 &&
      history.length >= 6 &&
      growthMB >= 16 &&
      growthMB * MB >= first.privateBytes * 0.15 &&
      positive / (history.length - 1) >= 0.7,
  };
}
export class CityAnalyzer {
  private previous: RawSnapshot | null = null;
  private histories = new Map<string, HistoryPoint[]>();
  private events: CityEvent[] = [];
  private growthKeys = new Set<string>();
  update(raw: RawSnapshot): CitySnapshot {
    const at = Date.parse(raw.capturedAt),
      old = this.previous,
      oldAt = old ? Date.parse(old.capturedAt) : 0;
    if (old && at <= oldAt)
      throw new Error("Collector timestamps must increase.");
    const elapsed = old ? (at - oldAt) / 1000 : 0;
    const oldProcesses = new Map(old?.processes.map((p) => [processKey(p), p]));
    const currentKeys = new Set(raw.processes.map(processKey));
    const byPid = new Map(raw.processes.map((p) => [p.pid, p]));
    const processes: CityProcess[] = raw.processes.map((p) => {
      const key = processKey(p),
        last = oldProcesses.get(key);
      const cpu = last
        ? cpuPercent(last.cpuSeconds, p.cpuSeconds, elapsed, raw.cores)
        : null;
      const history = [
        ...(this.histories.get(key) ?? []),
        { time: at, rss: p.rssBytes, privateBytes: p.privateBytes, cpu },
      ].slice(-30);
      this.histories.set(key, history);
      const parent = byPid.get(p.ppid);
      const validParent =
        parent &&
        parent.pid !== p.pid &&
        (!parent.createdAt ||
          !p.createdAt ||
          Date.parse(parent.createdAt) <= Date.parse(p.createdAt));
      const growth = growthSignal(history);
      if (old && !last) this.addEvent(at, "start", p.name, p.pid, key);
      if (growth.growing && !this.growthKeys.has(key)) {
        this.addEvent(at, "growth", p.name, p.pid, key);
        this.growthKeys.add(key);
      }
      if (!growth.growing) this.growthKeys.delete(key);
      return {
        ...p,
        key,
        cpu,
        parentKey: validParent ? processKey(parent) : null,
        history,
        ...growth,
      };
    });
    for (const [key, p] of oldProcesses)
      if (!currentKeys.has(key)) {
        this.addEvent(at, "exit", p.name, p.pid, key);
        this.histories.delete(key);
        this.growthKeys.delete(key);
      }
    let cpu: number | null = null;
    if (old?.systemCpu && raw.systemCpu) {
      const total = raw.systemCpu.total - old.systemCpu.total,
        idle = raw.systemCpu.idle - old.systemCpu.idle;
      if (total > 0 && idle >= 0)
        cpu = Math.max(0, Math.min(100, (1 - idle / total) * 100));
    }
    this.previous = raw;
    return {
      at,
      cpu,
      ramUsed: raw.totalBytes - raw.availableBytes,
      ramTotal: raw.totalBytes,
      cores: raw.cores,
      processes,
      events: [...this.events],
      growingCount: processes.filter((p) => p.growing).length,
    };
  }
  private addEvent(
    time: number,
    kind: CityEvent["kind"],
    name: string,
    pid: number,
    key: string,
  ): void {
    this.events.unshift({
      id: `${time}:${kind}:${key}`,
      time,
      kind,
      name,
      pid,
    });
    this.events = this.events.slice(0, 40);
  }
}
export function sortProcesses(
  processes: CityProcess[],
  sort: "ram" | "cpu" | "name",
): CityProcess[] {
  return [...processes].sort((a, b) =>
    sort === "name"
      ? a.name.localeCompare(b.name)
      : sort === "cpu"
        ? (b.cpu ?? -1) - (a.cpu ?? -1) || b.rssBytes - a.rssBytes
        : b.rssBytes - a.rssBytes || a.pid - b.pid,
  );
}
