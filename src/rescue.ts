export type RescuePhase = "idle" | "hunting" | "draining" | "won" | "lost";
/** Simulation clock: advances only for accepted demo samples, never wall-clock timers. */
export class RescueGame {
  phase: RescuePhase = "idle";
  culprit: string | null = null;
  elapsed = 0;
  mistakes = 0;
  water = 0;
  private last = 0;
  private drainAt = 0;
  start(key: string, at: number) {
    this.phase = "hunting";
    this.culprit = key;
    this.elapsed = 0;
    this.mistakes = 0;
    this.water = 0;
    this.last = at;
  }
  advance(at: number, memoryRecovered = true) {
    const seconds = Math.max(0, Math.min(2.5, (at - this.last) / 1000));
    this.last = at;
    if (this.phase === "hunting") {
      this.elapsed += seconds;
      this.water = Math.min(0.85, this.elapsed / 52);
      if (this.elapsed >= 45) this.phase = "lost";
    } else if (this.phase === "draining") {
      this.water = Math.max(0, this.water - seconds * 0.09);
      if (this.water === 0 && at - this.drainAt >= 6000 && memoryRecovered)
        this.phase = "won";
    }
  }
  contain(key: string | null, at: number): "wrong" | "correct" | "inactive" {
    if (this.phase !== "hunting") return "inactive";
    if (key !== this.culprit) {
      this.mistakes++;
      this.elapsed = Math.min(45, this.elapsed + 4);
      if (this.elapsed >= 45) this.phase = "lost";
      return "wrong";
    }
    this.phase = "draining";
    this.drainAt = at;
    return "correct";
  }
  reset() {
    this.phase = "idle";
    this.culprit = null;
    this.elapsed = 0;
    this.mistakes = 0;
    this.water = 0;
    this.last = 0;
  }
}
