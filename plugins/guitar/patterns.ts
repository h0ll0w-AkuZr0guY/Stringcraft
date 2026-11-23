import type { Difficulty } from "../../packages/contracts";
type Stroke = { beat: number; up: boolean };
const down = (...beats: number[]): Stroke[] =>
  beats.map((beat) => ({ beat, up: false }));
/** Offsets belong to a measure, independently of where its chord changes occur. */
export function strumPattern(
  numerator: number,
  denominator: number,
  difficulty: Difficulty,
): Stroke[] {
  if (numerator === 4 && denominator === 4)
    return difficulty === "easy"
      ? down(0, 2)
      : [
          { beat: 0, up: false },
          { beat: 1, up: false },
          { beat: 1.5, up: true },
          { beat: 2.5, up: true },
          { beat: 3, up: false },
          { beat: 3.5, up: true },
        ];
  if (numerator === 3 && denominator === 4)
    return difficulty === "easy"
      ? down(0, 1, 2)
      : [
          { beat: 0, up: false },
          { beat: 1, up: false },
          { beat: 1.5, up: true },
          { beat: 2, up: false },
          { beat: 2.5, up: true },
        ];
  if (numerator === 6 && denominator === 8)
    return difficulty === "easy"
      ? down(0, 1.5)
      : [
          { beat: 0, up: false },
          { beat: 1, up: true },
          { beat: 1.5, up: false },
          { beat: 2.5, up: true },
        ];
  return down(
    ...Array.from({ length: numerator }, (_, i) => (i * 4) / denominator),
  );
}
