/** Diagnostic alignment only: detector output cannot certify its own accuracy. */
export interface AlignmentAttack {
  beat: number;
  midi: number;
}
export interface RecordingAttack {
  start: number;
  pitch: { midi: number };
}
export interface AlignmentSearch {
  bpm: [number, number, number];
  offsetSeconds: [number, number, number];
  transpose: number[];
  selectionBeats: [number, number];
  checkBeats: [number, number];
  onsetTolerance: number;
  recordingBounds: [number, number];
}
function range(spec: [number, number, number], name: string) {
  if (
    spec.length !== 3 ||
    !spec.every(Number.isFinite) ||
    spec[0] > spec[1] ||
    spec[2] <= 0
  )
    throw new Error(`Invalid ${name} search range`);
  const size = Math.floor((spec[1] - spec[0]) / spec[2] + 1e-9) + 1;
  if (size > 500000) throw new Error("Alignment search is too large");
  return Array.from({ length: size }, (_, i) => spec[0] + i * spec[2]);
}
export function fitReferenceGrid(
  reference: AlignmentAttack[],
  recording: RecordingAttack[],
  search: AlignmentSearch,
) {
  const bpms = range(search.bpm, "BPM"),
    offsets = range(search.offsetSeconds, "offset");
  for (const interval of [
    search.selectionBeats,
    search.checkBeats,
    search.recordingBounds,
  ])
    if (
      interval.length !== 2 ||
      !interval.every(Number.isFinite) ||
      interval[0] < 0 ||
      interval[1] <= interval[0]
    )
      throw new Error("Invalid alignment interval");
  if (
    search.bpm[0] < 20 ||
    search.bpm[1] > 400 ||
    search.offsetSeconds[0] < 0 ||
    !Number.isFinite(search.onsetTolerance) ||
    search.onsetTolerance <= 0 ||
    search.onsetTolerance > 0.2 ||
    !Array.isArray(search.transpose) ||
    !search.transpose.length ||
    search.transpose.length > 5 ||
    search.transpose.some((t) => !Number.isInteger(t) || Math.abs(t) > 24) ||
    new Set(search.transpose).size !== search.transpose.length
  )
    throw new Error("Invalid alignment parameters");
  if (
    Math.max(search.selectionBeats[0], search.checkBeats[0]) <
    Math.min(search.selectionBeats[1], search.checkBeats[1])
  )
    throw new Error("Selection and check intervals must not overlap");
  if (bpms.length * offsets.length * search.transpose.length > 500000)
    throw new Error("Alignment search is too large");
  if (
    reference.length > 1000 ||
    recording.length > 100000 ||
    reference.some(
      (e) =>
        !Number.isFinite(e.beat) ||
        e.beat < 0 ||
        !Number.isInteger(e.midi) ||
        e.midi < 0 ||
        e.midi > 127,
    ) ||
    recording.some(
      (e) =>
        !Number.isFinite(e.start) ||
        e.start < 0 ||
        !Number.isInteger(e.pitch.midi) ||
        e.pitch.midi < 0 ||
        e.pitch.midi > 127,
    )
  )
    throw new Error("Invalid alignment attacks");
  const subset = (bounds: [number, number]) =>
    reference.filter((e) => e.beat >= bounds[0] && e.beat < bounds[1]);
  const selection = subset(search.selectionBeats),
    check = subset(search.checkBeats);
  if (selection.length < 4 || check.length < 4)
    throw new Error(
      "Need at least four selection and four independent check attacks",
    );
  const byPitch = new Map<number, { start: number; index: number }[]>();
  recording.forEach((note, index) => {
    if (
      note.start < search.recordingBounds[0] ||
      note.start >= search.recordingBounds[1]
    )
      return;
    const group = byPitch.get(note.pitch.midi) ?? [];
    group.push({ start: note.start, index });
    byPitch.set(note.pitch.midi, group);
  });
  for (const group of byPitch.values()) group.sort((a, b) => a.start - b.start);
  const evaluate = (
    events: AlignmentAttack[],
    bpm: number,
    offset: number,
    transpose: number,
    tolerance = search.onsetTolerance,
    pitchMode: "exact" | "class" | "any" = "exact",
  ) => {
    const candidates = events.map((e) => {
      const expected = offset + (e.beat * 60) / bpm;
      const pool =
        pitchMode === "exact"
          ? (byPitch.get(e.midi + transpose) ?? [])
          : [...byPitch]
              .filter(
                ([pitch]) =>
                  pitchMode === "any" ||
                  (pitch - e.midi - transpose) % 12 === 0,
              )
              .flatMap(([, notes]) => notes);
      return pool
        .map((n) => ({ index: n.index, error: Math.abs(n.start - expected) }))
        .filter((n) => n.error <= tolerance)
        .sort((a, b) => a.error - b.error);
    });
    const owner = new Map<number, number>();
    const assign = (index: number, visited: Set<number>): boolean => {
      for (const c of candidates[index]) {
        if (visited.has(c.index)) continue;
        visited.add(c.index);
        if (!owner.has(c.index) || assign(owner.get(c.index)!, visited)) {
          owner.set(c.index, index);
          return true;
        }
      }
      return false;
    };
    events.forEach((_, i) => assign(i, new Set()));
    const error = [...owner].reduce(
      (sum, [candidate, index]) =>
        sum + candidates[index].find((c) => c.index === candidate)!.error,
      0,
    );
    return {
      referenceAttacks: events.length,
      matched: owner.size,
      coverage: events.length ? owner.size / events.length : null,
      matchedOnsetMae: owner.size ? error / owner.size : null,
    };
  };
  type Candidate = {
    bpm: number;
    offset: number;
    transpose: number;
    selection: ReturnType<typeof evaluate>;
  };
  const rank = (a: Candidate, b: Candidate) =>
    b.selection.matched - a.selection.matched ||
    (a.selection.matchedOnsetMae ?? Infinity) -
      (b.selection.matchedOnsetMae ?? Infinity) ||
    Math.abs(a.transpose) - Math.abs(b.transpose) ||
    a.bpm - b.bpm ||
    a.offset - b.offset;
  const best: Candidate[] = [];
  const maxBeat = Math.max(search.selectionBeats[1], search.checkBeats[1]),
    minBeat = Math.min(search.selectionBeats[0], search.checkBeats[0]);
  let evaluated = 0;
  for (const bpm of bpms)
    for (const offset of offsets) {
      if (
        offset + (minBeat * 60) / bpm < search.recordingBounds[0] ||
        offset + (maxBeat * 60) / bpm > search.recordingBounds[1] + 1e-9
      )
        continue;
      for (const transpose of search.transpose) {
        const candidate = {
          bpm,
          offset,
          transpose,
          selection: evaluate(selection, bpm, offset, transpose),
        };
        evaluated++;
        best.push(candidate);
        best.sort(rank);
        if (best.length > 6) best.pop();
      }
    }
  if (!best.length)
    throw new Error("Recording does not cover selection and check intervals");
  const selected = best[0];
  const checkAt = (
    tolerance: number,
    pitchMode: "exact" | "class" | "any" = "exact",
  ) =>
    evaluate(
      check,
      selected.bpm,
      selected.offset,
      selected.transpose,
      tolerance,
      pitchMode,
    );
  return {
    status: "unconfirmed" as const,
    evaluated,
    selected: {
      ...selected,
      check: evaluate(check, selected.bpm, selected.offset, selected.transpose),
    },
    alternatives: best.slice(1),
    diagnostics: {
      // These relaxed measures never participate in candidate selection.
      checkAt100ms: checkAt(0.1),
      checkAt200ms: checkAt(0.2),
      checkPitchClassAt100ms: checkAt(0.1, "class"),
      checkOnsetsOnlyAt50ms: checkAt(0.05, "any"),
      checkFourBeatWindows: Array.from(
        {
          length: Math.ceil((search.checkBeats[1] - search.checkBeats[0]) / 4),
        },
        (_, i) => {
          const from = search.checkBeats[0] + i * 4,
            to = Math.min(from + 4, search.checkBeats[1]);
          return {
            from,
            to,
            ...evaluate(
              subset([from, to]),
              selected.bpm,
              selected.offset,
              selected.transpose,
            ),
          };
        },
      ),
    },
    limitations: [
      "Selection uses detector output and may fit detector errors.",
      "Check attacks were excluded from search ranking; they are not an independent song or human truth.",
      "Coverage of a sparse arranger melody is not precision, recall or transcription accuracy for a commercial mix.",
    ],
  };
}
