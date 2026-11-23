import { useWorkbenchContext } from "../hooks/WorkbenchContext";
export default function AnalysisEngine() {
  const c = useWorkbenchContext(),
    run = c.project.localAnalysis;
  const rows =
    run?.executions ??
    (c.localMode === "accompaniment" ? (c.engineState?.executions ?? []) : []);
  return (
    <div className="analysis-engine">
      <label>
        识别方式
        <select
          aria-label="识别方式"
          value={c.localMode === "accompaniment" ? "accompaniment" : "browser"}
          disabled={!!c.busy}
          onChange={(e) => c.setLocalMode(e.target.value)}
        >
          <option value="browser">快速基础识别 · 浏览器</option>
          {c.local && (
            <option value="accompaniment" disabled={!c.engineState?.ready}>
              本地伴奏增强（实验） ·{" "}
              {c.engineState?.device === "cuda"
                ? "CUDA"
                : c.engineState?.ready
                  ? "CPU"
                  : "检查中 / 未就绪"}
            </option>
          )}
        </select>
      </label>
      {c.localMode === "accompaniment" ? (
        <small>
          {c.engineState?.gpu ?? c.engineState?.message ?? "检查本地模型"}
        </small>
      ) : (
        <small>Basic Pitch · 浏览器 WASM；和弦使用独立秒时间轴。</small>
      )}
      {rows.map((r) => (
        <small key={r.name}>
          {r.name} · {r.provider} · {r.device.toUpperCase()}
        </small>
      ))}
      {c.local && c.engineState?.ready && !c.engineState?.promoted && (
        <small>
          增强模型仍有逐曲退化，尚未自动设为默认；可在上方明确选择并对照试听。
        </small>
      )}
      {run && (
        <small>
          {run.cacheHit ? "本次复用了分离缓存" : "本作品已保存分离分析结果"} ·
          改 BPM 无需重新分离
        </small>
      )}
      {run && (
        <div className="generation-actions">
          <button
            className="text-button"
            onClick={() => void c.playStem("accompaniment.wav")}
          >
            试听分离伴奏
          </button>
          <button
            className="text-button"
            onClick={() => void c.playStem("bass.wav")}
          >
            试听分离低音
          </button>
          <button className="text-button" onClick={c.stop}>
            停止分离试听
          </button>
        </div>
      )}
      {run && (
        <label>
          和声对照
          <select
            aria-label="和声对照"
            value={
              c.project.harmonyAnalysis?.method.endsWith("/original")
                ? "direct"
                : c.project.harmonyAnalysis?.method.startsWith("note-")
                  ? "notes"
                  : "separated"
            }
            disabled={!!c.busy}
            onChange={(e) =>
              void c.compareHarmony(
                e.target.value as "direct" | "separated" | "notes",
              )
            }
          >
            <option value="separated">分离伴奏 → 和弦网络</option>
            <option value="direct">原曲 → 同一和弦网络</option>
            <option value="notes">基础音符证据</option>
          </select>
        </label>
      )}
      {!!c.project.harmonyAnalysis && (
        <small>
          和声覆盖{" "}
          {Math.round(
            (100 *
              c.project.harmonyAnalysis.segments
                .filter((s) => s.root !== null)
                .reduce((sum, s) => sum + s.end - s.start, 0)) /
              c.project.duration,
          )}
          %（候选区间占比，非正确率） ·{" "}
          {
            c.project.harmonyAnalysis.segments.filter(
              (s) => s.status === "candidate",
            ).length
          }{" "}
          段待确认候选参与预览；无和声证据的区间保留休止。
        </small>
      )}
      {run?.warnings.map((w) => (
        <small key={w}>{w}</small>
      ))}
    </div>
  );
}
