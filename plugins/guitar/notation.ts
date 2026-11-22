import type { GuitarNote, MusicProject } from "../../packages/contracts";
import { beatToSeconds, secondsToBeat } from "../../packages/contracts/score";
import { projectScore } from "../../packages/music/score";
import { measureGrid } from "../../packages/music/structure";
export interface TabColumn {
  key: string;
  beat: number;
  x: number;
  notes: GuitarNote[];
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
    const columns = [...group.values()].sort((a, b) => a.beat - b.beat);
    const width = Math.max(360, 90 + columns.length * 42);
    let last = 38;
    for (const column of columns) {
      column.x = Math.max(
        last + 38,
        50 + ((column.beat - beat) / (endBeat - beat)) * (width - 105),
      );
      last = column.x;
    }
    measures.push({
      index: measures.length,
      beat,
      endBeat,
      start: beatToSeconds(score, beat),
      end: beatToSeconds(score, endBeat),
      width: Math.max(width, last + 38),
      columns,
    });
  }
  return measures;
}
