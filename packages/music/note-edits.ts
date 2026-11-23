import {
  validateNotes,
  type MusicProject,
  type NoteEvent,
  type NoteEditorState,
  type NoteOverride,
} from "../contracts";
export const emptyNoteEditor = (): NoteEditorState => ({
  base: [],
  commands: [],
  cursor: 0,
  filter: { strength: 0, minimumDuration: 0, low: 0, high: 127 },
});
export function correctedNotes(
  p: Pick<MusicProject, "notes" | "noteEditor">,
): NoteEvent[] {
  const map = new Map(p.notes.map((n) => [n.id, n]));
  const state = p.noteEditor;
  for (const change of [
    ...(state?.base ?? []),
    ...(state?.commands.slice(0, state.cursor).flatMap((c) => c.changes) ?? []),
  ])
    if (change.note) map.set(change.id, change.note);
    else map.delete(change.id);
  return [...map.values()].sort(
    (a, b) =>
      a.start - b.start ||
      a.pitch.midi - b.pitch.midi ||
      a.id.localeCompare(b.id),
  );
}
export function filteredNotes(p: Pick<MusicProject, "notes" | "noteEditor">) {
  const f = p.noteEditor?.filter ?? emptyNoteEditor().filter;
  return correctedNotes(p).filter(
    (n) =>
      n.score >= f.strength &&
      n.duration >= f.minimumDuration &&
      n.pitch.midi >= f.low &&
      n.pitch.midi <= f.high,
  );
}
export function commitNotes(
  p: MusicProject,
  changes: NoteOverride[],
): MusicProject {
  const current = correctedNotes(p),
    byId = new Map(current.map((n) => [n.id, n]));
  if (new Set(changes.map((c) => c.id)).size !== changes.length)
    throw new Error("一次编辑包含重复音符标识");
  if (!changes.length) return p;
  for (const c of changes) {
    if (c.note) {
      validateNotes([c.note]);
      if (
        c.note.id !== c.id ||
        c.note.start + c.note.duration > p.duration + 0.001
      )
        throw new Error("校订音符超出项目时间范围");
    }
  }
  const state = structuredClone(p.noteEditor ?? emptyNoteEditor());
  state.commands = state.commands.slice(0, state.cursor);
  state.commands.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    changes: structuredClone(changes),
    before: changes.map((c) => byId.get(c.id) ?? null),
  });
  state.cursor = state.commands.length;
  if (state.commands.length > 100) {
    const base = new Map(state.base.map((c) => [c.id, c]));
    for (const c of state.commands.shift()!.changes) base.set(c.id, c);
    state.base = [...base.values()];
    state.cursor--;
  }
  return { ...p, noteEditor: state };
}
