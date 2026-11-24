import type {
  ArrangementGoal,
  MusicProject,
  NoteEditorState,
  NoteOverride,
  ProjectTrack,
} from "../contracts";
import { commitNotes, emptyNoteEditor, filteredNotes } from "./note-edits";
export function projectTracks(p: MusicProject): ProjectTrack[] {
  const tracks = p.tracks?.length
    ? p.tracks
    : [
        {
          id: "legacy",
          name:
            p.sourceKind === "audio" ? "原始识别（未独立分轨）" : "导入音乐",
          role: "original" as const,
          notes: p.notes,
          noteEditor: p.noteEditor,
          score: p.score,
          melody: p.melody,
        },
      ];
  return [
    ...tracks,
    ...(p.arrangement
      ? [
          {
            id: "arrangement",
            name: "吉他编配",
            role: "arrangement" as const,
            notes: p.arrangement.notes,
            score: p.arrangement.score,
          },
        ]
      : []),
    ...(p.piano
      ? [
          {
            id: "piano-arrangement",
            name: "钢琴编配",
            role: "arrangement" as const,
            notes: p.piano.notes,
            score: p.piano.score,
          },
        ]
      : []),
  ];
}
export function editorTrackProject(p: MusicProject, id: string): MusicProject {
  const track = projectTracks(p).find((t) => t.id === id);
  if (!track || track.id === "legacy") return p;
  return {
    ...p,
    notes: track.notes,
    noteEditor: track.noteEditor,
    score: track.score,
    melody: track.melody ?? track.melodyEvidence ?? track.notes,
    transcription:
      track.transcription ?? (track.notes.length ? p.transcription : undefined),
    tracks: undefined,
  };
}
export function commitTrackNotes(
  p: MusicProject,
  id: string,
  changes: NoteOverride[],
) {
  if (id === "arrangement" || id === "piano-arrangement")
    throw new Error("编配音符请在乐器谱面中修改弦位和演奏动作。");
  if (!p.tracks?.some((t) => t.id === id)) return commitNotes(p, changes);
  const edited = commitNotes(editorTrackProject(p, id), changes);
  return {
    ...p,
    tracks: p.tracks.map((t) =>
      t.id === id ? { ...t, noteEditor: edited.noteEditor } : t,
    ),
  };
}
export function changeTrackEditor(
  p: MusicProject,
  id: string,
  change: (s: NoteEditorState) => NoteEditorState,
) {
  if (!p.tracks?.some((t) => t.id === id))
    return {
      ...p,
      noteEditor: change(structuredClone(p.noteEditor ?? emptyNoteEditor())),
    };
  return {
    ...p,
    tracks: p.tracks.map((t) =>
      t.id === id
        ? {
            ...t,
            noteEditor: change(
              structuredClone(t.noteEditor ?? emptyNoteEditor()),
            ),
          }
        : t,
    ),
  };
}
export function arrangementTracks(
  p: MusicProject,
  goal: ArrangementGoal,
  phrasing = false,
) {
  const instrumental = p.tracks?.find((t) => t.role === "instrumental"),
    vocal = p.tracks?.find((t) => t.role === "vocal"),
    bass = p.tracks?.find((t) => t.role === "bass");
  const lead = goal === "fingerstyle" ? vocal : instrumental;
  if (instrumental && goal === "fingerstyle" && !lead?.notes.length)
    throw new Error(
      "人声轨还没有旋律转录，请先分析人声；未使用混音或低音冒充。",
    );
  const input = lead ? editorTrackProject(p, lead.id) : p;
  return {
    notes: filteredNotes(input),
    melodyEvidence:
      (phrasing && lead?.phraseEvidence?.length
        ? lead.phraseEvidence
        : lead?.melodyEvidence) ??
      (!instrumental ? p.melodyEvidence : undefined),
    bassEvidence:
      !phrasing || p.sourceKind !== "audio"
        ? undefined
        : bass?.notes.length
          ? filteredNotes(editorTrackProject(p, bass.id))
          : filteredNotes(
              instrumental ? editorTrackProject(p, instrumental.id) : p,
            ).filter((n) => n.pitch.midi <= 55),
    harmony: instrumental?.harmonyAnalysis ?? p.harmonyAnalysis,
    ids: [
      ...new Set(
        [lead?.id, instrumental?.id, bass?.id].filter(
          (id): id is string => !!id,
        ),
      ),
    ],
  };
}
