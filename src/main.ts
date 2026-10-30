import "./style.css";
import {
  validateSnapshot,
  type CitySnapshot,
  type CityProcess,
  type ThemeId,
  type Mode,
  type RawSnapshot,
} from "./model.ts";
import { CityAnalyzer, sortProcesses } from "./metrics.ts";
import { DemoWorld } from "./demo.ts";
import { themes } from "./themes.ts";
import { CityScene } from "./city.ts";
import { shellMarkup } from "./shell.ts";
import {
  applicationInsights,
  busiestApplication,
  type InsightMetric,
} from "./insights.ts";
import type { ApplicationInsight } from "./insights.ts";
import { Experience } from "./experience.ts";
import { architectures, classify } from "./districts.ts";
import { processRelations } from "./relationships.ts";

const app = document.querySelector<HTMLDivElement>("#app")!;
let fa = new URLSearchParams(location.search).get("lang") === "fa";
let themeId: ThemeId = "neon",
  labels = false,
  roads = true,
  paused = false,
  mode: Mode = "demo",
  sort: "ram" | "cpu" | "name" = "ram",
  query = "",
  filter: "all" | "growth" = "all";
try {
  const p = JSON.parse(
    localStorage.getItem("process-city-preferences") ?? "{}",
  );
  if (themes.some((t) => t.id === p.theme)) themeId = p.theme;
  if (!new URLSearchParams(location.search).has("lang")) fa = p.fa === true;
} catch {
  /* Default preferences. */
}
let analyzer = new CityAnalyzer(),
  demo = new DemoWorld(),
  snapshot: CitySnapshot | null = null,
  rawSnapshot: RawSnapshot | null = null,
  selected: string | null = null,
  scene: CityScene | null = null,
  lastReceive = 0,
  lastTimestamp = "",
  connectionError = "",
  connecting = false,
  inFlight = false,
  generation = 0,
  parentFilter: string | null = null;
const t = (en: string, persian: string): string => (fa ? persian : en);
const esc = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const num = (n: number, digits = 0): string =>
  new Intl.NumberFormat(fa ? "fa-IR" : "en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
const percent = (n: number | null): string =>
  n === null ? "—" : num(n, 1) + (fa ? "٪" : "%");
const size = (bytes: number): string =>
  bytes >= 1073741824
    ? num(bytes / 1073741824, 1) + " GB"
    : num(bytes / 1048576, 1) + " MB";
const theme = () => themes.find((t) => t.id === themeId)!;
function icon(name: string): string {
  const shapes: Record<string, string> = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    city: '<path d="M3 21V9l6-3v15M9 21V3l6 3v15M15 21V11l6-3v13M1 21h22M5 11v2m0 3v2m6-10v2m0 3v2m6-2v2m0 3v2"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v5m6-5v5M9 18v5m6-5v5M1 9h5m-5 6h5m12-6h5m-5 6h5"/>',
    ram: '<path d="M3 6h18v12H3zM6 18v3m4-3v3m4-3v3m4-3v3M7 10v4m5-4v4m5-4v4"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    camera:
      '<path d="m4 7 3-4h10l3 4h2v14H2V7h2Z"/><circle cx="12" cy="13" r="4"/>',
    pause: '<path d="M8 4v16m8-16v16"/>',
    play: '<path d="m7 3 14 9-14 9V3Z"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    minus: '<path d="M4 12h16"/>',
    fit: '<path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5"/>',
    link: '<path d="M8 5h8v6H8zM3 17h6v5H3zm12 0h6v5h-6zM12 11v3H6v3m6-3h6v3"/>',
    drop: '<path d="M12 2S4 11 4 15a8 8 0 0 0 16 0c0-4-8-13-8-13Z"/>',
    reset: '<path d="M3 11a9 9 0 1 1 3 8M3 4v7h7"/>',
    download: '<path d="M12 2v13m-5-5 5 5 5-5M3 16v5h18v-5"/>',
    close: '<path d="m5 5 14 14M5 19 19 5"/>',
    check: '<path d="m4 12 5 5L20 5"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 11v7m0-12v1"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] ?? shapes.city}</svg>`;
}
function savePreferences(): void {
  try {
    localStorage.setItem(
      "process-city-preferences",
      JSON.stringify({ theme: themeId, fa }),
    );
  } catch {
    /* Preferences are optional. */
  }
}
let inspectorOpen = false,
  insightOpen = false,
  insightMetric: InsightMetric = "cpu";
let insightKey: string | null = null;
let quality: "auto" | "low" | "high" = "auto";
let introChecked = false,
  introTimer: ReturnType<typeof setTimeout> | undefined;
let liveSnapshot: CitySnapshot | null = null;
const experience = new Experience({
  fa: () => fa,
  mode: () => mode,
  theme,
  scene: () => scene,
  selected: () => selected,
  select: (key) => {
    selected = key;
    renderPanels(true);
  },
  demo: () => demo,
  latest: () => liveSnapshot,
  display: (frame) => {
    snapshot = frame ?? liveSnapshot;
    renderPanels(true);
  },
  notify,
  poll: () => {
    void poll();
  },
  restartAnalysis: () => {
    analyzer = new CityAnalyzer();
  },
});
function activateToolTab(panel: string): void {
  const active = ["processes", "experiences", "recording", "settings"].includes(
    panel,
  )
    ? panel
    : "processes";
  for (const name of ["processes", "experiences", "recording", "settings"]) {
    const tab = document.getElementById("tab-" + name),
      content = document.getElementById("panel-" + name);
    tab?.setAttribute("aria-selected", String(name === active));
    tab?.setAttribute("tabindex", name === active ? "0" : "-1");
    if (content) content.hidden = name !== active;
  }
  if (active === "processes") renderPanels(true);
}
function openTools(panel: string): void {
  activateToolTab(panel);
  const dialog = document.querySelector<HTMLDialogElement>("#tools-dialog");
  if (dialog && !dialog.open) dialog.showModal();
}
function renderInsight(insight: ApplicationInsight | null): void {
  const focusedAction = document.activeElement?.closest<HTMLElement>(
    "#insight-content [data-action]",
  )?.dataset.action;
  document
    .querySelector('[data-action="insight-cpu"]')
    ?.setAttribute("aria-pressed", String(insightMetric === "cpu"));
  document
    .querySelector('[data-action="insight-memory"]')
    ?.setAttribute("aria-pressed", String(insightMetric === "memory"));
  document
    .querySelector('[data-action="discover"]')
    ?.setAttribute("aria-pressed", String(insightOpen));
  const content = document.getElementById("insight-content");
  if (!content) return;
  if (!insight) {
    content.innerHTML = `<p>${insightKey ? t("The selected family is no longer in this snapshot.", "خانوادهٔ انتخاب‌شده دیگر در این نمونه نیست.") : t("Waiting for the next CPU reading. You can explore private memory now.", "در انتظار نمونهٔ بعدی CPU؛ حافظهٔ خصوصی را همین حالا می‌توانی بررسی کنی.")}</p><button data-action="refresh-insight" class="text-button">${t("Find the current leader", "پیداکردن پرمصرف‌ترینِ اکنون")} ↻</button>`;
    return;
  }
  const cpu =
    insight.cpu === null
      ? "—"
      : (insight.cpuComplete ? "" : "≥ ") + percent(insight.cpu);
  content.innerHTML = `<span class="insight-reason">${insightMetric === "cpu" ? t("Tracking the family found at selection", "رصد خانوادهٔ پرمصرف در لحظهٔ انتخاب") : t("Tracking the selected private-memory family", "رصد خانوادهٔ انتخاب‌شده از نظر حافظهٔ خصوصی")}</span><h2 dir="ltr">${esc(insight.name)}</h2><div class="insight-values"><span><small>CPU</small><strong><bdi>${cpu}</bdi></strong></span><span><small>${t("Private memory", "حافظهٔ خصوصی")}</small><strong><bdi>${size(insight.privateBytes)}</bdi></strong></span><span><small>${t("Processes", "پردازش")}</small><strong>${num(insight.members.size)}</strong></span></div><p>${t("This observed process family is highlighted in the city. High usage can be normal.", "این خانوادهٔ پردازش‌ها در شهر روشن شده است. مصرف بالا می‌تواند طبیعی باشد.")}${!insight.cpuComplete ? " " + t("Some CPU counters are unavailable.", "برخی شمارنده‌های CPU در دسترس نیستند.") : ""}</p><button data-action="refresh-insight" class="text-button">${t("Find the current leader", "پیداکردن پرمصرف‌ترینِ اکنون")} ↻</button><button data-action="inspect-family" class="text-button">${t("Inspect this family", "بررسی این خانواده")} ↗</button>`;
  if (focusedAction)
    Array.from(content.querySelectorAll<HTMLButtonElement>("[data-action]"))
      .find((button) => button.dataset.action === focusedAction)
      ?.focus({ preventScroll: true });
}
function finishIntro(): void {
  clearTimeout(introTimer);
  const overlay = document.getElementById("intro-scene");
  if (overlay) overlay.hidden = true;
  scene?.stopIntro();
  try {
    localStorage.setItem("process-city-intro-v3", "seen");
  } catch {
    /* Optional onboarding memory. */
  }
}
function startIntro(force: boolean): void {
  if (!snapshot || !scene) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  try {
    if (!force && localStorage.getItem("process-city-intro-v3") === "seen")
      return;
  } catch {
    /* First-visit animation stays optional. */
  }
  const overlay = document.getElementById("intro-scene"),
    rows = document.getElementById("intro-rows");
  if (!overlay || !rows) return;
  rows.innerHTML = [...snapshot.processes]
    .sort((a, b) => b.rssBytes - a.rssBytes)
    .slice(0, 5)
    .map(
      (p, i) =>
        `<div class="intro-row" style="--order:${i}"><span dir="ltr">${esc(p.name)}</span><span><bdi>${size(p.rssBytes)}</bdi></span></div>`,
    )
    .join("");
  overlay.hidden = false;
  scene.intro();
  clearTimeout(introTimer);
  introTimer = setTimeout(finishIntro, 3300);
}
function renderShell(): void {
  const view = scene?.view();
  scene?.destroy();
  document.documentElement.lang = fa ? "fa" : "en";
  document.documentElement.dir = fa ? "rtl" : "ltr";
  document.title = t(
    "Process City — Your computer, a living city.",
    "شهر پردازش‌ها — کامپیوترت یک شهر زنده است.",
  );
  app.innerHTML = shellMarkup({
    fa,
    mode,
    themeId,
    labels,
    roads,
    paused,
    query,
    sort,
    icon,
    esc,
  });
  try {
    scene = new CityScene(
      document.querySelector<HTMLCanvasElement>("#city")!,
      theme(),
      (key) => {
        experience.stopDirector();
        selected = key;
        inspectorOpen = true;
        insightOpen = false;
        renderPanels(true);
        document.getElementById("inspector")!.scrollTop = 0;
      },
    );
  } catch (e) {
    notify(e instanceof Error ? e.message : "Canvas unavailable.");
  }
  if (view) scene?.restore(view);
  scene?.quality(quality);
  const qualitySelect = document.getElementById("quality") as HTMLSelectElement;
  if (qualitySelect) qualitySelect.value = quality;
  experience.mount();
  renderPanels();
}
function filtered(): CityProcess[] {
  return snapshot
    ? sortProcesses(
        snapshot.processes.filter(
          (p) =>
            (!query ||
              p.name.toLowerCase().includes(query.toLowerCase()) ||
              String(p.pid).includes(query)) &&
            (filter === "all" || p.growing) &&
            (!parentFilter || p.parentKey === parentFilter),
        ),
        sort,
      )
    : [];
}
function sparkline(process: CityProcess): string {
  const values = process.history.map((p) => p.privateBytes),
    max = Math.max(...values, 1),
    min = Math.min(...values),
    range = Math.max(max - min, max * 0.03, 1);
  const points = values
    .map(
      (v, i) =>
        `${10 + (i / Math.max(values.length - 1, 1)) * 260},${66 - ((v - min) / range) * 48}`,
    )
    .join(" ");
  return `<svg class="sparkline" viewBox="0 0 280 80" role="img" aria-label="${t("Private memory history, up to 30 samples", "تاریخچهٔ حافظهٔ خصوصی تا ۳۰ نمونه")}"><path d="M10 67H270M10 30H270" class="chart-grid"/><polyline points="${points}" class="chart-line"/></svg>`;
}
function relationshipMarkup(p: CityProcess): string {
  const family = processRelations(snapshot!.processes, p.key);
  const item = (member: CityProcess, role: string, kind: string) =>
    `<button class="family-node ${kind}" data-process="${esc(member.key)}"><small>${role}</small><span dir="ltr">${esc(member.name)}</span><bdi>PID ${member.pid}</bdi></button>`;
  return `<section class="family-map" aria-label="${t("Observed process relationships", "روابط مشاهده‌شدهٔ پردازش")}"><div class="family-map-title"><h3>${t("Follow this family", "مسیر این خانواده")}</h3><span>${num(family.children.length)} ${t("children", "فرزند")}</span></div><p>${t("Arrows go from parent to child; they do not show data or network traffic.", "پیکان از والد به فرزند است؛ جریان داده یا شبکه را نشان نمی‌دهد.")}</p>${family.parent ? item(family.parent, t("PARENT · AMBER", "والد · طلایی"), "parent-node") : `<div class="family-missing">${t("Parent unavailable or exited", "والد در دسترس نیست یا پایان یافته")}${p.ppid ? ` · PPID <bdi>${p.ppid}</bdi>` : ""}</div>`}<div class="family-direction" aria-hidden="true">↓</div><div class="family-current"><span>${t("SELECTED", "انتخاب‌شده")}</span><bdi>${esc(p.name)} · ${p.pid}</bdi></div>${
    family.children.length
      ? `<div class="family-direction" aria-hidden="true">↓</div><div class="family-children">${family.children
          .slice(0, 2)
          .map((child) =>
            item(child, t("CHILD · BLUE", "فرزند · آبی"), "child-node"),
          )
          .join("")}</div>`
      : `<p class="family-empty">${t("No observed children in this snapshot.", "در این نمونه فرزندی مشاهده نشده است.")}</p>`
  }${family.children.length > 2 ? `<button class="text-button" data-action="children">${t("All children", "همهٔ فرزندان")} (${num(family.children.length)}) ↗</button>` : ""}${family.children.length > 12 ? `<p>${t("The city highlights the 12 largest children; the list includes all of them.", "برای خوانایی، ۱۲ فرزند با بیشترین حافظه در شهر برجسته‌اند؛ فهرست شامل همه است.")}</p>` : ""}${!roads ? `<button class="text-button" data-action="relations">${t("Show the paths in the city", "نمایش مسیرها در شهر")} ↗</button>` : ""}</section>`;
}
function inspectorMarkup(): string {
  const p = snapshot?.processes.find((p) => p.key === selected);
  if (!p)
    return `<div class="inspector-header">${icon("search")}<span>${t("PROCESS INSPECTOR", "جزئیات پردازش")}</span></div><div class="inspector-empty">${icon("city")}<h2>${selected ? t("This process has left the city.", "این پردازش از شهر خارج شده است.") : t("Meet a building.", "با یک ساختمان آشنا شو.")}</h2><p>${t("Select any building or process in the list to follow its story.", "یک ساختمان یا پردازش از فهرست انتخاب کنید تا جزئیاتش را ببینید.")}</p></div>`;
  return `<div class="inspector-header">${icon("cpu")}<span>${t("PROCESS INSPECTOR", "جزئیات پردازش")}</span><span class="inspector-live">${experience.replaying ? t("REPLAY", "بازپخش") : paused ? t("PAUSED", "متوقف") : t("TRACKING", "در حال رصد")}</span></div><div class="inspector-content"><div class="process-avatar">${icon("city")}</div><h2 dir="ltr">${esc(p.name)}</h2><div class="pid-line">PID <bdi>${p.pid}</bdi> <span>·</span> PPID <bdi>${p.ppid}</bdi></div>${relationshipMarkup(p)}<div class="architecture-badge">${fa ? architectures[classify(p.name)].fa : architectures[classify(p.name)].en}</div><button data-exp="enter" class="enter-building">↗ ${t("Enter this building", "ورود به این ساختمان")}</button><div class="inspector-metrics"><div><span>${t("CPU SHARE", "سهم CPU")}</span><strong>${percent(p.cpu)}</strong></div><div><span>${t("WORKING SET", "حافظهٔ مقیم")}</span><strong><bdi>${size(p.rssBytes)}</bdi></strong></div></div><div class="inspector-separator"></div><div class="history-heading"><h3>${t("Private memory", "حافظهٔ خصوصی")}</h3><span>${num(p.history.length)} ${t("samples", "نمونه")}</span></div><div class="history-value"><bdi>${size(p.privateBytes)}</bdi><span class="${p.growing ? "warning-text" : ""}">${p.growthMB >= 0 ? "+" : "−"}${num(Math.abs(p.growthMB), 1)} MB</span></div>${sparkline(p)}<div class="chart-axis"><span>${t("Earlier", "قبل‌تر")}</span><span>${t("Now", "اکنون")}</span></div>
  ${p.growing ? `<div class="growth-alert">${icon("drop")}<div><strong>${t("Sustained memory growth", "رشد پیوستهٔ حافظه")}</strong><p>+${num(p.growthRate, 1)} MB/min · ${t("Possible leak; inspect further.", "احتمال نشت؛ نیازمند بررسی بیشتر.")}</p></div></div>` : `<div class="stable-note"><span class="status-dot"></span>${t("No sustained growth signal", "نشانه‌ای از رشد پیوسته دیده نشد")}</div>`}
  <div class="process-age">${t("Started", "زمان آغاز")}: ${p.createdAt ? esc(new Date(p.createdAt).toLocaleTimeString(fa ? "fa-IR" : "en-GB")) : t("Unavailable", "نامشخص")}</div></div>`;
}
function renderPanels(force = false): void {
  document
    .querySelector('[data-action="discover"]')
    ?.setAttribute("aria-pressed", String(insightOpen));
  const discoverButton = document.querySelector<HTMLButtonElement>(
    '[data-action="discover"]',
  );
  if (discoverButton) discoverButton.disabled = !snapshot;
  const relationsButton = document.getElementById(
    "relations-open",
  ) as HTMLButtonElement | null;
  if (relationsButton) relationsButton.disabled = !snapshot;
  if (!snapshot) {
    const banner = document.querySelector<HTMLElement>("#connection-banner");
    if (banner) {
      banner.hidden = !connectionError;
      banner.textContent = connectionError;
    }
    const status = document.querySelector("#connection-status");
    if (status)
      status.textContent = t(
        "Waiting for the first snapshot…",
        "در انتظار نخستین نمونه…",
      );
    const badge = document.querySelector("#source-badge");
    if (badge) badge.textContent = t("WAITING", "در انتظار");
    return;
  }
  document.documentElement.style.setProperty("--accent", theme().accent);
  document.documentElement.style.setProperty("--secondary", theme().secondary);
  const byId = (id: string) => document.getElementById(id)!;
  byId("cpu-value").textContent = percent(snapshot.cpu);
  byId("memory-value").innerHTML =
    `<bdi dir="ltr">${size(snapshot.ramUsed)}</bdi>`;
  byId("memory-detail").innerHTML =
    t("of ", "از ") + `<bdi dir="ltr">${size(snapshot.ramTotal)}</bdi>`;
  byId("memory-fill").style.height =
    `${(snapshot.ramUsed / snapshot.ramTotal) * 100}%`;
  byId("process-value").textContent = num(snapshot.processes.length);
  byId("process-detail").textContent =
    num(snapshot.cores) + " " + t("logical cores", "هستهٔ منطقی");
  byId("growth-value").textContent = num(snapshot.growingCount);
  byId("cpu-bars").innerHTML = Array.from(
    { length: 13 },
    (_, i) =>
      `<i style="height:${13 + ((i * 17) % 35)}px;opacity:${snapshot!.cpu !== null && i / 13 < snapshot!.cpu / 100 ? 1 : 0.15}"></i>`,
  ).join("");
  const stale = mode === "live" && Date.now() - lastReceive > 8000;
  byId("connection-status").textContent = connecting
    ? t("Connecting…", "در حال اتصال…")
    : mode === "demo"
      ? t("Synthetic data · 2s refresh", "دادهٔ ساختگی · هر ۲ ثانیه")
      : stale
        ? t("Readings stale", "داده‌ها قدیمی‌اند")
        : t("Local collector · 2s refresh", "جمع‌آورندهٔ محلی · هر ۲ ثانیه");
  byId("source-badge").textContent = paused
    ? t("PAUSED", "متوقف")
    : mode === "demo"
      ? t("SIMULATION", "شبیه‌سازی")
      : stale
        ? t("STALE", "قدیمی")
        : t("LIVE / LOCAL", "زنده / محلی");
  byId("source-badge").classList.toggle(
    "live",
    mode === "live" && !stale && !experience.replaying,
  );
  if (experience.replaying)
    byId("source-badge").textContent =
      t("REPLAY / ", "بازپخش / ") +
      (experience.source() === "demo"
        ? t("SIMULATION", "شبیه‌سازی")
        : t("LOCAL RECORDING", "ضبط محلی"));
  if (experience.replaying)
    byId("connection-status").textContent = t(
      "Viewing a recording · source shown on city",
      "در حال مشاهدهٔ ضبط · منبع روی شهر درج شده",
    );
  const banner = byId("connection-banner");
  banner.hidden = !connectionError;
  banner.textContent = connectionError;
  const values = filtered();
  const searchInput = document.getElementById(
    "search",
  ) as HTMLInputElement | null;
  if (searchInput && document.activeElement !== searchInput)
    searchInput.value = query;
  byId("filter-state").innerHTML =
    filter === "growth" || parentFilter
      ? `<button class="filter-chip" data-action="clear-filter">${parentFilter ? t("Child processes only", "فقط پردازش‌های فرزند") : t("Growing memory only", "فقط رشد حافظه")}${icon("close")}</button>`
      : "";
  const focusedProcess = document.activeElement?.closest<HTMLButtonElement>(
    "#process-list [data-process]",
  )?.dataset.process;
  if (
    force ||
    (document.querySelector<HTMLDialogElement>("#tools-dialog")?.open &&
      !document.getElementById("panel-processes")?.hidden)
  ) {
    byId("process-list").innerHTML = values.length
      ? `<table><thead><tr><th>${t("PROCESS", "پردازش")}</th><th>PID</th><th>CPU</th><th>${t("WORKING SET", "حافظهٔ مقیم")}</th><th>${t("PRIVATE", "خصوصی")}</th><th>${t("GROWTH", "رشد")}</th></tr></thead><tbody>${values.map((p) => `<tr class="${p.key === selected ? "selected" : ""}"><td><button data-process="${esc(p.key)}"><span class="process-dot ${p.growing ? "growing" : ""}"></span><span dir="ltr">${esc(p.name)}</span></button></td><td><bdi>${p.pid}</bdi></td><td>${percent(p.cpu)}</td><td><bdi>${size(p.rssBytes)}</bdi></td><td><bdi>${size(p.privateBytes)}</bdi></td><td class="${p.growing ? "warning-text" : ""}">${p.growing ? "↗ " + num(p.growthMB, 1) + " MB" : "—"}</td></tr>`).join("")}</tbody></table>`
      : `<div class="list-empty">${t("No matching processes. Try another name or clear the growth filter.", "پردازشی پیدا نشد. نام دیگری را جست‌وجو کنید یا فیلتر رشد را بردارید.")}</div>`;
  }
  if (focusedProcess)
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "#process-list [data-process]",
      ),
    )
      .find((button) => button.dataset.process === focusedProcess)
      ?.focus({ preventScroll: true });
  const focusedInspector =
    document.activeElement?.closest<HTMLButtonElement>("#inspector button");
  const focusIdentity = focusedInspector
    ? {
        action: focusedInspector.dataset.action,
        process: focusedInspector.dataset.process,
        exp: focusedInspector.dataset.exp,
      }
    : null;
  if (force || inspectorOpen)
    byId("inspector").innerHTML =
      `<button class="inspector-close icon-button" data-action="close-inspector" aria-label="${t("Close inspector", "بستن جزئیات")}">×</button>` +
      inspectorMarkup();
  if (focusIdentity)
    Array.from(
      document.querySelectorAll<HTMLButtonElement>("#inspector button"),
    )
      .find(
        (button) =>
          button.dataset.action === focusIdentity.action &&
          button.dataset.process === focusIdentity.process &&
          button.dataset.exp === focusIdentity.exp,
      )
      ?.focus({ preventScroll: true });
  byId("inspector").hidden = !inspectorOpen;
  const familyLegend = byId("relationship-legend");
  familyLegend.hidden = !(
    inspectorOpen &&
    roads &&
    snapshot.processes.some((p) => p.key === selected)
  );
  byId("relations-open").setAttribute(
    "aria-pressed",
    String(inspectorOpen && roads),
  );
  byId("insight").hidden = !insightOpen;
  const discovery = insightOpen
    ? insightKey
      ? (applicationInsights(snapshot).find(
          (group) => group.key === insightKey,
        ) ?? null)
      : busiestApplication(snapshot, insightMetric)
    : null;
  if (discovery) {
    insightKey = discovery.key;
    if (insightOpen) selected = discovery.key;
  }
  if (insightOpen) renderInsight(discovery);
  byId("renderer-state").textContent =
    scene?.kind === "3d" ? "3D" : t("2D fallback", "نمای جایگزین ۲بعدی");
  byId("events").innerHTML = snapshot.events.length
    ? snapshot.events
        .slice(0, 8)
        .map(
          (e) =>
            `<div class="event"><span class="event-time">${new Date(e.time).toLocaleTimeString(fa ? "fa-IR" : "en-GB")}</span><span class="event-dot ${e.kind}"></span><span dir="ltr">${esc(e.name)}</span><span>${e.kind === "start" ? t("joined the city", "وارد شهر شد") : e.kind === "exit" ? t("left the city", "از شهر خارج شد") : t("shows growing private memory", "رشد حافظهٔ خصوصی دارد")}</span><span class="event-pid">PID ${e.pid}</span></div>`,
        )
        .join("")
    : `<p class="muted-note">${t("Watching for process starts, exits and memory growth…", "در انتظار آغاز، پایان یا رشد حافظهٔ پردازش‌ها…")}</p>`;
  document
    .querySelector('[data-action="surge"]')
    ?.setAttribute("aria-pressed", String(demo.surge));
  document
    .querySelector('[data-action="leak"]')
    ?.setAttribute("aria-pressed", String(demo.leak));
  experience.update(snapshot);
  scene?.set(snapshot, theme(), {
    labels,
    roads,
    paused: paused || stale,
    selected:
      inspectorOpen || insightOpen || experience.cinematic ? selected : null,
    filter: discovery
      ? discovery.members
      : query || parentFilter || filter === "growth"
        ? new Set(values.map((p) => p.key))
        : null,
    locale: fa ? "fa" : "en",
    mode: experience.source(),
    relationFocus: inspectorOpen,
  });
}
function accept(raw: RawSnapshot): void {
  if (raw.capturedAt === lastTimestamp) return;
  lastTimestamp = raw.capturedAt;
  rawSnapshot = raw;
  liveSnapshot = analyzer.update(raw);
  experience.record(liveSnapshot);
  snapshot = experience.display(liveSnapshot);
  lastReceive = Date.now();
  renderPanels();
  if (!introChecked) {
    introChecked = true;
    startIntro(false);
  }
}
async function poll(): Promise<void> {
  if (paused || inFlight) return;
  if (mode === "demo") {
    accept(demo.next());
    return;
  }
  inFlight = true;
  const requestGeneration = generation;
  try {
    const response = await fetch("/api/snapshot", {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (requestGeneration !== generation) return;
    if (!response.ok) throw new Error();
    const result = (await response.json()) as { data: unknown; stale: boolean };
    if (result.stale) throw new Error();
    accept(validateSnapshot(result.data));
    connectionError = "";
  } catch {
    if (requestGeneration === generation)
      connectionError = t(
        "Collector unavailable. Last readings are frozen. Start the local collector and reconnect, or choose Demo simulation.",
        "جمع‌آورنده در دسترس نیست؛ آخرین داده‌ها ثابت مانده‌اند. جمع‌آورندهٔ محلی را اجرا کنید و دوباره متصل شوید یا دمو را انتخاب کنید.",
      );
  } finally {
    inFlight = false;
    renderPanels();
  }
}
async function changeMode(value: string): Promise<void> {
  const switchGeneration = ++generation;
  parentFilter = null;
  if (value === "demo") {
    mode = "demo";
    demo = new DemoWorld();
    paused = false;
    analyzer = new CityAnalyzer();
    snapshot = null;
    liveSnapshot = null;
    experience.reset(mode);
    inspectorOpen = false;
    insightOpen = false;
    insightKey = null;
    selected = null;
    lastTimestamp = "";
    connectionError = "";
    renderShell();
    void poll();
    return;
  }
  connecting = true;
  renderPanels();
  try {
    const response = await fetch("/api/health", {
      signal: AbortSignal.timeout(4000),
    });
    if (switchGeneration !== generation) return;
    const health = (await response.json()) as {
      readOnly?: boolean;
      status?: string;
    };
    if (!response.ok || health.readOnly !== true) throw new Error();
    mode = "live";
    paused = false;
    selected = null;
    analyzer = new CityAnalyzer();
    snapshot = null;
    liveSnapshot = null;
    experience.reset(mode);
    lastTimestamp = "";
    connectionError = "";
    renderShell();
    void poll();
  } catch {
    if (switchGeneration !== generation) return;
    connectionError = t(
      "Live monitoring runs locally on Windows. Run npm run build, then npm start, and open http://127.0.0.1:4317. The online demo cannot read your processes.",
      "رصد زنده به اجرای محلی روی ویندوز نیاز دارد. npm run build و سپس npm start را اجرا و http://127.0.0.1:4317 را باز کنید. دموی آنلاین به پردازش‌های شما دسترسی ندارد.",
    );
    document.querySelector<HTMLSelectElement>("#mode")!.value = "demo";
  } finally {
    connecting = false;
    renderPanels();
  }
}
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function notify(message: string): void {
  const toast = document.querySelector<HTMLElement>("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 6000);
}
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
app.addEventListener("click", async (event) => {
  const target = (event.target as Element).closest<HTMLElement>("button");
  if (!target) return;
  if (target.dataset.process) {
    experience.stopDirector();
    selected = target.dataset.process;
    inspectorOpen = true;
    insightOpen = false;
    document.querySelector<HTMLDialogElement>("#tools-dialog")?.close();
    renderPanels(true);
    document.getElementById("inspector")!.scrollTop = 0;
    document
      .querySelector<HTMLButtonElement>(".inspector-close")
      ?.focus({ preventScroll: true });
    if (innerWidth < 700)
      document.querySelector(".city-observatory")?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      });
    return;
  }
  if (target.dataset.exp === "tour") {
    inspectorOpen = false;
    insightOpen = false;
    renderPanels();
  }
  if (["now", "rescue", "showcase"].includes(target.dataset.exp ?? "")) {
    inspectorOpen = false;
    insightOpen = false;
    insightKey = null;
    if (target.dataset.exp === "rescue") selected = null;
  }
  switch (target.dataset.action) {
    case "open-tools":
      openTools("processes");
      break;
    case "open-processes":
      openTools("processes");
      break;
    case "open-share":
      openTools("recording");
      break;
    case "close-tools":
      document.querySelector<HTMLDialogElement>("#tools-dialog")?.close();
      break;
    case "tool-tab":
      activateToolTab(target.dataset.panel ?? "processes");
      break;
    case "discover":
      experience.stopDirector();
      insightOpen = !insightOpen;
      insightKey = null;
      inspectorOpen = false;
      query = "";
      filter = "all";
      parentFilter = null;
      renderPanels(true);
      if (insightOpen) {
        const insight = snapshot
          ? busiestApplication(snapshot, insightMetric)
          : null;
        if (insight) scene?.focus(insight.key);
      } else scene?.reset();
      break;
    case "close-insight":
      insightOpen = false;
      scene?.reset();
      renderPanels();
      break;
    case "insight-cpu":
      insightMetric = "cpu";
      insightKey = null;
      renderPanels();
      if (insightKey) scene?.focus(insightKey);
      break;
    case "insight-memory":
      insightMetric = "memory";
      insightKey = null;
      renderPanels();
      if (insightKey) scene?.focus(insightKey);
      break;
    case "refresh-insight":
      insightKey = null;
      renderPanels();
      if (insightKey) scene?.focus(insightKey);
      break;
    case "inspect-family": {
      const insight = snapshot
        ? applicationInsights(snapshot).find(
            (group) => group.key === insightKey,
          )
        : null;
      if (insight) {
        selected = insight.key;
        insightOpen = false;
        inspectorOpen = true;
        renderPanels(true);
        document.getElementById("inspector")!.scrollTop = 0;
      }
      break;
    }
    case "relations": {
      if (!snapshot) break;
      if (inspectorOpen && roads && target.id === "relations-open") {
        inspectorOpen = false;
        renderPanels();
        break;
      }
      experience.stopDirector();
      finishIntro();
      if (
        !inspectorOpen ||
        !snapshot.processes.some((p) => p.key === selected)
      ) {
        const counts = new Map<string, number>();
        snapshot.processes.forEach((p) => {
          if (p.parentKey)
            counts.set(p.parentKey, (counts.get(p.parentKey) ?? 0) + 1);
        });
        selected =
          [...snapshot.processes].sort(
            (a, b) =>
              (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0) ||
              b.rssBytes - a.rssBytes,
          )[0]?.key ?? null;
      }
      roads = true;
      inspectorOpen = true;
      insightOpen = false;
      query = "";
      parentFilter = null;
      filter = "all";
      renderPanels(true);
      break;
    }
    case "close-inspector":
      inspectorOpen = false;
      renderPanels();
      break;
    case "play-story":
      inspectorOpen = false;
      insightOpen = false;
      query = "";
      parentFilter = null;
      filter = "all";
      void experience.action("showcase");
      break;
    case "replay-intro":
      document.querySelector<HTMLDialogElement>("#tools-dialog")?.close();
      startIntro(true);
      break;
    case "skip-intro":
      finishIntro();
      break;
    case "language":
      fa = !fa;
      savePreferences();
      {
        const url = new URL(location.href);
        url.searchParams.set("lang", fa ? "fa" : "en");
        history.replaceState(null, "", url);
      }
      renderShell();
      break;
    case "help":
      document.querySelector<HTMLDialogElement>("#help-dialog")!.showModal();
      break;
    case "close-help":
      document.querySelector<HTMLDialogElement>("#help-dialog")!.close();
      break;
    case "pause":
      paused = !paused;
      target.innerHTML = icon(paused ? "play" : "pause");
      target.setAttribute(
        "aria-label",
        paused
          ? t("Resume updates", "ادامهٔ به‌روزرسانی")
          : t("Pause updates", "توقف به‌روزرسانی"),
      );
      renderPanels();
      if (!paused) void poll();
      break;
    case "zoom-in":
      scene?.zoom(0.15);
      break;
    case "zoom-out":
      scene?.zoom(-0.15);
      break;
    case "fit":
      scene?.reset();
      break;
    case "labels":
      labels = !labels;
      target.setAttribute("aria-pressed", String(labels));
      renderPanels();
      break;
    case "roads":
      roads = !roads;
      target.setAttribute("aria-pressed", String(roads));
      renderPanels();
      break;
    case "surge":
      if (
        mode === "demo" &&
        !experience.replaying &&
        !experience.scenarioLocked
      ) {
        demo.surge = !demo.surge;
        renderPanels();
        void poll();
      }
      break;
    case "leak":
      if (
        mode === "demo" &&
        !experience.replaying &&
        !experience.scenarioLocked
      ) {
        if (demo.leak) demo.recover();
        else demo.startLeak();
        selected =
          snapshot?.processes.find((p) => p.pid === 7331)?.key ?? selected;
        renderPanels();
        void poll();
      }
      break;
    case "recover":
      if (
        mode === "demo" &&
        !experience.replaying &&
        !experience.scenarioLocked
      ) {
        demo.recover();
        renderPanels();
        void poll();
      }
      break;
    case "growth-filter":
      filter = filter === "all" ? "growth" : "all";
      renderPanels();
      break;
    case "clear-filter":
      filter = "all";
      parentFilter = null;
      renderPanels(true);
      break;
    case "children":
      openTools("processes");
      parentFilter = selected;
      filter = "all";
      query = "";
      document.querySelector<HTMLInputElement>("#search")!.value = "";
      renderPanels(true);
      document
        .querySelector("#process-list")
        ?.scrollIntoView({ block: "nearest" });
      break;
    case "screenshot":
      try {
        if (scene)
          download(
            await scene.image(),
            `process-city-${themeId}-${experience.source()}.png`,
          );
      } catch {
        notify(t("Could not capture the city.", "گرفتن تصویر شهر ممکن نشد."));
      }
      break;
    case "export-json":
      if (experience.replaying) {
        notify(
          t(
            "Use Save recording to export this replay.",
            "برای خروجی این بازپخش از «ذخیرهٔ ضبط» استفاده کن.",
          ),
        );
        break;
      }
      if (rawSnapshot)
        download(
          new Blob(
            [
              JSON.stringify(
                {
                  application: "Process City",
                  source: mode,
                  snapshot: rawSnapshot,
                },
                null,
                2,
              ),
            ],
            { type: "application/json" },
          ),
          "process-city-snapshot.json",
        );
      break;
  }
});
app.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement;
  if (target.id === "search") {
    query = target.value;
    parentFilter = null;
    renderPanels();
  }
});
app.addEventListener("change", (event) => {
  const target = event.target as HTMLSelectElement;
  if (target.id === "theme" && themes.some((t) => t.id === target.value)) {
    themeId = target.value as ThemeId;
    savePreferences();
    renderPanels();
  }
  if (target.id === "mode") void changeMode(target.value);
  if (
    target.id === "quality" &&
    ["auto", "low", "high"].includes(target.value)
  ) {
    quality = target.value as typeof quality;
    scene?.quality(quality);
  }
  if (target.id === "sort") {
    sort = target.value as "ram" | "cpu" | "name";
    renderPanels();
  }
});
app.addEventListener("pointerdown", (event) => {
  if ((event.target as HTMLElement).id === "city") experience.stopDirector();
});
app.addEventListener("city-camera-input", () => experience.stopDirector());
app.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (target.id === "city") experience.stopDirector();
  if (
    target.getAttribute("role") === "tab" &&
    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
  ) {
    event.preventDefault();
    const tabs = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.tool-tabs [role="tab"]'),
    );
    const index = tabs.indexOf(target as HTMLButtonElement),
      step = event.key === "ArrowRight" ? (fa ? -1 : 1) : fa ? 1 : -1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + step + tabs.length) % tabs.length;
    activateToolTab(tabs[next].dataset.panel!);
    tabs[next].focus();
  }
  if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
    inspectorOpen = false;
    insightOpen = false;
    renderPanels();
  }
});
renderShell();
if (
  new URLSearchParams(location.search).get("mode") === "live" &&
  ["127.0.0.1", "localhost"].includes(location.hostname)
)
  void changeMode("live");
else void poll();
setInterval(() => {
  void poll();
}, 2000);
