import type { CitySnapshot, Mode, Theme } from "./model.ts";
import type { CityScene } from "./city.ts";
import type { DemoWorld } from "./demo.ts";
import { architectures, classify, districtRoot } from "./districts.ts";
import { CityTape, compareFrames, MAX_TAPE_BYTES } from "./tape.ts";
import { RescueGame } from "./rescue.ts";
import { renderClip, videoMime } from "./video.ts";
import { makeShowcase } from "./showcase.ts";
import { mountExperience } from "./experience-shell.ts";

interface Context {
  fa(): boolean;
  mode(): Mode;
  theme(): Theme;
  scene(): CityScene | null;
  selected(): string | null;
  select(key: string): void;
  demo(): DemoWorld;
  latest(): CitySnapshot | null;
  display(frame: CitySnapshot | null): void;
  notify(message: string): void;
  poll(): void;
  restartAnalysis(): void;
}
const html = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export class Experience {
  tape = new CityTape();
  private replayTape: CityTape | null = null;
  private index = 0;
  private playing = false;
  private playAt = 0;
  private speed = 4;
  private baseline: CitySnapshot | null = null;
  private ghost = false;
  private follow = false;
  private compareMix = 0.5;
  private comparePaint = 0;
  private touring = false;
  private tourAt = 0;
  private lastFocus = 0;
  private caption = "";
  private captionUntil = 0;
  private previous: CitySnapshot | null = null;
  private game = new RescueGame();
  private rescueBaseline = 0;
  private recording: AbortController | null = null;
  private clipURL: string | null = null;
  private importError = "";
  constructor(private c: Context) {
    document.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(
        "[data-exp]",
      );
      if (button && !button.disabled) void this.action(button.dataset.exp!);
    });
    document.addEventListener("input", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.id === "compare-slider")
        this.setComparison(Number(input.value) / 100);
      if (input.id === "time-slider") {
        this.enterReplay();
        this.playing = false;
        this.index = Number(input.value);
        this.showFrame();
      }
    });
    document.addEventListener("change", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.id === "play-speed") this.speed = Number(input.value);
      if (input.id === "tape-file" && input.files?.[0])
        void this.import(input.files[0]);
    });
    setInterval(() => this.tick(), 150);
    addEventListener("pagehide", () => {
      this.recording?.abort();
      if (this.clipURL) URL.revokeObjectURL(this.clipURL);
    });
  }
  private t(en: string, fa: string) {
    return this.c.fa() ? fa : en;
  }
  source() {
    return this.replayTape?.source ?? this.c.mode();
  }
  get cinematic() {
    return this.touring || this.follow;
  }
  stopDirector() {
    this.follow = false;
    this.touring = false;
    document
      .querySelector('[data-exp="tour"]')
      ?.setAttribute("aria-pressed", "false");
  }
  get replaying() {
    return this.replayTape !== null;
  }
  get scenarioLocked() {
    return this.game.phase === "hunting" || this.game.phase === "draining";
  }
  get activeTape() {
    return this.replayTape ?? this.tape;
  }
  reset(mode: Mode) {
    this.recording?.abort();
    this.tape = new CityTape(mode);
    this.replayTape = null;
    this.baseline = null;
    this.ghost = false;
    this.playing = false;
    this.previous = null;
    this.game.reset();
    this.stopDirector();
    this.caption = "";
    this.lastFocus = 0;
  }
  record(frame: CitySnapshot) {
    this.tape.record(frame);
    const previous = this.previous;
    this.previous = frame;
    if (this.c.mode() === "demo") {
      const culprit = frame.processes.find((p) => p.key === this.game.culprit);
      this.game.advance(
        frame.at,
        !culprit || culprit.privateBytes <= this.rescueBaseline + 3 * 1048576,
      );
      if (this.game.phase === "lost") this.c.demo().recover();
    }
    if (
      this.follow &&
      !this.replaying &&
      !this.scenarioLocked &&
      previous &&
      performance.now() - this.lastFocus > 8000
    ) {
      const old = new Set(previous.processes.map((p) => p.key));
      const newborn = frame.processes.filter((p) => !old.has(p.key));
      const candidate = newborn.find(
        (p) => classify(p.name) !== "system" && p.rssBytes > 20 * 1048576,
      );
      if (candidate) {
        const root = districtRoot(candidate, frame.processes);
        const family = newborn.filter(
          (p) => districtRoot(p, frame.processes).key === root.key,
        );
        this.caption = this.t(
          `A district awakens · ${root.name} · +${family.length} buildings`,
          `محله‌ای بیدار شد · ${root.name} · ${family.length}+ ساختمان`,
        );
        this.captionUntil = performance.now() + 7500;
        this.lastFocus = performance.now();
        setTimeout(() => {
          if (this.replaying) return;
          this.c.select(candidate.key);
          this.c.scene()?.focus(candidate.key);
        }, 80);
      }
    }
  }
  display(frame: CitySnapshot): CitySnapshot {
    return this.replaying
      ? (this.activeTape.frame(this.index) ?? frame)
      : frame;
  }
  mount() {
    mountExperience({
      fa: this.c.fa(),
      live: this.c.mode() === "live",
      touring: this.touring,
      ghost: this.ghost,
    });
    const handle = document.getElementById("compare-handle");
    let dragging = false;
    handle?.addEventListener("pointerdown", (event) => {
      dragging = true;
      handle.setPointerCapture(event.pointerId);
    });
    handle?.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const rect = document.getElementById("city")!.getBoundingClientRect();
      this.setComparison((event.clientX - rect.left) / rect.width);
    });
    handle?.addEventListener("pointerup", () => {
      dragging = false;
    });
    handle?.addEventListener("pointercancel", () => {
      dragging = false;
    });
    let dialog = document.getElementById("clip-dialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "clip-dialog";
      document.body.append(dialog);
      dialog.addEventListener("cancel", () => this.recording?.abort());
    }
    (document.getElementById("play-speed") as HTMLSelectElement).value = String(
      this.speed,
    );
    this.update(
      this.replaying ? this.activeTape.frame(this.index) : this.c.latest(),
    );
  }
  private setComparison(value: number): void {
    this.stopDirector();
    this.compareMix = Math.max(0, Math.min(1, value));
    const input = document.getElementById(
      "compare-slider",
    ) as HTMLInputElement | null;
    if (input) input.value = String(this.compareMix * 100);
    const line = document.getElementById("comparison-line");
    if (line) line.style.left = `${this.compareMix * 100}%`;
    this.c
      .scene()
      ?.comparison(this.ghost ? this.baseline : null, this.compareMix);
    if (!this.comparePaint)
      this.comparePaint = requestAnimationFrame(() => {
        this.comparePaint = 0;
        this.c.scene()?.renderAt(performance.now());
      });
  }
  update(frame: CitySnapshot | null) {
    if (!frame) return;
    const tape = this.activeTape,
      length = tape.frames.length;
    const source =
      this.source() === "demo"
        ? this.t("SIMULATION", "شبیه‌سازی")
        : this.t("LOCAL RECORDING", "ضبط محلی");
    const text = (id: string, value: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    text(
      "time-state",
      `${this.replaying ? this.t("REPLAY", "بازپخش") : this.t("RECORDING", "در حال ضبط")} / ${source}`,
    );
    const start = tape.frames[0]?.at ?? frame.at,
      end = tape.frames.at(-1)?.at ?? frame.at;
    text(
      "time-label",
      `${new Date(frame.at).toLocaleTimeString(this.c.fa() ? "fa-IR" : "en-GB")} · ${Math.round((end - start) / 1000)} ${this.t("seconds buffered", "ثانیه ضبط‌شده")} · ${length} ${this.t("frames", "فریم")}`,
    );
    const slider = document.getElementById(
      "time-slider",
    ) as HTMLInputElement | null;
    if (slider) {
      slider.max = String(Math.max(0, length - 1));
      slider.disabled = length < 2;
      if (document.activeElement !== slider)
        slider.value = String(this.replaying ? this.index : length - 1);
    }
    text("play-tape", this.playing ? "Ⅱ" : "▶");
    const play = document.getElementById("play-tape");
    play?.setAttribute(
      "aria-label",
      this.playing
        ? this.t("Pause replay", "توقف بازپخش")
        : this.t("Play recording", "پخش ضبط"),
    );
    text(
      "tape-note",
      this.importError ||
        this.t(
          "Rolling memory buffer · up to 3 minutes / 25,000 process samples · JSON save & replay · no automatic uploads.",
          "حافظهٔ چرخشی تا ۳ دقیقه / ۲۵٬۰۰۰ نمونهٔ پردازش · ذخیره و بازپخش JSON · بدون ارسال خودکار.",
        ),
    );
    if (this.baseline) {
      const diff = compareFrames(this.baseline, frame);
      text(
        "comparison",
        `+${diff.births} / −${diff.exits} · ${diff.memoryMB >= 0 ? "+" : ""}${diff.memoryMB.toFixed(1)} MB · ${new Date(this.baseline.at).toLocaleTimeString(this.c.fa() ? "fa-IR" : "en-GB")}`,
      );
    } else
      text(
        "comparison",
        this.t(
          "Pin a frame to compare births, exits and physical RAM.",
          "یک فریم را مرجع کن تا تولد، خروج و RAM فیزیکی را مقایسه کنی.",
        ),
      );
    const phase = this.game.phase;
    const rescueOverlay = document.getElementById("rescue-overlay");
    if (rescueOverlay) rescueOverlay.hidden = phase === "idle";
    const line = document.getElementById("comparison-line"),
      timeTrack = document.getElementById("time-track"),
      compareTrack = document.getElementById("comparison-track");
    if (line) {
      line.hidden = !this.ghost;
      line.style.left = `${this.compareMix * 100}%`;
    }
    if (timeTrack) timeTrack.hidden = this.ghost;
    if (compareTrack) compareTrack.hidden = !this.ghost;
    document
      .querySelector('[data-exp="compare"]')
      ?.setAttribute("aria-pressed", String(this.ghost));
    if (this.baseline) {
      text(
        "comparison",
        `${this.t("Reference", "مرجع")}: ${new Date(this.baseline.at).toLocaleTimeString(this.c.fa() ? "fa-IR" : "en-GB")} · ${document.getElementById("comparison")?.textContent ?? ""}`,
      );
      const before = document.querySelector(".before-label"),
        after = document.querySelector(".after-label");
      if (before)
        before.textContent =
          this.t("REFERENCE ", "مرجع ") +
          new Date(this.baseline.at).toLocaleTimeString(
            this.c.fa() ? "fa-IR" : "en-GB",
          );
      if (after)
        after.textContent =
          (this.replaying
            ? this.t("SELECTED ", "انتخاب‌شده ")
            : this.t("NOW ", "اکنون ")) +
          new Date(frame.at).toLocaleTimeString(
            this.c.fa() ? "fa-IR" : "en-GB",
          );
    }
    text(
      "rescue-clock",
      `00:${String(Math.max(0, Math.ceil(45 - this.game.elapsed))).padStart(2, "0")}`,
    );
    const p = frame.processes.find((p) => p.key === this.c.selected());
    const stories = {
      idle: this.t(
        "The city is calm. Start a simulated crisis to test your instincts.",
        "شهر آرام است. یک بحران شبیه‌سازی‌شده بساز و قدرت تشخیصت را امتحان کن.",
      ),
      hunting: this.t(
        `Flood rising. Inspect private-memory trends. Selected: ${p?.name ?? "none"} · wrong guesses: ${this.game.mistakes}`,
        `آب بالا می‌آید. روند حافظهٔ خصوصی را بررسی کن. انتخاب: ${p?.name ?? "هیچ‌کدام"} · حدس نادرست: ${this.game.mistakes}`,
      ),
      draining: this.t(
        "Source contained. Pumps are draining the city. Watch memory recover.",
        "منبع مهار شد. پمپ‌ها شهر را تخلیه می‌کنند؛ بازگشت حافظه را ببین.",
      ),
      won: this.t(
        `City saved! ${Math.round(this.game.elapsed)}s · ${this.game.mistakes} wrong guesses.`,
        `شهر نجات پیدا کرد! ${Math.round(this.game.elapsed)} ثانیه · ${this.game.mistakes} حدس نادرست.`,
      ),
      lost: this.t(
        "The flood won this round. Reset, inspect the trend and try again.",
        "این بار سیل برنده شد. بازنشانی کن، روند حافظه را بخوان و دوباره تلاش کن.",
      ),
    };
    text("rescue-story", stories[phase]);
    const fill = document.getElementById("flood-fill");
    if (fill) fill.style.width = `${this.game.water * 100}%`;
    document
      .querySelector(".flood-meter")
      ?.setAttribute(
        "aria-valuenow",
        String(Math.round(this.game.water * 100)),
      );
    const disabled = this.c.mode() !== "demo" || this.replaying;
    const compareButton = document.querySelector<HTMLButtonElement>(
      '[data-exp="compare"]',
    );
    if (compareButton) compareButton.disabled = this.scenarioLocked;
    for (const action of ["surge", "leak", "recover"])
      document
        .querySelectorAll<HTMLButtonElement>(`[data-action="${action}"]`)
        .forEach((b) => (b.disabled = disabled || this.scenarioLocked));
    for (const action of ["rescue", "cancel-rescue", "launch"])
      document
        .querySelectorAll<HTMLButtonElement>(`[data-exp="${action}"]`)
        .forEach(
          (b) =>
            (b.disabled =
              disabled || (action !== "cancel-rescue" && this.scenarioLocked)),
        );
    const rescueButton = document.querySelector<HTMLButtonElement>(
      '[data-exp="rescue"]',
    );
    if (rescueButton)
      rescueButton.disabled = this.c.mode() !== "demo" || this.scenarioLocked;
    const contain = document.querySelector<HTMLButtonElement>(
      '[data-exp="contain"]',
    );
    if (contain) contain.disabled = disabled || phase !== "hunting" || !p;
    document
      .querySelector('[data-exp="ghost"]')
      ?.setAttribute("aria-pressed", String(this.ghost));
    const caption =
      performance.now() < this.captionUntil
        ? this.caption
        : this.touring
          ? this.t(
              "CINEMATIC TOUR / select a building to investigate",
              "گردش سینمایی / یک ساختمان را بررسی کن",
            )
          : this.replaying
            ? this.t(
                "REPLAY / scrub through the city’s memory",
                "بازپخش / در حافظهٔ شهر قدم بزن",
              )
            : "";
    const captionElement = document.getElementById("scene-caption");
    if (captionElement)
      captionElement.textContent =
        caption ||
        this.t(
          "Drag to explore · select a building",
          "برای کاوش بکش؛ یک ساختمان را انتخاب کن",
        );
    this.c
      .scene()
      ?.comparison(this.ghost ? this.baseline : null, this.compareMix);
    this.c
      .scene()
      ?.extras(
        this.ghost ? this.baseline : null,
        this.replaying ? 0 : this.game.water,
        caption,
      );
  }
  private enterReplay() {
    if (!this.replayTape) {
      this.replayTape = new CityTape(this.tape.source);
      this.tape.frames.forEach((f) => this.replayTape!.record(f));
    }
    this.stopDirector();
  }
  private showFrame() {
    this.c.display(this.activeTape.frame(this.index));
  }
  private tick() {
    if (document.hidden) {
      this.playAt = performance.now();
      return;
    }
    const now = performance.now();
    if (this.playing && this.replayTape) {
      const frame = this.activeTape.frames[this.index],
        next = this.activeTape.frames[this.index + 1];
      if (!next) {
        this.playing = false;
        this.update(frame);
      } else if (
        now - this.playAt >=
        Math.max(50, (next.at - frame.at) / this.speed)
      ) {
        while (this.index + 1 < this.activeTape.frames.length) {
          const delay = Math.max(
            50,
            (this.activeTape.frames[this.index + 1].at -
              this.activeTape.frames[this.index].at) /
              this.speed,
          );
          if (now - this.playAt < delay) break;
          this.index++;
          this.playAt += delay;
        }
        this.showFrame();
      }
    }
    if (this.touring && now - this.tourAt > 6000) this.nextBuilding();
  }
  private nextBuilding() {
    const frame = this.replaying
      ? this.activeTape.frame(this.index)
      : this.c.latest();
    if (!frame) return;
    const processes = [...frame.processes]
      .sort((a, b) => b.rssBytes - a.rssBytes)
      .slice(0, 12);
    const index = processes.findIndex((p) => p.key === this.c.selected());
    const next = processes[(index + 1) % processes.length];
    if (next) {
      this.c.select(next.key);
      this.c.scene()?.focus(next.key);
      this.tourAt = performance.now();
    }
  }
  private download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  private async import(file: File) {
    try {
      if (file.size > MAX_TAPE_BYTES)
        throw new Error(
          this.t(
            "Maximum recording size: 12 MB.",
            "حداکثر اندازهٔ ضبط: ۱۲ مگابایت.",
          ),
        );
      const tape = CityTape.parse(await file.text());
      this.stopDirector();
      if (this.c.mode() === "demo") this.c.demo().recover();
      this.game.reset();
      this.replayTape = tape;
      this.index = 0;
      this.playing = false;
      this.baseline = null;
      this.ghost = false;
      this.importError = "";
      this.showFrame();
    } catch (error) {
      this.importError =
        this.t("Could not open recording: ", "بازکردن ضبط ممکن نشد: ") +
        (error instanceof Error ? error.message : "");
      this.c.notify(this.importError);
    }
  }
  async action(action: string) {
    let frame = this.replaying
      ? this.activeTape.frame(this.index)
      : this.c.latest();
    switch (action) {
      case "timeline":
        document.querySelector(".time-machine")?.scrollIntoView({
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
          block: "start",
        });
        break;
      case "follow":
        this.follow = !this.follow;
        document
          .querySelector('[data-exp="follow"]')
          ?.setAttribute("aria-pressed", String(this.follow));
        break;
      case "launch":
        if (this.c.mode() !== "demo" || this.replaying) return;
        this.c.demo().launch();
        this.lastFocus = -Infinity;
        this.c.poll();
        break;
      case "enter":
        if (this.c.selected()) this.c.scene()?.focus(this.c.selected()!);
        break;
      case "orbit":
        this.stopDirector();
        this.c.scene()?.reset();
        document
          .querySelector('[data-exp="tour"]')
          ?.setAttribute("aria-pressed", "false");
        break;
      case "tour":
        this.touring = !this.touring;
        this.follow = this.touring;
        document.querySelector<HTMLDialogElement>("#tools-dialog")?.close();
        if (this.touring) this.nextBuilding();
        document
          .querySelector('[data-exp="tour"]')
          ?.setAttribute("aria-pressed", String(this.touring));
        break;
      case "play":
        if (this.activeTape.frames.length < 2) return;
        this.enterReplay();
        this.playing = !this.playing;
        if (this.index >= this.activeTape.frames.length - 1) this.index = 0;
        this.playAt = performance.now();
        this.showFrame();
        break;
      case "now":
        this.replayTape = null;
        this.playing = false;
        this.importError = "";
        this.ghost = false;
        this.baseline = null;
        this.c.display(null);
        break;
      case "showcase":
        this.stopDirector();
        this.game.reset();
        if (this.c.mode() === "demo") this.c.demo().recover();
        this.replayTape = makeShowcase();
        this.index = 0;
        this.playing = true;
        this.playAt = performance.now();
        this.baseline = structuredClone(this.replayTape.frame(0));
        this.ghost = false;
        this.c.scene()?.reset();
        this.showFrame();
        break;
      case "compare":
        this.stopDirector();
        if (!this.ghost && !this.baseline) {
          const tape = this.activeTape,
            end = this.replaying ? this.index : tape.frames.length - 1;
          if (end < 1) {
            this.c.notify(
              this.t(
                "Record at least two samples first.",
                "ابتدا دست‌کم دو نمونه ضبط کن.",
              ),
            );
            return;
          }
          this.baseline = structuredClone(tape.frame(Math.max(0, end - 15)));
        }
        this.ghost = !this.ghost;
        this.c.display(this.replaying ? frame : null);
        break;
      case "pin":
        this.stopDirector();
        if (frame) {
          this.baseline = structuredClone(frame);
          this.ghost = true;
          this.c.display(this.replaying ? frame : null);
        }
        break;
      case "ghost":
        if (!this.baseline) {
          this.c.notify(
            this.t(
              "Pin a comparison frame first.",
              "ابتدا یک فریم مرجع ثبت کن.",
            ),
          );
          return;
        }
        this.ghost = !this.ghost;
        this.c.display(this.replaying ? frame : null);
        break;
      case "save":
        if (this.activeTape.frames.length)
          this.download(
            new Blob([this.activeTape.serialize()], {
              type: "application/json",
            }),
            `process-city-${this.source()}-recording.json`,
          );
        break;
      case "import":
        document.getElementById("tape-file")?.click();
        break;
      case "rescue": {
        if (this.c.mode() !== "demo") return;
        if (this.replaying) {
          this.replayTape = null;
          this.playing = false;
          frame = this.c.latest();
          this.c.display(null);
        }
        if (!frame) return;
        const candidates = frame.processes.filter(
          (p) =>
            p.pid > 1100 &&
            p.pid < 9900 &&
            p.privateBytes > 60 * 1048576 &&
            p.privateBytes < 400 * 1048576,
        );
        const culprit =
          candidates[Math.floor(Math.random() * candidates.length)];
        if (!culprit) return;
        this.ghost = false;
        this.baseline = null;
        document.querySelector<HTMLDialogElement>("#tools-dialog")?.close();
        this.game.start(culprit.key, frame.at);
        this.rescueBaseline = this.c.demo().baselinePrivate(culprit.pid);
        this.c.demo().recover();
        this.c.demo().startLeak(culprit.pid);
        this.c.restartAnalysis();
        this.c.scene()?.reset();
        this.stopDirector();
        this.c.notify(
          this.t(
            "A hidden process is growing. Compare its private memory over several samples.",
            "یک پردازش پنهانی در حال رشد است. حافظهٔ خصوصی‌اش را در چند نمونه مقایسه کن.",
          ),
        );
        this.c.poll();
        break;
      }
      case "contain": {
        if (this.c.mode() !== "demo" || this.replaying || !frame) return;
        const result = this.game.contain(this.c.selected(), frame.at);
        if (result === "correct") {
          this.c.demo().recover();
          this.c.notify(
            this.t(
              "Source contained. The city is recovering.",
              "منبع مهار شد؛ شهر در حال بازیابی است.",
            ),
          );
        }
        if (result === "wrong")
          this.c.notify(
            this.t(
              "That is not the source. Four seconds lost. Inspect private-memory growth.",
              "منبع این نبود؛ چهار ثانیه از دست رفت. رشد حافظهٔ خصوصی را بررسی کن.",
            ),
          );
        break;
      }
      case "cancel-rescue":
        if (this.c.mode() === "demo") {
          this.game.reset();
          this.c.demo().recover();
          this.c.poll();
        }
        break;
      case "clip":
        await this.clip();
        break;
      case "cancel-clip":
        this.recording?.abort();
        break;
      case "close-clip":
        this.recording?.abort();
        document.querySelector<HTMLDialogElement>("#clip-dialog")?.close();
        if (this.clipURL) {
          URL.revokeObjectURL(this.clipURL);
          this.clipURL = null;
        }
        break;
    }
    this.update(
      this.replaying ? this.activeTape.frame(this.index) : this.c.latest(),
    );
  }
  private async clip() {
    if (this.recording) return;
    const dialog = document.querySelector<HTMLDialogElement>("#clip-dialog")!;
    const supported = videoMime();
    if (!supported || this.activeTape.frames.length < 2) {
      this.c.notify(
        this.t(
          "Video needs a supported browser and at least two recorded samples.",
          "ویدئو به مرورگر سازگار و دست‌کم دو نمونهٔ ضبط‌شده نیاز دارد.",
        ),
      );
      return;
    }
    if (this.clipURL) {
      URL.revokeObjectURL(this.clipURL);
      this.clipURL = null;
    }
    const frozen = new CityTape(this.activeTape.source);
    this.activeTape.frames.forEach((f) => frozen.record(f));
    const controller = new AbortController();
    this.recording = controller;
    const portrait =
      (document.getElementById("portrait-clip") as HTMLInputElement)?.checked ??
      false;
    dialog.innerHTML = `<div class="dialog-heading"><h2>${this.t("Rendering your city", "در حال ساخت کلیپ شهر")}</h2><button data-exp="close-clip" aria-label="${this.t("Close", "بستن")}">×</button></div><div class="clip-content"><p>${this.t("Keep this tab visible for 12 seconds. The clip uses a frozen copy of your last recorded minute.", "این زبانه را ۱۲ ثانیه باز نگه دار. کلیپ از نسخهٔ ثابت آخرین دقیقهٔ ضبط‌شده ساخته می‌شود.")}</p><progress id="clip-progress" max="1" value="0"></progress><p id="clip-status" role="status">0%</p><button data-exp="cancel-clip">${this.t("Cancel rendering", "لغو ساخت")}</button><div id="clip-result"></div></div>`;
    dialog.showModal();
    try {
      await document.fonts.ready;
      const result = await renderClip(
        frozen,
        this.c.theme(),
        this.c.fa() ? "fa" : "en",
        portrait,
        controller.signal,
        (n) => {
          const bar = document.getElementById(
            "clip-progress",
          ) as HTMLProgressElement | null;
          if (bar) bar.value = n;
          const status = document.getElementById("clip-status");
          if (status) status.textContent = `${Math.round(n * 100)}%`;
        },
      );
      if (controller.signal.aborted) return;
      this.clipURL = URL.createObjectURL(result.blob);
      const target = document.getElementById("clip-result")!;
      target.innerHTML = `<video controls playsinline aria-label="${this.t("City clip preview", "پیش‌نمایش کلیپ شهر")}"></video><a class="clip-download" download="process-city-${frozen.source}.${result.extension}">${this.t("Download", "دریافت")} ${result.extension.toUpperCase()} · ${(result.blob.size / 1048576).toFixed(1)} MB</a>`;
      target.querySelector("video")!.src = this.clipURL;
      target.querySelector("a")!.href = this.clipURL;
      dialog.querySelector("h2")!.textContent = this.t(
        "Your city clip is ready",
        "کلیپ شهر تو آماده است",
      );
      document.getElementById("clip-status")!.textContent = this.t(
        "Your clip is ready.",
        "کلیپ تو آماده است.",
      );
      dialog.querySelector<HTMLButtonElement>(
        '[data-exp="cancel-clip"]',
      )!.hidden = true;
    } catch (error) {
      document.getElementById("clip-status")!.textContent = controller.signal
        .aborted
        ? this.t("Rendering cancelled.", "ساخت کلیپ لغو شد.")
        : this.t("Could not render video: ", "ساخت ویدئو ممکن نشد: ") +
          html(error instanceof Error ? error.message : "");
    } finally {
      this.recording = null;
    }
  }
}
