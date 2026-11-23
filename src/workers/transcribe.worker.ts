import type { MusicPlugin } from "../../packages/contracts";
self.onmessage = async (
  event: MessageEvent<{
    code: string;
    samples: Float32Array;
    modelUrl: string;
    wasmUrl: string;
    streaming?: boolean;
  }>,
) => {
  const url = URL.createObjectURL(
    new Blob([event.data.code], { type: "text/javascript" }),
  );
  try {
    const plugin = (await import(/* @vite-ignore */ url))
      .default as MusicPlugin;
    const notes = await plugin.transcribe!(
      event.data.samples,
      event.data.modelUrl,
      event.data.wasmUrl,
      (value) => self.postMessage({ type: "progress", value }),
      event.data.streaming
        ? (chunk) => self.postMessage({ type: "chunk", chunk })
        : undefined,
    );
    self.postMessage({ type: "result", notes });
  } catch (error) {
    console.error(error);
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "识别失败",
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};
