/** Native file reads/decoding cannot be interrupted reliably; abort discards late results. */
function abortable<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new DOMException("已取消", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    task().then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
export async function readAudioFile(
  file: File,
  maxMegabytes = 50,
  signal?: AbortSignal,
): Promise<{ buffer: AudioBuffer; sha256: string }> {
  if (!Number.isFinite(maxMegabytes) || maxMegabytes <= 0 || maxMegabytes > 200)
    throw new Error("录音文件限制无效");
  if (file.size > maxMegabytes * 1024 * 1024)
    throw new Error(`录音文件上限为 ${maxMegabytes} MB`);
  const control = new AbortController(),
    forward = () => control.abort(signal?.reason),
    timeout = setTimeout(
      () =>
        control.abort(
          new DOMException(
            "录音解码超时，请缩短文件或转换格式",
            "TimeoutError",
          ),
        ),
      60000,
    );
  if (signal?.aborted) forward();
  else signal?.addEventListener("abort", forward, { once: true });
  let ctx: AudioContext | undefined;
  try {
    const bytes = await abortable(() => file.arrayBuffer(), control.signal);
    // Finish hashing before decodeAudioData can detach the input buffer.
    const hash = await abortable(
      () => crypto.subtle.digest("SHA-256", bytes),
      control.signal,
    );
    const sha256 = Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    ctx = new AudioContext();
    let buffer: AudioBuffer;
    try {
      buffer = await abortable(
        () => ctx!.decodeAudioData(bytes),
        control.signal,
      );
    } catch (error) {
      if (control.signal.aborted) throw error;
      throw new Error("无法解码录音，请检查音频格式或转换为 WAV。");
    }
    return { buffer, sha256 };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", forward);
    await ctx?.close().catch(() => {});
  }
}
export function referenceWaveform(
  buffer: AudioBuffer,
  offset: number,
  duration: number,
): number[] {
  const samples = buffer.getChannelData(0),
    from = Math.floor(offset * buffer.sampleRate),
    length = Math.min(
      samples.length - from,
      Math.ceil(duration * buffer.sampleRate),
    );
  return Array.from({ length: 120 }, (_, i) => {
    const a = from + Math.floor((i * length) / 120),
      b = from + Math.floor(((i + 1) * length) / 120),
      step = Math.max(1, Math.floor((b - a) / 100));
    let peak = 0;
    for (let index = a; index < b; index += step)
      peak = Math.max(peak, Math.abs(samples[index]));
    return peak;
  });
}
