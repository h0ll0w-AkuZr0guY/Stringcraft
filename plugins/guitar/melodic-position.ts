import {
  secondsToBeat,
  type MusicalScore,
  type NoteEvent,
} from "../../packages/contracts";
import type { GuitarGrip, GuitarOptions } from "./types";
import { limits } from "./types";
import { tuning } from "./voicings";
import { assignFingers } from "./hands";
import { writtenPosition } from "./written-voices";

export interface MelodicPosition {
  string: number;
  fret: number;
  octave: number;
}
/** Phrase-wide beam search considers the bass and held melody before choosing a string. */
export function melodicPositions(
  melody: NoteEvent[],
  score: MusicalScore,
  options: GuitarOptions,
  grips: GuitarGrip[],
): Map<string, MelodicPosition> {
  const result = new Map<string, MelodicPosition>(),
    events = new Map(score.events.map((e) => [e.id, e]));
  const limit = limits[options.difficulty];
  const suggested = options.phrases?.length
    ? options.phrases
    : [{ beat: 0, endBeat: score.durationBeats }];
  const boundaries = new Set([
    0,
    score.durationBeats,
    ...suggested.flatMap((p) => [p.beat, p.endBeat]),
  ]);
  for (let i = 1; i < melody.length; i++)
    if (
      secondsToBeat(score, melody[i].start) -
        secondsToBeat(score, melody[i - 1].start + melody[i - 1].duration) >=
      1
    )
      boundaries.add(secondsToBeat(score, melody[i].start));
  const points = [...boundaries].sort((a, b) => a - b);
  const sourcePhrases = points
    .slice(0, -1)
    .map((beat, i) => ({ beat, endBeat: points[i + 1] }));
  const phrases: { beat: number; endBeat: number }[] = [];
  // A bar-count boundary is not permission to reset the hand or the octave.
  // Search continuously until there is an actual melodic breathing space.
  for (const p of sourcePhrases) {
    const previous = phrases.at(-1);
    const before = melody
      .filter(
        (n) =>
          secondsToBeat(score, n.start) < p.beat &&
          secondsToBeat(score, n.start) >= (previous?.beat ?? 0),
      )
      .at(-1);
    const after = melody.find(
      (n) =>
        secondsToBeat(score, n.start) >= p.beat - 0.000001 &&
        secondsToBeat(score, n.start) < p.endBeat,
    );
    if (
      previous &&
      before &&
      after &&
      secondsToBeat(score, after.start) -
        secondsToBeat(score, before.start + before.duration) <
        1
    )
      previous.endBeat = p.endBeat;
    else phrases.push({ beat: p.beat, endBeat: p.endBeat });
  }
  for (const phrase of phrases) {
    const notes = melody.filter((n) => {
      const beat = secondsToBeat(score, n.start);
      return beat >= phrase.beat - 0.001 && beat < phrase.endBeat - 0.001;
    });
    if (!notes.length) continue;
    const canShift = notes.every(
      (n) => events.get(n.id)?.extensions?.arranger?.allowOctaveShift === true,
    );
    type Node = {
      id: string;
      position: MelodicPosition;
      previous: Node | null;
    };
    type State = {
      cost: number;
      last: MelodicPosition | null;
      beat: number;
      held: { string: number; fret: number; end: number }[];
      node: Node | null;
      octave: number;
    };
    const previousNote = [...melody]
      .reverse()
      .find(
        (n) => secondsToBeat(score, n.start) < phrase.beat && result.has(n.id),
      );
    const carried = melody
      .filter(
        (n) =>
          secondsToBeat(score, n.start) < phrase.beat &&
          secondsToBeat(score, n.start + n.duration) > phrase.beat &&
          result.has(n.id),
      )
      .map((n) => ({
        ...result.get(n.id)!,
        end: secondsToBeat(score, n.start + n.duration),
      }));
    let states: State[] = (canShift ? [-12, 0, 12] : [0]).map((octave) => ({
      cost: Math.abs(octave) * 0.14,
      last: previousNote ? result.get(previousNote.id)! : null,
      beat: previousNote
        ? secondsToBeat(score, previousNote.start)
        : phrase.beat,
      held: carried,
      node: null,
      octave,
    }));
    for (const note of notes) {
      const beat = secondsToBeat(score, note.start),
        end = secondsToBeat(score, note.start + note.duration),
        event = events.get(note.id)!;
      const written = writtenPosition(event, options),
        grip = grips.find((g) => g.beat <= beat && g.endBeat > beat);
      const next: State[] = [];
      for (const state of states) {
        const pitch = note.pitch.midi + options.transpose + state.octave;
        const candidates = tuning
          .map((open, i) => ({
            string: i + 1,
            fret: pitch - options.capo - open,
            octave: state.octave,
          }))
          .filter(
            (p) =>
              p.fret >= 0 &&
              p.fret <= limit.fret &&
              (!written ||
                (p.string === written.string && p.fret === written.fret)),
          );
        for (const position of candidates) {
          const held = state.held.filter((a) => a.end > beat + 0.000001);
          if (
            held.some((a) => a.string === position.string) ||
            !assignFingers([...held, position])
          )
            continue;
          const frets = [...held, position]
            .filter((p) => p.fret > 0)
            .map((p) => p.fret);
          if (
            frets.length &&
            Math.max(...frets) - Math.min(...frets) > limit.span
          )
            continue;
          const gap = Math.max(0.25, beat - state.beat);
          if (
            state.last &&
            state.last.fret > 0 &&
            position.fret > 0 &&
            Math.abs(state.last.fret - position.fret) >
              limit.shiftPerBeat * gap + 1
          )
            continue;
          let bassPenalty = 0;
          if (grip) {
            const bassString =
              grip.shape.frets.findLastIndex((f) => f >= 0) + 1;
            const bass = {
              string: bassString,
              fret: grip.shape.frets[bassString - 1],
            };
            const soundingBass =
              tuning[bassString - 1] + options.capo + bass.fret;
            if (
              position.string === bassString ||
              !assignFingers([...held, position, bass])
            )
              bassPenalty = 2.5;
            if (soundingBass >= pitch - 3) bassPenalty += 2;
          }
          const move = state.last
            ? Math.abs(position.fret - state.last.fret) * 0.35 +
              (position.string !== state.last.string ? 0.12 : 0)
            : position.fret * 0.1;
          const register = canShift
            ? Math.max(0, 60 - pitch) * 0.12 + Math.max(0, pitch - 79) * 0.12
            : 0;
          const cost =
            state.cost +
            move +
            position.fret * 0.045 +
            bassPenalty +
            register -
            (position.fret === 0 ? 0.18 : 0);
          next.push({
            cost,
            last: position,
            beat,
            held: [...held, { ...position, end }],
            node: { id: note.id, position, previous: state.node },
            octave: state.octave,
          });
        }
      }
      if (!next.length)
        throw new Error(
          `旋律骨干在当前手型/难度下无法连续弹奏（第 ${Math.floor(beat) + 1} 拍）。请调整八度、变调夹或难度；未静默删除旋律。`,
        );
      next.sort((a, b) => a.cost - b.cost);
      const seen = new Set<string>();
      states = next
        .filter((s) => {
          const k = `${s.octave}/${s.last!.string}/${s.last!.fret}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, 18);
    }
    let node = states[0].node;
    while (node) {
      result.set(node.id, node.position);
      node = node.previous;
    }
  }
  return result;
}
