import {
  localCapabilities,
  type LocalEngineState,
} from "../../packages/music/local";
import { repairWorkbenchComponents } from "../../packages/music/maintenance";
import {
  ArrowUpRight,
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
  rollback,
  uninstall,
} from "../../packages/plugin-host";
export default function PluginCenter({
  notify,
}: {
  notify: (s: string) => void;
}) {
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
          onClick={() => refresh().catch((e) => notify(e.message))}
        >
          检查更新
        </button>
      </div>
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
