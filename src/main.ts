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
function renderShell(): void {
  scene?.destroy();
  document.documentElement.lang = fa ? "fa" : "en";
  document.documentElement.dir = fa ? "rtl" : "ltr";
  document.title = t(
    "Process City — Your computer, a living city.",
    "شهر پردازش‌ها — کامپیوترت یک شهر زنده است.",
  );
  app.innerHTML = `<a class="skip" href="#process-list">${t("Skip to process list", "رفتن به فهرست پردازش‌ها")}</a>
  <header class="topbar"><a href="?lang=${fa ? "fa" : "en"}" class="brand"><span class="brand-mark">${icon("city")}</span><span>PROCESS<span class="brand-city">CITY</span></span></a><span class="platform-tag">WINDOWS / LOCAL FIRST</span><div class="top-actions"><button data-action="help" class="quiet">${icon("info")}${t("How it works", "راهنما")}</button><button data-action="language" class="quiet" aria-label="${fa ? "Switch to English" : "تغییر زبان به فارسی"}">${fa ? "English" : "فارسی"}</button><button data-action="screenshot" class="outline">${icon("camera")}${t("Capture city", "عکس از شهر")}</button></div></header>
  <main><section class="page-heading"><div><div class="heading-kicker">${t("THE PROCESS OBSERVATORY", "رصدخانهٔ پردازش‌ها")}</div><h1>${t("Your system. A new perspective.", "سیستم تو، از نگاهی تازه.")}</h1><p>${t("Every process a building. Every connection a street.", "هر پردازش یک ساختمان؛ هر رابطه یک خیابان.")}</p></div><div class="source-control"><label for="mode">${t("DATA SOURCE", "منبع داده")}</label><select id="mode"><option value="demo" ${mode === "demo" ? "selected" : ""}>${t("Demo simulation", "شبیه‌سازی دمو")}</option><option value="live" ${mode === "live" ? "selected" : ""}>${t("Live Windows", "ویندوز زنده")}</option></select><span id="connection-status"></span></div></section>
  <section class="stats" aria-label="${t("System metrics", "شاخص‌های سیستم")}"><div class="stat">${icon("cpu")}<div><span>${t("CPU activity", "فعالیت CPU")}</span><strong id="cpu-value">—</strong><small>${t("of total machine capacity", "از کل ظرفیت سیستم")}</small></div><div class="stat-bars" id="cpu-bars"></div></div><div class="stat">${icon("ram")}<div><span>${t("Physical memory", "حافظهٔ فیزیکی")}</span><strong id="memory-value">—</strong><small id="memory-detail"></small></div><div class="memory-meter"><i id="memory-fill"></i></div></div><div class="stat">${icon("city")}<div><span>${t("City population", "جمعیت شهر")}</span><strong id="process-value">—</strong><small id="process-detail"></small></div></div><button class="stat growth-stat" data-action="growth-filter">${icon("drop")}<div><span>${t("Growing memory", "رشد حافظه")}</span><strong id="growth-value">—</strong><small>${t("a signal, not a leak diagnosis", "یک نشانه؛ نه تشخیص قطعی نشت")}</small></div></button></section>
  <div id="connection-banner" class="connection-banner" role="status" hidden></div>
  <section class="workspace"><div class="city-column"><div class="city-toolbar"><div class="city-title"><span class="status-dot"></span><strong>${t("City view", "نمای شهر")}</strong><span id="source-badge" class="badge"></span></div><div class="city-controls"><label class="sr-only" for="theme">${t("City theme", "تم شهر")}</label><select id="theme">${themes.map((th) => `<option value="${th.id}" ${th.id === themeId ? "selected" : ""}>${fa ? th.fa : th.name}</option>`).join("")}</select><button data-action="pause" class="icon-button" aria-label="${paused ? t("Resume updates", "ادامهٔ به‌روزرسانی") : t("Pause updates", "توقف به‌روزرسانی")}">${icon(paused ? "play" : "pause")}</button></div></div>
  <div class="city-stage"><canvas id="city" tabindex="0" role="img" aria-label="${t("Interactive isometric process city. Select a building or use the process list. Drag to pan; plus and minus to zoom.", "شهر ایزومتریک پردازش‌ها. یک ساختمان یا پردازش را از فهرست انتخاب کنید. برای جابه‌جایی بکشید و برای بزرگ‌نمایی از مثبت و منفی استفاده کنید.")}"></canvas><div class="city-caption"><span class="caption-coordinate">${t("SYSTEM DISTRICT", "ناحیهٔ سیستم")}</span><span>${t("Working set → skyline", "حافظهٔ مقیم ← خط آسمان")}</span></div><div class="view-tools"><button data-action="zoom-in" aria-label="${t("Zoom in", "بزرگ‌نمایی")}">${icon("plus")}</button><button data-action="zoom-out" aria-label="${t("Zoom out", "کوچک‌نمایی")}">${icon("minus")}</button><button data-action="fit" aria-label="${t("Fit city", "نمای کامل شهر")}">${icon("fit")}</button><span></span><button data-action="labels" aria-pressed="${labels}" aria-label="${t("Toggle building labels", "نمایش نام ساختمان‌ها")}">Aa</button><button data-action="roads" aria-pressed="${roads}" aria-label="${t("Toggle parent-child streets", "نمایش خیابان‌های والد و فرزند")}">${icon("link")}</button></div></div>
  <div class="city-legend"><span><i class="legend-building"></i>${t("Height & volume = RAM", "ارتفاع و حجم = RAM")}</span><span><i class="legend-lights"></i>${t("Lit windows = CPU", "پنجره‌های روشن = CPU")}</span><span><i class="legend-street"></i>${t("Streets = parent / child", "خیابان‌ها = والد / فرزند")}</span></div>
  <section class="sandbox" aria-label="${t("Demo scenarios", "سناریوهای دمو")}"><div><span class="sandbox-label">${t("THE SANDBOX", "محیط آزمایش")}</span><strong>${t("Make a little chaos.", "کمی آشوب بساز.")}</strong><small>${t("Synthetic scenarios. No actual CPU or RAM is allocated.", "سناریوی ساختگی؛ CPU یا RAM واقعی مصرف نمی‌شود.")}</small></div><div class="sandbox-actions"><button data-action="surge" ${mode === "live" ? "disabled" : ""} aria-pressed="${demo.surge}">${icon("cpu")}${t("CPU surge", "موج CPU")}</button><button data-action="leak" ${mode === "live" ? "disabled" : ""} aria-pressed="${demo.leak}">${icon("drop")}${t("Memory leak", "نشت حافظه")}</button><button data-action="recover" ${mode === "live" ? "disabled" : ""} aria-label="${t("Recover city", "بازیابی شهر")}">${icon("reset")}</button></div></section>
  </div><aside id="inspector" class="inspector" aria-label="${t("Process inspector", "جزئیات پردازش")}"></aside></section>
  <section class="process-section"><div class="process-heading"><div><h2>${t("Behind the skyline", "پشت خط آسمان")}</h2><p>${t("The full process list. The city shows up to 110 buildings.", "فهرست کامل پردازش‌ها؛ شهر تا ۱۱۰ ساختمان را نمایش می‌دهد.")}</p></div><div class="list-controls"><label class="search">${icon("search")}<input id="search" type="search" maxlength="80" placeholder="${t("Find a process or PID…", "نام پردازش یا PID…")}" aria-label="${t("Search processes", "جست‌وجوی پردازش‌ها")}" value="${esc(query)}"></label><select id="sort" aria-label="${t("Sort processes", "مرتب‌سازی پردازش‌ها")}"><option value="ram" ${sort === "ram" ? "selected" : ""}>${t("Memory ↓", "حافظه ↓")}</option><option value="cpu" ${sort === "cpu" ? "selected" : ""}>${t("CPU ↓", "CPU ↓")}</option><option value="name" ${sort === "name" ? "selected" : ""}>${t("Name A–Z", "نام A–Z")}</option></select></div></div><div id="filter-state"></div><div id="process-list" class="process-list"></div></section>
  <section class="event-section"><h2>${t("City dispatch", "رویدادهای شهر")}</h2><div id="events"></div></section><footer class="footer"><span>PROCESS CITY <span class="version">v1.0</span> · ${t("A different way to see your machine.", "نگاهی متفاوت به کامپیوترت.")}</span><span>${t("Read-only. No telemetry. No cloud process uploads.", "فقط‌خواندنی؛ بدون تله‌متری و ارسال پردازش‌ها به ابر.")}</span><button data-action="help" class="text-button">${t("Guide & export", "راهنما و خروجی")}</button></footer></main>
  <dialog id="help-dialog"><div class="dialog-heading"><h2>${t("A little map to your city.", "نقشه‌ای کوچک برای شهر تو.")}</h2><button data-action="close-help" aria-label="${t("Close help", "بستن راهنما")}">${icon("close")}</button></div><div class="help-content"><h3>${t("Read the skyline", "خواندن خط آسمان")}</h3><p>${t("Building volume represents working-set RAM on a logarithmic scale. CPU activity lights more windows. Streets follow parent process IDs observed in the same snapshot. The process list contains every collected process.", "حجم ساختمان با حافظهٔ مقیم پردازش در مقیاس لگاریتمی مرتبط است. فعالیت CPU پنجره‌های بیشتری را روشن می‌کند. خیابان‌ها از شناسهٔ والد در همان نمونه پیروی می‌کنند. فهرست، همهٔ پردازش‌های جمع‌آوری‌شده را نشان می‌دهد.")}</p><h3>${t("Why the city floods", "چرا شهر زیر آب می‌رود؟")}</h3><p>${t("Water indicates sustained growth in private memory: at least 16 MB and 15% growth over at least 12 seconds, with 70% of intervals increasing. This is a heuristic, not proof of a memory leak. The demo leak grows memory-lab.exe by 24 MB per update.", "آب نشانهٔ رشد پیوستهٔ حافظهٔ خصوصی است: حداقل ۱۶ مگابایت و ۱۵٪ رشد در دست‌کم ۱۲ ثانیه، با افزایش در ۷۰٪ فاصله‌های نمونه‌برداری. این یک تخمین است، نه اثبات نشت حافظه. سناریوی دمو در هر به‌روزرسانی ۲۴ مگابایت به memory-lab.exe می‌افزاید.")}</p><h3>${t("See your real Windows processes", "دیدن پردازش‌های واقعی ویندوز")}</h3><p>${t("Run this project locally with Node.js 22.18+ or 24+. Then open the loopback URL and select Live Windows. The hosted demo cannot read your computer.", "پروژه را با Node.js نسخهٔ ۲۲٫۱۸ به بالا یا ۲۴ به بالا روی ویندوز اجرا کنید. سپس نشانی محلی را باز و «ویندوز زنده» را انتخاب کنید. دموی آنلاین به پردازش‌های کامپیوتر شما دسترسی ندارد.")}</p><pre><code>npm ci\nnpm run build\nnpm start\n\nhttp://127.0.0.1:4317</code></pre><p>${t("If Windows blocks launching a child collector, use the documented two-terminal mode. Protected processes may expose no CPU counter. CPU percentages use total machine capacity; the first sample needs a second reading.", "اگر ویندوز اجرای جمع‌آورنده را محدود کرد، از روش دو ترمینال در راهنما استفاده کنید. شمارندهٔ CPU برخی پردازش‌های محافظت‌شده در دسترس نیست. درصد CPU از کل ظرفیت سیستم است و محاسبهٔ آن به دو نمونه نیاز دارد.")}</p><h3>${t("Keyboard & camera", "صفحه‌کلید و دوربین")}</h3><p>${t("Select processes from the list with Tab and Enter. Focus the canvas, then use arrows to pan, +/− to zoom and 0 to reset. Capture city downloads a PNG of the canvas. Snapshots are downloaded only when you choose Export snapshot.", "با Tab و Enter از فهرست پردازش انتخاب کنید. در بوم، کلیدهای جهت برای جابه‌جایی، مثبت و منفی برای بزرگ‌نمایی و صفر برای بازنشانی است. عکس شهر، تصویر PNG بوم را دریافت می‌کند. داده‌ها فقط با انتخاب خروجی نمونه دریافت می‌شوند.")}</p><button data-action="export-json">${icon("download")}${t("Export current snapshot", "دریافت نمونهٔ فعلی")}</button></div></dialog><div id="toast" role="status" class="toast" hidden></div>`;
  try {
    scene = new CityScene(
      document.querySelector<HTMLCanvasElement>("#city")!,
      theme(),
      (key) => {
        selected = key;
        renderPanels();
        if (innerWidth < 900)
          document.querySelector("#inspector")?.scrollIntoView({
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "instant"
              : "smooth",
            block: "nearest",
          });
      },
    );
  } catch (e) {
    notify(e instanceof Error ? e.message : "Canvas unavailable.");
  }
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
  return `<svg class="sparkline" viewBox="0 0 280 80" role="img" aria-label="${t("Private memory history, up to 60 seconds", "تاریخچهٔ حافظهٔ خصوصی تا ۶۰ ثانیه")}"><path d="M10 67H270M10 30H270" class="chart-grid"/><polyline points="${points}" class="chart-line"/></svg>`;
}
function inspectorMarkup(): string {
  const p = snapshot?.processes.find((p) => p.key === selected);
  if (!p)
    return `<div class="inspector-header">${icon("search")}<span>${t("PROCESS INSPECTOR", "جزئیات پردازش")}</span></div><div class="inspector-empty">${icon("city")}<h2>${t("Meet a building.", "با یک ساختمان آشنا شو.")}</h2><p>${t("Select any building or process in the list to follow its story.", "یک ساختمان یا پردازش از فهرست انتخاب کنید تا جزئیاتش را ببینید.")}</p></div>`;
  const parent = snapshot!.processes.find((v) => v.key === p.parentKey),
    children = snapshot!.processes.filter((v) => v.parentKey === p.key);
  return `<div class="inspector-header">${icon("cpu")}<span>${t("PROCESS INSPECTOR", "جزئیات پردازش")}</span><span class="inspector-live">${paused ? t("PAUSED", "متوقف") : t("TRACKING", "در حال رصد")}</span></div><div class="inspector-content"><div class="process-avatar">${icon("city")}</div><h2 dir="ltr">${esc(p.name)}</h2><div class="pid-line">PID <bdi>${p.pid}</bdi> <span>·</span> PPID <bdi>${p.ppid}</bdi></div><div class="inspector-metrics"><div><span>${t("CPU SHARE", "سهم CPU")}</span><strong>${percent(p.cpu)}</strong></div><div><span>${t("WORKING SET", "حافظهٔ مقیم")}</span><strong><bdi>${size(p.rssBytes)}</bdi></strong></div></div><div class="inspector-separator"></div><div class="history-heading"><h3>${t("Private memory", "حافظهٔ خصوصی")}</h3><span>${num(p.history.length)} ${t("samples", "نمونه")}</span></div><div class="history-value"><bdi>${size(p.privateBytes)}</bdi><span class="${p.growing ? "warning-text" : ""}">${p.growthMB >= 0 ? "+" : "−"}${num(Math.abs(p.growthMB), 1)} MB</span></div>${sparkline(p)}<div class="chart-axis"><span>${t("Earlier", "قبل‌تر")}</span><span>${t("Now", "اکنون")}</span></div>
  ${p.growing ? `<div class="growth-alert">${icon("drop")}<div><strong>${t("Sustained memory growth", "رشد پیوستهٔ حافظه")}</strong><p>+${num(p.growthRate, 1)} MB/min · ${t("Possible leak; inspect further.", "احتمال نشت؛ نیازمند بررسی بیشتر.")}</p></div></div>` : `<div class="stable-note"><span class="status-dot"></span>${t("No sustained growth signal", "نشانه‌ای از رشد پیوسته دیده نشد")}</div>`}
  <div class="inspector-separator"></div><h3 class="relationship-title">${icon("link")}${t("Connected streets", "خیابان‌های متصل")}</h3><div class="relation-label">${t("PARENT", "والد")}</div>${parent ? `<button class="relation" data-process="${esc(parent.key)}"><span dir="ltr">${esc(parent.name)}</span><span>${parent.pid}</span>${icon("arrow")}</button>` : `<p class="muted-note">${t("Parent is unavailable or has exited.", "والد در دسترس نیست یا پایان یافته است.")}</p>`}<div class="relation-label children-label">${t("CHILDREN", "فرزندان")} <span>${num(children.length)}</span></div>${children
    .slice(0, 6)
    .map(
      (child) =>
        `<button class="relation" data-process="${esc(child.key)}"><span dir="ltr">${esc(child.name)}</span><span>${child.pid}</span>${icon("arrow")}</button>`,
    )
    .join(
      "",
    )}${children.length > 6 ? `<button class="text-button" data-action="children">${t("Show all children in list", "نمایش همهٔ فرزندان در فهرست")}</button>` : ""}<div class="process-age">${t("Started", "زمان آغاز")}: ${p.createdAt ? esc(new Date(p.createdAt).toLocaleTimeString(fa ? "fa-IR" : "en-GB")) : t("Unavailable", "نامشخص")}</div></div>`;
}
function renderPanels(force = false): void {
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
  byId("source-badge").classList.toggle("live", mode === "live" && !stale);
  const banner = byId("connection-banner");
  banner.hidden = !connectionError;
  banner.textContent = connectionError;
  const values = filtered();
  byId("filter-state").innerHTML =
    filter === "growth" || parentFilter
      ? `<button class="filter-chip" data-action="clear-filter">${parentFilter ? t("Child processes only", "فقط پردازش‌های فرزند") : t("Growing memory only", "فقط رشد حافظه")}${icon("close")}</button>`
      : "";
  if (force || !document.activeElement?.closest("#process-list")) {
    byId("process-list").innerHTML = values.length
      ? `<table><thead><tr><th>${t("PROCESS", "پردازش")}</th><th>PID</th><th>CPU</th><th>${t("WORKING SET", "حافظهٔ مقیم")}</th><th>${t("PRIVATE", "خصوصی")}</th><th>${t("GROWTH", "رشد")}</th></tr></thead><tbody>${values.map((p) => `<tr class="${p.key === selected ? "selected" : ""}"><td><button data-process="${esc(p.key)}"><span class="process-dot ${p.growing ? "growing" : ""}"></span><span dir="ltr">${esc(p.name)}</span></button></td><td><bdi>${p.pid}</bdi></td><td>${percent(p.cpu)}</td><td><bdi>${size(p.rssBytes)}</bdi></td><td><bdi>${size(p.privateBytes)}</bdi></td><td class="${p.growing ? "warning-text" : ""}">${p.growing ? "↗ " + num(p.growthMB, 1) + " MB" : "—"}</td></tr>`).join("")}</tbody></table>`
      : `<div class="list-empty">${t("No matching processes. Try another name or clear the growth filter.", "پردازشی پیدا نشد. نام دیگری را جست‌وجو کنید یا فیلتر رشد را بردارید.")}</div>`;
  }
  if (force || !document.activeElement?.closest("#inspector"))
    byId("inspector").innerHTML = inspectorMarkup();
  byId("events").innerHTML = snapshot.events.length
    ? snapshot.events
        .slice(0, 8)
        .map(
          (e) =>
            `<div class="event"><span class="event-time">${new Date(e.time).toLocaleTimeString(fa ? "fa-IR" : "en-GB")}</span><span class="event-dot ${e.kind}"></span><span dir="ltr">${esc(e.name)}</span><span>${e.kind === "start" ? t("joined the city", "وارد شهر شد") : e.kind === "exit" ? t("left the city", "از شهر خارج شد") : t("shows growing private memory", "رشد حافظهٔ خصوصی دارد")}</span><span class="event-pid">PID ${e.pid}</span></div>`,
        )
        .join("")
    : `<p class="muted-note">${t("Watching for process starts, exits and memory growth…", "در انتظار آغاز، پایان یا رشد حافظهٔ پردازش‌ها…")}</p>`;
  scene?.set(snapshot, theme(), {
    labels,
    roads,
    paused: paused || stale,
    selected,
    filter:
      query || parentFilter || filter === "growth"
        ? new Set(values.map((p) => p.key))
        : null,
    locale: fa ? "fa" : "en",
    mode,
  });
}
function accept(raw: RawSnapshot): void {
  if (raw.capturedAt === lastTimestamp) return;
  lastTimestamp = raw.capturedAt;
  rawSnapshot = raw;
  snapshot = analyzer.update(raw);
  lastReceive = Date.now();
  if (!selected)
    selected =
      [...snapshot.processes].sort((a, b) => b.rssBytes - a.rssBytes)[0]?.key ??
      null;
  renderPanels();
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
    paused = false;
    analyzer = new CityAnalyzer();
    snapshot = null;
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
    selected = target.dataset.process;
    renderPanels(true);
    const row = Array.from(
      document.querySelectorAll<HTMLButtonElement>("#process-list button"),
    ).find((button) => button.dataset.process === selected);
    row?.focus({ preventScroll: true });
    return;
  }
  switch (target.dataset.action) {
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
      renderShell();
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
      if (mode === "demo") {
        demo.surge = !demo.surge;
        renderShell();
        void poll();
      }
      break;
    case "leak":
      if (mode === "demo") {
        demo.leak = !demo.leak;
        selected =
          snapshot?.processes.find((p) => p.pid === 7331)?.key ?? selected;
        renderShell();
        void poll();
      }
      break;
    case "recover":
      if (mode === "demo") {
        demo.recover();
        renderShell();
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
          download(await scene.image(), `process-city-${themeId}-${mode}.png`);
      } catch {
        notify(t("Could not capture the city.", "گرفتن تصویر شهر ممکن نشد."));
      }
      break;
    case "export-json":
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
  if (target.id === "sort") {
    sort = target.value as "ram" | "cpu" | "name";
    renderPanels();
  }
});
renderShell();
void poll();
setInterval(() => {
  void poll();
}, 2000);
