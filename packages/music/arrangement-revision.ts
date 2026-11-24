import type { MusicProject } from "../contracts";
/** Input revision token, not a security or file-integrity hash. Output fields are excluded. */
export function arrangementRevision(project: MusicProject): string {
  const text = JSON.stringify([
    project.sourceKind,
    project.notes,
    project.noteEditor,
    project.refinement,
    project.score,
    project.bpm,
    project.beatOffset,
    project.melodyEvidence,
    project.tracks?.map((t) => [
      t.id,
      t.notes,
      t.noteEditor,
      t.melodyEvidence,
      t.harmonyAnalysis,
      t.analysisRevision,
    ]),
  ]);
  let a = 2166136261,
    b = 2246822507;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b ^ text.charCodeAt(i), 3266489909);
  }
  return `music-v1:${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}
