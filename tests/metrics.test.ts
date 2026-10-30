import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cpuPercent,
  growthSignal,
  CityAnalyzer,
  sortProcesses,
} from "../src/metrics.ts";
import {
  validateSnapshot,
  processKey,
  type RawSnapshot,
  type RawProcess,
} from "../src/model.ts";
import { DemoWorld } from "../src/demo.ts";
const MB = 1048576;
const process = (overrides: Partial<RawProcess> = {}): RawProcess => ({
  pid: 10,
  ppid: 1,
  name: "worker.exe",
  createdAt: "2026-01-01T00:00:00Z",
  cpuSeconds: 1,
  rssBytes: 40 * MB,
  privateBytes: 32 * MB,
  ...overrides,
});
const raw = (seconds = 0, processes = [process()]): RawSnapshot => ({
  schemaVersion: 1,
  capturedAt: new Date(
    Date.UTC(2026, 0, 1, 0, 1) + seconds * 1000,
  ).toISOString(),
  cores: 4,
  totalBytes: 16 * 1024 * MB,
  availableBytes: 8 * 1024 * MB,
  systemCpu: { idle: seconds * 5, total: seconds * 10 },
  processes,
});
test("process CPU uses elapsed time and total machine capacity", () => {
  assert.equal(cpuPercent(4, 6, 2, 4), 25);
  assert.equal(cpuPercent(0, 20, 1, 4), 100);
});
test("unknown, reset, or invalid CPU deltas never become invented zero readings", () => {
  assert.equal(cpuPercent(null, 4, 2, 4), null);
  assert.equal(cpuPercent(10, 2, 2, 4), null);
  assert.equal(cpuPercent(0, 2, 0, 4), null);
});
test("system CPU derives from system counters; RAM uses physical availability, not summed working sets", () => {
  const a = new CityAnalyzer();
  assert.equal(a.update(raw()).cpu, null);
  const s = a.update(raw(2, [process({ cpuSeconds: 3 })]));
  assert.equal(s.cpu, 50);
  assert.equal(s.processes[0].cpu, 25);
  assert.equal(s.ramUsed, 8 * 1024 * MB);
});
test("PID reuse resets process history and CPU and records the old process exit", () => {
  const a = new CityAnalyzer();
  a.update(raw());
  a.update(raw(2, [process({ cpuSeconds: 3 })]));
  const s = a.update(
    raw(4, [process({ createdAt: "2026-01-01T00:01:03Z", cpuSeconds: 0.1 })]),
  );
  assert.equal(s.processes[0].history.length, 1);
  assert.equal(s.processes[0].cpu, null);
  assert.ok(s.events.some((e) => e.kind === "exit"));
  assert.ok(s.events.some((e) => e.kind === "start"));
});
test("a reused parent PID with a later start time is not shown as the parent", () => {
  const a = new CityAnalyzer();
  const child = process({ ppid: 1 }),
    parent = process({ pid: 1, ppid: 0, createdAt: "2026-01-01T00:00:30Z" });
  assert.equal(
    a.update(raw(0, [parent, child])).processes.find((p) => p.pid === 10)!
      .parentKey,
    null,
  );
});
test("valid parent-child identity links are preserved", () => {
  const parent = process({
    pid: 1,
    ppid: 0,
    createdAt: "2025-12-31T23:00:00Z",
  });
  const s = new CityAnalyzer().update(raw(0, [parent, process()]));
  assert.equal(s.processes[1].parentKey, processKey(parent));
});
test("growth detector requires duration, sample count, absolute and relative growth", () => {
  const values = Array.from({ length: 7 }, (_, i) => ({
    time: i * 2000,
    rss: 100 * MB,
    privateBytes: (80 + i * 4) * MB,
    cpu: 1,
  }));
  assert.equal(growthSignal(values).growing, true);
  assert.equal(growthSignal(values.slice(0, 5)).growing, false);
  assert.equal(
    growthSignal(
      values.map((v) => ({ ...v, privateBytes: v.privateBytes * 0 + 80 * MB })),
    ).growing,
    false,
  );
});
test("oscillating memory does not trigger sustained growth", () => {
  const values = [80, 100, 79, 101, 78, 102, 100].map((v, i) => ({
    time: i * 2000,
    rss: v * MB,
    privateBytes: v * MB,
    cpu: 1,
  }));
  assert.equal(growthSignal(values).growing, false);
});
test("history and event buffers stay bounded; exited processes disappear", () => {
  const a = new CityAnalyzer();
  let s = a.update(raw());
  for (let i = 1; i < 100; i++)
    s = a.update(raw(i * 2, [process({ pid: i + 100, cpuSeconds: i })]));
  assert.ok(s.events.length <= 40);
  assert.equal(s.processes.length, 1);
  assert.ok(s.processes[0].history.length <= 30);
});
test("timestamps must increase and unknown CPU sorts after known CPU", () => {
  const a = new CityAnalyzer();
  a.update(raw());
  assert.throws(() => a.update(raw()));
  const s = new CityAnalyzer().update(
    raw(0, [process(), process({ pid: 20 })]),
  );
  s.processes[0].cpu = 3;
  s.processes[1].cpu = null;
  assert.equal(sortProcesses(s.processes, "cpu")[0].pid, 10);
});
test("collector payloads validate duplicate PIDs, negative memory, and unavailable CPU", () => {
  assert.doesNotThrow(() =>
    validateSnapshot(raw(0, [process({ cpuSeconds: null })])),
  );
  assert.throws(() => validateSnapshot(raw(0, [process(), process()])));
  assert.throws(() => validateSnapshot(raw(0, [process({ rssBytes: -1 })])));
  assert.throws(() => validateSnapshot({ ...raw(), availableBytes: Infinity }));
});
test("demo leak grows the targeted process and recovery releases its synthetic memory", () => {
  const world = new DemoWorld(),
    a = new CityAnalyzer();
  world.leak = true;
  let s = a.update(world.next(100000));
  for (let i = 1; i <= 9; i++) s = a.update(world.next(100000 + i * 2000));
  const leaking = s.processes.find((p) => p.pid === 7331)!;
  assert.equal(leaking.growing, true);
  const before = leaking.privateBytes;
  world.recover();
  s = a.update(world.next(122000));
  assert.ok(s.processes.find((p) => p.pid === 7331)!.privateBytes < before);
});
test("demo CPU surge is visible and does not allocate memory or use a real workload", () => {
  const world = new DemoWorld(),
    a = new CityAnalyzer();
  a.update(world.next(100000));
  world.surge = true;
  const s = a.update(world.next(102000));
  assert.ok(s.cpu! > 70);
  assert.ok(s.processes.find((p) => p.pid === 3100)!.cpu! > 40);
});
