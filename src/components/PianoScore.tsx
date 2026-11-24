import { useWorkbenchContext } from "../hooks/WorkbenchContext";
import { useTransport } from "../hooks/useTransport";
import { RhythmScore } from "./Tablature";

export default function PianoScore({
  zoom,
  shown,
}: {
  zoom: number;
  shown: boolean;
}) {
  const c = useWorkbenchContext();
  const time = useTransport(c.transport, shown).position,
    p = c.project.piano;
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
        {!!p.performance.issues.length && (
          <span>{p.performance.issues.length} 个音需核对手别或指法</span>
        )}
      </div>
      <div className="notation-body" aria-label="钢琴大谱表">
        <RhythmScore
          piano
          project={c.project}
          time={time}
          zoom={zoom}
          onActivate={(notes, at) => c.activateNotes(notes, at)}
        />
      </div>
    </section>
  );
}
