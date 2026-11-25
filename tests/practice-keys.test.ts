import { expect, test } from "vitest";
import {
  guitarKeys,
  pianoKeys,
  splitKeys,
  whiteAnchors,
} from "../src/components/practice-keys";

test("split piano zones do not share keys and every accident corresponds to a physical gap", () => {
  for (const base of whiteAnchors.slice(0, -4)) {
    const all = pianoKeys("split", base, base);
    expect(new Set(all.map((key) => key.code)).size).toBe(all.length);
    for (const hand of ["left", "right"] as const) {
      const keys = splitKeys(hand, base);
      expect(keys.filter((key) => !key.black)).toHaveLength(5);
      for (const key of keys.filter((key) => key.black)) {
        expect(
          keys.some((other) => other.midi === key.midi - 1 && !other.black),
        ).toBe(true);
        expect(
          keys.some((other) => other.midi === key.midi + 1 && !other.black),
        ).toBe(true);
      }
    }
  }
});

test("guitar has eight left-hand slots and dedicated right-hand actions", () => {
  const keys = [
    ...guitarKeys.chords,
    ...guitarKeys.strings,
    guitarKeys.down,
    guitarKeys.up,
  ];
  expect(new Set(keys).size).toBe(16);
  expect(guitarKeys.strings[0]).toBe("KeyH");
});
