import type * as Alpha from "@coderline/alphatab";
import type { MusicProject, ScoreHit } from "../../packages/contracts";
import { beatToSeconds } from "../../packages/contracts";
import { measureGrid } from "../../packages/music/structure";
import { pianoMusicXml } from "./musicxml";

export function alphaPiano(
  alpha: typeof Alpha,
  project: MusicProject,
  bind: (beat: Alpha.model.Beat, hit: ScoreHit) => void,
) {
  const piano = project.piano!;
  const score = alpha.importer.ScoreLoader.loadScoreFromBytes(
    new TextEncoder().encode(pianoMusicXml(project.name, piano)),
  );
  const bars = measureGrid(piano.score);
  const spans = [...piano.notes].sort((a, b) => a.start - b.start);
  for (const staff of score.tracks[0].staves) {
    staff.showTablature = false;
    staff.showStandardNotation = true;
    let index = 0;
    let active: typeof spans = [];
    for (const bar of staff.bars) {
      const measure = bars[bar.index];
      if (!measure) continue;
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          const when = Math.min(
            measure.endBeat,
            measure.beat + beat.playbackStart / 960,
          );
          const to = Math.min(
            measure.endBeat,
            when + beat.playbackDuration / 960,
          );
          const start = beatToSeconds(piano.score, when),
            end = beatToSeconds(piano.score, to);
          while (index < spans.length && spans[index].start <= start + 0.002)
            active.push(spans[index++]);
          active = active.filter((n) => n.start + n.duration > start - 0.002);
          const pitches = new Set(beat.notes.map((n) => n.realValue));
          bind(beat, {
            startSeconds: start,
            endSeconds: end,
            noteIds: active
              .filter((n) => pitches.has(n.pitch.midi))
              .map((n) => n.id),
          });
        }
      }
    }
  }
  return score;
}
