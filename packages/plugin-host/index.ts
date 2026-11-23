import { get, set } from "idb-keyval";
import {
  SDK_VERSION,
  type PluginManifest,
  type MusicPlugin,
  type InstrumentPluginV2,
  type NoteRefinerPlugin,
} from "../contracts";
type Installed = {
  manifest: PluginManifest;
  code: string;
  enabled: boolean;
  previous?: Omit<Installed, "previous">;
};
const live = new Map<string, MusicPlugin>();
const base = () => new URL(import.meta.env.BASE_URL, location.href);
export async function catalog(): Promise<PluginManifest[]> {
  const response = await fetch(new URL("plugins/catalog.json", base()), {
    cache: "no-cache",
  });
  if (!response.ok) throw new Error("插件目录暂时无法访问");
  const value = await response.json();
  if (!Array.isArray(value)) throw new Error("插件目录格式无效");
  return value;
}
export const installed = (id: string) => get<Installed>(`plugin:${id}`);
export async function install(
  manifest: PluginManifest,
  trail = new Set<string>(),
): Promise<void> {
  if (
    ![1, SDK_VERSION].includes(manifest.sdk) ||
    manifest.runtime !== "browser"
  )
    throw new Error("此插件需要本地环境或不兼容的 SDK");
  if (!/^[a-z][a-z0-9-]+$/.test(manifest.id) || trail.has(manifest.id))
    throw new Error("插件标识或依赖无效");
  const trusted = (await catalog()).find(
    (m) =>
      m.id === manifest.id &&
      m.version === manifest.version &&
      m.sha256 === manifest.sha256 &&
      m.entry === manifest.entry,
  );
  if (!trusted) throw new Error("仅支持当前官方目录中的插件");
  trail.add(manifest.id);
  for (const dep of manifest.dependencies) {
    const entry = (await catalog()).find((m) => m.id === dep);
    if (!entry) throw new Error("插件依赖不存在");
    const old = await installed(dep);
    if (!old || !old.enabled) await install(entry, new Set(trail));
  }
  const url = new URL(manifest.entry, base());
  if (
    url.origin !== location.origin ||
    !url.pathname.startsWith(base().pathname + "plugins/")
  )
    throw new Error("插件来源不受支持");
  const response = await fetch(url);
  if (!response.ok) throw new Error("插件下载失败");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== manifest.size)
    throw new Error("插件文件长度校验失败");
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  if (digest !== manifest.sha256) throw new Error("插件完整性校验失败");
  const old = await installed(manifest.id);
  await set(`plugin:${manifest.id}`, {
    manifest,
    code: new TextDecoder().decode(bytes),
    enabled: true,
    previous: old
      ? { manifest: old.manifest, code: old.code, enabled: old.enabled }
      : undefined,
  } satisfies Installed);
  live.delete(manifest.id);
}
export async function enable(id: string, on: boolean) {
  const p = await installed(id);
  if (!p) throw new Error("插件未安装");
  await set(`plugin:${id}`, { ...p, enabled: on });
  live.delete(id);
}
export async function uninstall(id: string) {
  const dependents = [];
  for (const m of await catalog()) {
    const p = await installed(m.id);
    if (p?.enabled && p.manifest.dependencies.includes(id))
      dependents.push(m.name);
  }
  if (dependents.length)
    throw new Error("请先停用依赖此插件的 " + dependents.join("、"));
  const p = await installed(id);
  if (p)
    await set(`plugin:${id}`, {
      ...p,
      enabled: false,
      code: "",
      previous: { manifest: p.manifest, code: p.code, enabled: true },
    });
  live.delete(id);
}
export async function rollback(id: string) {
  const p = await installed(id);
  if (!p?.previous?.code) throw new Error("没有可恢复版本");
  await set(`plugin:${id}`, {
    ...p.previous,
    previous: { manifest: p.manifest, code: p.code, enabled: p.enabled },
  });
  live.delete(id);
}
export async function load(id: string): Promise<MusicPlugin> {
  if (live.has(id)) return live.get(id)!;
  const p = await installed(id);
  if (!p?.enabled || !p.code) throw new Error(`请在插件中心安装并启用 ${id}`);
  for (const dep of p.manifest.dependencies) {
    const d = await installed(dep);
    if (!d?.enabled) throw new Error(`插件依赖 ${dep} 未启用`);
  }
  const url = URL.createObjectURL(
    new Blob([p.code], { type: "text/javascript" }),
  );
  try {
    const plugin = (await import(/* @vite-ignore */ url))
      .default as MusicPlugin;
    live.set(id, plugin);
    return plugin;
  } finally {
    URL.revokeObjectURL(url);
  }
}
/** Typed entry point for instrument-owned v2 options/actions, with no concrete instrument dependency. */
export async function loadInstrument<Options, Action, Notation>(
  id: string,
): Promise<InstrumentPluginV2<Options, Action, Notation>> {
  const plugin = (await load(id)) as unknown as InstrumentPluginV2<
    Options,
    Action,
    Notation
  >;
  if (
    !plugin.id ||
    ![
      plugin.arrangeScore,
      plugin.validatePerformance,
      plugin.soundEvents,
      plugin.notation,
    ].every((fn) => typeof fn === "function")
  )
    throw new Error("插件未提供完整的 SDK v2 乐器能力");
  return plugin;
}
export async function loadRefiner<Options>(
  id: string,
): Promise<NoteRefinerPlugin<Options>> {
  const plugin = (await load(id)) as unknown as NoteRefinerPlugin<Options>;
  if (typeof plugin.refineNotes !== "function")
    throw new Error("插件未提供候选清理能力");
  return plugin;
}
export async function bootstrap() {
  const list = await catalog();
  for (const id of [
    "piano-roll",
    "note-audio",
    "note-exporters",
    "melody-tracker",
    "guitar-standard",
    "standard-exporters",
    "guitar-samples",
    "harmony-analysis",
    "rhythm-analysis",
  ]) {
    const p = await installed(id);
    if (!p) await install(list.find((m) => m.id === id)!);
  }
  return list;
}

/** Pure musical computations run outside the UI; cancellation terminates the worker. */
export async function invoke<T>(
  id: string,
  method:
    | "extractMelody"
    | "arrange"
    | "analyzeTiming"
    | "analyzeHarmony"
    | "analyzeTimeline"
    | "recommendCapos",
  args: unknown[],
  signal?: AbortSignal,
): Promise<T> {
  await load(id);
  const p = await installed(id);
  signal?.throwIfAborted();
  const worker = new Worker(
    new URL("../../src/workers/operation.worker.ts", import.meta.url),
    { type: "module" },
  );
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.terminate();
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("已取消", "AbortError"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("计算超时，请缩短片段"));
    }, 120000);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (e) => {
      cleanup();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.result as T);
    };
    worker.onerror = (e) => {
      cleanup();
      reject(new Error(e.message));
    };
    worker.postMessage({ code: p!.code, method, args });
  });
}
