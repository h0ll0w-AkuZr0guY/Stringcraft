import type { PianoArrangement } from "../../packages/contracts/piano";
import { measureGrid } from "../../packages/music/structure";

const divisions = 480;
const ticks = (beat: number) => Math.round(beat * divisions);
const letters = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
const sharp = new Set([1, 3, 6, 8, 10]);
const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
/** Physical hand and MusicXML staff stay separate from guitar and from the original score. */
export function pianoMusicXml(name: string, p: PianoArrangement): string {
  const { score, performance } = p;
  const ranges = performance.actions
    .map((a) => ({
      ...a,
      start: ticks(a.beat),
      end: Math.max(ticks(a.beat) + 1, ticks(a.beat + a.durationBeats)),
      staff:
        a.hand === "left" || (a.hand === "unassigned" && a.midi < 60) ? 2 : 1,
    }))
    .sort((a, b) => a.start - b.start);
  const held: typeof ranges = [];
  let rangeIndex = 0;
  const bars = measureGrid(score)
    .map((bar) => {
      const start = ticks(bar.beat),
        end = ticks(bar.endBeat),
        length = end - start;
      if (length <= 0) return "";
      while (rangeIndex < ranges.length && ranges[rangeIndex].start < end) {
        const item = ranges[rangeIndex++];
        if (item.end > start) held.push(item);
      }
      const active = held.filter((a) => a.end > start);
      held.splice(0, held.length, ...active);
      const meter =
        "<time><beats>" +
        bar.numerator +
        "</beats><beat-type>" +
        bar.denominator +
        "</beat-type></time>";
      const attrs =
        "<attributes>" +
        (bar.index === 0 ? "<divisions>480</divisions>" : "") +
        meter +
        (bar.index === 0
          ? '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>'
          : "") +
        "</attributes>";
      const tempos = score.tempo
        .filter((t) => t.beat >= bar.beat && t.beat < bar.endBeat)
        .map(
          (t) =>
            "<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>" +
            t.bpm +
            "</per-minute></metronome></direction-type><offset>" +
            Math.max(0, ticks(t.beat) - start) +
            '</offset><sound tempo="' +
            t.bpm +
            '"/></direction>',
        )
        .join("");
      const staffs = [1, 2]
        .map((staff) => {
          const notes = active.filter((a) => a.staff === staff);
          const edges = [
            ...new Set([
              start,
              end,
              ...notes.flatMap((a) => [
                Math.max(start, a.start),
                Math.min(end, a.end),
              ]),
            ]),
          ].sort((a, b) => a - b);
          const cells = edges
            .slice(0, -1)
            .map((at, i) => {
              const next = edges[i + 1],
                span = next - at;
              const sounding = notes.filter((a) => a.start <= at && a.end > at);
              const props =
                "<duration>" + span + "</duration><voice>" + staff + "</voice>";
              if (!sounding.length)
                return (
                  "<note><rest/>" +
                  props +
                  "<staff>" +
                  staff +
                  "</staff></note>"
                );
              return sounding
                .map((a, index) => {
                  const pitch = a.midi % 12,
                    ties = [
                      ...(a.start < at ? ["stop"] : []),
                      ...(a.end > next ? ["start"] : []),
                    ];
                  const typed = ties
                    .map((type) => '<tie type="' + type + '"/>')
                    .join("");
                  const notation =
                    ties.map((type) => '<tied type="' + type + '"/>').join("") +
                    (a.finger && a.start === at
                      ? "<technical><fingering>" +
                        a.finger +
                        "</fingering></technical>"
                      : "");
                  return (
                    "<note>" +
                    (index ? "<chord/>" : "") +
                    "<pitch><step>" +
                    letters[pitch] +
                    "</step>" +
                    (sharp.has(pitch) ? "<alter>1</alter>" : "") +
                    "<octave>" +
                    (((a.midi / 12) | 0) - 1) +
                    "</octave></pitch><duration>" +
                    span +
                    "</duration>" +
                    typed +
                    "<voice>" +
                    staff +
                    "</voice><staff>" +
                    staff +
                    "</staff>" +
                    (notation
                      ? "<notations>" + notation + "</notations>"
                      : "") +
                    "</note>"
                  );
                })
                .join("");
            })
            .join("");
          return (
            (staff === 2
              ? "<backup><duration>" + length + "</duration></backup>"
              : "") + cells
          );
        })
        .join("");
      return (
        '<measure number="' +
        (bar.index + 1) +
        '"' +
        (bar.pickup ? ' implicit="yes"' : "") +
        ">" +
        attrs +
        tempos +
        staffs +
        "</measure>"
      );
    })
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>' +
    xml(name) +
    '</work-title></work><part-list><score-part id="P1"><part-name>钢琴</part-name></score-part></part-list><part id="P1">' +
    bars +
    "</part></score-partwise>"
  );
}
