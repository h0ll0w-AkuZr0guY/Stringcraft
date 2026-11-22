import type { MusicProject } from "../contracts";
import {
  beatToSeconds,
  secondsToBeat,
  type MusicalScore,
} from "../contracts/score";
export function withReferenceTempo(
  score: MusicalScore,
  bpm: number,
): MusicalScore {
  const next = structuredClone(score);
  next.tempo = [{ beat: 0, bpm }];
  next.timing = "manual";
  next.durationBeats = secondsToBeat(
    next,
    beatToSeconds(score, score.durationBeats),
  );
  next.events = score.events.map((e) => {
    const beat = secondsToBeat(next, beatToSeconds(score, e.beat));
    return {
      ...e,
      beat,
      durationBeats:
        secondsToBeat(next, beatToSeconds(score, e.beat + e.durationBeats)) -
        beat,
    };
  });
  const mapped = (beat: number) =>
    secondsToBeat(next, beatToSeconds(score, beat));
  next.chords = score.chords.map((c) => ({
    ...c,
    beat: mapped(c.beat),
    durationBeats: mapped(c.beat + c.durationBeats) - mapped(c.beat),
  }));
  next.sections = score.sections.map((s) => ({
    ...s,
    beat: mapped(s.beat),
    endBeat: mapped(s.endBeat),
  }));
  // A tempo correction can shift the notated bar grid, so the pickup needs reconfirming.
  if (next.pickupBeats) delete next.pickupBeats;
  return next;
}

export function projectScore(project: MusicProject): MusicalScore {
  if (project.score) return structuredClone(project.score);
  const score: MusicalScore = {
    version: 2,
    durationBeats: 1,
    tempo: [{ beat: 0, bpm: project.bpm }],
    meter: [{ beat: 0, numerator: 4, denominator: 4 }],
    beatOffsetSeconds: project.beatOffset,
    timing: project.sourceKind === "audio" ? "unconfirmed" : "imported",
    events: [],
    chords: [],
    sections: [],
    warnings: [],
  };
  score.durationBeats = Math.max(0.25, secondsToBeat(score, project.duration));
  // This is a projection of the selected voice, not evidence of source separation.
  score.events = project.melody
    .map((n) => {
      const beat = Math.max(0, secondsToBeat(score, n.start));
      return {
        id: n.id,
        voice: "melody",
        beat,
        durationBeats: Math.min(
          score.durationBeats - beat,
          Math.max(0.01, secondsToBeat(score, n.start + n.duration) - beat),
        ),
        midi: n.pitch.midi,
        velocity: n.velocity,
        sourceIds: [n.id],
        origin: n.source,
        activation: n.score,
        roleOrigin: "inferred" as const,
      };
    })
    .filter((n) => n.durationBeats > 0);
  if (score.timing === "unconfirmed")
    score.warnings.push("速度与首拍尚未确认，4/4 仅为可编辑的编配网格。");
  return score;
}
/** Explicit copy migration. Never overwrites the original project identity. */
export function upgradeProject(project: MusicProject): MusicProject {
  const copy = structuredClone(project);
  copy.id = crypto.randomUUID();
  copy.name += " · v2 副本";
  copy.schemaVersion = 2;
  copy.score = projectScore(project);
  copy.migratedFrom = project.id;
  copy.createdAt = copy.updatedAt = new Date().toISOString();
  return copy;
}
