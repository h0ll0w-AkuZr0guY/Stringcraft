import type {
  HarmonyAnalysis,
  MusicalScore,
  NoteEditorState,
  NoteEvent,
  TranscriptionState,
} from "./index";
export type TrackRole =
  | "original"
  | "vocal"
  | "instrumental"
  | "bass"
  | "drums"
  | "other"
  | "arrangement";
export interface AudioAssetRef {
  id: string;
  sha256: string;
  duration: number;
  sampleRate: number;
  channels: number;
  offsetSeconds: number;
}
export interface ProjectTrack {
  id: string;
  name: string;
  role: TrackRole;
  notes: NoteEvent[];
  asset?: AudioAssetRef;
  noteEditor?: NoteEditorState;
  transcription?: TranscriptionState;
  score?: MusicalScore;
  melody?: NoteEvent[];
  melodyEvidence?: NoteEvent[];
  harmonyAnalysis?: HarmonyAnalysis;
  analysisRevision?: string;
}
