export type PracticeHand = "left" | "right";
export type PianoKey = {
  code: string;
  midi: number;
  hand: PracticeHand;
  black: boolean;
  center: number;
};

const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);
export const whiteAnchors = Array.from({ length: 88 }, (_, i) => i + 21).filter(
  (midi) => !isBlack(midi),
);
const zones = {
  left: {
    white: ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG"],
    black: ["KeyW", "KeyE", "KeyR", "KeyT"],
  },
  right: {
    white: ["KeyJ", "KeyK", "KeyL", "Semicolon", "Quote"],
    black: ["KeyI", "KeyO", "KeyP", "BracketLeft"],
  },
};
const legacy = {
  left: [
    "KeyZ",
    "KeyS",
    "KeyX",
    "KeyD",
    "KeyC",
    "KeyV",
    "KeyG",
    "KeyB",
    "KeyH",
    "KeyN",
    "KeyJ",
    "KeyM",
  ],
  right: [
    "KeyQ",
    "Digit2",
    "KeyW",
    "Digit3",
    "KeyE",
    "KeyR",
    "Digit5",
    "KeyT",
    "Digit6",
    "KeyY",
    "Digit7",
    "KeyU",
  ],
};
export const guitarKeys = {
  chords: ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyZ", "KeyX", "KeyC"],
  strings: ["KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote"],
  down: "ArrowDown",
  up: "ArrowUp",
};
export const legacyGuitarKeys = {
  chords: Array.from({ length: 8 }, (_, i) => "Digit" + (i + 1)),
  strings: ["BracketRight", "BracketLeft", "KeyP", "KeyO", "KeyI", "KeyU"],
  down: "KeyJ",
  up: "KeyK",
};

export function splitKeys(hand: PracticeHand, base: number): PianoKey[] {
  const white = whiteAnchors.filter((midi) => midi >= base).slice(0, 5);
  const offset = hand === "left" ? 0 : 5;
  return white.flatMap((midi, index) => {
    const keys: PianoKey[] = [
      {
        code: zones[hand].white[index],
        midi,
        hand,
        black: false,
        center: (offset + index + 0.5) * 10,
      },
    ];
    if (white[index + 1] === midi + 2)
      keys.push({
        code: zones[hand].black[index],
        midi: midi + 1,
        hand,
        black: true,
        center: (offset + index + 1) * 10,
      });
    return keys;
  });
}

export function pianoKeys(
  mode: "split" | "wide" | "legacy",
  left: number,
  right: number,
): PianoKey[] {
  if (mode === "split")
    return [...splitKeys("left", left), ...splitKeys("right", right)];
  const full = [
    "KeyA",
    "KeyW",
    "KeyS",
    "KeyE",
    "KeyD",
    "KeyF",
    "KeyT",
    "KeyG",
    "KeyY",
    "KeyH",
    "KeyU",
    "KeyJ",
    "KeyK",
  ];
  const centers = [0.5, 1, 1.5, 2, 2.5, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7.5];
  if (mode === "wide")
    return full.map((code, index) => ({
      code,
      midi: right + index,
      hand: "right",
      black: isBlack(index),
      center: (centers[index] / 8) * 100,
    }));
  return (["left", "right"] as const).flatMap((hand, side) =>
    legacy[hand].map((code, index) => ({
      code,
      midi: (side === 0 ? left : right) + index,
      hand,
      black: isBlack(index),
      center: ((side * 7 + centers[index]) / 14) * 100,
    })),
  );
}
