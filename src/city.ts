import type { CityProcess, CitySnapshot, Theme } from "./model.ts";
import { architectures, classify, districtRoot } from "./districts.ts";
interface Spot {
  x: number;
  y: number;
}
interface Hit {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CityOptions {
  labels: boolean;
  roads: boolean;
  paused: boolean;
  selected: string | null;
  filter: Set<string> | null;
  locale: "en" | "fa";
  mode: "demo" | "live";
}
const clamp = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, n));
const hash = (s: string): number => {
  let n = 2166136261;
  for (let i = 0; i < s.length; i++)
    n = Math.imul(n ^ s.charCodeAt(i), 16777619);
  return n >>> 0;
};
export class CityScene {
  private cameraTarget: { zoom: number; x: number; y: number } | null = null;
  private born = new Map<string, number>();
  private departing: { p: CityProcess; pos: Spot; at: number }[] = [];
  private ghost: CitySnapshot | null = null;
  private flood = 0;
  private headline = "";
  private focusedKey: string | null = null;
  private fixed: { width: number; height: number } | undefined;
  private ctx: CanvasRenderingContext2D;
  private positions = new Map<string, Spot>();
  private hits: Hit[] = [];
  private width = 1;
  private height = 1;
  private zoomValue = 1;
  private pan = { x: 0, y: 0 };
  private frame = 0;
  private lastDraw = 0;
  private snapshot: CitySnapshot | null = null;
  private theme: Theme;
  private options: CityOptions = {
    labels: false,
    roads: true,
    paused: false,
    selected: null,
    filter: null,
    locale: "en",
    mode: "demo",
  };
  private down: { x: number; y: number; panX: number; panY: number } | null =
    null;
  private dragged = false;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)");
  private observer: ResizeObserver | null = null;
  constructor(
    private canvas: HTMLCanvasElement,
    theme: Theme,
    private select: (key: string) => void,
    fixed?: { width: number; height: number },
  ) {
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error(
        "Canvas 2D is unavailable. The process list is still available.",
      );
    this.ctx = context;
    this.theme = theme;
    this.fixed = fixed;
    if (!fixed) {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
    } else this.resize();
    canvas.addEventListener("pointerdown", (event) => {
      this.cameraTarget = null;
      this.down = {
        x: event.clientX,
        y: event.clientY,
        panX: this.pan.x,
        panY: this.pan.y,
      };
      this.dragged = false;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (this.down) {
        const dx = event.clientX - this.down.x,
          dy = event.clientY - this.down.y;
        if (Math.hypot(dx, dy) > 4) this.dragged = true;
        this.pan = { x: this.down.panX + dx, y: this.down.panY + dy };
        this.draw(performance.now());
      } else {
        const hit = this.hit(event.offsetX, event.offsetY);
        canvas.style.cursor = hit ? "pointer" : "grab";
      }
    });
    canvas.addEventListener("pointerup", (event) => {
      if (!this.dragged) {
        const rect = canvas.getBoundingClientRect();
        const hit = this.hit(
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
        if (hit) this.select(hit.key);
      }
      this.down = null;
    });
    canvas.addEventListener("pointercancel", () => {
      this.down = null;
    });
    canvas.addEventListener(
      "wheel",
      (event) => {
        if (document.activeElement !== canvas && !event.ctrlKey) return;
        event.preventDefault();
        this.zoom(event.deltaY > 0 ? -0.1 : 0.1);
      },
      { passive: false },
    );
    canvas.addEventListener("keydown", (event) => {
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        this.zoom(0.15);
      }
      if (event.key === "-") {
        event.preventDefault();
        this.zoom(-0.15);
      }
      if (event.key === "0" || event.key === "Escape") this.reset();
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
      ) {
        event.preventDefault();
        this.cameraTarget = null;
        this.pan.x +=
          event.key === "ArrowLeft" ? 25 : event.key === "ArrowRight" ? -25 : 0;
        this.pan.y +=
          event.key === "ArrowUp" ? 25 : event.key === "ArrowDown" ? -25 : 0;
        this.draw(performance.now());
      }
    });
    const animate = (now: number): void => {
      this.frame = requestAnimationFrame(animate);
      if (
        document.hidden ||
        this.reduced.matches ||
        this.options.paused ||
        now - this.lastDraw < 50
      )
        return;
      this.lastDraw = now;
      this.draw(now);
    };
    if (!fixed) this.frame = requestAnimationFrame(animate);
  }
  set(snapshot: CitySnapshot, theme: Theme, options: CityOptions): void {
    if (snapshot.at !== this.snapshot?.at) {
      const previous = new Set(
        this.snapshot?.processes.map((p) => p.key) ?? [],
      );
      const next = new Set(snapshot.processes.map((p) => p.key));
      const now = performance.now();
      for (const p of snapshot.processes)
        if (!previous.has(p.key))
          this.born.set(p.key, now - (this.snapshot ? 0 : hash(p.key) % 900));
      for (const p of this.snapshot?.processes ?? []) {
        const pos = this.positions.get(p.key);
        if (!next.has(p.key) && pos)
          this.departing.push({ p, pos: { ...pos }, at: now });
      }
      this.departing = this.departing
        .filter((d) => now - d.at < 2200)
        .slice(-35);
      for (const [key, at] of this.born)
        if (now - at > 3000 || !next.has(key)) this.born.delete(key);
    }
    this.snapshot = snapshot;
    this.theme = theme;
    this.options = options;
    this.layout(snapshot.processes);
    this.draw(performance.now());
  }
  zoom(delta: number): void {
    this.cameraTarget = null;
    this.zoomValue = clamp(this.zoomValue + delta, 0.5, 4);
    this.draw(performance.now());
  }
  reset(): void {
    this.cameraTarget = null;
    this.focusedKey = null;
    this.zoomValue = 1;
    this.pan = { x: 0, y: 0 };
    this.draw(performance.now());
  }
  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
  }
  view() {
    return {
      zoom: this.zoomValue,
      x: this.pan.x,
      y: this.pan.y,
      focus: this.focusedKey,
    };
  }
  restore(view: { zoom: number; x: number; y: number; focus?: string | null }) {
    this.zoomValue = view.zoom;
    this.pan = { x: view.x, y: view.y };
    if (view.focus !== undefined) this.focusedKey = view.focus;
  }
  focus(key: string): void {
    const pos = this.positions.get(key),
      p = this.snapshot?.processes.find((p) => p.key === key);
    if (!pos || !p) return;
    this.focusedKey = key;
    const zoom = 3.15,
      scale = Math.min(this.width / 910, this.height / 650) * zoom;
    const height = clamp(
      10 + Math.log2(p.rssBytes / 1048576 + 1) * 11,
      12,
      145,
    );
    this.cameraTarget = {
      zoom,
      x: -(pos.x - pos.y) * 32 * scale,
      y: -(pos.x + pos.y - 12) * 16 * scale + height * 0.45 * scale,
    };
    if (this.reduced.matches || this.options.paused) {
      this.restore(this.cameraTarget);
      this.cameraTarget = null;
      this.draw(performance.now());
    }
  }
  extras(ghost: CitySnapshot | null, flood: number, headline: string) {
    this.ghost = ghost;
    this.flood = clamp(flood, 0, 0.85);
    this.headline = headline;
  }
  renderAt(now: number) {
    this.draw(now);
  }
  async image(): Promise<Blob> {
    return new Promise((resolve, reject) =>
      this.canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Could not export city image.")),
        "image/png",
      ),
    );
  }
  private resize(): void {
    const rect = this.fixed ?? this.canvas.getBoundingClientRect(),
      dpr = this.fixed ? 1 : Math.min(devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw(performance.now());
  }
  private hit(x: number, y: number): Hit | undefined {
    return [...this.hits]
      .reverse()
      .find(
        (h) =>
          Math.abs(x - h.x) < h.width &&
          y >= h.y - h.height &&
          y <= h.y + h.width * 0.6,
      );
  }
  private layout(processes: CityProcess[]): void {
    const visible = new Set(processes.map((p) => p.key));
    for (const key of this.positions.keys())
      if (!visible.has(key)) this.positions.delete(key);
    const occupied = new Set(
      [...this.positions.values()].map((p) => p.y * 13 + p.x),
    );
    for (const process of [...processes]
      .sort((a, b) => b.rssBytes - a.rssBytes)
      .slice(0, 110)) {
      if (this.positions.has(process.key)) continue;
      const root = districtRoot(process, processes);
      const zone = architectures[classify(root.name)].zone;
      // Related processes settle near their observed application root; probing keeps slots unique.
      const preferred = [...Array(169)]
        .map((_, slot) => ({
          slot,
          distance:
            Math.hypot((slot % 13) - zone[0], Math.floor(slot / 13) - zone[1]) +
            (hash(root.key + ":" + slot) % 100) / 180,
        }))
        .sort((a, b) => a.distance - b.distance);
      let slot = preferred[0].slot;
      for (let attempt = 0; attempt < 169; attempt++) {
        const x = slot % 13,
          y = Math.floor(slot / 13);
        if (!occupied.has(slot) && !(x >= 5 && x <= 7 && y >= 5 && y <= 7)) {
          this.positions.set(process.key, { x, y });
          occupied.add(slot);
          break;
        }
        slot = preferred[attempt + 1]?.slot ?? slot;
      }
    }
    // Only keep a bounded visual subset; all processes remain in the searchable list.
    if (this.positions.size > 110) {
      const priority = new Set(
        [...processes]
          .sort((a, b) => b.rssBytes - a.rssBytes)
          .slice(0, 110)
          .map((p) => p.key),
      );
      for (const key of this.positions.keys())
        if (!priority.has(key)) this.positions.delete(key);
    }
    if (this.options.selected && !this.positions.has(this.options.selected)) {
      const target = processes.find((p) => p.key === this.options.selected);
      if (target) {
        const entry = this.positions.keys().next().value;
        if (entry) {
          const spot = this.positions.get(entry)!;
          this.positions.delete(entry);
          this.positions.set(target.key, spot);
        }
      }
    }
  }
  private project(x: number, y: number, z = 0): Spot {
    const scale =
      Math.min(this.width / 910, this.height / 650) * this.zoomValue;
    return {
      x: this.width * 0.5 + (x - y) * 32 * scale + this.pan.x,
      y:
        this.height * 0.57 + (x + y - 12) * 16 * scale - z * scale + this.pan.y,
    };
  }
  private polygon(points: Spot[], fill: string, stroke?: string): void {
    const c = this.ctx;
    c.beginPath();
    points.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 0.7;
      c.stroke();
    }
  }
  private iso(
    x: number,
    y: number,
    width: number,
    depth: number,
    height: number,
    fill: { top: string; left: string; right: string },
    outline?: string,
  ): void {
    const a = this.project(x, y),
      b = this.project(x + width, y),
      d = this.project(x, y + depth),
      e = this.project(x + width, y + depth);
    const at = this.project(x, y, height),
      bt = this.project(x + width, y, height),
      dt = this.project(x, y + depth, height),
      et = this.project(x + width, y + depth, height);
    this.polygon([d, e, et, dt], fill.left, outline);
    this.polygon([b, e, et, bt], fill.right, outline);
    this.polygon([at, bt, et, dt], fill.top, outline);
    void a;
  }
  private draw(now: number): void {
    if (this.cameraTarget) {
      const a = 0.13;
      this.zoomValue += (this.cameraTarget.zoom - this.zoomValue) * a;
      this.pan.x += (this.cameraTarget.x - this.pan.x) * a;
      this.pan.y += (this.cameraTarget.y - this.pan.y) * a;
      if (
        Math.abs(this.cameraTarget.x - this.pan.x) +
          Math.abs(this.cameraTarget.y - this.pan.y) <
        0.15
      )
        this.cameraTarget = null;
    }
    const c = this.ctx,
      t = this.theme;
    c.clearRect(0, 0, this.width, this.height);
    const background = c.createRadialGradient(
      this.width * 0.5,
      this.height * 0.4,
      0,
      this.width * 0.5,
      this.height * 0.5,
      this.width * 0.8,
    );
    background.addColorStop(0, t.ground);
    background.addColorStop(1, "#090d14");
    c.fillStyle = background;
    c.fillRect(0, 0, this.width, this.height);
    for (let i = 0; i < 55; i++) {
      const x = ((hash("star" + i) % 1000) / 1000) * this.width,
        y = ((hash("sky" + i) % 350) / 1000) * this.height;
      c.fillStyle = t.accent;
      c.globalAlpha = 0.12 + (i % 4) * 0.05;
      c.fillRect(x, y, 1, 1);
    }
    c.globalAlpha = 1;
    this.hits = [];
    this.iso(-0.65, -0.65, 13.4, 13.4, 0, {
      top: t.ground,
      left: t.left,
      right: t.right,
    });
    const origin = this.project(-0.65, -0.65),
      end = this.project(12.75, 12.75);
    void origin;
    void end;
    c.lineWidth = 0.6;
    c.strokeStyle = t.grid;
    c.globalAlpha = 0.42;
    for (let i = 0; i <= 13; i++) {
      for (const ends of [
        [this.project(i - 0.5, -0.5), this.project(i - 0.5, 12.5)],
        [this.project(-0.5, i - 0.5), this.project(12.5, i - 0.5)],
      ]) {
        c.beginPath();
        c.moveTo(ends[0].x, ends[0].y);
        c.lineTo(ends[1].x, ends[1].y);
        c.stroke();
      }
    }
    c.globalAlpha = 1;
    const snapshot = this.snapshot;
    if (!snapshot) return;
    const displayed = snapshot.processes
      .filter((p) => this.positions.has(p.key))
      .sort((a, b) => {
        const aa = this.positions.get(a.key)!,
          bb = this.positions.get(b.key)!;
        return aa.x + aa.y - bb.x - bb.y;
      });
    const scale =
      Math.min(this.width / 910, this.height / 650) * this.zoomValue;
    if (this.ghost) {
      c.save();
      c.globalAlpha = 0.22;
      c.setLineDash([3, 4]);
      for (const p of this.ghost.processes.slice(0, 110)) {
        const pos = this.positions.get(p.key) ?? {
          x: hash(p.key) % 13,
          y: Math.floor(hash(p.key) / 13) % 13,
        };
        const h = clamp(10 + Math.log2(p.rssBytes / 1048576 + 1) * 11, 12, 145);
        this.iso(
          pos.x,
          pos.y,
          0.65,
          0.65,
          h,
          { top: "#68baff22", left: "#68baff08", right: "#68baff08" },
          "#9ed4ff",
        );
      }
      c.restore();
    }
    // Streets represent observed parent-child relationships, never guessed grouping.
    if (this.options.roads) {
      for (const p of displayed) {
        const pos = this.positions.get(p.key),
          parent = p.parentKey ? this.positions.get(p.parentKey) : undefined;
        if (!pos || !parent) continue;
        const highlight =
          p.key === this.options.selected ||
          p.parentKey === this.options.selected;
        c.globalAlpha = highlight ? 0.9 : 0.28;
        c.strokeStyle = highlight ? t.secondary : t.road;
        c.lineWidth = (highlight ? 2.2 : 1.4) * scale;
        const a = this.project(pos.x + 0.3, pos.y + 0.3),
          b = this.project(parent.x + 0.3, pos.y + 0.3),
          d = this.project(parent.x + 0.3, parent.y + 0.3);
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.lineTo(d.x, d.y);
        c.stroke();
        if (
          (p.cpu ?? 0) > 0.3 &&
          !this.options.paused &&
          !this.reduced.matches
        ) {
          const fraction = (now / 2200 + (hash(p.key) % 10) / 10) % 1;
          const point = {
            x: a.x + (b.x - a.x) * fraction,
            y: a.y + (b.y - a.y) * fraction,
          };
          c.fillStyle = t.accent;
          c.fillRect(point.x, point.y, 2 * scale, 2 * scale);
        }
      }
      c.globalAlpha = 1;
    }
    this.iso(5.05, 5.05, 2.9, 2.9, 3, {
      top: t.road,
      left: t.left,
      right: t.right,
    });
    const center = this.project(6.5, 6.5, 4);
    c.save();
    c.translate(center.x, center.y);
    c.scale(1, 0.5);
    c.strokeStyle = t.accent;
    c.globalAlpha = 0.7;
    c.lineWidth = scale;
    c.beginPath();
    c.arc(0, 0, 24 * scale, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(0, 0, 15 * scale, 0, Math.PI * 2);
    c.stroke();
    c.restore();
    for (const p of displayed) {
      const pos = this.positions.get(p.key)!,
        selected = p.key === this.options.selected,
        dim = this.options.filter && !this.options.filter.has(p.key),
        mb = p.rssBytes / 1048576;
      const birth = this.born.get(p.key),
        progress =
          birth === undefined || this.reduced.matches
            ? 1
            : clamp((now - birth) / 1600, 0.03, 1);
      const rise = 1 - Math.pow(1 - progress, 3);
      const height = clamp(10 + Math.log2(mb + 1) * 11, 12, 145) * rise,
        size = clamp(0.38 + Math.log2(mb + 1) * 0.028, 0.4, 0.72),
        cpu = p.cpu ?? 0;
      const shade = selected ? t.accent : p.growing ? t.secondary : undefined;
      const architecture = architectures[classify(p.name)];
      c.globalAlpha = dim ? 0.08 : 0.2;
      this.iso(pos.x - 0.09, pos.y - 0.09, 0.9, 0.9, 1, {
        top: architecture.color,
        left: t.left,
        right: t.right,
      });
      if (progress < 1 && !dim) {
        const ground = this.project(pos.x + 0.3, pos.y + 0.3);
        c.save();
        c.translate(ground.x, ground.y);
        c.scale(1, 0.5);
        c.strokeStyle = t.accent;
        c.globalAlpha = 1 - progress;
        c.lineWidth = 2;
        c.beginPath();
        c.arc(0, 0, (16 + progress * 65) * scale, 0, Math.PI * 2);
        c.stroke();
        c.restore();
      }
      c.globalAlpha = dim ? 0.15 : 1;
      if (t.shape === "tree") {
        this.iso(pos.x + 0.22, pos.y + 0.22, 0.13, 0.13, height * 0.55, {
          top: "#866541",
          left: "#4b352d",
          right: "#6a4931",
        });
        for (let level = 0; level < 3; level++) {
          const z = height * 0.55 + level * height * 0.225,
            span = size * (1 - level * 0.18);
          this.iso(
            pos.x,
            pos.y,
            span,
            span,
            z,
            { top: t.top, left: t.left, right: t.right },
            shade,
          );
        }
      } else if (t.shape === "station") {
        this.iso(
          pos.x,
          pos.y,
          size,
          size,
          height * 0.75,
          { top: t.top, left: t.left, right: t.right },
          shade,
        );
        this.iso(
          pos.x + 0.08,
          pos.y + 0.08,
          size - 0.16,
          size - 0.16,
          height,
          { top: t.right, left: t.left, right: t.right },
          shade,
        );
      } else if (t.shape === "reef") {
        this.iso(
          pos.x + 0.05,
          pos.y + 0.05,
          size,
          size,
          height * 0.55,
          { top: t.top, left: t.left, right: t.right },
          shade,
        );
        this.iso(
          pos.x + 0.18,
          pos.y + 0.15,
          size * 0.5,
          size * 0.5,
          height,
          { top: t.top, left: t.left, right: t.right },
          shade,
        );
      } else {
        this.iso(
          pos.x,
          pos.y,
          size,
          size,
          height,
          { top: architecture.color, left: t.left, right: t.right },
          shade,
        );
        if (architecture.shape === "terrace") {
          for (let terrace = 1; terrace <= 3; terrace++) {
            const a = this.project(pos.x + size, pos.y, (height * terrace) / 4),
              b = this.project(
                pos.x + size,
                pos.y + size,
                (height * terrace) / 4,
              );
            c.strokeStyle = architecture.color;
            c.lineWidth = 2 * scale;
            c.beginPath();
            c.moveTo(a.x, a.y);
            c.lineTo(b.x, b.y);
            c.stroke();
          }
        } else if (
          architecture.shape === "workshop" ||
          architecture.shape === "studio"
        ) {
          this.iso(
            pos.x + 0.12,
            pos.y + 0.12,
            size * 0.55,
            size * 0.55,
            height + 11 * rise,
            { top: architecture.color, left: t.right, right: t.left },
            shade,
          );
        } else if (
          architecture.shape === "plant" ||
          architecture.shape === "antenna" ||
          architecture.shape === "utility"
        ) {
          const top = this.project(pos.x + size / 2, pos.y + size / 2, height);
          c.strokeStyle = architecture.color;
          c.lineWidth = (architecture.shape === "plant" ? 4 : 1.5) * scale;
          c.beginPath();
          c.moveTo(top.x, top.y);
          c.lineTo(top.x, top.y - 18 * scale * rise);
          c.stroke();
          c.beginPath();
          c.arc(top.x, top.y - 19 * scale * rise, 3 * scale, 0, Math.PI * 2);
          c.stroke();
        }
      }
      const floors = Math.max(2, Math.floor(height / 11));
      for (let floor = 1; floor < floors; floor++) {
        for (let side = 0; side < 2; side++) {
          for (let window = 0; window < 3; window++) {
            const chance =
                (hash(p.key + floor + ":" + side + ":" + window) % 100) / 100,
              lit = chance < 0.07 + (cpu / 100) * 2.8;
            const z = floor * 10;
            let faceX = pos.x,
              faceY = pos.y,
              faceSize = size;
            if (t.shape === "tree")
              faceSize =
                size *
                (z > height * 0.775 ? 0.64 : z > height * 0.55 ? 0.82 : 1);
            if (t.shape === "station" && z > height * 0.75) {
              faceX += 0.08;
              faceY += 0.08;
              faceSize -= 0.16;
            }
            if (t.shape === "reef") {
              faceX += z > height * 0.55 ? 0.18 : 0.05;
              faceY += z > height * 0.55 ? 0.15 : 0.05;
              faceSize *= z > height * 0.55 ? 0.5 : 1;
            }
            const offset = (faceSize * (window + 0.6)) / 3.6;
            const point =
              side === 0
                ? this.project(faceX + faceSize, faceY + offset, z)
                : this.project(faceX + offset, faceY + faceSize, z);
            c.fillStyle = lit ? (p.growing ? t.secondary : t.window) : t.grid;
            c.globalAlpha = (dim ? 0.15 : 1) * (lit ? 0.9 : 0.45);
            c.fillRect(
              point.x - 1.1 * scale,
              point.y,
              2.4 * scale,
              3.5 * scale,
            );
          }
        }
      }
      c.globalAlpha = dim ? 0.15 : 1;
      const roof = this.project(pos.x + size / 2, pos.y + size / 2, height);
      if (selected || cpu > 10 || p.growing) {
        c.strokeStyle = p.growing ? t.secondary : t.accent;
        c.lineWidth = 1.1 * scale;
        c.beginPath();
        c.moveTo(roof.x, roof.y);
        c.lineTo(roof.x, roof.y - 13 * scale);
        c.stroke();
        c.fillStyle = p.growing ? t.secondary : t.accent;
        c.beginPath();
        c.arc(roof.x, roof.y - 15 * scale, 2.4 * scale, 0, Math.PI * 2);
        c.fill();
      }
      const base = this.project(pos.x + size / 2, pos.y + size / 2);
      this.hits.push({
        key: p.key,
        x: base.x,
        y: base.y,
        width: Math.max(9, size * 36 * scale),
        height: height * scale + 6,
      });
      if (selected || (this.options.labels && !dim)) {
        c.font = `${Math.max(9, 11 * scale)}px ${this.options.locale === "fa" ? "Vazirmatn" : "Segoe UI"}, sans-serif`;
        const name = p.name.slice(0, 20),
          width = c.measureText(name).width;
        c.fillStyle = "#0b111c";
        c.globalAlpha = 0.92;
        c.fillRect(roof.x - width / 2 - 6, roof.y - 36 * scale, width + 12, 19);
        c.globalAlpha = 1;
        c.fillStyle = selected ? t.accent : "#c9d9df";
        c.textAlign = "center";
        c.fillText(name, roof.x, roof.y - 23 * scale);
      }
    }
    c.globalAlpha = 1;
    for (const exit of this.departing) {
      const elapsed = (now - exit.at) / 2200;
      if (elapsed >= 1 || this.reduced.matches) continue;
      c.globalAlpha = (1 - elapsed) * 0.7;
      const point = this.project(exit.pos.x + 0.3, exit.pos.y + 0.3);
      c.fillStyle = t.secondary;
      for (let i = 0; i < 9; i++)
        c.fillRect(
          point.x + Math.sin(i * 7) * elapsed * 35 * scale,
          point.y - elapsed * (20 + i * 10) * scale,
          3 * scale,
          3 * scale,
        );
    }
    c.globalAlpha = 1;
    const growing = snapshot.processes.filter((p) => p.growing),
      water = Math.max(
        this.flood,
        clamp(growing.reduce((n, p) => n + p.growthMB, 0) / 750, 0, 0.68),
      );
    if (water > 0) {
      const source = growing.sort((a, b) => b.growthMB - a.growthMB)[0];
      const sourcePos = source ? this.positions.get(source.key) : undefined;
      if (sourcePos) {
        const point = this.project(sourcePos.x + 0.3, sourcePos.y + 0.3);
        c.save();
        c.translate(point.x, point.y);
        c.scale(1, 0.5);
        c.strokeStyle = t.water;
        for (let i = 0; i < 3; i++) {
          const phase = ((this.reduced.matches ? 0 : now / 2200) + i / 3) % 1;
          c.globalAlpha = (1 - phase) * 0.7;
          c.beginPath();
          c.arc(0, 0, (20 + phase * water * 450) * scale, 0, Math.PI * 2);
          c.stroke();
        }
        c.restore();
      }
      const y = this.height * (1 - water * 0.8);
      const gradient = c.createLinearGradient(0, y, 0, this.height);
      gradient.addColorStop(0, t.water + "00");
      gradient.addColorStop(0.22, t.water + "55");
      gradient.addColorStop(1, t.water + "aa");
      c.fillStyle = gradient;
      c.fillRect(0, y, this.width, this.height - y);
      c.strokeStyle = t.water;
      c.globalAlpha = 0.6;
      for (let line = 0; line < 4; line++) {
        c.beginPath();
        for (let x = 0; x < this.width; x += 10) {
          const wave =
            Math.sin(
              x / 80 +
                (this.options.paused || this.reduced.matches ? 0 : now / 1000) +
                line,
            ) * 4;
          c.lineTo(x, y + 20 + line * 13 + wave);
        }
        c.stroke();
      }
      c.globalAlpha = 1;
    }
    if (this.headline) {
      c.fillStyle = "#090f19d9";
      c.fillRect(18, 58, Math.min(this.width - 36, 470), 36);
      c.font = `13px ${this.options.locale === "fa" ? "Vazirmatn" : "Segoe UI"}, sans-serif`;
      c.fillStyle = t.accent;
      c.textAlign = this.options.locale === "fa" ? "right" : "left";
      c.fillText(
        this.headline.slice(0, 75),
        this.options.locale === "fa" ? Math.min(this.width - 30, 476) : 30,
        81,
        Math.min(this.width - 60, 445),
      );
    }
    const focused = snapshot.processes.find((p) => p.key === this.focusedKey);
    if (focused && this.zoomValue > 1.8) {
      const w = Math.min(360, this.width - 36),
        top = this.height - 99;
      c.fillStyle = "#0a1423ed";
      c.fillRect(18, top, w, 57);
      c.strokeStyle = architectures[classify(focused.name)].color;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(18, top);
      c.lineTo(18 + w, top);
      c.stroke();
      c.textAlign = "left";
      c.font = "bold 13px Vazirmatn, sans-serif";
      c.fillStyle = "#e5edf3";
      c.fillText("↗ " + focused.name.slice(0, 28), 29, top + 22, w - 22);
      c.font = "11px Vazirmatn, sans-serif";
      c.fillStyle = t.accent;
      c.fillText(
        `CPU ${focused.cpu?.toFixed(1) ?? "—"}%  /  RAM ${(focused.rssBytes / 1048576).toFixed(0)} MB  /  PID ${focused.pid}`,
        29,
        top + 43,
        w - 22,
      );
    }
    c.fillStyle = "#7b93a6";
    c.font = `11px ${this.options.locale === "fa" ? "Vazirmatn" : "Segoe UI"}, sans-serif`;
    c.textAlign = "left";
    c.fillText(
      "PROCESS CITY  /  " +
        (this.options.mode === "demo" ? "SIMULATION" : "LIVE LOCAL") +
        "  /  " +
        this.theme.name.toUpperCase() +
        "  /  " +
        new Date(snapshot.at).toLocaleTimeString("en-GB"),
      20,
      this.height - 20,
    );
    c.textAlign = "right";
    c.fillText(
      `${this.positions.size} / ${snapshot.processes.length}  ·  ${Math.round(this.zoomValue * 100)}%`,
      this.width - 20,
      this.height - 20,
    );
  }
}
