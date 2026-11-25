import type * as Alpha from "@coderline/alphatab";
import type { MusicProject, ScoreHit } from "../../packages/contracts";
import { beatToSeconds, secondsToBeat } from "../../packages/contracts/score";
import { projectScore } from "../../packages/music/score";
import { tabMeasures } from "./notation";
import type { GuitarPerformance } from "./types";

/** Structured alphaTab model; independent voices and explicit ties, never flat alphaTex chords. */
export function alphaScore(
  alpha: typeof Alpha,
  project: MusicProject,
  showFingering = false,
  bind?: (beat: Alpha.model.Beat, hit: ScoreHit) => void,
) {
  const m = alpha.model,
    score = new m.Score(),
    track = new m.Track(),
    staff = new m.Staff();
  score.title = project.name;
  score.subTitle =
    "标准调弦 E A D G B E · 变调夹 " + (project.arrangement?.capo ?? 0) + " 品";
  score.addTrack(track);
  track.addStaff(staff);
  track.name = "吉他";
  track.playbackInfo.program = 24;
  staff.stringTuning = new m.Tuning("Standard", [64, 59, 55, 50, 45, 40], true);
  staff.capo = project.arrangement?.capo ?? 0;
  staff.displayTranspositionPitch = -12;
  staff.showTablature = true;
  staff.showStandardNotation = true;
  const musical = project.arrangement?.score ?? projectScore(project),
    notes = project.arrangement?.notes ?? [];
  const origins = new Map<string, Alpha.model.Note>();
  const grips =
    (project.arrangement?.performance as GuitarPerformance | undefined)
      ?.grips ?? [];
  for (const grip of grips) {
    const chord = new m.Chord();
    chord.name = grip.name;
    chord.strings = [...grip.shape.frets];
    chord.firstFret = Math.max(
      1,
      Math.min(...chord.strings.filter((x) => x > 0)),
    );
    if (!Number.isFinite(chord.firstFret) || chord.firstFret < 4)
      chord.firstFret = 1;
    chord.showName = chord.showDiagram = true;
    staff.addChord(grip.chordId, chord);
  }
  const strikes = new Map<string, number>();
  for (const note of notes)
    if (note.strokeId)
      strikes.set(
        note.strokeId,
        Math.min(note.start, strikes.get(note.strokeId) ?? Infinity),
      );
  const roles = (["melody", "bass", "harmony"] as const).filter((role) =>
    notes.some(
      (n) => (n.strokeId ? "harmony" : (n.role ?? "harmony")) === role,
    ),
  );
  if (!roles.length) roles.push("melody");
  const written = notes.map((n) => ({
    note: n,
    start:
      Math.round(
        secondsToBeat(
          musical,
          n.strokeId ? strikes.get(n.strokeId)! : n.start,
        ) * 4,
      ) / 4,
    end: Math.max(
      Math.round(secondsToBeat(musical, n.start) * 4) / 4 + 0.25,
      n.dead && n.notationDurationBeats
        ? Math.round(secondsToBeat(musical, n.start) * 4) / 4 +
            n.notationDurationBeats
        : Math.round(secondsToBeat(musical, n.start + n.duration) * 4) / 4,
    ),
  }));
  for (const measure of tabMeasures(project)) {
    const master = new m.MasterBar(),
      bar = new m.Bar();
    const meter =
      musical.meter.findLast((t) => t.beat <= measure.beat) ?? musical.meter[0];
    master.timeSignatureNumerator = meter.numerator;
    master.isAnacrusis = measure.index === 0 && !!musical.pickupBeats;
    master.timeSignatureDenominator = meter.denominator;
    const part = musical.sections.find(
      (s) => s.beat >= measure.beat - 0.001 && s.beat < measure.endBeat - 0.001,
    );
    if (part) {
      const section = new m.Section();
      section.text = part.label;
      section.marker = "";
      master.section = section;
    }
    const tempo =
      musical.tempo.findLast((t) => t.beat <= measure.beat) ?? musical.tempo[0];
    if (
      measure.index === 0 ||
      musical.tempo.some((t) => Math.abs(t.beat - measure.beat) < 0.001)
    )
      master.tempoAutomations.push(
        m.Automation.buildTempoAutomation(false, 0, tempo.bpm, 2),
      );
    for (const point of musical.tempo.filter(
      (t) => t.beat > measure.beat && t.beat < measure.endBeat,
    ))
      master.tempoAutomations.push(
        m.Automation.buildTempoAutomation(
          false,
          (point.beat - measure.beat) / (measure.endBeat - measure.beat),
          point.bpm,
          2,
        ),
      );
    score.addMasterBar(master);
    staff.addBar(bar);
    for (const role of roles) {
      const voice = new m.Voice();
      bar.addVoice(voice);
      const roleNotes = written.filter(
        ({ note: n }) =>
          (n.strokeId ? "harmony" : (n.role ?? "harmony")) === role,
      );
      const boundaries = [
        ...new Set([
          measure.beat,
          measure.endBeat,
          ...roleNotes
            .flatMap((n) => [n.start, n.end])
            .filter((b) => b > measure.beat && b < measure.endBeat),
        ]),
      ].sort((a, b) => a - b);
      for (let interval = 0; interval < boundaries.length - 1; interval++) {
        let beat = boundaries[interval];
        while (beat < boundaries[interval + 1] - 0.001) {
          const available = boundaries[interval + 1] - beat;
          const values: [number, Alpha.model.Duration, number][] = [
            [4, m.Duration.Whole, 0],
            [3, m.Duration.Half, 1],
            [2, m.Duration.Half, 0],
            [1.5, m.Duration.Quarter, 1],
            [1, m.Duration.Quarter, 0],
            [0.75, m.Duration.Eighth, 1],
            [0.5, m.Duration.Eighth, 0],
            [0.25, m.Duration.Sixteenth, 0],
          ];
          // Offbeat fragments stop at the next beat; regular quarter/half notes remain whole.
          const offset = (beat - measure.beat) % 1;
          const maximum =
            offset > 0.001 ? Math.min(available, 1 - offset) : available;
          const [length, duration, dots] =
            values.find(([length]) => length <= maximum + 0.001) ??
            values.at(-1)!;
          const cell = new m.Beat();
          cell.duration = duration;
          cell.dots = dots;
          voice.addBeat(cell);
          const chord =
            role === roles.at(-1) &&
            grips.find((grip) => Math.abs(grip.beat - beat) < 0.002);
          if (chord) cell.chordId = chord.chordId;
          for (const { note: n, start, end } of roleNotes) {
            if (start > beat + 0.001 || end <= beat + 0.001) continue;
            const note = new m.Note();
            note.string = 7 - n.string;
            note.fret = n.fret;
            note.isDead = !!n.dead;
            note.isTieDestination = start < beat - 0.001;
            note.isLetRing = !!n.letRing;
            note.isPalmMute = n.technique === "pm";
            if (!note.isTieDestination && n.stroke) {
              cell.brushType =
                n.stroke === "down"
                  ? m.BrushType.BrushDown
                  : m.BrushType.BrushUp;
              cell.brushDuration = 60;
            }
            if (showFingering && n.leftFinger)
              note.leftHandFinger = n.leftFinger;
            if (showFingering && n.rightFinger)
              note.rightHandFinger = {
                p: m.Fingers.Thumb,
                i: m.Fingers.IndexFinger,
                m: m.Fingers.MiddleFinger,
                a: m.Fingers.AnnularFinger,
              }[n.rightFinger];
            if (!note.isTieDestination) {
              if (
                n.linkFrom &&
                (n.attack === "hammer" || n.attack === "pull")
              ) {
                const previous = origins.get(n.linkFrom);
                if (previous) previous.isHammerPullOrigin = true;
              }
              if (n.linkFrom && n.attack === "slide") {
                const previous = origins.get(n.linkFrom);
                if (previous) previous.slideOutType = m.SlideOutType.Legato;
              }
            }
            origins.set(n.id, note);
            cell.addNote(note);
          }
          const sounding = roleNotes.filter(
            (n) => n.start <= beat + 0.001 && n.end > beat + 0.001,
          );
          const hit: ScoreHit = {
            noteIds: sounding.map((n) => n.note.id),
            startSeconds: Math.min(
              project.duration,
              Math.max(
                0,
                Math.min(
                  ...(sounding.length
                    ? sounding.map((n) =>
                        n.start < beat - 0.001
                          ? beatToSeconds(musical, beat)
                          : n.note.start,
                      )
                    : [beatToSeconds(musical, beat)]),
                ),
              ),
            ),
            endSeconds: Math.min(
              project.duration,
              beatToSeconds(musical, beat + length),
            ),
          };
          hit.endSeconds = Math.max(
            hit.endSeconds,
            Math.min(project.duration, hit.startSeconds + 0.001),
          );
          bind?.(cell, hit);
          beat += length;
        }
      }
    }
  }
  score.finish(new alpha.Settings());
  return score;
}
