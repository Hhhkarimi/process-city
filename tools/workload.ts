// Optional bounded workload for validating the LIVE collector, never run by the UI.
// At most 20 seconds of one-core CPU work and at most 96 MB of retained buffers.
const kind = process.argv[2] ?? "memory";
console.log(JSON.stringify({ fixture: kind, pid: process.pid }));
if (!["memory", "cpu"].includes(kind)) throw new Error("Choose memory or cpu.");
const start = Date.now();
if (kind === "cpu") {
  console.log("Process City CPU fixture: one core, 15 seconds.");
  let value = 0;
  while (Date.now() - start < 15000) value = Math.sin(value + Math.random());
  console.log("CPU fixture complete.", Number.isFinite(value));
} else {
  console.log(
    "Process City memory fixture: 8 MB per second, capped at 96 MB; exits after 20 seconds.",
  );
  const blocks: Buffer[] = [];
  const timer = setInterval(() => {
    if (blocks.length < 12) blocks.push(Buffer.alloc(8 * 1024 * 1024, 1));
    if (Date.now() - start >= 20000) {
      clearInterval(timer);
      blocks.length = 0;
      console.log("Memory fixture complete.");
    }
  }, 1000);
}
