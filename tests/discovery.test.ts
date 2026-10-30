import { test } from "node:test";
import assert from "node:assert/strict";
import { CityAnalyzer } from "../src/metrics.ts";
import { DemoWorld } from "../src/demo.ts";
import { applicationInsights, busiestApplication } from "../src/insights.ts";
import { CityLayout } from "../src/layout.ts";

function city() {
  const analyzer = new CityAnalyzer(),
    demo = new DemoWorld();
  analyzer.update(demo.next(1800000000000));
  demo.surge = true;
  return analyzer.update(demo.next(1800000002000));
}
test("resource discovery aggregates a measured process family and names its actual root", () => {
  const snapshot = city(),
    result = busiestApplication(snapshot, "cpu")!;
  assert.equal(result.name, "Code.exe");
  assert.ok(
    result.members.has(snapshot.processes.find((p) => p.pid === 3100)!.key),
  );
  assert.ok(result.cpu! > 45);
  const members = snapshot.processes.filter((p) => result.members.has(p.key));
  assert.equal(
    result.privateBytes,
    members.reduce((n, p) => n + p.privateBytes, 0),
  );
  assert.equal(
    result.cpu,
    members.reduce((n, p) => n + (p.cpu ?? 0), 0),
  );
  assert.equal(result.cpuComplete, true);
});
test("CPU discovery never invents zero for unavailable counters and marks partial sums", () => {
  const snapshot = city();
  snapshot.processes.forEach((p) => (p.cpu = null));
  assert.equal(busiestApplication(snapshot, "cpu"), null);
  assert.ok(busiestApplication(snapshot, "memory"));
  const node = snapshot.processes.find((p) => p.pid === 3100)!;
  node.cpu = 24;
  const result = busiestApplication(snapshot, "cpu")!;
  assert.equal(result.cpu, 24);
  assert.equal(result.cpuComplete, false);
});
test("name similarity does not merge unrelated process families", () => {
  const snapshot = city();
  const other = {
    ...snapshot.processes.find((p) => p.pid === 1200)!,
    pid: 99000,
    key: "99000:independent",
    parentKey: null,
    ppid: 0,
  };
  snapshot.processes.push(other);
  const groups = applicationInsights(snapshot).filter(
    (g) => g.name === "chrome.exe",
  );
  assert.equal(groups.length, 2);
  assert.equal(groups.find((g) => g.key === other.key)!.members.size, 1);
});
test("3D city layout keeps occupied plots unique and stable as measured values change", () => {
  const snapshot = city(),
    layout = new CityLayout();
  layout.sync(snapshot.processes, null);
  const initial = new Map(layout.plots);
  assert.equal(
    new Set([...layout.plots.values()].map((p) => `${p.x}:${p.z}`)).size,
    initial.size,
  );
  snapshot.processes.forEach((p) => (p.rssBytes *= 1.2));
  layout.sync(snapshot.processes, null);
  assert.deepEqual(layout.plots, initial);
  assert.ok(
    [...layout.plots.values()].every(
      (p) => !(p.x >= 5 && p.x <= 7 && p.z >= 5 && p.z <= 7),
    ),
  );
});
test("3D layout caps building count, admits a selected small process and retains a bounded history", () => {
  const base = city().processes[0];
  const processes = Array.from({ length: 160 }, (_, i) => ({
    ...base,
    pid: i + 10000,
    key: `process-${i}`,
    parentKey: null,
    rssBytes: (160 - i) * 1048576,
  }));
  const layout = new CityLayout();
  layout.sync(processes, processes[159].key);
  assert.equal(layout.plots.size, 110);
  assert.ok(layout.plots.has(processes[159].key));
  const key = processes[0].key,
    position = layout.plots.get(key)!;
  layout.sync(processes.slice(1), null);
  assert.deepEqual(layout.historical(key), position);
  for (let i = 0; i < 8; i++)
    layout.sync(
      processes.map((p) => ({ ...p, key: `${i}:${p.key}` })),
      null,
    );
  assert.equal(layout.historical(key), undefined);
});
