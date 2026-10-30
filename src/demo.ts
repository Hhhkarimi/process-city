import type { RawProcess, RawSnapshot } from "./model.ts";
const MB = 1024 * 1024;
const epoch = "2026-10-30T06:00:00.000Z";
export class DemoWorld {
  tick = 0;
  surge = false;
  leak = false;
  leakPid = 7331;
  private launchNumber = 0;
  private leaked = 0;
  private cumulative = new Map<number, number>();
  private systemTotal = 0;
  private systemIdle = 0;
  private lastTime = 0;
  private templates: RawProcess[] = [];
  constructor() {
    const apps: [number, number, string, number][] = [
      [4, 0, "System", 28],
      [800, 4, "services.exe", 40],
      [1100, 800, "explorer.exe", 176],
      [1200, 1100, "chrome.exe", 780],
      [2200, 1100, "Code.exe", 620],
      [3100, 2200, "node.exe", 340],
      [4100, 1100, "WindowsTerminal.exe", 156],
      [5200, 1100, "Figma.exe", 910],
      [6300, 1100, "Spotify.exe", 290],
      [7331, 3100, "memory-lab.exe", 160],
      [8100, 800, "dwm.exe", 130],
      [9100, 1100, "SearchHost.exe", 96],
    ];
    for (let i = 0; i < 12; i++) {
      apps.push([
        1201 + i,
        1200,
        i % 3 === 0 ? "chrome-renderer.exe" : "chrome.exe",
        75 + ((i * 79) % 430),
      ]);
    }
    for (let i = 0; i < 9; i++) {
      apps.push([
        2201 + i,
        2200,
        i % 2 === 0 ? "Code-extension.exe" : "Code.exe",
        60 + ((i * 53) % 260),
      ]);
    }
    for (let i = 0; i < 7; i++) {
      apps.push([
        8201 + i,
        800,
        ["svchost.exe", "RuntimeBroker.exe", "audiodg.exe"][i % 3],
        24 + ((i * 37) % 120),
      ]);
    }
    for (let i = 0; i < 6; i++) {
      apps.push([
        9400 + i,
        3100,
        ["vite.exe", "tsserver.exe", "esbuild.exe"][i % 3],
        55 + ((i * 113) % 330),
      ]);
    }
    this.templates = apps.map(([pid, ppid, name, ram], i) => ({
      pid,
      ppid,
      name,
      createdAt: new Date(Date.parse(epoch) + i * 1000).toISOString(),
      cpuSeconds: 0,
      rssBytes: ram * MB,
      privateBytes: ram * 0.82 * MB,
    }));
  }
  next(now = Date.now()): RawSnapshot {
    const at = Math.max(now, this.lastTime + 1),
      seconds = this.lastTime ? (at - this.lastTime) / 1000 : 2;
    this.lastTime = at;
    this.tick++;
    if (this.leak) this.leaked += 24;
    else this.leaked = Math.max(0, this.leaked - 45);
    const processes = this.templates.map((base, i) => {
      let cpu =
        0.08 +
        Math.max(0, Math.sin(this.tick * 0.27 + i * 2.4)) *
          (i < 12 ? 2.4 : 0.5);
      if (this.surge && base.pid === 3100) cpu = 48 + Math.sin(this.tick) * 4;
      if (this.surge && base.ppid === 3100) cpu = 2.3;
      const cumulative =
        (this.cumulative.get(base.pid) ?? 0) + (cpu / 100) * 8 * seconds;
      this.cumulative.set(base.pid, cumulative);
      const extra = base.pid === this.leakPid ? this.leaked * MB : 0;
      const wave =
        (Math.sin(this.tick * 0.1 + i) - Math.sin(0.1 + i)) * MB * 1.3;
      return {
        ...base,
        cpuSeconds: cumulative,
        rssBytes: Math.max(0, Math.round(base.rssBytes + wave + extra)),
        privateBytes: Math.max(0, Math.round(base.privateBytes + wave + extra)),
      };
    });
    if (this.tick % 30 >= 18)
      processes.push({
        pid: 9901,
        ppid: 4100,
        name: "build-worker.exe",
        createdAt: new Date(
          Date.parse(epoch) + 3600000 + Math.floor(this.tick / 30) * 60000,
        ).toISOString(),
        cpuSeconds: ((this.tick % 30) - 18) * 0.2,
        rssBytes: 96 * MB,
        privateBytes: 80 * MB,
      });
    const busy = this.surge ? 0.79 : 0.16 + 0.04 * Math.sin(this.tick * 0.2);
    this.systemTotal += 8 * seconds * 1e7;
    this.systemIdle += 8 * seconds * 1e7 * (1 - busy);
    return {
      schemaVersion: 1,
      capturedAt: new Date(at).toISOString(),
      cores: 8,
      totalBytes: 32 * 1024 * MB,
      availableBytes: Math.max(
        0,
        (21 * 1024 - this.leaked) * MB -
          this.templates
            .filter((p) => p.pid >= 16000)
            .reduce((n, p) => n + p.privateBytes, 0),
      ),
      systemCpu: { total: this.systemTotal, idle: this.systemIdle },
      processes,
    };
  }
  recover(): void {
    this.surge = false;
    this.leak = false;
  }
  startLeak(pid = 7331): void {
    this.leaked = 0;
    this.leakPid = pid;
    this.leak = true;
  }
  baselinePrivate(pid: number): number {
    return this.templates.find((p) => p.pid === pid)?.privateBytes ?? 0;
  }
  launch(now = Date.now()): number {
    // A synthetic process family, never an actual OS launch.
    const root = 16000 + (++this.launchNumber % 5) * 20;
    this.templates = this.templates.filter((p) => p.pid < 16000);
    for (let i = 0; i < 8; i++)
      this.templates.push({
        pid: root + i,
        ppid: i === 0 ? 1100 : root,
        name: i === 0 ? "Studio-Code.exe" : "Code-renderer.exe",
        createdAt: new Date(now + i).toISOString(),
        cpuSeconds: 0,
        rssBytes: (180 + i * 37) * MB,
        privateBytes: (130 + i * 29) * MB,
      });
    return root;
  }
}
