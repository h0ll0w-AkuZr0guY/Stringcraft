import { validateNotes, type NoteEvent, type MusicProject } from "./index";
export interface NoteOverride {
  id: string;
  note: NoteEvent | null;
}
export interface NoteEditCommand {
  id: string;
  at: string;
  changes: NoteOverride[];
  before: (NoteEvent | null)[];
}
export interface NoteEditorState {
  base: NoteOverride[];
  commands: NoteEditCommand[];
  cursor: number;
  filter: {
    strength: number;
    minimumDuration: number;
    low: number;
    high: number;
  };
}
export interface TranscriptionState {
  jobId: string;
  status: "running" | "complete" | "stopped" | "error";
  processedSeconds: number;
  pluginVersion: string;
  pluginSha256: string;
  modelSha256?: string;
  error?: string;
}
export interface TranscriptionChunk {
  notes: NoteEvent[];
  processedSeconds: number;
  complete: boolean;
}
export interface NoteWindow {
  from: number;
  to: number;
  high: number;
  rowHeight: number;
  width: number;
  height: number;
  duration: number;
  time: number;
  wave: number[];
  processed: number;
}
export interface NoteSpatialIndex {
  query(from: number, to: number, low: number, high: number): NoteEvent[];
}
export interface NoteViewPlugin {
  index(notes: NoteEvent[]): NoteSpatialIndex;
  paint(
    ctx: CanvasRenderingContext2D,
    view: NoteWindow,
    notes: NoteEvent[],
    selected: Set<string>,
  ): void;
}

export function validateNoteEditor(p: MusicProject) {
  const s = p.noteEditor;
  if (!s) return;
  if (
    !Array.isArray(s.base) ||
    !Array.isArray(s.commands) ||
    s.base.length > 100000 ||
    s.commands.length > 100 ||
    !Number.isInteger(s.cursor) ||
    s.cursor < 0 ||
    s.cursor > s.commands.length ||
    !s.filter
  )
    throw new Error("音符编辑记录无效");
  const f = s.filter;
  if (
    ![f.strength, f.minimumDuration, f.low, f.high].every(Number.isFinite) ||
    f.strength < 0 ||
    f.strength > 1 ||
    f.minimumDuration < 0 ||
    f.minimumDuration > 300 ||
    !Number.isInteger(f.low) ||
    !Number.isInteger(f.high) ||
    f.low < 0 ||
    f.high > 127 ||
    f.low > f.high
  )
    throw new Error("音符筛选条件无效");
  let count = s.base.length;
  for (const c of s.commands) {
    if (
      !c ||
      typeof c.id !== "string" ||
      !Number.isFinite(Date.parse(c.at)) ||
      !Array.isArray(c.changes) ||
      !Array.isArray(c.before) ||
      c.changes.length !== c.before.length
    )
      throw new Error("音符编辑命令无效");
    count += c.changes.length;
    if (count > 200000) throw new Error("编辑记录过大");
  }
  for (const c of [...s.base, ...s.commands.flatMap((c) => c.changes)]) {
    if (!c || typeof c.id !== "string" || !c.id)
      throw new Error("音符编辑标识无效");
    if (c.note !== null) {
      validateNotes([c.note]);
      if (
        c.note.id !== c.id ||
        c.note.start + c.note.duration > p.duration + 0.01
      )
        throw new Error("音符编辑超出范围");
    }
  }
  for (const c of s.commands)
    validateNotes(c.before.filter((n): n is NoteEvent => n !== null));
  const merged = new Map(p.notes.map((n) => [n.id, n]));
  for (const c of [
    ...s.base,
    ...s.commands.slice(0, s.cursor).flatMap((c) => c.changes),
  ])
    if (c.note) merged.set(c.id, c.note);
    else merged.delete(c.id);
  validateNotes([...merged.values()]);
}
