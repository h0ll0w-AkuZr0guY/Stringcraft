import type {
  GuitarNote,
  MusicProject,
  ChordSymbol,
} from "../../packages/contracts";
import { beatToSeconds, secondsToBeat } from "../../packages/contracts/score";
import { projectScore } from "../../packages/music/score";
import { measureGrid } from "../../packages/music/structure";
export interface TabColumn {
  key: string;
  beat: number;
  x: number;
  notes: GuitarNote[];
  chord?: ChordSymbol;
}
export interface TabMeasure {
  index: number;
  beat: number;
  endBeat: number;
  start: number;
  end: number;
  width: number;
  columns: TabColumn[];
}
/** Minimum column spacing is physical glyph space, not a fixed number of seconds. */
export function tabMeasures(project: MusicProject): TabMeasure[] {
  const score = project.arrangement?.score ?? projectScore(project),
    notes = project.arrangement?.notes ?? [];
  const measures: TabMeasure[] = [];
  for (const { beat, endBeat } of measureGrid(score)) {
    const group = new Map<string, TabColumn>();
    for (const n of notes) {
      const b = secondsToBeat(score, n.start);
      if (b < beat - 0.001 || b >= endBeat - 0.001) continue;
      const key = n.strokeId ?? String(Math.round(b * 1000));
      const column = group.get(key) ?? { key, beat: b, x: 0, notes: [] };
      column.notes.push(n);
      group.set(key, column);
    }
    const active = score.chords.find(
      (c) => c.beat <= beat + 0.001 && c.beat + c.durationBeats > beat + 0.001,
    );
    for (const chord of [
      ...(active ? [active] : []),
      ...score.chords.filter(
        (c) => c.beat > beat + 0.001 && c.beat < endBeat - 0.001,
      ),
    ]) {
      const at = Math.max(beat, chord.beat),
        column = [...group.values()].find(
          (c) => Math.abs(c.beat - at) < 0.001,
        ) ?? { key: `chord-${chord.id}`, beat: at, x: 0, notes: [] };
      column.chord = chord;
      group.set(column.key, column);
    }
    const columns = [...group.values()].sort((a, b) => a.beat - b.beat);
    const width = Math.max(360, 90 + columns.length * 42);
    let last = 38,
      lastChordRight = -100;
    for (const column of columns) {
      column.x = Math.max(
        last + 38,
        50 + ((column.beat - beat) / (endBeat - beat)) * (width - 105),
      );
      if (column.chord) {
        column.x = Math.max(column.x, lastChordRight + 12);
        lastChordRight = column.x + 62;
      }
      last = column.x;
    }
    measures.push({
      index: measures.length,
      beat,
      endBeat,
      start: beatToSeconds(score, beat),
      end: beatToSeconds(score, endBeat),
      width: Math.max(width, last + 38, lastChordRight + 15),
      columns,
    });
  }
  return measures;
}
