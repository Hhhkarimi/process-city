import type { CityProcess } from "./model.ts";

export const architectures = {
  browser: {
    en: "Browser residences",
    fa: "برج‌های مرورگر",
    color: "#69bbff",
    zone: [2, 2],
    shape: "terrace",
  },
  editor: {
    en: "Creative workshops",
    fa: "کارگاه‌های ویرایشگر",
    color: "#bf9bff",
    zone: [10, 2],
    shape: "workshop",
  },
  developer: {
    en: "Compute foundry",
    fa: "نیروگاه محاسبات",
    color: "#ffbf69",
    zone: [10, 6],
    shape: "plant",
  },
  creative: {
    en: "Design studios",
    fa: "استودیوهای طراحی",
    color: "#ff85b8",
    zone: [10, 10],
    shape: "studio",
  },
  media: {
    en: "Broadcast quarter",
    fa: "محلهٔ رسانه",
    color: "#83e5ad",
    zone: [2, 10],
    shape: "antenna",
  },
  system: {
    en: "City infrastructure",
    fa: "زیرساخت شهر",
    color: "#96a9bb",
    zone: [6, 10],
    shape: "utility",
  },
  other: {
    en: "Independent towers",
    fa: "برج‌های مستقل",
    color: "#70e5db",
    zone: [2, 6],
    shape: "tower",
  },
} as const;
export type Architecture = keyof typeof architectures;
export function classify(name: string): Architecture {
  if (/chrome|firefox|msedge|brave|opera|browser/i.test(name)) return "browser";
  if (/code|cursor|idea|devenv|notepad|sublime/i.test(name)) return "editor";
  if (
    /node|python|java|cargo|rustc|vite|esbuild|tsserver|worker|memory-lab|terminal|powershell|pwsh|cmd\.exe/i.test(
      name,
    )
  )
    return "developer";
  if (/figma|photoshop|blender|illustrator|paint|affinity/i.test(name))
    return "creative";
  if (/spotify|vlc|music|obs|discord|audacity/i.test(name)) return "media";
  if (
    /system|services|svchost|explorer|dwm|runtimebroker|audiodg|searchhost|wininit|winlogon|smss|csrss|lsass|registry|idle|conhost|security|defender/i.test(
      name,
    )
  )
    return "system";
  return "other";
}
/** Neighborhood ancestry uses observed, creation-time-checked parentKey values only. */
export function districtRoot(
  process: CityProcess,
  processes: readonly CityProcess[],
): CityProcess {
  const byKey = new Map(processes.map((p) => [p.key, p]));
  const seen = new Set([process.key]);
  let root = process;
  while (root.parentKey) {
    const parent = byKey.get(root.parentKey);
    if (!parent || seen.has(parent.key) || classify(parent.name) === "system")
      break;
    seen.add(parent.key);
    root = parent;
  }
  return root;
}
