import { useWorkbenchContext } from "../hooks/WorkbenchContext";
import { useTransport } from "../hooks/useTransport";
import { RhythmScore } from "./Tablature";
import { useEffect, useState } from "react";
import { load } from "../../packages/plugin-host";

export default function PianoScore({
  zoom,
  shown,
  paper = false,
}: {
  zoom: number;
  shown: boolean;
  paper?: boolean;
}) {
  const c = useWorkbenchContext();
  const time = useTransport(c.transport, shown).position,
    p = c.project.piano;
  const [tone, setTone] = useState("正在检查钢琴音色");
  useEffect(() => {
    if (!p) return;
    let active = true;
    const ctx = new OfflineAudioContext(1, 32, 24000);
    void load("piano-samples")
      .then(async (plugin) => {
        await plugin.prepareAudio?.(ctx, p.notes, "grand");
        if (active)
          setTone(
            plugin.hasSamples?.(p.notes)
              ? "实录钢琴 · Salamander"
              : "合成键盘 · 采样未齐",
          );
      })
      .catch(() => {
        if (active) setTone("合成键盘 · 采样未启用");
      });
    return () => {
      active = false;
    };
  }, [p]);
  if (!p)
    return (
      <div className="empty-panel">
        导入 MIDI、MusicXML 或清晰钢琴独奏，然后生成双手谱。
      </div>
    );
  return (
    <section className="panel score-panel piano-score">
      <div className="piano-score-tools">
        <button
          className="button secondary small"
          onClick={() => void c.exportPiano("musicxml")}
        >
          钢琴 MusicXML
        </button>
        <button
          className="button secondary small"
          onClick={() => void c.exportPiano("midi")}
        >
          钢琴 MIDI
        </button>
        <button
          className="button secondary small"
          onClick={() => void c.exportPiano("wav")}
        >
          钢琴 WAV
        </button>
        <span>{tone}</span>
        {!!p.performance.issues.length && (
          <span>{p.performance.issues.length} 个音需核对手别或指法</span>
        )}
      </div>
      <div className="notation-body" aria-label="钢琴大谱表">
        <RhythmScore
          piano
          paper={paper}
          project={c.project}
          time={time}
          zoom={zoom}
          onActivate={(notes, at) => c.activateNotes(notes, at)}
        />
      </div>
    </section>
  );
}
