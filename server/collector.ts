import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateSnapshot, type RawSnapshot } from "../src/model.ts";

export class Collector {
  snapshot: RawSnapshot | null = null;
  error: string | null = null;
  private child: ChildProcess | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reading = false;
  start(file?: string): void {
    if (file) {
      void this.read(file);
      this.timer = setInterval(() => {
        void this.read(file);
      }, 1000);
      return;
    }
    if (process.platform !== "win32") {
      this.error =
        "Live monitoring requires Windows. Use demo mode on other platforms.";
      return;
    }
    const shell = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    let pending = "";
    try {
      this.child = spawn(
        shell,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-File",
          fileURLToPath(new URL("./collect.ps1", import.meta.url)),
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      this.child.stdout?.setEncoding("utf8");
      this.child.stdout?.on("data", (chunk: string) => {
        pending += chunk;
        if (pending.length > 8_000_000) {
          pending = "";
          this.error = "Collector output exceeded the safety limit.";
          return;
        }
        let index: number;
        while ((index = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, index).trim();
          pending = pending.slice(index + 1);
          if (line) this.accept(line);
        }
      });
      this.child.stderr?.on("data", () => {
        this.error =
          "Windows collector could not read process metrics. Try the documented two-terminal mode.";
      });
      this.child.on("error", () => {
        this.error =
          "Windows blocked the collector process. Use the documented two-terminal mode.";
      });
      this.child.on("exit", () => {
        this.error = "The Windows collector stopped. Restart local monitoring.";
      });
    } catch {
      this.error =
        "Could not launch the Windows collector. Use the documented two-terminal mode.";
    }
  }
  private accept(text: string): void {
    try {
      const snapshot = validateSnapshot(
        JSON.parse(text.replace(/^\uFEFF/, "")),
      );
      if (
        !this.snapshot ||
        Date.parse(snapshot.capturedAt) > Date.parse(this.snapshot.capturedAt)
      ) {
        this.snapshot = snapshot;
        this.error = null;
      }
    } catch {
      this.error = "The collector returned an invalid snapshot.";
    }
  }
  private async read(file: string): Promise<void> {
    if (this.reading) return;
    this.reading = true;
    try {
      const text = await readFile(file, "utf8");
      if (text.length > 8_000_000) throw new Error();
      this.accept(text);
    } catch {
      this.error =
        "Waiting for the collector file. Start collect.ps1 with the same absolute path.";
    } finally {
      this.reading = false;
    }
  }
  state(): {
    snapshot: RawSnapshot | null;
    error: string | null;
    stale: boolean;
  } {
    return {
      snapshot: this.snapshot,
      error: this.error,
      stale:
        !this.snapshot ||
        Date.now() - Date.parse(this.snapshot.capturedAt) > 8000,
    };
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.child?.kill();
  }
}
