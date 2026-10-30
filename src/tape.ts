import {
  processKey,
  validateSnapshot,
  type CitySnapshot,
  type CityProcess,
  type Mode,
} from "./model.ts";

const MAX_SAMPLES = 25000;
const MAX_FRAMES = 90;
export const MAX_TAPE_BYTES = 12 * 1024 * 1024;
type Frame = Omit<CitySnapshot, "processes"> & { processes: CityProcess[] };
export class CityTape {
  readonly frames: Frame[] = [];
  source: Mode;
  private samples = 0;
  constructor(source: Mode = "demo") {
    this.source = source;
  }
  record(snapshot: CitySnapshot): void {
    if (this.frames.length && snapshot.at <= this.frames.at(-1)!.at) return;
    if (snapshot.processes.length > MAX_SAMPLES) return;
    const frame: Frame = {
      ...snapshot,
      events: snapshot.events.map((e) => ({ ...e })),
      processes: snapshot.processes.map((p) => ({ ...p, history: [] })),
    };
    this.frames.push(frame);
    this.samples += frame.processes.length;
    while (this.frames.length > MAX_FRAMES || this.samples > MAX_SAMPLES) {
      this.samples -= this.frames.shift()!.processes.length;
    }
  }
  frame(index: number): CitySnapshot | null {
    const i = Math.max(0, Math.min(this.frames.length - 1, Math.round(index)));
    const frame = this.frames[i];
    if (!frame) return null;
    const history = new Map<string, CityProcess["history"]>();
    for (const f of this.frames.slice(Math.max(0, i - 29), i + 1)) {
      for (const p of f.processes) {
        const h = history.get(p.key) ?? [];
        h.push({
          time: f.at,
          rss: p.rssBytes,
          privateBytes: p.privateBytes,
          cpu: p.cpu,
        });
        history.set(p.key, h);
      }
    }
    return {
      ...frame,
      processes: frame.processes.map((p) => ({
        ...p,
        history: history.get(p.key)!,
      })),
    };
  }
  serialize(): string {
    return JSON.stringify({
      application: "Process City",
      version: 2,
      source: this.source,
      frames: this.frames,
    });
  }
  static parse(text: string): CityTape {
    if (new TextEncoder().encode(text).length > MAX_TAPE_BYTES)
      throw new Error("Recording exceeds 12 MB.");
    const data = JSON.parse(text);
    if (
      data.application !== "Process City" ||
      data.version !== 2 ||
      !["demo", "live"].includes(data.source) ||
      !Array.isArray(data.frames) ||
      !data.frames.length ||
      data.frames.length > MAX_FRAMES
    )
      throw new Error("Invalid Process City recording.");
    const tape = new CityTape(data.source);
    let count = 0,
      last = -Infinity;
    const finite = (v: unknown): v is number =>
      typeof v === "number" && Number.isFinite(v);
    const cpu = (v: unknown) => v === null || (finite(v) && v >= 0 && v <= 100);
    for (const f of data.frames) {
      if (
        !finite(f.at) ||
        f.at <= last ||
        !cpu(f.cpu) ||
        !finite(f.ramUsed) ||
        f.ramUsed < 0 ||
        f.ramUsed > f.ramTotal ||
        !Array.isArray(f.processes)
      )
        throw new Error("Invalid recording frame.");
      last = f.at;
      count += f.processes.length;
      if (count > MAX_SAMPLES)
        throw new Error("Recording contains too many process samples.");
      const raw = validateSnapshot({
        schemaVersion: 1,
        capturedAt: new Date(f.at).toISOString(),
        cores: f.cores,
        totalBytes: f.ramTotal,
        availableBytes: f.ramTotal - f.ramUsed,
        systemCpu: null,
        processes: f.processes,
      });
      const keys = new Set(raw.processes.map(processKey));
      const byKey = new Map(raw.processes.map((p) => [processKey(p), p]));
      const processes = raw.processes.map((p, i) => {
        const meta = f.processes[i];
        if (
          meta.key !== processKey(p) ||
          !cpu(meta.cpu) ||
          !finite(meta.growthMB) ||
          !finite(meta.growthRate) ||
          typeof meta.growing !== "boolean" ||
          (meta.parentKey !== null &&
            (!keys.has(meta.parentKey) || meta.parentKey === meta.key))
        )
          throw new Error("Invalid process metadata.");
        const parent = byKey.get(meta.parentKey);
        if (
          parent &&
          (parent.pid !== p.ppid ||
            (parent.createdAt &&
              p.createdAt &&
              Date.parse(parent.createdAt) > Date.parse(p.createdAt)))
        )
          throw new Error("Invalid recorded parent identity.");
        return {
          ...p,
          key: meta.key,
          cpu: meta.cpu,
          parentKey: meta.parentKey,
          growthMB: meta.growthMB,
          growthRate: meta.growthRate,
          growing: meta.growing,
          history: [],
        };
      });
      // Events are rebuilt from validated process identities; imported HTML is never trusted.
      const prior = tape.frames.at(-1);
      const events: CitySnapshot["events"] = [];
      if (prior) {
        const old = new Set(prior.processes.map((p) => p.key));
        for (const p of processes)
          if (!old.has(p.key))
            events.push({
              id: `${f.at}:${p.key}`,
              time: f.at,
              kind: "start",
              name: p.name,
              pid: p.pid,
            });
        for (const p of prior.processes)
          if (!keys.has(p.key))
            events.push({
              id: `${f.at}:${p.key}`,
              time: f.at,
              kind: "exit",
              name: p.name,
              pid: p.pid,
            });
      }
      tape.record({
        at: f.at,
        cpu: f.cpu,
        ramUsed: f.ramUsed,
        ramTotal: f.ramTotal,
        cores: f.cores,
        processes,
        events: events.slice(-40),
        growingCount: processes.filter((p) => p.growing).length,
      });
    }
    return tape;
  }
}
export function compareFrames(before: CitySnapshot, after: CitySnapshot) {
  const old = new Set(before.processes.map((p) => p.key)),
    now = new Set(after.processes.map((p) => p.key));
  return {
    births: after.processes.filter((p) => !old.has(p.key)).length,
    exits: before.processes.filter((p) => !now.has(p.key)).length,
    memoryMB: (after.ramUsed - before.ramUsed) / 1048576,
  };
}
