import { Pause, Play, SkipBack } from "lucide-react";
import { useWorkbenchContext } from "../hooks/WorkbenchContext";
import { useTransport } from "../hooks/useTransport";
export default function SharedTransport({
  professional,
}: {
  professional: boolean;
}) {
  const c = useWorkbenchContext(),
    p = useTransport(c.transport),
    active = c.tracks.find((t) => t.id === c.activeTrackId);
  const togglePlay = () => {
    if (c.transport.snapshot().status !== "paused") c.pause();
    else void c.playTracks();
  };
  return (
    <div className="workspace-transport" data-testid="shared-transport">
      <button
        className="play-button"
        aria-label={p.status !== "paused" ? "暂停播放" : "播放当前轨道"}
        onClick={togglePlay}
        disabled={!c.ready || !!c.busy}
      >
        {p.status !== "paused" ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <button className="icon-button" aria-label="回到开头" onClick={c.rewind}>
        <SkipBack size={17} />
      </button>
      <output role="timer" aria-live="off" data-testid="transport-position">
        {p.position.toFixed(1)} / {c.project.duration.toFixed(1)} 秒
      </output>
      <input
        type="range"
        aria-label="播放位置"
        min={0}
        max={c.project.duration}
        step={0.01}
        value={p.position}
        onChange={(e) => c.seek(Number(e.target.value))}
      />
      <select
        aria-label="统一播放速度"
        value={c.speed}
        onChange={(e) => c.setSpeed(Number(e.target.value))}
      >
        {[0.5, 0.75, 1, 1.25, 1.5].map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      <select
        aria-label="播放监听方式"
        value={c.monitorMode}
        onChange={(e) =>
          c.setMonitorMode(e.target.value as typeof c.monitorMode)
        }
      >
        <option value="audio">轨道音频</option>
        <option value="notes">当前轨音符</option>
        {(professional || c.monitorMode === "mix") && (
          <option value="mix">多轨混合</option>
        )}
      </select>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={c.loop}
          onChange={(e) => c.setLoop(e.target.checked)}
        />
        循环
      </label>
      {professional && c.loop && (
        <>
          <input
            aria-label="循环 A 秒"
            type="number"
            min={0}
            max={c.project.duration}
            step={0.1}
            value={c.loopStart}
            onChange={(e) => c.setLoopStart(Number(e.target.value))}
          />
          <input
            aria-label="循环 B 秒"
            type="number"
            min={0}
            max={c.project.duration}
            step={0.1}
            value={c.loopEnd}
            onChange={(e) => c.setLoopEnd(Number(e.target.value))}
          />
        </>
      )}
      <span className="transport-status">
        {p.status === "loading"
          ? "加载声音…"
          : p.status === "playing"
            ? "正在播放"
            : active?.name}
      </span>
    </div>
  );
}
