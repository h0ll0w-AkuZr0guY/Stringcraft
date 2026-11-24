import type { GuitarNote, MusicProject } from "../../packages/contracts";
import { beatToSeconds } from "../../packages/contracts";
import type {
  PracticeAttack,
  PracticeChart,
  PracticeChord,
} from "../../packages/contracts/practice";
import { noteName } from "../../packages/music/demo";
import { measureGrid } from "../../packages/music/structure";
import type { GuitarPerformance } from "../guitar/types";
import { demoChart } from "./index";

export function projectChart(
  project: MusicProject,
  instrument: "piano" | "guitar",
): PracticeChart | undefined {
  const chart: PracticeChart = {
    title: project.name,
    instrument,
    bpm: project.bpm,
    duration: project.duration,
    attacks: [],
    chords: [],
  };
  if (instrument === "piano") {
    const p = project.piano;
    if (!p) return;
    const grid = measureGrid(p.score);
    const notes = new Map(p.notes.map((n) => [n.id, n]));
    for (const a of p.performance.actions) {
      if (a.hand === "unassigned" || a.midi < 21 || a.midi > 108) continue;
      const n = notes.get(a.id);
      if (!n) continue;
      chart.attacks.push({
        id: n.id,
        at: n.start,
        duration: n.duration,
        measure: (grid.findLast((b) => b.beat <= a.beat)?.index ?? 0) + 1,
        token: "key:" + a.hand + ":" + a.midi,
        pitches: [a.midi],
        label: noteName(a.midi),
      });
    }
  } else {
    const result = project.arrangement;
    if (!result) return;
    chart.chords = demoChart("guitar").chords;
    const performance = result.performance as GuitarPerformance | undefined;
    const score = result.score;
    const grid = score ? measureGrid(score) : [];
    const grips = performance?.grips ?? [];
    const names = new Map<string, PracticeChord>();
    for (const grip of grips) {
      const id = grip.name + " " + grip.shape.frets.join(",");
      if (names.has(id)) continue;
      const frets = [...grip.shape.frets].reverse();
      names.set(id, {
        id,
        name: grip.name,
        frets,
        firstBeat: grip.beat,
        pitches: frets.map((f, i) =>
          f < 0 ? null : [40, 45, 50, 55, 59, 64][i] + f + result.capo,
        ),
      });
    }
    if (names.size) chart.chords = [...names.values()];
    const notesById = new Map(result.notes.map((n) => [n.id, n]));
    if (performance && score) {
      const strokes = new Map<string, PracticeAttack>();
      for (const a of performance.actions) {
        const note = notesById.get(a.id);
        const at = note?.start ?? beatToSeconds(score, a.beat);
        if (at < 0 || at >= project.duration) continue;
        const measure =
          (grid.findLast((b) => b.beat <= a.beat)?.index ?? 0) + 1;
        if (a.strokeId) {
          const group = strokes.get(a.strokeId);
          if (group) {
            if (note && !note.dead) group.pitches.push(note.pitch.midi);
            continue;
          }
          const grip = grips.find(
            (g) => g.beat <= a.beat + 0.003 && g.endBeat > a.beat,
          );
          const chord =
            grip && names.get(grip.name + " " + grip.shape.frets.join(","));
          const direction = a.stroke ?? "down",
            label = (chord?.name ?? "") + (direction === "up" ? " ↑" : " ↓");
          const event = {
            id: a.strokeId,
            at,
            duration: 0.24,
            measure,
            token: "strum:" + direction + ":" + (chord?.id ?? "*"),
            pitches: note && !note.dead ? [note.pitch.midi] : [],
            label,
          };
          strokes.set(a.strokeId, event);
          chart.attacks.push(event);
        } else
          chart.attacks.push({
            id: a.id,
            at,
            duration: Math.max(0.06, note?.duration ?? 0.14),
            measure,
            token: "pick:" + a.string,
            pitches: note && !note.dead ? [note.pitch.midi] : [],
            label: a.string + "弦",
          });
      }
    } else {
      for (const n of result.notes as GuitarNote[])
        chart.attacks.push({
          id: n.id,
          at: n.start,
          duration: n.duration,
          measure: Math.floor((n.start * project.bpm) / 240) + 1,
          token: "pick:" + n.string,
          pitches: n.dead ? [] : [n.pitch.midi],
          label: n.string + "弦 " + n.fret + "品",
        });
    }
  }
  chart.attacks.sort((a, b) => a.at - b.at);
  return chart.attacks.length ? chart : undefined;
}
