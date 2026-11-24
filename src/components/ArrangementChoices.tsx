import type { Difficulty } from "../../packages/contracts";
import { useWorkbenchContext } from "../hooks/WorkbenchContext";

const difficultyLabels: Record<Difficulty, string> = {
  easy: "初学",
  normal: "日常",
  hard: "进阶",
  expert: "挑战",
};
const guidance = {
  accompaniment: [
    "稳定拍子，给换和弦留时间。",
    "常用指型和自然的扫弦或分解节奏。",
    "加入重音层次和更丰富的和弦指型。",
    "保留细致的节奏变化与和弦色彩。",
  ],
  fingerstyle: [
    "先弹清楚旋律和必要的低音。",
    "保留旋律与低音，减少频繁换把。",
    "加入可同时弹奏的内声和连奏。",
    "保留更完整的织体与独立声部。",
  ],
  melody: [
    "优先低把位，留出换弦和换把时间。",
    "保留主要旋律与常用指法。",
    "允许更灵活的把位和完整乐句。",
    "保留更多旋律细节和快速转换。",
  ],
};

export default function ArrangementChoices({
  compact = false,
}: {
  compact?: boolean;
}) {
  const c = useWorkbenchContext();
  const levels = Object.keys(difficultyLabels) as Difficulty[];
  return (
    <fieldset
      className={
        compact ? "arrangement-choices compact" : "arrangement-choices"
      }
      disabled={!!c.busy}
    >
      <label>
        编配目标
        <select
          aria-label="编配目标"
          value={c.goal}
          onChange={(e) => c.setGoal(e.target.value as typeof c.goal)}
        >
          <option value="accompaniment">弹唱伴奏</option>
          <option value="fingerstyle">独奏指弹</option>
          <option value="melody">单线练习</option>
        </select>
      </label>
      <div className="difficulty-buttons" role="group" aria-label="弹奏难度">
        {levels.map((difficulty) => (
          <button
            type="button"
            key={difficulty}
            aria-pressed={difficulty === c.difficulty}
            onClick={() => c.setDifficulty(difficulty)}
          >
            {difficultyLabels[difficulty]}
          </button>
        ))}
      </div>
      {!compact && c.goal === "accompaniment" && (
        <label>
          伴奏手法
          <select
            aria-label="伴奏手法"
            value={c.pattern}
            onChange={(e) => c.setPattern(e.target.value as typeof c.pattern)}
          >
            <option value="auto">按段落安排</option>
            <option value="strum">扫弦</option>
            <option value="arpeggio">分解和弦</option>
          </select>
        </label>
      )}
      <small aria-live="polite">
        {guidance[c.goal][levels.indexOf(c.difficulty)]}
      </small>
    </fieldset>
  );
}
