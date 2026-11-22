import {
  soundingEvents,
  validateScore,
  type MusicalScore,
  type ScoreEvent,
  type ChordSymbol,
} from "../contracts";
const pitchClass: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
const number = (parent: Element, selector: string, fallback: number) =>
  Number(parent.querySelector(selector)?.textContent ?? fallback);
/** Partwise reader with explicit voice cursors, rests, ties, slurs and tempo/meter maps. */
export function readMusicXML(text: string): MusicalScore {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.tagName !== "score-partwise"
  )
    throw new Error("仅支持未压缩的 score-partwise MusicXML");
  const score: MusicalScore = {
    version: 2,
    durationBeats: 0,
    tempo: [],
    meter: [],
    beatOffsetSeconds: 0,
    timing: "imported",
    events: [],
    chords: [],
    sections: [],
    warnings: [],
  };
  let id = 0;
  for (const [partIndex, part] of [
    ...doc.querySelectorAll("score-partwise > part"),
  ].entries()) {
    let barStart = 0,
      divisions = 1,
      beatsPerBar = 4;
    const ties = new Map<string, string>(),
      slurs = new Map<string, string>();
    for (const measure of part.querySelectorAll(":scope > measure")) {
      let cursor = barStart,
        previous = cursor,
        maximum = cursor;
      for (const child of measure.children) {
        if (child.tagName === "attributes") {
          divisions = number(child, "divisions", divisions);
          if (!Number.isFinite(divisions) || divisions <= 0)
            throw new Error("MusicXML divisions 无效");
          const time = child.querySelector("time");
          if (time) {
            const numerator = number(time, "beats", 4),
              denominator = number(time, "beat-type", 4);
            beatsPerBar = (numerator * 4) / denominator;
            if (partIndex === 0)
              score.meter.push({ beat: cursor, numerator, denominator });
          }
          continue;
        }
        const duration = number(child, ":scope > duration", 0) / divisions;
        if (child.tagName === "backup") {
          cursor -= duration;
          continue;
        }
        if (child.tagName === "forward") {
          cursor += duration;
          maximum = Math.max(maximum, cursor);
          continue;
        }
        if (partIndex === 0) {
          for (const sound of child.tagName === "sound"
            ? [child]
            : [...child.querySelectorAll("sound[tempo]")]) {
            const bpm = Number(sound.getAttribute("tempo"));
            if (Number.isFinite(bpm) && bpm >= 20 && bpm <= 300)
              score.tempo.push({
                beat: cursor + number(child, "offset", 0) / divisions,
                bpm,
              });
          }
          if (child.tagName === "harmony") {
            const root =
              (pitchClass[
                child.querySelector("root-step")?.textContent ?? "C"
              ] +
                number(child, "root-alter", 0) +
                12) %
              12;
            const kind = child.querySelector("kind")?.textContent ?? "major";
            const quality = (
              {
                major: "major",
                minor: "minor",
                dominant: "7",
                "major-seventh": "maj7",
                "minor-seventh": "m7",
                "suspended-fourth": "sus4",
              } as Record<string, ChordSymbol["quality"]>
            )[kind];
            if (quality)
              score.chords.push({
                id: `xml-chord-${id++}`,
                beat: cursor + number(child, "offset", 0) / divisions,
                durationBeats: beatsPerBar,
                root,
                quality,
                origin: "imported",
              });
            else score.warnings.push(`未支持的和弦性质：${kind}，请人工校正。`);
          }
        }
        if (child.tagName !== "note") continue;
        if (child.querySelector("grace")) {
          score.warnings.push("装饰音保留为待核对项，尚未转为有时值事件。");
          continue;
        }
        if (duration <= 0) continue;
        const beat = child.querySelector("chord") ? previous : cursor;
        const voice = `part-${partIndex}/staff-${number(child, "staff", 1)}/voice-${child.querySelector("voice")?.textContent ?? "1"}`;
        const pitch = child.querySelector("pitch");
        const midi = pitch
          ? (number(pitch, "octave", 4) + 1) * 12 +
            pitchClass[pitch.querySelector("step")?.textContent ?? "C"] +
            number(pitch, "alter", 0)
          : null;
        const event: ScoreEvent = {
          id: `xml-event-${id++}`,
          beat,
          durationBeats: duration,
          voice,
          midi,
          velocity: 0.7,
          sourceIds: [],
          role:
            partIndex === 0 &&
            number(child, "staff", 1) === 1 &&
            (child.querySelector("voice")?.textContent ?? "1") === "1"
              ? "melody"
              : "harmony",
        };
        const key = `${voice}/${midi}`;
        const tieStops = !!child.querySelector(
          'tie[type="stop"], tied[type="stop"]',
        );
        const tieStarts = !!child.querySelector(
          'tie[type="start"], tied[type="start"]',
        );
        if (tieStops) {
          event.tieFrom = ties.get(key);
          if (!event.tieFrom) throw new Error("延音线缺少起点");
          ties.delete(key);
        }
        if (tieStarts) ties.set(key, event.id);
        for (const link of child.querySelectorAll(
          "slur, hammer-on, pull-off",
        )) {
          const slurKey = `${voice}/${link.tagName}/${link.getAttribute("number") ?? "1"}`;
          if (link.getAttribute("type") === "stop") {
            event.slurFrom = slurs.get(slurKey);
            slurs.delete(slurKey);
          }
          if (link.getAttribute("type") === "start")
            slurs.set(slurKey, event.id);
        }
        score.events.push(event);
        maximum = Math.max(maximum, beat + duration);
        if (!child.querySelector("chord")) {
          previous = cursor;
          cursor += duration;
        }
      }
      barStart =
        measure.getAttribute("implicit") === "yes"
          ? maximum
          : Math.max(barStart + beatsPerBar, maximum);
      score.durationBeats = Math.max(score.durationBeats, barStart);
    }
    if (ties.size)
      score.warnings.push("存在未闭合的延音线，请核对文件是否仅包含选段。");
  }
  const unique = <T extends { beat: number }>(items: T[]) => [
    ...new Map(
      items.sort((a, b) => a.beat - b.beat).map((p) => [p.beat, p]),
    ).values(),
  ];
  score.tempo = unique(score.tempo);
  score.meter = unique(score.meter);
  if (!score.tempo.length || score.tempo[0].beat !== 0) {
    score.tempo.unshift({ beat: 0, bpm: 120 });
    score.warnings.push("文件缺少初始速度，使用 120 BPM 显示，请核对。");
  }
  if (!score.meter.length || score.meter[0].beat !== 0) {
    score.meter.unshift({ beat: 0, numerator: 4, denominator: 4 });
    score.warnings.push("文件缺少初始拍号，使用 4/4 网格，请核对。");
  }
  score.chords
    .sort((a, b) => a.beat - b.beat)
    .forEach(
      (c, i, all) =>
        (c.durationBeats = (all[i + 1]?.beat ?? score.durationBeats) - c.beat),
    );
  score.durationBeats = Math.max(0.25, score.durationBeats);
  validateScore(score);
  soundingEvents(score);
  return score;
}
