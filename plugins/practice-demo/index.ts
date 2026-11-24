import type {
  PracticeAttack,
  PracticeChart,
  PracticePlugin,
  PracticeReport,
} from "../../packages/contracts/practice";
const banks = [
  ["C", [-1, 3, 2, 0, 1, 0]],
  ["Am", [-1, 0, 2, 2, 1, 0]],
  ["F", [1, 3, 3, 2, 1, 1]],
  ["G", [3, 2, 0, 0, 0, 3]],
] as const;
export function demoChart(instrument: "piano" | "guitar"): PracticeChart {
  const chart: PracticeChart = {
    instrument,
    title: instrument === "piano" ? "晨光练习" : "四和弦练习",
    duration: 16,
    bpm: 120,
    chords: [],
    attacks: [],
  };
  if (instrument === "piano") {
    const melody = [
      60, 62, 64, 67, 65, 64, 62, 60, 64, 67, 69, 67, 65, 64, 62, 60,
    ];
    chart.attacks = melody.map((midi, i) => ({
      id: "n" + i,
      at: i + 0.5,
      duration: 0.55,
      measure: Math.floor(i / 2) + 1,
      token: "key:right:" + midi,
      pitches: [midi],
      label:
        ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"][
          midi % 12
        ] + "4",
    }));
  } else {
    const tuning = [40, 45, 50, 55, 59, 64];
    chart.chords = banks.map(([name, frets], i) => ({
      id: name,
      name,
      frets: [...frets],
      pitches: frets.map((f, s) => (f < 0 ? null : tuning[s] + f)),
      firstBeat: i * 4,
    }));
    for (let i = 0; i < 32; i++) {
      const chord = chart.chords[Math.floor(i / 8)];
      const direction = i % 4 === 3 ? "up" : "down";
      chart.attacks.push({
        id: "ch" + i,
        at: i * 0.5,
        duration: 0.25,
        measure: Math.floor(i / 4) + 1,
        token: "strum:" + direction + ":" + chord.id,
        pitches: chord.pitches.filter((p) => p !== null),
        label: chord.name + (direction === "up" ? " ↑" : " ↓"),
      });
    }
  }
  return chart;
}
export const demoPractice: PracticePlugin = {
  sdk: 1,
  modes: ["free", "rhythm"],
  create(chart, mode) {
    let pending: PracticeAttack[] = [];
    let report: PracticeReport = { hits: 0, misses: 0, wrong: 0, history: [] };
    return {
      begin(start, end) {
        pending = chart.attacks.filter(
          (a) => a.at >= start - 0.002 && a.at < end,
        );
        report = { hits: 0, misses: 0, wrong: 0, history: [] };
      },
      press(token, at) {
        if (mode !== "rhythm") return;
        const i = pending.findIndex(
          (a) => a.token === token && Math.abs(at - a.at) <= 0.22,
        );
        if (i < 0) {
          report.wrong++;
          report.history.push({ label: "再看一下键位", verdict: "wrong" });
          return;
        }
        const [event] = pending.splice(i, 1);
        report.hits++;
        report.history.push({
          eventId: event.id,
          measure: event.measure,
          label: event.label,
          verdict: "hit",
        });
      },
      tick(at) {
        if (mode === "rhythm")
          while (pending[0] && pending[0].at < at - 0.22) {
            const event = pending.shift()!;
            report.misses++;
            report.history.push({
              eventId: event.id,
              measure: event.measure,
              label: event.label,
              verdict: "missed",
            });
          }
      },
      next: () => pending[0],
      report: () => ({ ...report, history: report.history.slice(-16) }),
    };
  },
};
