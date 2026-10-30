import { test } from "node:test";
import assert from "node:assert/strict";
import { createCityServer, isAllowedRequest } from "../server/http.ts";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
test("loopback host validation blocks DNS rebinding and foreign origins", () => {
  assert.equal(isAllowedRequest("127.0.0.1:4317", undefined, 4317), true);
  assert.equal(
    isAllowedRequest("localhost:4317", "http://localhost:4317", 4317),
    true,
  );
  assert.equal(isAllowedRequest("evil.example:4317", undefined, 4317), false);
  assert.equal(
    isAllowedRequest("127.0.0.1:4317", "https://evil.example", 4317),
    false,
  );
});
test("read-only HTTP flow exposes health, preserves stale status, rejects foreign origins and serves only intended files", async () => {
  const source = {
    state: () => ({
      snapshot: null,
      error: "Collector warming up.",
      stale: true,
    }),
  };
  const server = createCityServer(
    source,
    fileURLToPath(new URL("../public/", import.meta.url)),
    0,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port,
    base = `http://127.0.0.1:${port}`;
  try {
    const health = await fetch(base + "/api/health");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).readOnly, true);
    assert.equal(health.headers.get("access-control-allow-origin"), null);
    const stale = await fetch(base + "/api/snapshot");
    assert.equal(stale.status, 503);
    assert.equal((await stale.json()).stale, true);
    assert.equal(
      (
        await fetch(base + "/api/snapshot", {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(base + "/api/snapshot", { method: "POST" })).status,
      405,
    );
    assert.equal((await fetch(base + "/api/unknown")).status, 404);
    const file = await fetch(base + "/favicon.svg");
    assert.equal(file.status, 200);
    assert.match(file.headers.get("content-type")!, /svg/);
    assert.equal(file.headers.get("x-content-type-options"), "nosniff");
    assert.notEqual((await fetch(base + "/%2e%2e%5cpackage.json")).status, 200);
    assert.equal((await fetch(base + "/missing.txt")).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
