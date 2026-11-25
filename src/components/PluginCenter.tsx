import { nativeHost } from "../edition";
import {
  localCapabilities,
  localPluginInbox,
  readLocalPlugin,
  type LocalEngineState,
} from "../../packages/music/local";
import { repairWorkbenchComponents } from "../../packages/music/maintenance";
import {
  ArrowUpRight,
  Gamepad2,
  Check,
  Download,
  Package,
  Puzzle,
  RotateCcw,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { PluginManifest } from "../../packages/contracts";
import {
  catalog,
  enable,
  install,
  installed,
  installSignedBrowserPackage,
  rollback,
  uninstall,
} from "../../packages/plugin-host";
export default function PluginCenter({
  notify,
}: {
  notify: (s: string) => void;
}) {
  const [practiceVersion, setPracticeVersion] = useState<string>();
  const [list, setList] = useState<PluginManifest[]>([]),
    [states, setStates] = useState<
      Record<
        string,
        {
          version: string;
          enabled: boolean;
          previous: boolean;
          code: boolean;
          sha256: string;
        }
      >
    >({}),
    [localEngine, setLocalEngine] = useState<LocalEngineState | null>(null),
    [busy, setBusy] = useState("");
  async function refresh() {
    const all = await catalog();
    const items = all.filter(
      (m) => m.audience === "user" && m.maturity !== "example",
    );
    setList(items);
    if (nativeHost())
      setPracticeVersion(
        (
          await (
            await import("../../packages/plugin-host/practice")
          ).privatePractice()
        )?.version,
      );
    setLocalEngine((await localCapabilities())?.engine ?? null);
    const pairs = await Promise.all(
      items.map(async (m) => {
        const p = await installed(m.id);
        return [
          m.id,
          p
            ? {
                version: p.manifest.version,
                sha256: p.manifest.sha256,
                enabled: p.enabled,
                previous: !!p.previous?.code,
                code: !!p.code,
              }
            : undefined,
        ] as const;
      }),
    );
    setStates(Object.fromEntries(pairs.filter((x) => x[1])) as typeof states);
  }
  useEffect(() => {
    refresh().catch((e) => notify(e.message));
  }, []);
  useEffect(() => {
    if (localEngine?.status !== "checking") return;
    const timer = setTimeout(() => {
      void localCapabilities().then((c) => setLocalEngine(c?.engine ?? null));
    }, 2000);
    return () => clearTimeout(timer);
  }, [localEngine?.status, localEngine]);
  async function act(id: string, fn: () => Promise<void>) {
    setBusy(id);
    try {
      await fn();
      await refresh();
      notify("插件状态已更新");
    } catch (e) {
      notify(e instanceof Error ? e.message : "插件操作失败");
    } finally {
      setBusy("");
    }
  }
  async function scanInbox() {
    const files = await localPluginInbox();
    if (!files.length) {
      notify("插件文件夹里没有可扫描的小型 ZIP。");
      return;
    }
    const results: string[] = [];
    for (const name of files) {
      try {
        const bytes = await readLocalPlugin(name);
        try {
          results.push((await installSignedBrowserPackage(bytes)).name);
        } catch {
          const { installPracticeZip } = await import(
            "../../packages/plugin-host/practice"
          );
          const info = await installPracticeZip(new File([bytes], name));
          results.push("键盘练习 " + info.version);
        }
      } catch {
        results.push(name + " 校验失败");
      }
    }
    await refresh();
    notify(results.join(" · "));
  }
  async function checkUpdates() {
    await refresh();
    if (!nativeHost()) return;
    const base = new URL(
      "https://h0ll0w-akuzr0guy.github.io/Stringcraft/plugins/",
    );
    const response = await fetch(new URL("updates.json", base), {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    if (!response?.ok) {
      notify("已检查随包目录。在线更新清单暂不可用。");
      return;
    }
    const items: unknown = await response.json();
    if (!Array.isArray(items) || items.length > 25)
      throw new Error("在线插件清单无效。");
    let applied = 0;
    for (const entry of items) {
      if (typeof entry !== "string" || !/^[a-z][a-z0-9.-]+\.zip$/.test(entry))
        continue;
      const pack = await fetch(new URL(entry, base), {
        signal: AbortSignal.timeout(12000),
      });
      if (!pack.ok) continue;
      await installSignedBrowserPackage(await pack.arrayBuffer());
      applied++;
    }
    await refresh();
    notify(
      applied ? `已检查并应用 ${applied} 个签名插件。` : "当前没有可用更新。",
    );
  }
  useEffect(() => {
    const host = nativeHost();
    if (!host) return;
    const received = (event: Event) => {
      const message = (event as MessageEvent).data;
      if (message === "runtime-changed")
        void refresh().catch((e) => notify(e.message));
    };
    host.addEventListener("message", received);
    return () => host.removeEventListener("message", received);
  }, []);
  return (
    <>
      <div className="section-title">
        <div>
          <p className="eyebrow">A WORKBENCH THAT GROWS WITH YOU</p>
          <h1>当前可使用的能力</h1>
          <p className="muted">
            这里仅展示可独立使用的功能包，内部依赖和开发示例不计入插件数量。
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => checkUpdates().catch((e) => notify(e.message))}
        >
          检查更新
        </button>
      </div>
      {nativeHost() && (
        <section className="plugin-notice" aria-label="本地扩展管理">
          <button
            className="button secondary"
            onClick={() => nativeHost()?.postMessage("open-plugins")}
          >
            打开插件文件夹
          </button>
          <button
            className="button secondary"
            disabled={!!busy}
            onClick={() => void scanInbox().catch((e) => notify(e.message))}
          >
            扫描本地包
          </button>
          <button
            className="button secondary"
            onClick={() => nativeHost()?.postMessage("import-cuda")}
          >
            导入 CUDA 离线包
          </button>
        </section>
      )}
      <div className="plugin-notice">
        <Puzzle size={21} />
        <p>
          “已启用”表示允许使用，不代表本次任务调用过。具体模型和设备请看工作台的分析记录。
        </p>
        <button
          className="button secondary"
          disabled={!!busy}
          onClick={() => act("components", repairWorkbenchComponents)}
        >
          修复工作台组件
        </button>
      </div>
      {nativeHost() && (
        <section className="plugin-notice practice-import">
          <Gamepad2 size={22} />
          <div>
            <strong>完整版键盘练习</strong>
            <p>
              {practiceVersion
                ? "已安装 · " + practiceVersion
                : "导入官方签名的练习插件 ZIP"}
            </p>
          </div>
          <label className="button secondary small">
            导入练习插件
            <input
              type="file"
              aria-label="导入练习插件"
              className="visually-hidden"
              accept=".zip"
              disabled={!!busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file)
                  void act("practice", async () => {
                    await (
                      await import("../../packages/plugin-host/practice")
                    ).installPracticeZip(file);
                  });
              }}
            />
          </label>
          {practiceVersion && (
            <>
              <button
                className="text-button"
                onClick={() =>
                  void act("practice", async () => {
                    await (
                      await import("../../packages/plugin-host/practice")
                    ).removePrivatePractice();
                  })
                }
              >
                卸载练习插件
              </button>
              <button
                className="text-button"
                onClick={() =>
                  void act("practice", async () => {
                    const { rollbackPractice } = await import(
                      "../../packages/plugin-host/practice"
                    );
                    await rollbackPractice();
                  })
                }
              >
                恢复上一版
              </button>
            </>
          )}
        </section>
      )}
      <div className="plugin-grid">
        {list.map((m) => {
          const p = states[m.id];
          return (
            <article className="plugin-card" key={m.id}>
              <div className="plugin-card-top">
                <span
                  className={`plugin-symbol ${m.runtime === "local" ? "gold" : ""}`}
                >
                  <Package size={25} />
                </span>
                <span className="tag">
                  {m.runtime === "browser" ? "浏览器" : "本地增强"}
                </span>
              </div>
              <h2>{m.name}</h2>
              <p>{m.description}</p>
              <div className="plugin-meta">
                <span>
                  v{m.version} ·{" "}
                  {m.maturity === "experimental" ? "实验功能" : "可用功能"}
                </span>
                <span>
                  {m.size
                    ? (m.size / 1024 / 1024).toFixed(2) + " MB"
                    : "独立环境包"}
                </span>
              </div>
              <div className="plugin-actions">
                {m.runtime === "local" ? (
                  <div className="local-engine-state">
                    <strong>
                      {localEngine?.ready
                        ? `模型就绪 · ${localEngine.device?.toUpperCase()}`
                        : (localEngine?.message ?? "完整本地环境未安装")}
                    </strong>
                    {localEngine?.executions?.map((e) => (
                      <small key={e.name} style={{ display: "block" }}>
                        {e.name} · {e.provider} · {e.device}
                      </small>
                    ))}
                    <small style={{ display: "block" }}>
                      从工作台的“识别方式”选择本地伴奏增强；当前为实验功能。
                    </small>
                  </div>
                ) : (
                  <>
                    <button
                      className={`button ${p?.enabled ? "secondary" : "primary"}`}
                      disabled={!!busy}
                      onClick={() =>
                        act(m.id, () =>
                          !p?.code ||
                          p.version !== m.version ||
                          p.sha256 !== m.sha256
                            ? install(m)
                            : enable(m.id, !p.enabled),
                        )
                      }
                    >
                      {busy === m.id ? (
                        "处理中…"
                      ) : !p?.code ? (
                        <>
                          <Download size={15} />
                          安装插件
                        </>
                      ) : p.version !== m.version || p.sha256 !== m.sha256 ? (
                        "更新插件"
                      ) : p.enabled ? (
                        <>
                          <Check size={15} />
                          已启用 · 停用
                        </>
                      ) : (
                        "启用插件"
                      )}
                    </button>
                    {p?.code && (
                      <button
                        className="text-button"
                        disabled={!!busy}
                        onClick={() => act(m.id, () => uninstall(m.id))}
                      >
                        卸载
                      </button>
                    )}
                    {p?.previous && (
                      <button
                        className="icon-button"
                        title="恢复上一个版本"
                        disabled={!!busy}
                        onClick={() => act(m.id, () => rollback(m.id))}
                      >
                        <RotateCcw size={16} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
