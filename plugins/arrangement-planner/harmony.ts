import {
  eventRole,
  type ChordSymbol,
  type MusicalScore,
  type ArrangementDraft,
} from "../../packages/contracts";

const intervals: Record<ChordSymbol["quality"], number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  sus4: [0, 5, 7],
};
const key = (c: Pick<ChordSymbol, "root" | "quality">) =>
  `${c.root}:${c.quality}`;
const fixed = (c: ChordSymbol) =>
  c.origin === "manual" || c.origin === "imported";
const resolves = (a: ChordSymbol, b?: ChordSymbol) =>
  !!b &&
  (a.quality === "major" || a.quality === "7") &&
  (a.root + 5) % 12 === b.root;

function localKeyFit(source: ChordSymbol[], at: number) {
  const nearby = source.filter(
    (c) => c.beat < at + 8 && c.beat + c.durationBeats > at - 8,
  );
  const hypotheses = Array.from({ length: 24 }, (_, i) => {
    const root = i % 12,
      minor = i >= 12;
    const palette = minor
      ? ([
          [0, "minor"],
          [2, "minor"],
          [3, "major"],
          [5, "minor"],
          [7, "minor"],
          [7, "major"],
          [8, "major"],
          [10, "major"],
        ] as const)
      : ([
          [0, "major"],
          [2, "minor"],
          [4, "minor"],
          [5, "major"],
          [7, "major"],
          [9, "minor"],
        ] as const);
    const fits = (c: ChordSymbol) =>
      palette.some(
        ([step, q]) =>
          (root + step) % 12 === c.root &&
          (c.quality === q ||
            (q === "major" && ["7", "maj7", "sus4"].includes(c.quality)) ||
            (q === "minor" && c.quality === "m7")),
      );
    return {
      fits,
      score: nearby.reduce(
        (sum, c) => sum + Math.min(4, c.durationBeats) * (fits(c) ? 1 : -0.35),
        0,
      ),
    };
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return (c: ChordSymbol) =>
    hypotheses.reduce(
      (sum, h) =>
        sum +
        (h.fits(c) ? 0 : 0.07) * Math.exp((h.score - hypotheses[0].score) / 4),
      0,
    );
}
export const chordKinds = (chords: ChordSymbol[]) =>
  new Set(chords.map((c) => `${key(c)}:${c.bass ?? ""}`)).size;

/** Duration-weighted sequence fit. Frequency is a weak prior, never a vocabulary cap. */
export function organizeHarmony(
  score: MusicalScore,
  decisions: ArrangementDraft["decisions"],
): ChordSymbol[] {
  const source = [...score.chords].sort((a, b) => a.beat - b.beat);
  if (!source.length) return [];
  const counts = new Map<string, number>();
  for (const c of source)
    counts.set(key(c), (counts.get(key(c)) ?? 0) + c.durationBeats);
  const maximum = Math.max(...counts.values(), 1);
  type State = { cost: number; path: ChordSymbol[] };
  let states: State[] = [{ cost: 0, path: [] }];
  for (let i = 0; i < source.length; i++) {
    const original = source[i],
      short = original.durationBeats < 0.75;
    const keyPenalty = localKeyFit(source, original.beat);
    const melodic = score.events.filter(
      (e) =>
        e.midi !== null &&
        eventRole(e) === "melody" &&
        e.beat < original.beat + original.durationBeats &&
        e.beat + e.durationBeats > original.beat,
    );
    const protectedChord =
      fixed(original) ||
      (resolves(original, source[i + 1]) &&
        (original.durationBeats >= 0.5 || (original.evidence ?? 0) > 0.1));
    let choices = [original];
    if (!protectedChord) {
      for (const a of original.alternatives ?? []) {
        // A long structural harmony cannot be relabelled merely because its
        // melody uses a non-chord tone. Reconsider short weak islands only.
        if (!short || (original.evidence ?? 0) >= 0.2 || a.score < 0.02)
          continue;
        choices.push({
          ...original,
          root: a.root,
          quality: a.quality,
          bass: undefined,
        });
      }
      if (short && (original.evidence ?? 0) < 0.2) {
        for (const neighbor of [source[i - 1], source[i + 1]])
          if (neighbor)
            choices.push({
              ...original,
              root: neighbor.root,
              quality: neighbor.quality,
              bass: neighbor.bass,
            });
      }
      if (
        (original.quality === "maj7" || original.quality === "m7") &&
        (original.evidence ?? 0) < 0.2
      ) {
        const seventh =
          (original.root + (original.quality === "maj7" ? 11 : 10)) % 12;
        if (
          !melodic.some(
            (e) => e.midi! % 12 === seventh && e.durationBeats >= 0.5,
          )
        )
          choices.push({
            ...original,
            quality: original.quality === "m7" ? "minor" : "major",
          });
      }
    }
    choices = choices.filter(
      (c, j, all) =>
        all.findIndex((x) => key(x) === key(c) && x.bass === c.bass) === j,
    );
    const next: State[] = [];
    for (const state of states)
      for (const candidate of choices) {
        const changed =
          key(candidate) !== key(original) || candidate.bass !== original.bass;
        const pcs = intervals[candidate.quality].map(
          (n) => (n + candidate.root) % 12,
        );
        let clash = 0,
          total = 0;
        for (const e of melodic) {
          const weight =
            Math.min(
              e.beat + e.durationBeats,
              original.beat + original.durationBeats,
            ) - Math.max(e.beat, original.beat);
          const structural =
            e.durationBeats >= 0.5 ||
            Math.abs(e.beat - Math.round(e.beat)) < 0.1;
          total += weight * (structural ? 1 : 0.25);
          if (!pcs.includes(e.midi! % 12))
            clash += weight * (structural ? 1 : 0.25);
        }
        const simplified =
          ((original.quality === "maj7" && candidate.quality === "major") ||
            (original.quality === "m7" && candidate.quality === "minor")) &&
          original.root === candidate.root;
        const prior =
          0.12 *
          Math.log1p(
            maximum /
              Math.max(
                0.25,
                counts.get(key(candidate)) ??
                  (simplified ? counts.get(key(original)) : undefined) ??
                  0.25,
              ),
          );
        const previous = state.path.at(-1);
        const change =
          previous && key(previous) !== key(candidate)
            ? short
              ? 0.65
              : 0.12
            : 0;
        const emission = changed
          ? simplified
            ? -0.08 + (original.evidence ?? 0) * 0.4
            : 0.22 + (original.evidence ?? 0) * 1.8
          : 0;
        next.push({
          cost:
            state.cost +
            emission +
            keyPenalty(candidate) +
            prior +
            (clash / (total || 1)) * 0.35 +
            change -
            (previous && resolves(previous, candidate) ? 0.08 : 0),
          path: [...state.path, candidate],
        });
      }
    // Keep distinct final labels, retaining global context without exponential paths.
    next.sort((a, b) => a.cost - b.cost);
    const seen = new Set<string>();
    states = next
      .filter((s) => {
        const k = key(s.path.at(-1)!);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 12);
  }
  const result: ChordSymbol[] = [];
  for (const [i, candidate] of states[0].path.entries()) {
    const raw = source[i],
      changed = key(raw) !== key(candidate) || raw.bass !== candidate.bass;
    const chord = {
      ...candidate,
      id: changed ? `arranged-${raw.id}` : raw.id,
      origin: changed ? ("generated" as const) : raw.origin,
    };
    if (changed)
      decisions.push({
        sourceIds: [raw.id],
        reason:
          "结合持续时间、旋律与前后和声整理弱证据和弦；保留原始识别供对照。",
      });
    const previous = result.at(-1);
    if (
      previous &&
      !fixed(previous) &&
      !fixed(chord) &&
      key(previous) === key(chord) &&
      previous.bass === chord.bass &&
      Math.abs(previous.beat + previous.durationBeats - chord.beat) < 0.03
    ) {
      previous.durationBeats = chord.beat + chord.durationBeats - previous.beat;
      decisions.push({
        sourceIds: [raw.id],
        reason: "合并相邻同和弦区间，持续音不触发重新换和弦。",
      });
    } else result.push(chord);
  }
  // Snap shared weak boundaries only; silence and protected edits are never crossed.
  for (let i = 1; i < result.length; i++) {
    const a = result[i - 1],
      b = result[i];
    if (
      score.timing === "unconfirmed" ||
      score.timing === "estimated" ||
      fixed(a) ||
      fixed(b) ||
      Math.abs(a.beat + a.durationBeats - b.beat) > 0.02
    )
      continue;
    const boundary = Math.round(b.beat * 2) / 2;
    if (
      Math.abs(boundary - b.beat) > 0.12 ||
      boundary <= a.beat + 0.05 ||
      boundary >= b.beat + b.durationBeats - 0.05
    )
      continue;
    const end = b.beat + b.durationBeats;
    a.durationBeats = boundary - a.beat;
    b.beat = boundary;
    b.durationBeats = end - boundary;
  }
  return result;
}
