export * from "./arrangement-draft";
export * from "./audio-reference";
export * from "./harmony";
export * from "./music-knowledge";
export * from "./note-editor";
export * from "./score";
export * from "./score-view";
export * from "./timing";
export * from "./tracks";
import {
  validateArrangementDraft,
  type AccompanimentPattern,
  type ArrangementDraft,
  type ArrangementPlanningContext,
  type ArrangementPlanningOptions,
} from "./arrangement-draft";
import { validateAudioReference, type AudioReference } from "./audio-reference";
import {
  validateHarmony,
  validateLocalAnalysis,
  type HarmonyAnalysis,
  type LocalAnalysisRun,
} from "./harmony";
import type { MusicAssessment } from "./music-knowledge";
import type {
  NoteEditorState,
  NoteViewPlugin,
  TranscriptionChunk,
  TranscriptionState,
} from "./note-editor";
import { validateNoteEditor } from "./note-editor";
import {
  validateScore,
  type ArrangementGoal,
  type MusicalScore,
  type PerformancePlan,
} from "./score";
import { validateTiming, type TimingAnalysis } from "./timing";
import type { ProjectTrack } from "./tracks";
/** SDK v2 plus the v1 workbench compatibility projection. Seconds remain source time. */
export const SDK_VERSION = 2;
export type Difficulty = "easy" | "normal" | "hard" | "expert";
export interface Pitch {
  midi: number;
  cents?: number;
}
export interface NoteEvent {
  id: string;
  start: number;
  duration: number;
  pitch: Pitch;
  velocity: number;
  score: number;
  source: "detected" | "demo" | "manual" | "generated";
  role?: "melody" | "bass" | "harmony";
  locked?: boolean;
}
export interface GuitarNote extends NoteEvent {
  string: number;
  fret: number;
  technique?: "h" | "p" | "pm";
  leftFinger?: number;
  rightFinger?: "p" | "i" | "m" | "a";
  linkFrom?: string;
  attack?: "pluck" | "hammer" | "pull" | "slide" | "strum" | "dead";
  /** Legacy TAB projection: pitch describes the string position, not a sounded pitch. */
  dead?: boolean;
  /** Guitar percussion may have a notated beat value longer than its noise decay. */
  notationDurationBeats?: number;
  stroke?: "down" | "up";
  strokeId?: string;
  letRing?: boolean;
  articulation?: {
    damp?: boolean;
    releaseSeconds?: number;
    sustainOffset?: number;
  };
}
export interface InstrumentDefinition {
  id: string;
  name: string;
  pitchRange: [number, number];
  tuning?: number[];
  maxFret?: number;
  notation: string[];
  techniques: string[];
}
export interface Arrangement<N extends NoteEvent = GuitarNote> {
  sourceTrackIds?: string[];
  id: string;
  instrumentId: string;
  difficulty: Difficulty;
  capo: number;
  transpose: number;
  notes: N[];
  dropped: { noteId: string; reason: string }[];
  warnings: string[];
  goal?: ArrangementGoal;
  score?: MusicalScore;
  performance?: PerformancePlan<unknown>;
}
export interface MusicProject<N extends NoteEvent = GuitarNote> {
  tracks?: ProjectTrack[];
  schemaVersion: 1 | 2;
  score?: MusicalScore;
  migratedFrom?: string;
  refinement?: {
    pluginId: string;
    profile: string;
    notes: NoteEvent[];
    dropped: { noteId: string; reason: string }[];
  };
  timingAnalysis?: TimingAnalysis;
  harmonyAnalysis?: HarmonyAnalysis;
  arrangementDraft?: ArrangementDraft;
  melodyEvidence?: NoteEvent[];
  localAnalysis?: LocalAnalysisRun;
  noteEditor?: NoteEditorState;
  transcription?: TranscriptionState;
  sourceAudioSha256?: string;
  audioReference?: AudioReference;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  duration: number;
  bpm: number;
  beatOffset: number;
  sourceOffset: number;
  notes: NoteEvent[];
  melody: NoteEvent[];
  arrangement: Arrangement<N> | null;
  pluginVersions: Record<string, string>;
  sourceKind: "audio" | "demo" | "midi" | "musicxml";
}
export type Capability =
  | "transcriber"
  | "melody"
  | "harmony"
  | "timing"
  | "refiner"
  | "instrument"
  | "renderer"
  | "exporter"
  | "advisor"
  | "separator"
  | "note-view"
  | "note-renderer";
export interface PluginManifest {
  audience?: "user" | "internal" | "developer";
  maturity?: "ready" | "experimental" | "example";
  bundle?: string;
  id: string;
  name: string;
  version: string;
  sdk: number;
  description: string;
  capabilities: Capability[];
  runtime: "browser" | "local";
  license: string;
  entry: string;
  sha256: string;
  size: number;
  dependencies: string[];
}
export interface PluginContext {
  signal?: AbortSignal;
  progress?: (value: number, message: string) => void;
}
export interface ArrangeOptions {
  difficulty: Difficulty;
  capo: number;
  transpose: number;
  bpm: number;
  previous?: GuitarNote[];
  goal?: ArrangementGoal;
  score?: MusicalScore;
  pattern?: AccompanimentPattern;
  phrases?: import("./arrangement-draft").ArrangementPhrase[];
}
export interface MusicPlugin {
  assessMusic?: (score: MusicalScore, goal: ArrangementGoal) => MusicAssessment;
  planArrangement?: (
    context: ArrangementPlanningContext,
    options: ArrangementPlanningOptions,
  ) => ArrangementDraft;
  noteView?: NoteViewPlugin;
  scheduleNotes?: (
    ctx: AudioContext,
    notes: NoteEvent[],
    from: number,
    to: number,
    speed: number,
    atTime?: number,
  ) => { origin: number; stop: () => void };
  renderNotes?: (notes: NoteEvent[], duration: number) => Promise<ArrayBuffer>;
  exportNotes?: (notes: NoteEvent[], bpm: number) => Uint8Array;
  analyzeTiming?: (
    samples: Float32Array,
    sampleRate: number,
    noteProposalBpm?: number,
  ) => TimingAnalysis;
  analyzeHarmony?: (notes: NoteEvent[], score: MusicalScore) => MusicalScore;
  analyzeTimeline?: (notes: NoteEvent[], duration: number) => HarmonyAnalysis;
  tempoCandidates?: (notes: NoteEvent[]) => { bpm: number; score: number }[];
  instrument?: InstrumentDefinition;
  extractMelody?: (notes: NoteEvent[]) => NoteEvent[];
  arrange?: (notes: NoteEvent[], options: ArrangeOptions) => Arrangement;
  recommendCapos?: (
    notes: NoteEvent[],
    options: ArrangeOptions,
  ) => { capo: number; score: number }[];
  exportFile?: (
    project: MusicProject,
    format: string,
  ) => { data: Uint8Array | string; mime: string; extension: string };
  transcribe?: (
    samples: Float32Array,
    modelUrl: string,
    wasmUrl: string,
    progress: (value: number) => void,
    chunk?: (chunk: TranscriptionChunk) => void,
  ) => Promise<NoteEvent[]>;
  scheduleAudio?: (
    ctx: AudioContext | OfflineAudioContext,
    notes: NoteEvent[],
    tone: string,
    from?: number,
    to?: number,
    speed?: number,
    atTime?: number,
  ) => Promise<{ origin: number; fallback: number }>;
  prepareAudio?: (
    ctx: AudioContext | OfflineAudioContext,
    notes: NoteEvent[],
    tone: string,
  ) => Promise<void>;
  renderAudio?: (
    notes: NoteEvent[],
    duration: number,
    tone: string,
    progress?: (processed: number, total: number) => void,
  ) => Promise<{ data: ArrayBuffer; fallback: number }>;
  advise?: (
    settings: { key: string; endpoint: string; model: string },
    candidates: { capo: number; score: number }[],
    summary: { notes: number; difficulty: string },
    signal?: AbortSignal,
  ) => Promise<{ capo: number; reason: string }>;
}
export interface NoteRefinerPlugin<Options> {
  refineNotes(
    notes: NoteEvent[],
    options?: Options,
  ): { notes: NoteEvent[]; dropped: { noteId: string; reason: string }[] };
}
export interface Job {
  partial?: { notes: NoteEvent[]; duration: number };
  cacheKey?: string;
  cacheHit?: boolean;
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string;
  result?: unknown;
  error?: { code: string; message: string };
}
export function validateNotes(value: unknown): asserts value is NoteEvent[] {
  if (!Array.isArray(value) || value.length > 100000)
    throw new Error("音符列表无效或过大");
  const ids = new Set<string>();
  for (const n of value) {
    if (
      !n ||
      typeof n.id !== "string" ||
      !n.id ||
      ids.has(n.id) ||
      !Number.isFinite(n.start) ||
      n.start < 0 ||
      !Number.isFinite(n.duration) ||
      n.duration <= 0 ||
      !Number.isInteger(n.pitch?.midi) ||
      n.pitch.midi < 0 ||
      n.pitch.midi > 127 ||
      !Number.isFinite(n.velocity) ||
      n.velocity < 0 ||
      n.velocity > 1 ||
      !Number.isFinite(n.score) ||
      n.score < 0 ||
      n.score > 1 ||
      (n.locked !== undefined && typeof n.locked !== "boolean") ||
      (n.pitch.cents !== undefined && !Number.isFinite(n.pitch.cents)) ||
      !["detected", "demo", "manual", "generated"].includes(n.source)
    )
      throw new Error("音符数据不符合 SDK v1 契约");
    ids.add(n.id);
  }
}
export function validateProject(value: unknown): asserts value is MusicProject {
  const p = value as MusicProject;
  if (
    !p ||
    ![1, 2].includes(p.schemaVersion) ||
    typeof p.id !== "string" ||
    typeof p.name !== "string" ||
    !Number.isFinite(p.duration) ||
    p.duration <= 0 ||
    p.duration > 1800 ||
    !Number.isFinite(Date.parse(p.createdAt)) ||
    !Number.isFinite(Date.parse(p.updatedAt)) ||
    !["audio", "demo", "midi", "musicxml"].includes(p.sourceKind) ||
    !p.pluginVersions ||
    typeof p.pluginVersions !== "object" ||
    Object.values(p.pluginVersions).some((v) => typeof v !== "string") ||
    !Number.isFinite(p.bpm) ||
    p.bpm < 20 ||
    p.bpm > 300 ||
    !Number.isFinite(p.sourceOffset) ||
    p.sourceOffset < 0 ||
    !Number.isFinite(p.beatOffset)
  )
    throw new Error("项目版本或元数据无效");
  validateNotes(p.notes);
  if (p.tracks) {
    if (!Array.isArray(p.tracks) || p.tracks.length > 64)
      throw new Error("轨道列表无效");
    const trackIds = new Set<string>();
    for (const track of p.tracks) {
      if (
        !track ||
        !track.id ||
        typeof track.id !== "string" ||
        track.id.length > 128 ||
        trackIds.has(track.id) ||
        typeof track.name !== "string" ||
        ![
          "original",
          "vocal",
          "instrumental",
          "bass",
          "drums",
          "other",
          "arrangement",
        ].includes(track.role)
      )
        throw new Error("轨道身份无效");
      trackIds.add(track.id);
      validateNotes(track.notes);
      if (track.notes.some((n) => n.start + n.duration > p.duration + 0.01))
        throw new Error("轨道音符超出项目");
      if (track.score) validateScore(track.score);
      if (track.harmonyAnalysis)
        validateHarmony(track.harmonyAnalysis, p.duration);
      for (const events of [track.melody, track.melodyEvidence])
        if (events) {
          validateNotes(events);
          if (events.some((n) => n.start + n.duration > p.duration + 0.01))
            throw new Error("轨道旋律证据超出项目");
        }
      if (track.noteEditor)
        validateNoteEditor({
          ...p,
          notes: track.notes,
          noteEditor: track.noteEditor,
          tracks: undefined,
        });
      const a = track.asset;
      if (
        a &&
        (!/^[a-f0-9]{64}$/.test(a.id) ||
          a.id !== a.sha256 ||
          ![a.duration, a.sampleRate, a.channels, a.offsetSeconds].every(
            Number.isFinite,
          ) ||
          a.duration <= 0 ||
          a.sampleRate < 8000 ||
          a.channels < 1 ||
          a.channels > 8 ||
          a.offsetSeconds < 0)
      )
        throw new Error("轨道音频引用无效");
    }
  }
  if (p.harmonyAnalysis) validateHarmony(p.harmonyAnalysis, p.duration);
  if (p.arrangementDraft) validateArrangementDraft(p.arrangementDraft);
  if (p.melodyEvidence) {
    validateNotes(p.melodyEvidence);
    if (p.melodyEvidence.some((n) => n.start + n.duration > p.duration + 0.01))
      throw new Error("旋律证据超出片段");
  }
  if (p.localAnalysis) validateLocalAnalysis(p.localAnalysis);
  validateNotes(p.melody);
  validateNoteEditor(p);
  if (p.transcription) {
    const t = p.transcription;
    if (
      typeof t.jobId !== "string" ||
      !["running", "complete", "stopped", "error"].includes(t.status) ||
      !Number.isFinite(t.processedSeconds) ||
      t.processedSeconds < 0 ||
      t.processedSeconds > p.duration + 0.01 ||
      typeof t.pluginVersion !== "string" ||
      typeof t.pluginSha256 !== "string" ||
      (t.status === "complete" &&
        Math.abs(t.processedSeconds - p.duration) > 0.01)
    )
      throw new Error("转录进度无效");
  }
  validateAudioReference(p);
  if (p.timingAnalysis) {
    validateTiming(p.timingAnalysis);
    if (p.timingAnalysis.durationSeconds > p.duration + 0.01)
      throw new Error("拍点分析超出项目时长");
  }
  if (p.refinement) {
    validateNotes(p.refinement.notes);
    const originals = new Map(p.notes.map((n) => [n.id, n])),
      kept = new Set(p.refinement.notes.map((n) => n.id));
    for (const note of p.refinement.notes) {
      const original = originals.get(note.id);
      if (
        !original ||
        note.start !== original.start ||
        note.duration !== original.duration ||
        note.pitch.midi !== original.pitch.midi ||
        note.source !== original.source ||
        note.score !== original.score ||
        note.velocity !== original.velocity
      )
        throw new Error("清理结果不能更改或伪造原始候选");
    }
    if (
      !Array.isArray(p.refinement.dropped) ||
      p.refinement.dropped.some(
        (d) =>
          !originals.has(d.noteId) ||
          kept.has(d.noteId) ||
          typeof d.reason !== "string",
      )
    )
      throw new Error("候选清理省略记录无效");
  }
  if (p.schemaVersion === 2 && !p.score) throw new Error("v2 项目缺少音乐结构");
  if (p.score) validateScore(p.score);
  for (const n of [...p.notes, ...p.melody, ...(p.arrangement?.notes ?? [])]) {
    if (n.start + n.duration > p.duration + 0.01)
      throw new Error("音符超出项目时间范围");
  }
  if (p.arrangement) {
    validateNotes(p.arrangement.notes);
    if (
      !["easy", "normal", "hard", "expert"].includes(
        p.arrangement.difficulty,
      ) ||
      !Number.isInteger(p.arrangement.capo) ||
      p.arrangement.capo < 0 ||
      p.arrangement.capo > 12 ||
      !Number.isInteger(p.arrangement.transpose) ||
      Math.abs(p.arrangement.transpose) > 12
    )
      throw new Error("编配参数无效");
    const tuning = [64, 59, 55, 50, 45, 40];
    for (const n of p.arrangement.notes) {
      if (
        !Number.isInteger(n.string) ||
        n.string < 1 ||
        n.string > 6 ||
        !Number.isInteger(n.fret) ||
        n.fret < 0 ||
        n.fret + p.arrangement.capo > 24 ||
        n.pitch.midi !== tuning[n.string - 1] + p.arrangement.capo + n.fret
      )
        throw new Error("吉他弦位与音高不一致");
      if (
        (n.dead !== undefined && typeof n.dead !== "boolean") ||
        (n.attack === "dead" && !n.dead) ||
        (n.dead && n.attack !== undefined && n.attack !== "dead")
      )
        throw new Error("闷音与演奏动作不一致");
      if (
        n.notationDurationBeats !== undefined &&
        (!Number.isFinite(n.notationDurationBeats) ||
          n.notationDurationBeats <= 0)
      )
        throw new Error("谱面时值无效");
    }
  }
}
