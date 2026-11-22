import { installed, install, catalog } from "../plugin-host";
import type { NoteEvent } from "../contracts";
export async function decode(
  file: File,
  start: number,
  length: number,
  signal?: AbortSignal,
): Promise<{
  samples: Float32Array;
  buffer: AudioBuffer;
  duration: number;
  waveform: number[];
}> {
  if (file.size > 50 * 1024 * 1024)
    throw new Error("在线文件上限为 50 MB，请使用本地增强包");
  if (
    !Number.isFinite(start) ||
    start < 0 ||
    !Number.isFinite(length) ||
    length <= 0 ||
    length > 60
  )
    throw new Error("请选择 1–60 秒的分析片段");
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    signal?.throwIfAborted();
    if (start >= buffer.duration) throw new Error("片段起点超出音频时长");
    const duration = Math.min(length, buffer.duration - start),
      off = new OfflineAudioContext(1, Math.ceil(duration * 22050), 22050);
    const source = off.createBufferSource();
    source.buffer = buffer;
    source.connect(off.destination);
    source.start(0, start, duration);
    const rendered = await off.startRendering();
    signal?.throwIfAborted();
    const samples = rendered.getChannelData(0).slice();
    const waveform = Array.from({ length: 120 }, (_, i) => {
      const a = Math.floor((i * samples.length) / 120),
        b = Math.floor(((i + 1) * samples.length) / 120);
      let v = 0;
      for (let j = a; j < b; j++) v = Math.max(v, Math.abs(samples[j]));
      return v;
    });
    return { samples, buffer, duration, waveform };
  } finally {
    await ctx.close();
  }
}
export async function transcribe(
  samples: Float32Array,
  signal: AbortSignal,
  progress: (n: number) => void,
): Promise<NoteEvent[]> {
  let p = await installed("basic-pitch");
  if (!p) {
    const m = (await catalog()).find((x) => x.id === "basic-pitch")!;
    await install(m);
    p = await installed("basic-pitch");
  }
  if (!p?.enabled) throw new Error("请在插件中心启用 Basic Pitch");
  signal.throwIfAborted();
  const worker = new Worker(
    new URL("../../src/workers/transcribe.worker.ts", import.meta.url),
    { type: "module" },
  );
  const base = new URL(import.meta.env.BASE_URL, location.href);
  return new Promise((resolve, reject) => {
    const done = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
      clearTimeout(timeout);
    };
    const abort = () => {
      done();
      reject(new DOMException("已取消识别", "AbortError"));
    };
    const timeout = setTimeout(() => {
      done();
      reject(new Error("识别超过 5 分钟，请缩短片段或使用本地增强"));
    }, 300000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (e) => {
      if (e.data.type === "progress") progress(e.data.value);
      else if (e.data.type === "result") {
        done();
        resolve(e.data.notes);
      } else if (e.data.type === "error") {
        done();
        reject(new Error(e.data.message));
      }
    };
    worker.onerror = (e) => {
      done();
      reject(new Error(e.message || "浏览器识别环境不可用"));
    };
    worker.postMessage(
      {
        code: p!.code,
        samples,
        modelUrl: new URL("models/basic-pitch/model.json", base).href,
        wasmUrl: new URL("wasm/", base).href,
      },
      [samples.buffer],
    );
  });
}
