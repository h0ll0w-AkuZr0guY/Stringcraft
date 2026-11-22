import type { MusicProject, NoteEvent } from "../contracts";
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
  return {
    schemaVersion: 1,
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
}
export function noteName(midi: number) {
  return (
    ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][
      ((midi % 12) + 12) % 12
    ] +
    (Math.floor(midi / 12) - 1)
  );
}
