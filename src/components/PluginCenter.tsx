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
    [busy, setBusy] = useState("");
  async function refresh() {
    const items = await catalog();
    setList(items);
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
          <h1>给创作，更多可能。</h1>
          <p className="muted">
            乐器、算法与音源，各自生长。按需安装，独立更新。
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
          当前提供官方插件。安装记录保存在此浏览器中；本地计算插件在下载的应用中运行。
        </p>
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
                  v{m.version} · SDK {m.sdk}
                </span>
                <span>
                  {m.size
                    ? (m.size / 1024 / 1024).toFixed(2) + " MB"
                    : "独立环境包"}
                </span>
              </div>
              <div className="plugin-actions">
                {m.runtime === "local" ? (
                  <a
                    className="button secondary"
                    href="https://github.com/h0ll0w-AkuZr0guY/Stringcraft/releases"
                    target="_blank"
                    rel="noreferrer"
                  >
                    下载环境包 <ArrowUpRight size={15} />
                  </a>
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
