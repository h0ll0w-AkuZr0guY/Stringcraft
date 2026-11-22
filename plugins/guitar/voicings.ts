import type { ChordSymbol } from "../../packages/contracts/score";
export const tuning = [64, 59, 55, 50, 45, 40];
export interface Voicing {
  id: string;
  root: number;
  quality: ChordSymbol["quality"];
  /** First string first. -1 means muted. Finger 1 may form a barre. */
  frets: number[];
  fingers: number[];
  barre?: { fret: number; fromString: number; toString: number };
}
const shape = (
  id: string,
  root: number,
  quality: Voicing["quality"],
  frets: number[],
  fingers: number[],
  barre?: Voicing["barre"],
): Voicing => ({ id, root, quality, frets, fingers, barre });
export const openVoicings: Voicing[] = [
  shape("C", 0, "major", [0, 1, 0, 2, 3, -1], [0, 1, 0, 2, 3, 0]),
  shape("D", 2, "major", [2, 3, 2, 0, -1, -1], [2, 3, 1, 0, 0, 0]),
  shape("E", 4, "major", [0, 0, 1, 2, 2, 0], [0, 0, 1, 3, 2, 0]),
  shape("G", 7, "major", [3, 0, 0, 0, 2, 3], [4, 0, 0, 0, 1, 2]),
  shape("G-common", 7, "major", [3, 3, 0, 0, 2, 3], [4, 3, 0, 0, 1, 2]),
  shape("A", 9, "major", [0, 2, 2, 2, 0, -1], [0, 3, 2, 1, 0, 0]),
  shape("Am", 9, "minor", [0, 1, 2, 2, 0, -1], [0, 1, 3, 2, 0, 0]),
  shape("Dm", 2, "minor", [1, 3, 2, 0, -1, -1], [1, 3, 2, 0, 0, 0]),
  shape("Em", 4, "minor", [0, 0, 0, 2, 2, 0], [0, 0, 0, 3, 2, 0]),
  shape("F-small", 5, "major", [1, 1, 2, 3, -1, -1], [1, 1, 2, 3, 0, 0], {
    fret: 1,
    fromString: 1,
    toString: 2,
  }),
  shape("Cmaj7", 0, "maj7", [0, 0, 0, 2, 3, -1], [0, 0, 0, 2, 3, 0]),
  shape("Em7", 4, "m7", [0, 0, 0, 0, 2, 0], [0, 0, 0, 0, 2, 0]),
  shape("Am7", 9, "m7", [0, 1, 0, 2, 0, -1], [0, 1, 0, 2, 0, 0]),
  shape("D7", 2, "7", [2, 1, 2, 0, -1, -1], [3, 1, 2, 0, 0, 0]),
  shape("A7", 9, "7", [0, 2, 0, 2, 0, -1], [0, 3, 0, 2, 0, 0]),
  shape("E7", 4, "7", [0, 0, 1, 0, 2, 0], [0, 0, 1, 0, 2, 0]),
  shape("G7", 7, "7", [1, 0, 0, 0, 2, 3], [1, 0, 0, 0, 2, 3]),
  shape("B7", 11, "7", [2, 0, 2, 1, 2, -1], [4, 0, 3, 1, 2, 0]),
  shape("Dsus4", 2, "sus4", [3, 3, 2, 0, -1, -1], [4, 3, 1, 0, 0, 0]),
  shape("Asus4", 9, "sus4", [0, 3, 2, 2, 0, -1], [0, 4, 3, 2, 0, 0]),
];
export function chordName(c: Pick<ChordSymbol, "root" | "quality">) {
  return (
    ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][
      ((c.root % 12) + 12) % 12
    ] +
    { major: "", minor: "m", "7": "7", maj7: "maj7", m7: "m7", sus4: "sus4" }[
      c.quality
    ]
  );
}
export function voicings(
  root: number,
  quality: Voicing["quality"],
  barre: boolean,
): Voicing[] {
  const result = openVoicings.filter(
    (v) => v.root === root && v.quality === quality && (barre || !v.barre),
  );
  if (!barre) return result;
  // Movable E / A families, explicitly fingered instead of unconstrained pitch stacks.
  if (["major", "minor", "7", "m7"].includes(quality)) {
    const e = (root - 4 + 12) % 12,
      a = (root - 9 + 12) % 12;
    if (e > 0 && e <= 9) {
      const minor = quality === "minor" || quality === "m7",
        seventh = quality === "7" || quality === "m7";
      result.push(
        shape(
          `E-${quality}-${e}`,
          root,
          quality,
          [e, e, e + (minor ? 0 : 1), e + (seventh ? 0 : 2), e + 2, e],
          [1, 1, minor ? 1 : 2, seventh ? 1 : 4, 3, 1],
          { fret: e, fromString: 1, toString: 6 },
        ),
      );
    }
    if (a > 0 && a <= 9) {
      const minor = quality === "minor" || quality === "m7",
        seventh = quality === "7" || quality === "m7";
      result.push(
        shape(
          `A-${quality}-${a}`,
          root,
          quality,
          [a, a + (minor ? 1 : 2), a + (seventh ? 0 : 2), a + 2, a, -1],
          [1, minor ? 2 : 4, seventh ? 1 : 3, minor ? 3 : 2, 1, 0],
          { fret: a, fromString: 1, toString: 5 },
        ),
      );
    }
  }
  return result;
}
export function transitionCost(a: Voicing | undefined, b: Voicing): number {
  if (!a) return Math.max(...b.frets) * 0.2 + (b.barre ? 2 : 0);
  let cost = 0;
  for (let finger = 1; finger <= 4; finger++) {
    const x = a.fingers.indexOf(finger),
      y = b.fingers.indexOf(finger);
    if (x < 0 || y < 0) {
      if (x !== y) cost += 0.4;
      continue;
    }
    cost += Math.abs(a.frets[x] - b.frets[y]) * 0.8 + Math.abs(x - y) * 0.2;
    if (a.frets[x] === b.frets[y] && x === y) cost -= 0.6;
  }
  return cost + (b.barre ? 1 : 0);
}
