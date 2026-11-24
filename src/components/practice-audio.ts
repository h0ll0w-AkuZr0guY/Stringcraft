export function playPracticeTone(
  ctx: AudioContext,
  midi: number,
  instrument: "piano" | "guitar",
  start = ctx.currentTime,
  duration?: number,
) {
  const hz = 440 * 2 ** ((midi - 69) / 12);
  const osc = ctx.createOscillator(),
    body = ctx.createOscillator(),
    amp = ctx.createGain(),
    harmonic = ctx.createGain();
  osc.frequency.value = hz;
  body.frequency.value = hz * 2.004;
  harmonic.gain.value = 0.22;
  osc.type = "triangle";
  body.type = "sine";
  osc.connect(amp);
  body.connect(harmonic);
  harmonic.connect(amp);
  amp.connect(ctx.destination);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(0.14, start + 0.008);
  amp.gain.exponentialRampToValueAtTime(
    0.016,
    start + (instrument === "guitar" ? 0.26 : 0.5),
  );
  osc.start(start);
  body.start(start);
  let ended = false;
  const release = (when = ctx.currentTime) => {
    if (ended) return;
    ended = true;
    const t = Math.max(when, start + 0.01);
    amp.gain.cancelAndHoldAtTime(t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);
    osc.stop(t + 0.11);
    body.stop(t + 0.11);
  };
  if (duration) release(start + duration);
  return release;
}
