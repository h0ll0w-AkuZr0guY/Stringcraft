import { Midi } from "@tonejs/midi";
import type { MusicPlugin, NoteEvent } from "../../packages/contracts";
/** Allocate overlapping equal pitches to separate channels, preserving real reattacks. */
export function exportNotes(notes: NoteEvent[], bpm: number) {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  const lanes: {
    end: Map<number, number>;
    track: ReturnType<Midi["addTrack"]>;
  }[] = [];
  for (const n of [...notes].sort((a, b) => a.start - b.start)) {
    let lane = lanes.find(
      (l) => (l.end.get(n.pitch.midi) ?? -1) <= n.start + 0.0000001,
    );
    if (!lane) {
      if (lanes.length === 15)
        throw new Error("同一音高重叠超过 MIDI 可用通道，请先校订重复音符。");
      const track = midi.addTrack();
      track.channel = lanes.length < 9 ? lanes.length : lanes.length + 1;
      track.instrument.number = 0;
      track.name = "Stringcraft notes";
      lane = { end: new Map(), track };
      lanes.push(lane);
    }
    lane.track.addNote({
      midi: n.pitch.midi,
      time: n.start,
      duration: n.duration,
      velocity: Math.max(0.01, n.velocity),
    });
    lane.end.set(n.pitch.midi, n.start + n.duration);
  }
  return midi.toArray();
}
export default { exportNotes } satisfies MusicPlugin;
