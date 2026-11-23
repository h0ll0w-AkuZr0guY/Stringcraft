import { useEffect, useRef, useState } from "react";
import { LoaderCircle, CheckCircle2, AlertCircle } from "lucide-react";
import { useWorkbenchContext } from "../hooks/WorkbenchContext";

export default function GenerationFeedback({
  result = false,
}: {
  result?: boolean;
}) {
  const c = useWorkbenchContext(),
    task = c.generation;
  const [now, setNow] = useState(Date.now());
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (task?.status !== "running") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [task?.id, task?.status]);
  useEffect(() => {
    if (!result || !task || task.status === "running") return;
    target.current?.scrollIntoView({ block: "start", behavior: "instant" });
    target.current?.focus({ preventScroll: true });
  }, [result, task?.id, task?.status]);
  if (!task) return null;
  const running = task.status === "running";
  const elapsed = Math.max(
    0,
    Math.floor(((task.endedAt ?? now) - task.startedAt) / 1000),
  );
  const showStructure = () => {
    c.setAdvanced(true);
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLDetailsElement>(".structure-panel");
      if (el) {
        el.open = true;
        el.scrollIntoView({ block: "start" });
      }
    });
  };
  return (
    <div
      ref={target}
      id={result ? "generation-result" : undefined}
      tabIndex={-1}
      className={`generation-feedback ${task.status}`}
      data-status={task.status}
      data-phase={task.phase}
      data-testid={result ? "generation-result" : "generation-feedback"}
    >
      <div
        className="generation-message"
        role={result ? undefined : "group"}
        aria-live={result ? "off" : "polite"}
      >
        {running ? (
          <LoaderCircle size={18} className="spin" />
        ) : task.status === "success" ? (
          <CheckCircle2 size={18} />
        ) : (
          <AlertCircle size={18} />
        )}
        <strong>{task.message}</strong>
      </div>
      <small>
        {running ? `当前阶段：${task.phase} · ` : ""}已用 {elapsed} 秒
        {running && elapsed >= 10 ? "，仍在处理中，可随时取消。" : ""}
      </small>
      <div className="generation-actions">
        {running && (
          <button
            className="button secondary small"
            onClick={() => c.abortRef.current?.abort()}
          >
            取消生成
          </button>
        )}
        {task.status === "success" &&
          (result ? (
            <button
              className="button primary small"
              onClick={() => (c.playing ? c.stop() : void c.play())}
            >
              {c.playing ? "停止结果试听" : "播放结果"}
            </button>
          ) : (
            <button
              className="text-button"
              onClick={() =>
                document
                  .getElementById("guitar-notation")
                  ?.scrollIntoView({ block: "start" })
              }
            >
              查看谱面
            </button>
          ))}
        {!running && task.status !== "success" && (
          <>
            {task.message.includes("没有找到可用和弦") &&
              c.goal === "accompaniment" && (
                <button
                  className="button secondary small"
                  onClick={() => {
                    c.setGoal("melody");
                    c.notify("已选择单线旋律练习，请点击生成吉他编配。");
                  }}
                >
                  改用单线旋律练习
                </button>
              )}
            {task.recovery === "plugins" ? (
              <button
                disabled={!!c.busy}
                className="button secondary small"
                onClick={() => void c.repairGeneration()}
              >
                修复所需插件
              </button>
            ) : task.recovery === "structure" ? (
              <button
                className="button secondary small"
                onClick={showStructure}
              >
                检查和弦与高级设置
              </button>
            ) : task.recovery === "upgrade" ? (
              <button
                disabled={!!c.busy}
                className="button secondary small"
                onClick={() => void c.upgrade()}
              >
                创建 v2 副本
              </button>
            ) : (
              <button
                disabled={!!c.busy}
                className="button secondary small"
                onClick={() => void c.generate()}
              >
                重新生成
              </button>
            )}
            {result && (
              <button
                className="text-button"
                onClick={() => {
                  const diagnostic = {
                    version: __APP_VERSION__,
                    build: __BUILD_SHA__,
                    phase: task.phase,
                    status: task.status,
                    message: task.message,
                    durationSeconds: elapsed,
                    settings: {
                      difficulty: c.difficulty,
                      goal: c.goal,
                      pattern: c.pattern,
                      capo: c.capo,
                      autoCapo: c.autoCapo,
                      transpose: c.transpose,
                      bpm: c.project.bpm,
                    },
                    pluginVersions: c.project.pluginVersions,
                    plugins: task.problems,
                  };
                  const blob = new Blob([JSON.stringify(diagnostic, null, 2)], {
                    type: "application/json",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "Stringcraft-diagnostic.json";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                导出诊断信息
              </button>
            )}
          </>
        )}
      </div>
      {!!task.problems?.length && (
        <ul>
          {task.problems.map((p) => (
            <li key={p.id}>
              {p.name}：
              {p.reason === "disabled"
                ? "已停用；点击修复会重新启用"
                : p.reason === "missing"
                  ? "未安装"
                  : "需要更新"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
