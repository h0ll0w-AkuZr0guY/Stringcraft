import type { MusicProject, NoteEvent } from "../contracts";
import { projectScore } from "./score";
/** Original fixed composition. This fixture is never described as model inference. */
export function demoProject(): MusicProject {
  const pitches = [
    64, 67, 69, 67, 64, 62, 60, 62, 64, 67, 71, 69, 67, 64, 62, 64, 67, 69, 72,
    71, 69, 67, 64, 62, 64, 67, 69, 67, 64, 62, 60, 64,
  ];
  const notes: NoteEvent[] = pitches.map((midi, i) => ({
    id: `demo-m${i}`,
    start: i * 0.48,
    duration: i % 8 === 7 ? 0.85 : 0.4,
    pitch: { midi },
    velocity: 0.7,
    score: 0.95,
    source: "demo",
    role: "melody",
  }));
  for (let i = 0; i < 8; i++)
    notes.push({
      id: `demo-b${i}`,
      start: i * 1.92,
      duration: 1.7,
      pitch: { midi: [40, 45, 48, 43][i % 4] },
      velocity: 0.5,
      score: 0.65,
      source: "demo",
      role: "bass",
    });
  const project: MusicProject = {
    schemaVersion: 2,
    id: crypto.randomUUID(),
    name: "林间来信 · 原创练习曲",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    duration: 16.5,
    bpm: 125,
    beatOffset: 0,
    sourceOffset: 0,
    notes,
    melody: notes.filter((n) => n.role === "melody"),
    arrangement: null,
    pluginVersions: {},
    sourceKind: "demo",
  };
  project.score = projectScore(project);
  project.score.timing = "manual";
  project.score.chords = Array.from({ length: 9 }, (_, i) => ({
    id: `demo-chord-${i}`,
    beat: i * 4,
    durationBeats: Math.min(4, project.score!.durationBeats - i * 4),
    root: [4, 9, 0, 7][i % 4],
    quality: i % 4 < 2 ? ("minor" as const) : ("major" as const),
    origin: "manual" as const,
  })).filter((c) => c.durationBeats > 0);
  project.score.sections = [
    {
      id: "demo-verse",
      beat: 0,
      endBeat: project.score.durationBeats,
      label: "原创练习段",
      origin: "manual",
    },
  ];
  return project;
}
export function noteName(midi: number) {
  return (
    ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][
      ((midi % 12) + 12) % 12
    ] +
    (Math.floor(midi / 12) - 1)
  );
}
