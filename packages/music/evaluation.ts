import type { NoteEvent, ChordSymbol } from "../contracts";
/** Maximum one-to-one onset matching. A duplicate prediction cannot improve recall. */
export function compareNotes(
  reference: NoteEvent[],
  prediction: NoteEvent[],
  onsetTolerance = 0.05,
) {
  const candidates = reference.map((r) =>
    prediction
      .map((p, i) => ({ p, i }))
      .filter(
        ({ p }) =>
          p.pitch.midi === r.pitch.midi &&
          Math.abs(p.start - r.start) <= onsetTolerance,
      )
      .sort(
        (a, b) => Math.abs(a.p.start - r.start) - Math.abs(b.p.start - r.start),
      )
      .map((c) => c.i),
  );
  const owner = new Map<number, number>();
  function match(ri: number, visited: Set<number>): boolean {
    for (const pi of candidates[ri]) {
      if (visited.has(pi)) continue;
      visited.add(pi);
      if (!owner.has(pi) || match(owner.get(pi)!, visited)) {
        owner.set(pi, ri);
        return true;
      }
    }
    return false;
  }
  reference.forEach((_, i) => match(i, new Set()));
  const pairs = [...owner].map(([pi, ri]) => ({
    reference: reference[ri].id,
    prediction: prediction[pi].id,
    onsetError: Math.abs(reference[ri].start - prediction[pi].start),
    durationError: Math.abs(reference[ri].duration - prediction[pi].duration),
  }));
  const precision = prediction.length
    ? pairs.length / prediction.length
    : reference.length
      ? 0
      : 1;
  const recall = reference.length
    ? pairs.length / reference.length
    : prediction.length
      ? 0
      : 1;
  return {
    reference: reference.length,
    prediction: prediction.length,
    matched: pairs.length,
    precision,
    recall,
    f1:
      precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    onsetMae: pairs.length
      ? pairs.reduce((s, p) => s + p.onsetError, 0) / pairs.length
      : null,
    durationMae: pairs.length
      ? pairs.reduce((s, p) => s + p.durationError, 0) / pairs.length
      : null,
    pairs,
  };
}
export function compareHarmony(
  reference: ChordSymbol[],
  prediction: ChordSymbol[],
) {
  for (const intervals of [reference, prediction]) {
    const sorted = [...intervals].sort((a, b) => a.beat - b.beat);
    if (
      sorted.some(
        (c, i) =>
          i > 0 &&
          sorted[i - 1].beat + sorted[i - 1].durationBeats > c.beat + 0.001,
      )
    )
      throw new Error("重叠和弦区间不能用于评估");
  }
  let total = 0,
    covered = 0,
    agreement = 0;
  for (const r of reference) {
    total += r.durationBeats;
    for (const p of prediction) {
      const overlap = Math.max(
        0,
        Math.min(r.beat + r.durationBeats, p.beat + p.durationBeats) -
          Math.max(r.beat, p.beat),
      );
      covered += overlap;
      if (r.root === p.root && r.quality === p.quality) agreement += overlap;
    }
  }
  return {
    referenceBeats: total,
    coverage: total ? covered / total : null,
    rootQualityAgreement: total ? agreement / total : null,
  };
}
