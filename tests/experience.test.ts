import { test } from "node:test";
import assert from "node:assert/strict";
import { architectures, classify, districtRoot } from "../src/districts.ts";
import { CityTape, compareFrames, MAX_TAPE_BYTES } from "../src/tape.ts";
import { RescueGame } from "../src/rescue.ts";
import { DemoWorld } from "../src/demo.ts";
import { CityAnalyzer } from "../src/metrics.ts";
import { makeShowcase } from "../src/showcase.ts";

function recording(count = 10) {
  const demo = new DemoWorld(),
    analyzer = new CityAnalyzer(),
    tape = new CityTape();
  for (let i = 0; i < count; i++)
    tape.record(analyzer.update(demo.next(1800000000000 + i * 2000)));
  return { demo, analyzer, tape };
}
test("architecture uses app-name hints while neighborhoods use validated parent identity", () => {
  for (const [name, category] of [
    ["chrome.exe", "browser"],
    ["Code.exe", "editor"],
    ["node.exe", "developer"],
    ["Figma.exe", "creative"],
    ["Spotify.exe", "media"],
    ["svchost.exe", "system"],
    ["unknown.exe", "other"],
  ])
    assert.equal(classify(name), category);
  assert.equal(Object.keys(architectures).length, 7);
  const frame = recording(1).tape.frame(0)!;
  const renderer = frame.processes.find((p) => p.pid === 1202)!;
  assert.equal(districtRoot(renderer, frame.processes).pid, 1200);
  assert.equal(
    districtRoot(frame.processes.find((p) => p.pid === 9400)!, frame.processes)
      .pid,
    2200,
  );
  const root = frame.processes.find((p) => p.pid === 1200)!;
  root.parentKey = renderer.key; // Malformed cycles still terminate.
  assert.ok(districtRoot(renderer, frame.processes));
});
test("synthetic launch creates eight correctly linked buildings and uses fresh identities", () => {
  const { demo, analyzer, tape } = recording(2);
  const root = demo.launch();
  const after = analyzer.update(demo.next(1800000004000));
  const born = after.processes.filter((p) => p.pid >= 16000);
  assert.equal(born.length, 8);
  assert.equal(
    born.filter((p) => p.parentKey === born.find((p) => p.pid === root)!.key)
      .length,
    7,
  );
  const diff = compareFrames(tape.frame(1)!, after);
  assert.equal(diff.births, 8);
  assert.ok(diff.memoryMB > 1000);
});
test("rolling tape is bounded, monotonic and reconstructs inspection history without sharing mutations", () => {
  const { tape } = recording(130);
  assert.equal(tape.frames.length, 90);
  assert.equal(tape.frames[0].processes[0].history.length, 0);
  const frame = tape.frame(89)!;
  assert.equal(frame.processes[0].history.length, 30);
  frame.processes[0].rssBytes = 0;
  assert.notEqual(tape.frames[89].processes[0].rssBytes, 0);
  tape.record(tape.frames[0]);
  assert.equal(tape.frames.length, 90);
});
test("recordings enforce total sample budget even when individual frames are large", () => {
  const source = recording(1).tape.frame(0)!;
  const tape = new CityTape("live");
  const processes = Array.from({ length: 1000 }, (_, i) => ({
    ...source.processes[0],
    pid: i + 20000,
    ppid: 0,
    key: `${i + 20000}:${source.processes[0].createdAt}`,
    parentKey: null,
  }));
  for (let i = 0; i < 40; i++)
    tape.record({ ...source, at: source.at + i * 2000, processes });
  assert.equal(tape.frames.length, 25);
  assert.equal(
    tape.frames.reduce((n, f) => n + f.processes.length, 0),
    25000,
  );
});
test("instant showcase contains a complete minute with births, CPU surge, growth and recovery", () => {
  const tape = makeShowcase(1800000000000);
  assert.equal(tape.source, "demo");
  assert.equal(tape.frames.length, 31);
  assert.equal(tape.frames.at(-1)!.at - tape.frames[0].at, 60000);
  assert.ok(
    tape.frames[4].events.some(
      (e) => e.kind === "start" && e.name === "Studio-Code.exe",
    ),
  );
  assert.ok(tape.frames.some((f) => (f.cpu ?? 0) > 70));
  assert.ok(tape.frames.some((f) => f.growingCount > 0));
  const at = (i: number) =>
    tape.frames[i].processes.find((p) => p.pid === 7331)!.privateBytes;
  assert.ok(at(30) < at(21));
  assert.equal(CityTape.parse(tape.serialize()).frames.length, 31);
});
test("recording JSON round trip preserves source, CPU, timestamps and identities", () => {
  const { tape } = recording();
  tape.source = "live";
  const restored = CityTape.parse(tape.serialize());
  assert.equal(restored.source, "live");
  assert.deepEqual(restored.frame(9)?.processes, tape.frame(9)?.processes);
  assert.equal(restored.frame(9)?.at, tape.frame(9)?.at);
});
test("recording import rejects oversized, malformed, out-of-order or spoofed data", () => {
  const { tape } = recording(2);
  const mutate = (fn: (data: any) => void) => {
    const data = JSON.parse(tape.serialize());
    fn(data);
    return JSON.stringify(data);
  };
  assert.throws(() => CityTape.parse(" ".repeat(MAX_TAPE_BYTES + 1)));
  assert.throws(() => CityTape.parse(mutate((d) => (d.source = "cloud"))));
  assert.throws(() => CityTape.parse(mutate((d) => d.frames.reverse())));
  assert.throws(() =>
    CityTape.parse(mutate((d) => (d.frames[0].processes[0].cpu = 999))),
  );
  assert.throws(() =>
    CityTape.parse(mutate((d) => (d.frames[0].processes[0].key = "spoofed"))),
  );
  assert.throws(() =>
    CityTape.parse(mutate((d) => (d.frames[0].ramUsed = -1))),
  );
  assert.throws(() =>
    CityTape.parse(
      mutate((d) => (d.frames[0].processes[0].parentKey = "missing")),
    ),
  );
});
test("rescue requires the actual culprit, penalizes mistakes, and waits for drained memory", () => {
  const game = new RescueGame();
  game.start("culprit", 1000);
  game.advance(3000);
  assert.equal(game.elapsed, 2);
  assert.equal(game.contain("innocent", 3000), "wrong");
  assert.equal(game.elapsed, 6);
  assert.equal(game.contain("culprit", 3000), "correct");
  for (let at = 5000; at <= 15000; at += 2000) game.advance(at, false);
  assert.equal(game.water, 0);
  assert.equal(game.phase, "draining");
  game.advance(17000, true);
  assert.equal(game.phase, "won");
  assert.equal(game.contain("culprit", 19000), "inactive");
});
test("rescue times out, reset clears state, and pauses do not consume wall-clock time", () => {
  const game = new RescueGame();
  game.start("culprit", 0);
  game.advance(600000);
  assert.equal(game.elapsed, 2.5);
  for (let i = 0; i < 18; i++) game.advance(600000 + (i + 1) * 2500);
  assert.equal(game.phase, "lost");
  game.reset();
  assert.equal(game.phase, "idle");
  assert.equal(game.culprit, null);
  assert.equal(game.water, 0);
});
test("randomized demo leak targets only the chosen simulated process and recovers gradually", () => {
  const world = new DemoWorld();
  const first = world.next(1800000000000);
  world.startLeak(2202);
  let last = first;
  for (let i = 1; i <= 8; i++) last = world.next(1800000000000 + i * 2000);
  const delta = (pid: number) =>
    last.processes.find((p) => p.pid === pid)!.privateBytes -
    first.processes.find((p) => p.pid === pid)!.privateBytes;
  assert.ok(delta(2202) > 180 * 1048576);
  assert.ok(Math.abs(delta(7331)) < 3 * 1048576);
  world.recover();
  const recovered = world.next(1800000020000);
  assert.ok(
    recovered.processes.find((p) => p.pid === 2202)!.privateBytes <
      last.processes.find((p) => p.pid === 2202)!.privateBytes,
  );
});
