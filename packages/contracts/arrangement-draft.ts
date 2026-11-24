import type { Difficulty, NoteEvent } from "./index";
import {
  validateMusicAssessment,
  type MusicAssessment,
} from "./music-knowledge";
import {
  validateScore,
  type ArrangementGoal,
  type MusicalScore,
} from "./score";

export type AccompanimentPattern = "strum" | "arpeggio" | "auto";
export type ArrangementProfile = "classic" | "phrasing";
export interface ArrangementPlanningOptions {
  profile?: ArrangementProfile;
  difficulty: Difficulty;
  goal: ArrangementGoal;
  pattern: AccompanimentPattern;
}
export interface ArrangementPlanningContext {
  score: MusicalScore;
  sourceKind: "audio" | "demo" | "midi" | "musicxml";
  inputFingerprint: string;
  melodyEvidence?: NoteEvent[];
  bassEvidence?: NoteEvent[];
  melodyCandidates?: NoteEvent[];
}
export interface ArrangementPhrase {
  id: string;
  beat: number;
  endBeat: number;
  energy: "gentle" | "steady" | "emphatic";
  texture: "strum" | "arpeggio";
}
export interface ArrangementDraft {
  assessment?: MusicAssessment;
  version: 1;
  plannerVersion: string;
  inputFingerprint: string;
  options: ArrangementPlanningOptions;
  score: MusicalScore;
  phrases: ArrangementPhrase[];
  decisions: { sourceIds: string[]; reason: string }[];
  statistics: {
    inputChordKinds: number;
    outputChordKinds: number;
    inputIntervals: number;
    outputIntervals: number;
    anchors: number;
  };
}
export function validateArrangementDraft(draft: ArrangementDraft) {
  if (
    !draft ||
    draft.version !== 1 ||
    typeof draft.plannerVersion !== "string" ||
    typeof draft.inputFingerprint !== "string" ||
    !draft.inputFingerprint ||
    !draft.options ||
    !["easy", "normal", "hard", "expert"].includes(draft.options.difficulty) ||
    !["accompaniment", "fingerstyle", "melody"].includes(draft.options.goal) ||
    (draft.options.profile !== undefined &&
      !["classic", "phrasing"].includes(draft.options.profile)) ||
    !["strum", "arpeggio", "auto"].includes(draft.options.pattern) ||
    !Array.isArray(draft.phrases) ||
    draft.phrases.length > 10000 ||
    !Array.isArray(draft.decisions) ||
    draft.decisions.length > 20000
  )
    throw new Error("音乐编配稿无效");
  validateScore(draft.score);
  if (draft.assessment) validateMusicAssessment(draft.assessment);
  let end = 0;
  for (const p of draft.phrases) {
    if (
      !p ||
      typeof p.id !== "string" ||
      ![p.beat, p.endBeat].every(Number.isFinite) ||
      p.beat < 0 ||
      p.beat < end - 0.001 ||
      p.endBeat <= p.beat ||
      p.endBeat > draft.score.durationBeats + 0.001 ||
      !["gentle", "steady", "emphatic"].includes(p.energy) ||
      !["strum", "arpeggio"].includes(p.texture)
    )
      throw new Error("乐句编排无效");
    end = p.endBeat;
  }
  for (const d of draft.decisions)
    if (
      !d ||
      typeof d.reason !== "string" ||
      !Array.isArray(d.sourceIds) ||
      d.sourceIds.some((id) => typeof id !== "string")
    )
      throw new Error("编配来源无效");
  if (
    !draft.statistics ||
    [
      "inputChordKinds",
      "outputChordKinds",
      "inputIntervals",
      "outputIntervals",
      "anchors",
    ].some((key) => {
      const v = draft.statistics[key as keyof ArrangementDraft["statistics"]];
      return !Number.isInteger(v) || v < 0;
    })
  )
    throw new Error("编配统计无效");
}
