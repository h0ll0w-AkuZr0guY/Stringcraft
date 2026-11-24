import { useEffect, useRef, useState } from "react";
import { useWorkbenchContext } from "../hooks/WorkbenchContext";
/** Recording association is project metadata, separate from track editing. */
export default function ReferenceSettings() {
  const c = useWorkbenchContext(),
    input = useRef<HTMLInputElement>(null);
  const [offset, setOffset] = useState(
    c.project.audioReference?.offsetSeconds ?? c.project.sourceOffset,
  );
  useEffect(
    () =>
      setOffset(
        c.project.audioReference?.offsetSeconds ?? c.project.sourceOffset,
      ),
    [
      c.project.id,
      c.project.audioReference?.offsetSeconds,
      c.project.sourceOffset,
    ],
  );
  return (
    <section className="panel reference-settings">
      <h3>参考录音</h3>
      <p className="muted">
        给导入的谱面关联录音，也可更换对照演奏；音符与人工修改会保留。
      </p>
      <div className="generation-actions">
        <button
          className="button secondary small"
          onClick={() => input.current?.click()}
        >
          关联录音文件
        </button>
        <button
          className="button secondary small"
          onClick={() => void c.play(true)}
        >
          {c.project.audioReference?.kind === "reference"
            ? "参考录音对照"
            : "原曲对照"}
        </button>
      </div>
      <input
        ref={input}
        data-testid="reference-audio-input"
        type="file"
        accept="audio/*,.flac"
        className="visually-hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void c.bindRecording(f, offset);
        }}
      />
      <label>
        录音对照起点（秒）
        <input
          type="number"
          aria-label="录音对照起点"
          min={0}
          step={0.1}
          value={offset}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (
              Number.isFinite(value) &&
              value >= 0 &&
              (!c.project.audioReference || c.updateReferenceOffset(value))
            )
              setOffset(value);
          }}
        />
      </label>
    </section>
  );
}
