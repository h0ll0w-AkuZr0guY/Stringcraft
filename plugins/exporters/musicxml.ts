import type { MusicProject, MusicalScore } from "../../packages/contracts";
import { secondsToBeat, validateScore } from "../../packages/contracts";
import { projectScore } from "../../packages/music/score";
import { tabMeasures } from "../guitar/notation";
const escape = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
/** Export the actual arranged sound events, with independent string voices and explicit ties. */
export function musicXML(project: MusicProject): string {
  if (!project.arrangement) throw new Error("请先生成编配");
  const base = project.arrangement.score ?? projectScore(project);
  const score: MusicalScore = {
    ...base,
    events: project.arrangement.notes.map((n) => ({
      id: n.id,
      voice: String(n.string),
      beat: Math.max(0, Math.round(secondsToBeat(base, n.start) * 4) / 4),
      durationBeats: Math.max(
        0.25,
        Math.round(
          (secondsToBeat(base, n.start + n.duration) -
            secondsToBeat(base, n.start)) *
            4,
        ) / 4,
      ),
      midi: n.pitch.midi,
      velocity: n.velocity,
      sourceIds: [n.id],
    })),
  };
  // End a string on the next attack after notation quantization; retain actual seconds elsewhere.
  for (const e of score.events) {
    const next = score.events
      .filter((n) => n.voice === e.voice && n.beat > e.beat + 0.001)
      .sort((a, b) => a.beat - b.beat)[0];
    e.durationBeats = Math.min(
      e.durationBeats,
      next ? next.beat - e.beat : Infinity,
      score.durationBeats - e.beat,
    );
  }
  score.events = score.events.filter((e) => e.durationBeats > 0.001);
  validateScore(score);
  const output = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<score-partwise version="4.0"><work><work-title>${escape(project.name)}</work-title></work><part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list><part id="P1">`,
  ];
  const divisions = 960;
  const duration = (b: number) => Math.max(1, Math.round(b * divisions));
  for (const bar of tabMeasures({
    ...project,
    arrangement: { ...project.arrangement, score },
  })) {
    const meter =
      score.meter.findLast((m) => m.beat <= bar.beat) ?? score.meter[0];
    output.push(
      `<measure number="${bar.index + 1}"${bar.index === 0 && score.pickupBeats ? ' implicit="yes"' : ""}><attributes><divisions>${divisions}</divisions><time><beats>${meter.numerator}</beats><beat-type>${meter.denominator}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`,
    );
    const tempos = score.tempo.filter(
      (t) => t.beat >= bar.beat && t.beat < bar.endBeat,
    );
    for (const t of tempos)
      output.push(
        `<direction><offset>${Math.round((t.beat - bar.beat) * divisions)}</offset><sound tempo="${t.bpm}"/></direction>`,
      );
    for (const c of score.chords.filter(
      (c) => c.beat >= bar.beat && c.beat < bar.endBeat,
    )) {
      const root = (((c.root + project.arrangement.transpose) % 12) + 12) % 12;
      const step = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"][
          root
        ],
        alter = [1, 3, 6, 8, 10].includes(root) ? 1 : 0;
      const kind = {
        major: "major",
        minor: "minor",
        "7": "dominant",
        maj7: "major-seventh",
        m7: "minor-seventh",
        sus4: "suspended-fourth",
      }[c.quality];
      output.push(
        `<harmony><root><root-step>${step}</root-step>${alter ? "<root-alter>1</root-alter>" : ""}</root><kind>${kind}</kind><offset>${Math.round((c.beat - bar.beat) * divisions)}</offset></harmony>`,
      );
    }
    const voices = [...new Set(score.events.map((e) => e.voice))].sort();
    for (const [i, voice] of voices.entries()) {
      if (i)
        output.push(
          `<backup><duration>${duration(bar.endBeat - bar.beat)}</duration></backup>`,
        );
      const events = score.events
        .filter(
          (e) =>
            e.voice === voice &&
            e.beat < bar.endBeat &&
            e.beat + e.durationBeats > bar.beat,
        )
        .sort((a, b) => a.beat - b.beat);
      let cursor = bar.beat;
      const rest = (length: number) => {
        if (length > 0.001)
          output.push(
            `<note><rest/><duration>${duration(length)}</duration><voice>${voice}</voice></note>`,
          );
      };
      for (const e of events) {
        const start = Math.max(e.beat, bar.beat),
          end = Math.min(e.beat + e.durationBeats, bar.endBeat);
        rest(start - cursor);
        const n = project.arrangement.notes.find((n) => n.id === e.id)!;
        const pc = e.midi! % 12,
          step = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"][
            pc
          ],
          alter = [1, 3, 6, 8, 10].includes(pc) ? 1 : 0;
        const before = e.beat < bar.beat,
          after = e.beat + e.durationBeats > bar.endBeat + 0.001;
        const ties = `${before ? '<tie type="stop"/>' : ""}${after ? '<tie type="start"/>' : ""}`;
        const tied = `${before ? '<tied type="stop"/>' : ""}${after ? '<tied type="start"/>' : ""}`;
        const origin = project.arrangement.notes.find(
          (a) => a.linkFrom === e.id,
        );
        const link = (kind: string, type: string) =>
          `<${kind} type="${type}" number="1"/>`;
        const technique = `${!before && n.linkFrom && (n.attack === "hammer" || n.attack === "pull") ? link(n.attack === "hammer" ? "hammer-on" : "pull-off", "stop") : ""}${!after && origin && (origin.attack === "hammer" || origin.attack === "pull") ? link(origin.attack === "hammer" ? "hammer-on" : "pull-off", "start") : ""}`;
        output.push(
          `<note><pitch><step>${step}</step>${alter ? "<alter>1</alter>" : ""}<octave>${Math.floor(e.midi! / 12) - 1}</octave></pitch><duration>${duration(end - start)}</duration>${ties}<voice>${voice}</voice><notations>${tied}<technical><string>${n.string}</string><fret>${n.fret}</fret>${n.leftFinger ? `<fingering>${n.leftFinger}</fingering>` : ""}${technique}</technical></notations></note>`,
        );
        cursor = end;
      }
      rest(bar.endBeat - cursor);
    }
    output.push("</measure>");
  }
  output.push("</part></score-partwise>");
  return output.join("\n");
}
