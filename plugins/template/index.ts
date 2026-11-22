/** Copy to a new plugin directory. Do not add this template to the catalog. */
import type { MusicPlugin, NoteEvent } from "../../packages/contracts";
export function extractMelody(notes: NoteEvent[]): NoteEvent[] {
  return notes
    .filter((n) => n.score >= 0.5)
    .map((n) => ({ ...n, role: "melody" }));
}
export default { extractMelody } satisfies MusicPlugin;
