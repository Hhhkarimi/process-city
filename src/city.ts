import type { CitySnapshot, Theme } from "./model.ts";
import { CanvasCityScene, type CityOptions } from "./city2d.ts";
import { WebGLCityScene, type Quality, type SceneView } from "./city3d.ts";
export type { CityOptions } from "./city2d.ts";
/** One UI contract, with Canvas fallback when WebGL is unavailable or lost. */
export class CityScene {
  private engine: WebGLCityScene | CanvasCityScene;
  private latest: {
    snapshot: CitySnapshot;
    theme: Theme;
    options: CityOptions;
  } | null = null;
  private events = new AbortController();
  private disposed = false;
  kind: "3d" | "2d" = "3d";
  constructor(
    private canvas: HTMLCanvasElement,
    private theme: Theme,
    private select: (key: string) => void,
    private fixed?: { width: number; height: number },
  ) {
    try {
      if (new URLSearchParams(location.search).get("renderer") === "2d")
        throw new Error("Canvas requested.");
      this.engine = new WebGLCityScene(canvas, theme, select, fixed);
      canvas.dataset.renderer = "3d";
      canvas.addEventListener(
        "webglcontextlost",
        (event) => {
          if (this.disposed) return;
          event.preventDefault();
          this.fallback();
        },
        { signal: this.events.signal },
      );
    } catch {
      this.engine = this.canvasEngine();
    }
  }
  private canvasEngine() {
    this.kind = "2d";
    // A WebGL-owned canvas cannot acquire a 2D context. Replace the surface, preserving accessibility attributes.
    const replacement = this.canvas.cloneNode(false) as HTMLCanvasElement;
    if (this.canvas.parentNode) this.canvas.replaceWith(replacement);
    this.canvas = replacement;
    replacement.dataset.renderer = "2d";
    replacement.setAttribute(
      "aria-label",
      document.documentElement.lang === "fa"
        ? "شهر ایزومتریک دوبعدی پردازش‌ها. برای جابه‌جایی بکشید؛ پس از تمرکز از جهت‌ها و مثبت و منفی استفاده کنید. فهرست پردازش‌ها در ابزارهاست."
        : "2D isometric process city. Drag to pan; focus for arrow keys and plus/minus. The process list is available in Tools.",
    );
    return new CanvasCityScene(
      replacement,
      this.theme,
      this.select,
      this.fixed,
    );
  }
  private fallback() {
    this.events.abort();
    this.engine.destroy();
    this.engine = this.canvasEngine();
    if (this.latest)
      this.engine.set(
        this.latest.snapshot,
        this.latest.theme,
        this.latest.options,
      );
  }
  set(snapshot: CitySnapshot, theme: Theme, options: CityOptions) {
    this.theme = theme;
    this.latest = { snapshot, theme, options };
    this.engine.set(snapshot, theme, options);
  }
  zoom(delta: number) {
    this.engine.zoom(delta);
  }
  reset() {
    this.engine.reset();
  }
  focus(key: string) {
    this.engine.focus(key);
  }
  view(): SceneView {
    return this.engine.view();
  }
  restore(view: SceneView) {
    this.engine.restore(view);
  }
  extras(ghost: CitySnapshot | null, flood: number, headline: string) {
    this.engine.extras(null, flood, headline);
  }
  comparison(snapshot: CitySnapshot | null, mix: number) {
    this.engine.comparison(snapshot, mix);
  }
  quality(value: Quality) {
    if (this.engine instanceof WebGLCityScene) this.engine.quality(value);
  }
  intro() {
    if (this.engine instanceof WebGLCityScene) this.engine.intro();
  }
  stopIntro() {
    if (this.engine instanceof WebGLCityScene) this.engine.stopIntro();
  }
  renderAt(now: number) {
    this.engine.renderAt(now);
  }
  async image(): Promise<Blob> {
    if (this.kind === "2d" || !this.latest) return this.engine.image();
    this.engine.renderAt(performance.now());
    const output = document.createElement("canvas");
    output.width = this.canvas.width;
    output.height = this.canvas.height;
    const c = output.getContext("2d")!;
    c.drawImage(this.canvas, 0, 0);
    const font = Math.max(12, Math.round(output.width / 90)),
      padding = font * 1.2,
      band = font * 4.8;
    c.fillStyle = "#08111bea";
    c.fillRect(0, output.height - band, output.width, band);
    c.textAlign = "left";
    c.fillStyle = this.theme.accent;
    c.font = `500 ${font}px Vazirmatn, sans-serif`;
    c.fillText(
      `PROCESS CITY / ${this.latest.options.mode === "demo" ? "SIMULATED DATA" : "LOCAL WINDOWS DATA"}`,
      padding,
      output.height - band + padding * 1.4,
      output.width - padding * 2,
    );
    c.fillStyle = "#b5c8d8";
    c.font = `${font}px Vazirmatn, sans-serif`;
    c.fillText(
      `${this.theme.name} / ${new Date(this.latest.snapshot.at).toLocaleString("en-GB")}`,
      padding,
      output.height - band + padding * 2.8,
      output.width - padding * 2,
    );
    return new Promise((resolve, reject) =>
      output.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Could not capture city.")),
        "image/png",
      ),
    );
  }
  surface() {
    return this.canvas;
  }
  destroy() {
    this.disposed = true;
    this.events.abort();
    this.engine.destroy();
  }
}
