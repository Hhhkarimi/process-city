import type { CityProcess } from "./model.ts";
import { architectures, classify, districtRoot } from "./districts.ts";
export const hash = (value: string): number => {
  let n = 2166136261;
  for (let i = 0; i < value.length; i++)
    n = Math.imul(n ^ value.charCodeAt(i), 16777619);
  return n >>> 0;
};
export interface Plot {
  x: number;
  z: number;
}
export class CityLayout {
  readonly plots = new Map<string, Plot>();
  private retired = new Map<string, Plot>();
  sync(processes: CityProcess[], selected: string | null) {
    const priority = [...processes]
      .sort((a, b) => b.rssBytes - a.rssBytes)
      .slice(0, 110);
    const target = processes.find((p) => p.key === selected);
    if (target && !priority.some((p) => p.key === target.key))
      priority.splice(109, 1, target);
    const wanted = new Set(priority.map((p) => p.key));
    for (const [key, plot] of this.plots)
      if (!wanted.has(key)) {
        this.retired.set(key, plot);
        this.plots.delete(key);
      }
    while (this.retired.size > 400)
      this.retired.delete(this.retired.keys().next().value!);
    const occupied = new Set(
      [...this.plots.values()].map((p) => `${p.x}:${p.z}`),
    );
    for (const p of priority) {
      if (this.plots.has(p.key)) continue;
      const root = districtRoot(p, processes),
        zone = architectures[classify(root.name)].zone;
      const slots = Array.from({ length: 169 }, (_, i) => ({
        x: i % 13,
        z: Math.floor(i / 13),
      })).filter((s) => !(s.x >= 5 && s.x <= 7 && s.z >= 5 && s.z <= 7));
      slots.sort(
        (a, b) =>
          Math.hypot(a.x - zone[0], a.z - zone[1]) +
          (hash(root.key + a.x + ":" + a.z) % 100) / 200 -
          (Math.hypot(b.x - zone[0], b.z - zone[1]) +
            (hash(root.key + b.x + ":" + b.z) % 100) / 200),
      );
      const spot = slots.find((s) => !occupied.has(`${s.x}:${s.z}`));
      if (spot) {
        this.plots.set(p.key, spot);
        occupied.add(`${spot.x}:${spot.z}`);
      }
    }
  }
  historical(key: string): Plot | undefined {
    return this.plots.get(key) ?? this.retired.get(key);
  }
}
