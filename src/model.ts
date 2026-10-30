export interface RawProcess {
  pid: number;
  ppid: number;
  name: string;
  createdAt: string | null;
  cpuSeconds: number | null;
  rssBytes: number;
  privateBytes: number;
}
export interface RawSnapshot {
  schemaVersion: 1;
  capturedAt: string;
  cores: number;
  totalBytes: number;
  availableBytes: number;
  systemCpu: { idle: number; total: number } | null;
  processes: RawProcess[];
}
export interface HistoryPoint {
  time: number;
  rss: number;
  privateBytes: number;
  cpu: number | null;
}
export interface CityProcess extends RawProcess {
  key: string;
  cpu: number | null;
  parentKey: string | null;
  history: HistoryPoint[];
  growthMB: number;
  growthRate: number;
  growing: boolean;
}
export interface CitySnapshot {
  at: number;
  cpu: number | null;
  ramUsed: number;
  ramTotal: number;
  cores: number;
  processes: CityProcess[];
  events: CityEvent[];
  growingCount: number;
}
export interface CityEvent {
  id: string;
  time: number;
  kind: "start" | "exit" | "growth";
  name: string;
  pid: number;
}
export type Mode = "demo" | "live";
export type ThemeId = "neon" | "forest" | "orbital" | "aquarium";
export interface Theme {
  id: ThemeId;
  name: string;
  fa: string;
  ground: string;
  road: string;
  grid: string;
  top: string;
  left: string;
  right: string;
  window: string;
  accent: string;
  secondary: string;
  water: string;
  shape: "building" | "tree" | "station" | "reef";
}
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
export function validateSnapshot(value: unknown): RawSnapshot {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    typeof value.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(value.capturedAt)) ||
    !finite(value.cores) ||
    value.cores < 1 ||
    !finite(value.totalBytes) ||
    value.totalBytes === 0 ||
    !finite(value.availableBytes) ||
    value.availableBytes > value.totalBytes ||
    !Array.isArray(value.processes) ||
    value.processes.length > 10000
  )
    throw new Error("Invalid collector snapshot.");
  const ids = new Set<number>();
  for (const p of value.processes) {
    if (
      !object(p) ||
      !finite(p.pid) ||
      !Number.isInteger(p.pid) ||
      !finite(p.ppid) ||
      !Number.isInteger(p.ppid) ||
      ids.has(p.pid) ||
      typeof p.name !== "string" ||
      p.name.length > 260 ||
      !finite(p.rssBytes) ||
      !finite(p.privateBytes) ||
      (p.cpuSeconds !== null && !finite(p.cpuSeconds)) ||
      (p.createdAt !== null &&
        (typeof p.createdAt !== "string" ||
          !Number.isFinite(Date.parse(p.createdAt))))
    )
      throw new Error("Invalid process record.");
    ids.add(p.pid);
  }
  const cpu = value.systemCpu;
  if (
    cpu !== null &&
    (!object(cpu) ||
      !finite(cpu.idle) ||
      !finite(cpu.total) ||
      cpu.idle > cpu.total)
  )
    throw new Error("Invalid CPU counters.");
  return value as unknown as RawSnapshot;
}
export const processKey = (p: RawProcess): string =>
  `${p.pid}:${p.createdAt ?? "unknown"}`;
