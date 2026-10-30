import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Collector } from "./collector.ts";
import { createCityServer } from "./http.ts";
const args = process.argv.slice(2),
  fileIndex = args.indexOf("--collector-file"),
  portIndex = args.indexOf("--port");
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 4317;
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Port must be between 1024 and 65535.");
if (fileIndex >= 0 && !args[fileIndex + 1])
  throw new Error("--collector-file needs an absolute file path.");
const collector = new Collector();
collector.start(fileIndex >= 0 ? resolve(args[fileIndex + 1]) : undefined);
const root = fileURLToPath(new URL("../dist/", import.meta.url));
const server = createCityServer(collector, root, port);
server.listen(port, "127.0.0.1", () => {
  console.log(
    `Process City: http://127.0.0.1:${port}\nWindows metrics stay on this computer. Open the app and select Live Windows.`,
  );
});
server.on("error", (error) => {
  console.error(error.message);
  collector.stop();
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    collector.stop();
    server.close(() => process.exit(0));
  });
