import {
  soundingEvents,
  secondsToBeat,
  eventRole,
  type MusicalScore,
  type ScoreEvent,
} from "../../packages/contracts";
import type { GuitarAction, GuitarOptions } from "./types";
import { limits } from "./types";
import { pitchPositions } from "./fingering";
import { assignFingers, rightFinger } from "./hands";
import { tuning } from "./voicings";

export function writtenPosition(event: ScoreEvent, options: GuitarOptions) {
  if (options.positionSource === "optimize") return undefined;
  const notation = event.extensions?.guitar,
    string = notation?.string,
    fret = notation?.fret;
  if (
    typeof string !== "number" ||
    typeof fret !== "number" ||
    !Number.isInteger(string) ||
    string < 1 ||
    string > 6 ||
    !Number.isInteger(fret) ||
    fret < 0 ||
    fret > limits[options.difficulty].fret ||
    fret + options.capo > 24 ||
    event.midi === null ||
    tuning[string - 1] + options.capo + fret !== event.midi + options.transpose
  )
    return undefined;
  return { string, fret };
}
export function soundingOriginId(events: Map<string, ScoreEvent>, id: string) {
  let event = events.get(id);
  while (event?.tieFrom) event = events.get(event.tieFrom);
  return event?.id ?? id;
}
export function hasWrittenSupportingVoice(score: MusicalScore) {
  return score.events.some(
    (e) =>
      eventRole(e) !== "melody" &&
      (e.roleOrigin === "manual" ||
        ["manual", "imported", "demo"].includes(e.origin ?? "") ||
        (!e.origin && score.timing === "imported")),
  );
}
export function nextWrittenAttack(
  score: MusicalScore,
  string: number,
  beat: number,
  options: GuitarOptions,
): number | undefined {
  return score.events
    .filter(
      (e) =>
        e.beat > beat + 0.000001 &&
        !e.tieFrom &&
        (e.midi !== null || e.unpitched) &&
        (["manual", "imported", "demo"].includes(e.origin ?? "") ||
          e.roleOrigin === "manual" ||
          (!e.origin && score.timing === "imported")) &&
        (e.unpitched
          ? e.extensions?.guitar?.string === string
          : writtenPosition(e, options)?.string === string),
    )
    .sort((a, b) => a.beat - b.beat)[0]?.beat;
}
/** Only authored/imported voices are material. Unreviewed detector leftovers never enter here. */
export function addWrittenVoices(
  score: MusicalScore,
  initial: GuitarAction[],
  options: GuitarOptions,
): GuitarAction[] {
  const actions = [...initial],
    events = new Map(score.events.map((e) => [e.id, e]));
  const notes = soundingEvents(score)
    .filter(
      (n) =>
        n.role !== "melody" &&
        (events.get(n.id)?.roleOrigin === "manual" ||
          ["manual", "imported", "demo"].includes(
            events.get(n.id)?.origin ?? "",
          ) ||
          (!events.get(n.id)?.origin && score.timing === "imported")),
    )
    .sort(
      (a, b) =>
        (a.role === "bass" ? 0 : 1) - (b.role === "bass" ? 0 : 1) ||
        a.start - b.start,
    );
  for (const note of notes) {
    const event = events.get(note.id)!,
      beat = event.beat;
    const preferred = writtenPosition(event, options);
    const candidates = pitchPositions(
      note.pitch.midi + options.transpose,
      options.capo,
      limits[options.difficulty].fret,
    ).sort(
      (a, b) =>
        (a.string === preferred?.string ? -100 : 0) -
          (b.string === preferred?.string ? -100 : 0) || a.fret - b.fret,
    );
    for (const position of candidates) {
      let durationBeats =
        secondsToBeat(score, note.start + note.duration) - beat;
      const writtenNext = nextWrittenAttack(
        score,
        position.string,
        beat,
        options,
      );
      if (writtenNext !== undefined)
        durationBeats = Math.min(durationBeats, writtenNext - beat);
      const future = actions
        .filter((a) => a.string === position.string && a.beat > beat + 0.001)
        .sort((a, b) => a.beat - b.beat)[0];
      if (future) durationBeats = Math.min(durationBeats, future.beat - beat);
      if (
        actions.some(
          (a) =>
            a.string === position.string &&
            a.beat <= beat + 0.001 &&
            a.beat + a.durationBeats > beat + 0.001,
        )
      )
        continue;
      const candidate: GuitarAction = {
        id: note.id,
        beat,
        durationBeats,
        string: position.string,
        fret: position.fret,
        finger: 0,
        rightFinger: rightFinger(position.string),
        kind: "pluck",
        velocity: note.velocity * (note.role === "bass" ? 0.8 : 0.6),
        role: note.role ?? "harmony",
        sourceIds: [note.id],
      };
      const origin = event.slurFrom
        ? actions.find(
            (a) => a.id === soundingOriginId(events, event.slurFrom!),
          )
        : undefined;
      if (
        origin &&
        origin.string === position.string &&
        origin.fret !== position.fret &&
        Math.abs(origin.fret - position.fret) <= 3 &&
        Math.abs(origin.beat + origin.durationBeats - beat) < 0.002
      ) {
        candidate.kind = position.fret > origin.fret ? "hammer" : "pull";
        candidate.from = origin.id;
      }
      const boundaries = [
        beat,
        ...actions
          .map((a) => a.beat)
          .filter((b) => b > beat && b < beat + durationBeats),
      ];
      const feasible = boundaries.every((time) => {
        const active = [
          ...actions.filter(
            (a) =>
              a.beat <= time + 0.000001 &&
              a.beat + a.durationBeats > time + 0.000001,
          ),
          candidate,
        ];
        const frets = active.filter((a) => a.fret > 0).map((a) => a.fret);
        return (
          assignFingers(active) &&
          (!frets.length ||
            Math.max(...frets) - Math.min(...frets) <=
              limits[options.difficulty].span)
        );
      });
      if (!feasible) continue;
      actions.push(candidate);
      break;
    }
  }
  for (const event of score.events.filter(
    (e) =>
      e.unpitched &&
      (["manual", "imported", "demo"].includes(e.origin ?? "") ||
        e.roleOrigin === "manual"),
  )) {
    const string = event.extensions?.guitar?.string;
    if (
      typeof string !== "number" ||
      !Number.isInteger(string) ||
      string < 1 ||
      string > 6
    )
      continue;
    actions.push({
      id: event.id,
      beat: event.beat,
      durationBeats: Math.min(0.125, event.durationBeats),
      notationDurationBeats: event.durationBeats,
      string,
      fret: 0,
      finger: 0,
      rightFinger: "p",
      kind: "dead",
      velocity: event.velocity * 0.7,
      role: "bass",
      sourceIds: [event.id],
    });
  }
  // A written six-string chord needs one stroke, not six impossible simultaneous fingers.
  const groups = new Map<number, GuitarAction[]>();
  for (const a of actions) {
    const key = Math.round(a.beat * 1000);
    const group = groups.get(key) ?? [];
    group.push(a);
    groups.set(key, group);
  }
  for (const [beat, group] of groups)
    if (group.filter((a) => a.kind === "pluck").length > 4) {
      for (const a of group.filter((a) => a.kind === "pluck")) {
        a.kind = "strum";
        a.stroke = "down";
        a.strokeId = `written-stroke-${beat}`;
      }
    }
  return actions;
}
