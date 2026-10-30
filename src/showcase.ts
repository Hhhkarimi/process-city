import { DemoWorld } from "./demo.ts";
import { CityAnalyzer } from "./metrics.ts";
import { CityTape } from "./tape.ts";
/** A clearly labeled, generated demo recording; never substituted for live metrics. */
export function makeShowcase(now = Date.now()): CityTape {
  const demo = new DemoWorld(),
    analyzer = new CityAnalyzer(),
    tape = new CityTape("demo");
  for (let i = 0; i <= 30; i++) {
    const at = now - 60000 + i * 2000;
    if (i === 4) demo.launch(at - 20);
    if (i === 8) demo.surge = true;
    if (i === 6) demo.startLeak();
    if (i === 22) demo.recover();
    tape.record(analyzer.update(demo.next(at)));
  }
  return tape;
}
