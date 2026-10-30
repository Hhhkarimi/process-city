import { CityScene } from "./city.ts";
import type { Theme } from "./model.ts";
import { CityTape } from "./tape.ts";

export function videoMime(): string | null {
  if (
    typeof MediaRecorder === "undefined" ||
    !HTMLCanvasElement.prototype.captureStream
  )
    return null;
  return (
    [
      "video/mp4;codecs=avc1.424028",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ].find((type) => MediaRecorder.isTypeSupported(type)) ?? null
  );
}
export async function renderClip(
  tape: CityTape,
  theme: Theme,
  locale: "en" | "fa",
  portrait: boolean,
  signal: AbortSignal,
  progress: (n: number) => void,
): Promise<{ blob: Blob; extension: string }> {
  const mime = videoMime();
  if (!mime)
    throw new Error(
      locale === "fa"
        ? "این مرورگر ضبط ویدئو از بوم را پشتیبانی نمی‌کند."
        : "This browser cannot record canvas video.",
    );
  const end = tape.frames.at(-1)?.at;
  if (!end || tape.frames.length < 2)
    throw new Error(
      locale === "fa"
        ? "حداقل دو نمونه برای کلیپ لازم است."
        : "Record at least two samples first.",
    );
  const frames = tape.frames.filter((f) => f.at >= end - 60000);
  if (frames.length < 2) throw new Error("Not enough recent samples.");
  const canvas = document.createElement("canvas");
  const width = portrait ? 720 : 1280,
    height = portrait ? 960 : 800;
  const scene = new CityScene(canvas, theme, () => {}, { width, height });
  const context = canvas.getContext("2d")!;
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: 4500000,
  });
  const chunks: Blob[] = [];
  let byteLength = 0,
    failure: Error | null = null;
  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size) {
        chunks.push(event.data);
        byteLength += event.data.size;
      }
      if (byteLength > 40 * 1024 * 1024) {
        failure = new Error("Video exceeds 40 MB.");
        if (recorder.state !== "inactive") recorder.stop();
      }
    };
    recorder.onerror = () => {
      failure = new Error("Video encoder failed.");
    };
    recorder.onstop = () =>
      failure
        ? reject(failure)
        : resolve(new Blob(chunks, { type: recorder.mimeType }));
  });
  // Attach a rejection handler immediately, including encoder failures during rendering.
  void finished.catch(() => {});
  const abort = () => {
    failure = new DOMException("Cancelled", "AbortError");
    if (recorder.state !== "inactive") recorder.stop();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    recorder.start(250);
    const started = performance.now(),
      duration = 12000,
      first = frames[0].at;
    let index = 0,
      rendered = -1;
    while (performance.now() - started < duration) {
      if (signal.aborted || failure)
        throw failure ?? new DOMException("Cancelled", "AbortError");
      const elapsed = performance.now() - started;
      const fraction =
          elapsed >= duration - 75 ? 1 : Math.min(1, elapsed / duration),
        at = first + (end - first) * fraction;
      while (index + 1 < frames.length && frames[index + 1].at <= at) index++;
      const frame = frames[index];
      scene.restore({
        zoom: 1 + Math.sin(fraction * Math.PI) * 0.12,
        x: 0,
        y: 0,
      });
      if (rendered !== index) {
        scene.set(frame, theme, {
          labels: false,
          roads: true,
          paused: true,
          selected: null,
          filter: null,
          locale,
          mode: tape.source,
        });
        rendered = index;
      }
      scene.renderAt(performance.now());
      context.fillStyle = "#080e19ed";
      context.fillRect(0, 0, width, 55);
      context.fillRect(0, height - 72, width, 72);
      context.fillStyle = theme.accent;
      context.font = "bold 20px Vazirmatn, sans-serif";
      context.textAlign = "left";
      context.fillText("PROCESS CITY  /  TIME LAPSE", 24, 35);
      context.font = "14px Vazirmatn, sans-serif";
      context.fillStyle = "#d7e5ef";
      context.fillText(
        `${tape.source === "demo" ? "SIMULATED DATA" : "LOCAL PROCESS RECORDING"}  ·  ${new Date(frame.at).toLocaleString("en-GB")}`,
        24,
        height - 43,
      );
      context.fillText(
        `CPU ${frame.cpu?.toFixed(1) ?? "—"}%   /   RAM ${(frame.ramUsed / 1073741824).toFixed(1)} GB   /   ${frame.processes.length} processes`,
        24,
        height - 19,
      );
      context.fillStyle = theme.accent;
      context.fillRect(0, height - 3, width * fraction, 3);
      progress(fraction);
      await new Promise((resolve) => setTimeout(resolve, 33));
    }
    if (recorder.state !== "inactive") recorder.stop();
    const blob = await finished;
    progress(1);
    return { blob, extension: blob.type.includes("mp4") ? "mp4" : "webm" };
  } finally {
    signal.removeEventListener("abort", abort);
    if (recorder.state !== "inactive") recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    scene.destroy();
  }
}
