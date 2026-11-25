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

export const A4_TAB_WIDTH = 700;
export const A4_TAB_ROWS = 3;

/** Measure boundaries stay intact. Stretch spacing, leaving glyph sizes unchanged. */
export function tabSystems(
  bars: TabMeasure[],
  width: number,
  justify: boolean,
) {
  const preferredWidth = (bar: TabMeasure) =>
    justify
      ? Math.max(
          186,
          65 +
            bar.columns.length * 31 +
            bar.columns.filter((c) => c.chord).length * 12,
        )
      : bar.width;
  const rows: TabMeasure[][] = [];
  let row: TabMeasure[] = [];
  let used = 16;
  for (const bar of bars) {
    if (
      row.length &&
      (used + preferredWidth(bar) > width || (justify && row.length === 3))
    ) {
      rows.push(row);
      row = [];
      used = 16;
    }
    row.push(bar);
    used += preferredWidth(bar);
  }
  if (row.length) rows.push(row);
  if (!justify) return rows;
  return rows.map((system) => {
    const total = system.reduce((sum, bar) => sum + preferredWidth(bar), 0);
    const stretch = (width - 16) / total;
    return system.map((bar) => ({
      ...bar,
      width: preferredWidth(bar) * stretch,
      columns: bar.columns.map((column) => ({
        ...column,
        x:
          42 +
          ((column.x - 42) * (preferredWidth(bar) * stretch - 60)) /
            (bar.width - 60),
      })),
    }));
  });
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
