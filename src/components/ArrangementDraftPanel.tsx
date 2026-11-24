import { useState } from "react";
import { chordName } from "../../plugins/guitar/voicings";
import { useWorkbenchContext } from "../hooks/WorkbenchContext";

export default function ArrangementDraftPanel() {
  const c = useWorkbenchContext(),
    draft = c.project.arrangementDraft;
  const [view, setView] = useState("draft");
  if (!draft) return null;
  const chords =
    view === "draft" ? draft.score.chords : (c.project.score?.chords ?? []);
  return (
    <section className="musical-draft" data-testid="musical-draft">
      <strong>
        音乐化编配 · {draft.statistics.outputChordKinds} 种和弦 ·{" "}
        {draft.statistics.outputIntervals} 段
      </strong>
      <p>
        规划 {draft.statistics.anchors} 个旋律骨干音
        {draft.options.goal === "accompaniment"
          ? "；伴奏模式为演唱留白，不播放主旋律"
          : "，供独奏指法保留"}
        。 原始识别独立保存，乐句与段落为编配建议。
      </p>
      <div className="generation-actions">
        {(["melody", "bass", "harmony"] as const).map((role, i) => (
          <button
            key={role}
            className="button secondary small"
            disabled={!!c.busy || !c.notes.some((n) => n.role === role)}
            onClick={() => void c.playVoice(role)}
          >
            试听{["旋律", "低音", "伴奏"][i]}
          </button>
        ))}
        <button className="text-button" onClick={c.stop}>
          停止分声部试听
        </button>
      </div>
      <details>
        <summary>查看和声整理与编配依据</summary>
        <label>
          编配和声对照{" "}
          <select
            aria-label="编配和声对照"
            value={view}
            onChange={(e) => setView(e.target.value)}
          >
            <option value="draft">整理后的编配和声</option>
            <option value="source">原始候选和声</option>
          </select>
        </label>
        <p className="chord-sequence">
          {chords.slice(0, 80).map((chord) => (
            <span
              className="tag"
              key={chord.id}
              title={`第 ${chord.beat.toFixed(2)} 拍 · ${chord.durationBeats.toFixed(2)} 拍 · ${chord.origin}`}
            >
              {chordName(chord)}
              {chord.origin === "generated" ? " · 编配" : ""}
            </span>
          ))}
          {chords.length > 80 &&
            `另 ${chords.length - 80} 段，完整内容保存在项目中。`}
        </p>
        {draft.decisions.length ? (
          draft.decisions.slice(0, 12).map((d, i) => <p key={i}>{d.reason}</p>)
        ) : (
          <p>现有旋律与和声已经适合本次规划，保留原有结构。</p>
        )}
        {draft.assessment && (
          <details>
            <summary>音乐约束与来源 · {draft.assessment.profile}</summary>
            {draft.assessment.rules.map((r) => (
              <p key={r.id}>
                <strong>{r.title}</strong> ·{" "}
                {r.strength === "hard" ? "演奏约束" : "风格建议"}
                <br />
                {r.positive}
                <br />
                <small>{r.exceptions}</small>{" "}
                <a href={r.source.url} target="_blank" rel="noreferrer">
                  {r.source.title} · {r.source.location}
                </a>
              </p>
            ))}
          </details>
        )}
        <p>力度、织体与技法由吉他包实现；改编结果不计为原曲识别准确率。</p>
      </details>
    </section>
  );
}
