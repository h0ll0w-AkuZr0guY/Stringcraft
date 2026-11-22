import type * as Alpha from "@coderline/alphatab";
import type { MusicProject } from "../../packages/contracts";
import { secondsToBeat } from "../../packages/contracts/score";
import { projectScore } from "../../packages/music/score";
import { tabMeasures } from "./notation";

/** Structured alphaTab model; independent voices and explicit ties, never flat alphaTex chords. */
export function alphaScore(alpha: typeof Alpha, project: MusicProject) {
  const m = alpha.model,
    score = new m.Score(),
    track = new m.Track(),
    staff = new m.Staff();
  score.title = project.name;
  score.addTrack(track);
  track.addStaff(staff);
  track.name = "吉他";
  staff.stringTuning = new m.Tuning("Standard", [64, 59, 55, 50, 45, 40], true);
  staff.capo = project.arrangement?.capo ?? 0;
  staff.showTablature = true;
  staff.showStandardNotation = true;
  const musical = project.arrangement?.score ?? projectScore(project),
    notes = project.arrangement?.notes ?? [];
  const origins = new Map<string, Alpha.model.Note>();
  const roles = (["melody", "bass", "harmony"] as const).filter((role) =>
    notes.some((n) => (n.role ?? "harmony") === role),
  );
  for (const measure of tabMeasures(project)) {
    const master = new m.MasterBar(),
      bar = new m.Bar();
    const meter =
      musical.meter.findLast((t) => t.beat <= measure.beat) ?? musical.meter[0];
    master.timeSignatureNumerator = meter.numerator;
    master.timeSignatureDenominator = meter.denominator;
    const tempo =
      musical.tempo.findLast((t) => t.beat <= measure.beat) ?? musical.tempo[0];
    master.tempoAutomations.push(
      m.Automation.buildTempoAutomation(false, 0, tempo.bpm, 2),
    );
    score.addMasterBar(master);
    staff.addBar(bar);
    for (const role of roles) {
      const voice = new m.Voice();
      bar.addVoice(voice);
      const roleNotes = notes.filter((n) => (n.role ?? "harmony") === role);
      for (
        let beat = measure.beat;
        beat < measure.endBeat - 0.001;
        beat += 0.25
      ) {
        const cell = new m.Beat();
        cell.duration = m.Duration.Sixteenth;
        voice.addBeat(cell);
        for (const n of roleNotes) {
          const start = Math.round(secondsToBeat(musical, n.start) * 4) / 4;
          const end = Math.max(
            start + 0.25,
            Math.round(secondsToBeat(musical, n.start + n.duration) * 4) / 4,
          );
          if (start > beat + 0.001 || end <= beat + 0.001) continue;
          const note = new m.Note();
          note.string = 7 - n.string;
          note.fret = n.fret;
          note.isTieDestination = start < beat - 0.001;
          note.isLetRing = !!n.letRing;
          note.isPalmMute = n.technique === "pm";
          if (n.leftFinger) note.leftHandFinger = n.leftFinger;
          if (n.rightFinger)
            note.rightHandFinger = {
              p: m.Fingers.Thumb,
              i: m.Fingers.IndexFinger,
              m: m.Fingers.MiddleFinger,
              a: m.Fingers.AnnularFinger,
            }[n.rightFinger];
          if (!note.isTieDestination) {
            origins.set(n.id, note);
            if (n.linkFrom && (n.attack === "hammer" || n.attack === "pull")) {
              const previous = origins.get(n.linkFrom);
              if (previous) previous.isHammerPullOrigin = true;
            }
            if (n.linkFrom && n.attack === "slide") {
              const previous = origins.get(n.linkFrom);
              if (previous) previous.slideOutType = m.SlideOutType.Legato;
            }
          }
          cell.addNote(note);
        }
      }
    }
  }
  score.finish(new alpha.Settings());
  return score;
}
