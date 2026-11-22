import {
  soundingEvents,
  secondsToBeat,
  type MusicalScore,
} from "../../packages/contracts";
import {
  limits,
  type GuitarOptions,
  type GuitarAction,
  type GuitarGrip,
} from "./types";
import { rightFinger, assignFingers } from "./hands";
import { tuning } from "./voicings";
import { activePreferences, fingeringPath } from "./fingering";
import {
  addWrittenVoices,
  writtenPosition,
  soundingOriginId,
  hasWrittenSupportingVoice,
  nextWrittenAttack,
} from "./written-voices";

export function fingerstyle(
  score: MusicalScore,
  options: GuitarOptions,
  grips: GuitarGrip[],
): GuitarAction[] {
  const limit = limits[options.difficulty],
    actions: GuitarAction[] = [];
  const melody = soundingEvents(score).filter((n) => n.role === "melody");
  const preferred = fingeringPath(
    melody.map((n) => n.pitch.midi + options.transpose),
    options.preferences ?? activePreferences,
    options.capo,
    limit.fret,
  );
  // Work in phrases: preserve melodic events, add only structural bass, never all detector leftovers.
  const times = new Map(score.events.map((e) => [e.id, e.beat]));
  const eventsById = new Map(score.events.map((e) => [e.id, e]));
  let lastPosition = 0,
    lastBeat = -100,
    lastString = 0;
  for (const [index, n] of melody.entries()) {
    const beat = times.get(n.id)!;
    if (beat - lastBeat < limit.minBeats - 0.001) continue;
    const candidates = tuning
      .map((open, i) => ({
        string: i + 1,
        fret: n.pitch.midi + options.transpose - options.capo - open,
      }))
      .filter((p) => p.fret >= 0 && p.fret <= limit.fret)
      .sort((a, b) => {
        const grip = grips.find((g) => g.beat <= beat && g.endBeat > beat);
        const written = writtenPosition(
          score.events.find((e) => e.id === n.id)!,
          options,
        );
        const cost = (p: typeof a) =>
          (p.string === written?.string ? -100 : 0) +
          (preferred[index]?.string === p.string ? -4 : 0) +
          Math.abs(p.fret - lastPosition) * 0.65 +
          (p.string === lastString ? -0.4 : 0) +
          (grip?.shape.frets[p.string - 1] === p.fret ? -2 : 0) +
          p.fret * 0.08;
        return cost(a) - cost(b);
      });
    for (const pos of candidates) {
      if (
        lastBeat > 0 &&
        Math.abs(pos.fret - lastPosition) >
          limit.shiftPerBeat * Math.max(0.5, beat - lastBeat) + 1
      )
        continue;
      const event = score.events.find((e) => e.id === n.id)!;
      const durationBeats = Math.min(
        secondsToBeat(score, n.start + n.duration) - beat,
        (nextWrittenAttack(score, pos.string, beat, options) ?? Infinity) -
          beat,
      );
      const previous = actions.at(-1);
      const legato =
        options.difficulty !== "easy" &&
        event.slurFrom &&
        previous?.sourceIds.includes(
          soundingOriginId(eventsById, event.slurFrom),
        ) &&
        previous.string === pos.string &&
        previous.fret !== pos.fret &&
        Math.abs(previous.fret - pos.fret) <= 3 &&
        Math.abs(previous.beat + previous.durationBeats - beat) < 0.05;
      const kind = legato
        ? pos.fret > previous!.fret
          ? "hammer"
          : "pull"
        : "pluck";
      actions.push({
        id: n.id,
        beat,
        durationBeats,
        string: pos.string,
        fret: pos.fret,
        finger: 0,
        rightFinger: rightFinger(pos.string),
        kind,
        from: legato ? previous!.id : undefined,
        velocity: n.velocity * 0.9,
        role: "melody",
        sourceIds: [n.id],
      });
      lastPosition = pos.fret;
      lastString = pos.string;
      lastBeat = beat;
      break;
    }
  }
  const withWritten =
    options.goal === "fingerstyle"
      ? addWrittenVoices(score, actions, options)
      : actions;
  actions.splice(0, actions.length, ...withWritten);
  if (options.goal === "fingerstyle" && !hasWrittenSupportingVoice(score))
    for (const grip of grips) {
      const s = grip.shape.frets.findLastIndex((f) => f >= 0) + 1;
      // Roots on beats 1 and 3, with sustained melody kept ahead of bass.
      for (let beat = grip.beat; beat < grip.endBeat; beat += 2) {
        if (
          actions.some(
            (a) => a.role === "bass" && Math.abs(a.beat - beat) < 0.08,
          )
        )
          continue;
        const active = actions.filter(
          (a) =>
            a.beat <= beat + 0.001 && a.beat + a.durationBeats > beat + 0.001,
        );
        const candidate: GuitarAction = {
          id: `bass-${grip.chordId}-${beat}`,
          beat,
          durationBeats: Math.min(2, grip.endBeat - beat),
          string: s,
          fret: grip.shape.frets[s - 1],
          finger: 0,
          rightFinger: "p",
          kind: "pluck",
          velocity: 0.46,
          role: "bass",
          sourceIds: [],
        };
        if (
          actions.some(
            (a) =>
              a.string === s &&
              a.beat < beat + candidate.durationBeats &&
              a.beat + a.durationBeats > beat,
          )
        )
          continue;
        if (
          active.some((a) => a.string === s) ||
          !assignFingers([...active, candidate])
        )
          continue;
        const frets = [...active, candidate]
          .filter((a) => a.fret > 0)
          .map((a) => a.fret);
        if (
          frets.length &&
          Math.max(...frets) - Math.min(...frets) > limit.span
        )
          continue;
        const future = actions.filter(
          (a) => a.beat > beat && a.beat < beat + candidate.durationBeats,
        );
        if (
          future.some((a) => {
            const held = [
              ...actions.filter(
                (b) =>
                  b.beat <= a.beat + 0.000001 &&
                  b.beat + b.durationBeats > a.beat + 0.000001,
              ),
              candidate,
            ];
            const f = held.filter((b) => b.fret > 0).map((b) => b.fret);
            return (
              !assignFingers(held) ||
              (f.length && Math.max(...f) - Math.min(...f) > limit.span)
            );
          })
        )
          continue;
        actions.push(candidate);
      }
    }
  return actions;
}
