import { test } from "node:test";
import assert from "node:assert/strict";
import { CityAnalyzer } from "../src/metrics.ts";
import { DemoWorld } from "../src/demo.ts";
import { CityLayout } from "../src/layout.ts";
import {
  processRelations,
  visibleProcesses,
  streetRoute,
} from "../src/relationships.ts";

const snapshot = () =>
  new CityAnalyzer().update(new DemoWorld().next(1800000000000));
test("relationship focus follows observed parent and child keys, including leaf and missing-parent states", () => {
  const city = snapshot(),
    selected = city.processes.find((p) => p.pid === 1200)!;
  const family = processRelations(city.processes, selected.key);
  assert.equal(family.parent?.pid, 1100);
  assert.equal(family.children.length, 12);
  assert.ok(family.children.every((p) => p.parentKey === selected.key));
  const leaf = processRelations(city.processes, family.children[0].key);
  assert.equal(leaf.parent?.key, selected.key);
  assert.equal(leaf.children.length, 0);
  const absent = processRelations(
    city.processes.filter((p) => p.pid !== 1100),
    selected.key,
  );
  assert.equal(absent.parent, null);
  assert.equal(processRelations(city.processes, "exited").highlighted.size, 0);
});
test("small observed relatives remain drawable in a crowded city", () => {
  const base = snapshot().processes[0];
  const processes = Array.from({ length: 160 }, (_, i) => ({
    ...base,
    key: `p-${i}`,
    pid: 10000 + i,
    parentKey: null as string | null,
    rssBytes: (160 - i) * 1048576,
  }));
  const selected = processes[155];
  selected.parentKey = processes[156].key;
  processes[157].parentKey = selected.key;
  const layout = new CityLayout();
  layout.sync(processes, null);
  assert.equal(layout.plots.has(selected.key), false);
  layout.sync(processes, selected.key);
  for (const key of processRelations(processes, selected.key).highlighted)
    assert.ok(layout.plots.has(key));
  assert.equal(layout.plots.size, 110);
});
test("large families have a deterministic highlight budget while preserving their full relation list", () => {
  const base = snapshot().processes[0];
  const processes = Array.from({ length: 150 }, (_, i) => ({
    ...base,
    key: `p-${i}`,
    pid: i + 1000,
    parentKey: i ? "p-0" : null,
    rssBytes: i * 1048576,
  }));
  const family = processRelations(processes, "p-0");
  assert.equal(family.children.length, 149);
  assert.equal(family.highlighted.size, 13);
  assert.ok(family.highlighted.has("p-149"));
  assert.equal(visibleProcesses(processes, "p-0").length, 110);
  assert.deepEqual(
    visibleProcesses(processes, "p-0"),
    visibleProcesses([...processes].reverse(), "p-0"),
  );
});
test("streets run through half-grid lanes rather than intermediate building footprints", () => {
  for (const child of [
    { x: 0, z: 0 },
    { x: 8, z: 2 },
    { x: 3, z: 10 },
    { x: 12, z: 12 },
  ]) {
    const parent = { x: 3, z: 2 },
      route = streetRoute(parent, child);
    assert.deepEqual(route[0], parent);
    assert.deepEqual(route.at(-1), child);
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1],
        b = route[i];
      assert.ok(a.x === b.x || a.z === b.z);
      if (i > 1 && i < route.length - 1) {
        assert.ok(
          a.x === b.x ? !Number.isInteger(a.x) : !Number.isInteger(a.z),
        );
      }
    }
  }
});
