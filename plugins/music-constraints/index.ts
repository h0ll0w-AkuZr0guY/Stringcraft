import {
  eventRole,
  type ArrangementGoal,
  type MusicalScore,
  type MusicAssessment,
  type MusicRuleCard,
} from "../../packages/contracts";

// Paraphrased, source-linked rules. Numeric thresholds below are engineering
// heuristics for these profiles, not claims made by the cited teachers.
export const rules: MusicRuleCard[] = [
  {
    id: "harmonic-rhythm",
    title: "和声节奏与功能",
    source: {
      title: "Music Theory for the 21st-Century Classroom",
      url: "https://musictheory.pugetsound.edu/mt21c/HarmonicRhythm.html",
      location: "Harmonic Rhythm",
    },
    scope: "流行伴奏；识别候选整理",
    strength: "soft",
    positive: "同一和声持续时容纳多次旋律活动。",
    negative: "每个短经过音都触发换和弦。",
    exceptions: "人工和弦、真实转调及属功能解决保留；没有固定和弦数量上限。",
    implementation:
      "arrangement-planner/harmony.ts 序列拟合；本规则检查短和声并给出复核位置。",
  },
  {
    id: "non-chord-tones",
    title: "经过音与辅助音",
    source: {
      title: "Music Theory for the 21st-Century Classroom",
      url: "https://musictheory.pugetsound.edu/mt21c/NonChordTonesIntroduction.html",
      location: "Introduction to Non-Chord Tones",
    },
    scope: "单声部流行旋律",
    strength: "soft",
    positive: "级进连接及离开后返回原音的弱拍装饰得到保留。",
    negative: "仅因持续时间短就删掉完整经过音型。",
    exceptions: "多声部、低激活候选、休止隔断和跨乐句不自动保护。",
    implementation:
      "本插件标记上下文支持的短音；编配规划实际采用 protectedIds。",
  },
  {
    id: "phrase-breath",
    title: "乐句与呼吸",
    source: {
      title: "Open Music Theory",
      url: "https://viva.pressbooks.pub/openmusictheory/",
      location: "Form / Phrases and Cadences",
    },
    scope: "旋律及段落编配",
    strength: "soft",
    positive: "乐句首尾及真实休止保留，持续音不会跨休止自动填满。",
    negative: "为连续而填掉呼吸，或把每四小节当成识别出的曲式。",
    exceptions: "四小节边界仅为默认编配建议；人工段落优先。",
    implementation:
      "保护乐句尾音、显式休止；planner 现有段落和动机约束共同使用。",
  },
  {
    id: "strum-motion",
    title: "扫弦的连续动作",
    source: {
      title: "JustinGuitar Strumming Patterns",
      url: "https://www.youtube.com/watch?v=CjM5fyXoV8w",
      location: "02:14 exercise; 07:19 manipulating patterns（章节说明）",
    },
    scope: "吉他常规八分流行扫弦；不推广为所有风格通则",
    strength: "hard",
    positive: "正拍下扫、反拍上扫；空挥保留运动网格。",
    negative: "每换和弦便重新从一次下扫启动节奏型。",
    exceptions: "复合拍与特殊扫弦有独立型；不从视频说明推断全部动作细节。",
    implementation:
      "guitar/patterns.ts 按小节定位；guitar 动作验证器负责可弹性。",
  },
  {
    id: "fingerstyle-voices",
    title: "指弹的旋律、低音和内声",
    source: {
      title: "Joe McMurray: Arranging for Fingerstyle Guitar, 2nd ed.",
      url: "https://joemcmurray.com/wp-content/uploads/2023/09/Arranging-for-Fingerstyle-Guitar-2nd-Ed-Watermark-2023.09.05.pdf",
      location:
        "公开 11 页试读及目录：melody and bass / inner harmony / arpeggiation",
    },
    scope: "流行吉他独奏指弹",
    strength: "soft",
    positive: "先保证旋律骨干与低音，内声服从持续声部和手型。",
    negative: "三个声部各自生成后简单叠加，或用提高密度表示难度。",
    exceptions: "无旋律的前奏可由器乐担任；未经确认不把低音冒充人声。",
    implementation:
      "tracks 选择人声旋律和器乐和声；guitar 声部优先级与持续占弦验证。",
  },
  {
    id: "articulation",
    title: "连音需要准备与解决",
    source: {
      title: "Music Theory for the 21st-Century Classroom",
      url: "https://musictheory.pugetsound.edu/mt21c/DurationalSymbols.html",
      location: "4 Basics of Rhythm；结合吉他物理约束",
    },
    scope: "吉他击勾弦、滑音及延音",
    strength: "hard",
    positive: "有明确前音、同弦可达和连续时间才建议左手连音；延音只发声一次。",
    negative: "把任意相邻音涂上线，或每个延音片段重新拨弦。",
    exceptions: "跨弦旋律可连贯但不能标成同弦击勾；人工标注仍通过动作验证。",
    implementation:
      "guitar 连音动作、performance 与共享音频调度校验；不自动捏造滑音。",
  },
];
export function assessMusic(
  score: MusicalScore,
  goal: ArrangementGoal,
): MusicAssessment {
  const lead = score.events
    .filter((e) => eventRole(e) === "melody" && e.midi !== null)
    .sort((a, b) => a.beat - b.beat);
  const protectedIds = new Set<string>(),
    findings: MusicAssessment["findings"] = [];
  const restBetween = (a: number, b: number) =>
    score.events.some(
      (e) => e.midi === null && e.beat < b && e.beat + e.durationBeats > a,
    );
  for (let i = 1; i + 1 < lead.length; i++) {
    const a = lead[i - 1],
      b = lead[i],
      c = lead[i + 1],
      ab = b.midi! - a.midi!,
      bc = c.midi! - b.midi!;
    const connected =
      b.beat - a.beat - a.durationBeats <= 0.12 &&
      c.beat - b.beat - b.durationBeats <= 0.12 &&
      a.beat + a.durationBeats <= b.beat + 0.02 &&
      b.beat + b.durationBeats <= c.beat + 0.02;
    const stepwise =
      Math.abs(ab) >= 1 &&
      Math.abs(ab) <= 2 &&
      Math.abs(bc) >= 1 &&
      Math.abs(bc) <= 2;
    if (
      connected &&
      stepwise &&
      (Math.sign(ab) === Math.sign(bc) || a.midi === c.midi) &&
      b.durationBeats <= 0.5 &&
      Math.abs(b.beat - Math.round(b.beat)) > 0.12 &&
      [a, b, c].every((e) => (e.activation ?? 1) >= 0.5) &&
      !restBetween(a.beat, c.beat)
    ) {
      protectedIds.add(b.id);
      findings.push({
        ruleId: "non-chord-tones",
        sourceIds: [a.id, b.id, c.id],
        reason: "保留上下文支持的弱拍级进装饰；不由这个短音单独建立和弦。",
      });
    }
  }
  for (let i = 0; i < lead.length; i++) {
    const e = lead[i],
      next = lead[i + 1];
    if (
      !next ||
      next.beat - e.beat - e.durationBeats >= 0.75 ||
      restBetween(e.beat + e.durationBeats, next.beat)
    )
      protectedIds.add(e.id);
  }
  const short = score.chords.filter(
    (c) =>
      c.durationBeats < 0.5 && c.origin !== "manual" && c.origin !== "imported",
  );
  if (short.length)
    findings.push({
      ruleId: "harmonic-rhythm",
      sourceIds: short.map((c) => c.id),
      reason:
        "短和声候选需结合持续旋律、低音和前后功能核对；不会按出现频率硬删。",
    });
  return {
    version: 1,
    profile:
      goal === "fingerstyle"
        ? "pop-fingerstyle"
        : goal === "melody"
          ? "melody-practice"
          : "pop-accompaniment",
    protectedIds: [...protectedIds],
    findings,
    rules,
  };
}
export default { assessMusic };
