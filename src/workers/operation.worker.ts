import type { MusicPlugin } from "../../packages/contracts";
self.onmessage = async (
  e: MessageEvent<{
    code: string;
    method:
      | "extractMelody"
      | "arrange"
      | "analyzeTiming"
      | "analyzeHarmony"
      | "recommendCapos";
    args: unknown[];
  }>,
) => {
  const url = URL.createObjectURL(
    new Blob([e.data.code], { type: "text/javascript" }),
  );
  try {
    const plugin = (await import(/* @vite-ignore */ url))
      .default as MusicPlugin;
    const method = plugin[e.data.method] as
      | ((...args: unknown[]) => unknown)
      | undefined;
    if (!method) throw new Error("插件不支持此能力");
    self.postMessage({ result: await method(...e.data.args) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "插件执行失败",
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};
