import {
  beatToSeconds,
  eventRole,
  secondsToBeat,
  validateScore,
  type ArrangementDraft,
  type ArrangementPhrase,
  type ArrangementPlanningContext,
  type ArrangementPlanningOptions,
  type ScoreEvent,
} from "../../packages/contracts";
import { measureGrid } from "../../packages/music/structure";
import { assessMusic } from "../music-constraints";
import { chordKinds, organizeHarmony } from "./harmony";

function melodyScore(context: ArrangementPlanningContext) {
  const score = structuredClone(context.score);
  // A hand-corrected tie fragment protects its entire sustain chain.
  const protectedChain = new Set(
    score.events
      .filter(
        (e) =>
          e.origin === "manual" ||
          e.origin === "imported" ||
          e.roleOrigin === "manual" ||
          e.roleOrigin === "imported",
      )
      .map((e) => e.id),
  );
  for (let changed = true; changed; ) {
    changed = false;
    for (const e of score.events)
      if (
        e.tieFrom &&
        (protectedChain.has(e.id) || protectedChain.has(e.tieFrom))
      ) {
        if (!protectedChain.has(e.id) || !protectedChain.has(e.tieFrom))
          changed = true;
        protectedChain.add(e.id);
        protectedChain.add(e.tieFrom);
      }
  }
  if (context.sourceKind === "audio" && context.melodyCandidates) {
    const protectedEvents = score.events.filter((e) =>
      protectedChain.has(e.id),
    );
    const protectedIds = new Set(protectedEvents.map((e) => e.id));
    score.events = score.events.filter(
      (e) =>
        eventRole(e) !== "melody" || e.midi === null || protectedIds.has(e.id),
    );
    const existing = new Set(score.events.map((e) => e.id));
    for (const n of context.melodyCandidates) {
      const beat = Math.max(0, secondsToBeat(score, n.start)),
        end = Math.min(
          score.durationBeats,
          secondsToBeat(score, n.start + n.duration),
        );
      if (
        existing.has(n.id) ||
        end <= beat ||
        protectedEvents.some(
          (e) =>
            eventRole(e) === "melody" &&
            e.beat < end &&
            e.beat + e.durationBeats > beat,
        )
      )
        continue;
      score.events.push({
        id: n.id,
        beat,
        durationBeats: end - beat,
        midi: n.pitch.midi,
        voice: "melody",
        role: "melody",
        roleOrigin: "inferred",
        origin: n.source,
        activation: n.score,
        velocity: n.velocity,
        sourceIds: [n.id],
      });
    }
  }
  if (context.sourceKind !== "audio" || !context.melodyEvidence?.length)
    return score;
  const evidence = context.melodyEvidence.filter((n) => n.score >= 0.8);
  if (!evidence.length) return score;
  const regions: { start: number; end: number }[] = [];
  for (const n of [...evidence].sort((a, b) => a.start - b.start)) {
    const previous = regions.at(-1);
    if (previous && n.start - previous.end < 0.5)
      previous.end = Math.max(previous.end, n.start + n.duration);
    else regions.push({ start: n.start, end: n.start + n.duration });
  }
  const protectedEvents = score.events.filter(
    (e) =>
      e.origin === "manual" ||
      e.origin === "imported" ||
      e.roleOrigin === "manual" ||
      e.roleOrigin === "imported" ||
      protectedChain.has(e.id),
  );
  const protectedIds = new Set(protectedEvents.map((e) => e.id));
  score.events = score.events.filter(
    (e) =>
      protectedIds.has(e.id) ||
      eventRole(e) !== "melody" ||
      !regions.some(
        (r) =>
          beatToSeconds(score, e.beat) >= r.start - 0.04 &&
          beatToSeconds(score, e.beat) < r.end,
      ),
  );
  for (const n of evidence) {
    const beat = Math.max(0, secondsToBeat(score, n.start)),
      end = Math.min(
        score.durationBeats,
        secondsToBeat(score, n.start + n.duration),
      );
    if (
      end <= beat ||
      protectedEvents.some(
        (e) =>
          eventRole(e) === "melody" &&
          e.beat < end &&
          e.beat + e.durationBeats > beat,
      )
    )
      continue;
    score.events.push({
      id: `vocal-${n.id}`,
      beat,
      durationBeats: end - beat,
      midi: n.pitch.midi,
      voice: "melody",
      role: "melody",
      roleOrigin: "inferred",
      origin: "detected",
      velocity: n.velocity,
      activation: n.score,
      sourceIds: [n.id],
    });
  }
  // Inferred monophonic lead notes yield to the next lead attack. Detector
  // decay tails are not additional voices; written/manual polyphony is untouched.
  const lead = score.events
    .filter((e) => eventRole(e) === "melody" && e.midi !== null)
    .sort((a, b) => a.beat - b.beat);
  for (let i = 1; i < lead.length; i++) {
    const a = lead[i - 1],
      b = lead[i];
    if (
      !protectedChain.has(a.id) &&
      !protectedChain.has(b.id) &&
      !a.tieFrom &&
      !b.tieFrom &&
      a.beat < b.beat &&
      a.beat + a.durationBeats > b.beat
    )
      a.durationBeats = b.beat - a.beat;
  }
  const ids = new Set(score.events.map((e) => e.id));
  score.events = score.events.map((e) => ({
    ...e,
    tieFrom: e.tieFrom && ids.has(e.tieFrom) ? e.tieFrom : undefined,
    slurFrom: e.slurFrom && ids.has(e.slurFrom) ? e.slurFrom : undefined,
  }));
  return score;
}

export function planArrangement(
  context: ArrangementPlanningContext,
  options: ArrangementPlanningOptions,
): ArrangementDraft {
  validateScore(context.score);
  const score = melodyScore(context),
    decisions: ArrangementDraft["decisions"] = [];
  const assessment = assessMusic(score, options.goal);
  const musicalProtection = new Set(assessment.protectedIds);
  decisions.push(
    ...assessment.findings
      .filter((f) => f.ruleId === "non-chord-tones")
      .map((f) => ({ sourceIds: f.sourceIds, reason: f.reason })),
  );
  const bars = measureGrid(score),
    boundaries = new Set([0, score.durationBeats]);
  for (let i = 4; i < bars.length; i += 4) boundaries.add(bars[i].beat);
  for (const s of score.sections) {
    boundaries.add(s.beat);
    boundaries.add(s.endBeat);
  }
  const melody = score.events
    .filter((e) => eventRole(e) === "melody" && e.midi !== null)
    .sort((a, b) => a.beat - b.beat);
  for (let i = 1; i < melody.length; i++)
    if (melody[i].beat - melody[i - 1].beat - melody[i - 1].durationBeats >= 1)
      boundaries.add(melody[i].beat);
  const points = [...boundaries].sort((a, b) => a - b),
    phrases: ArrangementPhrase[] = [];
  const density = points
    .slice(0, -1)
    .map(
      (beat, i) =>
        melody.filter((e) => e.beat >= beat && e.beat < points[i + 1]).length /
        (points[i + 1] - beat),
    );
  const median =
    [...density].sort((a, b) => a - b)[Math.floor(density.length / 2)] ?? 1;
  for (let i = 0; i < points.length - 1; i++) {
    const beat = points[i],
      endBeat = points[i + 1];
    if (endBeat - beat < 0.001) continue;
    const section = score.sections.find(
      (s) => s.beat <= beat && s.endBeat > beat,
    );
    const energy =
      section?.energy ??
      (i === 0
        ? "gentle"
        : density[i] > median * 1.2 && density[i] > 0
          ? "emphatic"
          : "steady");
    phrases.push({
      id: `phrase-${i}`,
      beat,
      endBeat,
      energy,
      texture:
        options.pattern === "auto"
          ? energy === "emphatic"
            ? "strum"
            : "arpeggio"
          : options.pattern,
    });
  }
  if (context.sourceKind === "audio") {
    const keep = new Set<string>();
    const lengths = melody.map((e) => e.durationBeats).sort((a, b) => a - b);
    const structuralLength = Math.max(
      0.18,
      Math.min(0.5, (lengths[Math.floor(lengths.length / 2)] ?? 0.5) * 0.8),
    );
    const motifs = new Map<string, number[]>();
    for (let i = 0; i + 3 < melody.length; i++) {
      const group = melody.slice(i, i + 4);
      if (group.some((e) => (e.activation ?? 1) < 0.5)) continue;
      const signature = group
        .map(
          (e) =>
            `${e.midi! - group[0].midi!}:${Math.round((e.durationBeats / (group[0].durationBeats || 1)) * 4)}`,
        )
        .join("/");
      motifs.set(signature, [...(motifs.get(signature) ?? []), i]);
    }
    for (const starts of motifs.values())
      if (starts.length > 1 && starts.at(-1)! - starts[0] >= 4)
        for (const i of starts)
          melody.slice(i, i + 4).forEach((e) => keep.add(e.id));
    for (const e of melody) {
      const protectedEvent =
        e.origin === "manual" ||
        e.origin === "imported" ||
        e.roleOrigin === "manual" ||
        e.roleOrigin === "imported";
      if (
        protectedEvent ||
        musicalProtection.has(e.id) ||
        e.durationBeats >= structuralLength ||
        (Math.abs(e.beat - Math.round(e.beat)) < 0.1 &&
          (e.activation ?? 1) >= 0.35)
      )
        keep.add(e.id);
    }
    for (const p of phrases) {
      const inPhrase = melody.filter(
        (e) => e.beat >= p.beat && e.beat < p.endBeat,
      );
      if (inPhrase.length) {
        keep.add(inPhrase[0].id);
        keep.add(inPhrase.at(-1)!.id);
      }
    }
    // Keep complete tie chains. A tie is sustain, never a disposable ornament.
    for (let changed = true; changed; ) {
      changed = false;
      for (const e of melody)
        if (e.tieFrom && (keep.has(e.id) || keep.has(e.tieFrom))) {
          if (!keep.has(e.id) || !keep.has(e.tieFrom)) changed = true;
          keep.add(e.id);
          keep.add(e.tieFrom);
        }
    }
    const removed = melody.filter((e) => !keep.has(e.id));
    if (removed.length)
      decisions.push({
        sourceIds: removed.map((e) => e.id),
        reason: "省去短弱拍候选，保留长音、重音及乐句首尾；原始候选未删除。",
      });
    score.events = score.events.filter(
      (e) => eventRole(e) !== "melody" || e.midi === null || keep.has(e.id),
    );
  }
  const ids = new Set(score.events.map((e) => e.id));
  score.events = score.events.map((e) => {
    const structural = eventRole(e) === "melody" && e.midi !== null;
    const next: ScoreEvent = {
      ...e,
      tieFrom: e.tieFrom && ids.has(e.tieFrom) ? e.tieFrom : undefined,
      slurFrom: e.slurFrom && ids.has(e.slurFrom) ? e.slurFrom : undefined,
    };
    if (structural)
      next.extensions = {
        ...e.extensions,
        arranger: {
          ...e.extensions?.arranger,
          anchor: true,
          allowOctaveShift:
            context.sourceKind === "audio" &&
            e.origin !== "manual" &&
            e.origin !== "imported" &&
            e.roleOrigin !== "manual" &&
            e.roleOrigin !== "imported",
        },
      };
    return next;
  });
  const phrasing = options.profile === "phrasing";
  score.chords = organizeHarmony(
    score,
    decisions,
    phrasing ? { bass: context.bassEvidence ?? [] } : undefined,
  );
  if (context.sourceKind === "audio") {
    const lead = score.events
      .filter((e) => eventRole(e) === "melody" && e.midi !== null)
      .sort((a, b) => a.beat - b.beat);
    for (let i = 1; i < lead.length; i++) {
      const a = lead[i - 1],
        b = lead[i],
        gap = b.beat - a.beat - a.durationBeats;
      const phrase = phrases.find(
        (p) => p.beat <= a.beat && p.endBeat > b.beat,
      );
      if (
        !phrase ||
        a.origin === "manual" ||
        a.origin === "imported" ||
        b.origin === "manual" ||
        b.origin === "imported" ||
        a.roleOrigin === "manual" ||
        b.roleOrigin === "manual"
      )
        continue;
      const rest = score.events.some(
        (e) =>
          e.midi === null &&
          e.beat < b.beat &&
          e.beat + e.durationBeats > a.beat + a.durationBeats,
      );
      const gapSeconds =
        beatToSeconds(score, b.beat) -
        beatToSeconds(score, a.beat + a.durationBeats);
      if (
        !rest &&
        gap >= 0 &&
        gap <= 0.18 &&
        (!phrasing || (gapSeconds <= 0.065 && a.midi !== b.midi))
      )
        a.durationBeats = b.beat - a.beat;
      if (
        !rest &&
        Math.abs(a.beat + a.durationBeats - b.beat) < 0.01 &&
        (!phrasing ||
          (gapSeconds >= -0.025 &&
            gapSeconds <= 0.065 &&
            b.extensions?.arranger?.anchor !== true)) &&
        Math.abs(a.midi! - b.midi!) <= 2 &&
        a.midi !== b.midi &&
        b.durationBeats <= 0.5 &&
        Math.abs(b.beat - Math.round(b.beat)) > 0.12
      )
        b.extensions = {
          ...b.extensions,
          arranger: { ...b.extensions?.arranger, legatoCandidate: true },
        };
    }
  }
  // Only bridge a brief voiced gap between identical chords. Explicit rests stay empty.
  for (let i = 1; i < score.chords.length; i++) {
    const a = score.chords[i - 1],
      b = score.chords[i],
      start = a.beat + a.durationBeats,
      gap = b.beat - start;
    if (
      gap > 0.02 &&
      gap <= 0.5 &&
      a.root === b.root &&
      a.quality === b.quality &&
      a.origin !== "manual" &&
      a.origin !== "imported" &&
      score.events.some(
        (e) =>
          eventRole(e) === "melody" &&
          e.midi !== null &&
          e.beat <= start &&
          e.beat + e.durationBeats >= b.beat,
      ) &&
      !score.events.some(
        (e) =>
          e.midi === null &&
          e.beat < b.beat &&
          e.beat + e.durationBeats > start,
      )
    ) {
      score.chords.splice(i, 0, {
        id: `fill-${a.id}`,
        beat: start,
        durationBeats: gap,
        root: a.root,
        quality: a.quality,
        origin: "generated",
      });
      decisions.push({
        sourceIds: [a.id, b.id],
        reason: "按持续旋律补全短和声空窗；此处为编配补全，不代表原音频识别。",
      });
      i++;
    }
  }
  validateScore(score);
  return {
    version: 1,
    plannerVersion: "0.4.0",
    assessment,
    inputFingerprint: context.inputFingerprint,
    options: { ...options },
    score,
    phrases,
    decisions,
    statistics: {
      inputChordKinds: chordKinds(context.score.chords),
      outputChordKinds: chordKinds(score.chords),
      inputIntervals: context.score.chords.length,
      outputIntervals: score.chords.length,
      anchors: score.events.filter(
        (e) => e.extensions?.arranger?.anchor && !e.tieFrom,
      ).length,
    },
  };
}
export default { planArrangement };
