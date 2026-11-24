import { afterEach, expect, it, vi } from "vitest";
import { Transport, type PlaybackHandle } from "../packages/music/transport";
afterEach(() => vi.useRealTimers());
it("canceling preparation aborts the loading renderer before it can produce audio", async () => {
  const t = new Transport();
  t.setDuration(60);
  let aborted = false;
  const pending = t.play(
    (_from, _to, _speed, _current, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new DOMException("Canceled", "AbortError"));
          },
          { once: true },
        ),
      ),
  );
  t.pause();
  expect(aborted).toBe(true);
  await pending;
  expect(t.snapshot().status).toBe("paused");
  t.dispose();
});
it("pause retains the audio-clock position; resume and rewind are separate actions", async () => {
  vi.useFakeTimers();
  const t = new Transport();
  t.setDuration(300);
  let at = 0;
  const starts: number[] = [];
  const driver = async (from: number) => {
    starts.push(from);
    at = from;
    return { position: () => at, stop: vi.fn() };
  };
  await t.play(driver);
  at = 163.4;
  t.pause();
  expect(t.snapshot().position).toBe(163.4);
  await t.play();
  expect(starts).toEqual([0, 163.4]);
  t.stop();
  expect(t.snapshot().position).toBe(0);
  t.dispose();
});
it("seek during playback reschedules at the requested point without stale audio", async () => {
  vi.useFakeTimers();
  const t = new Transport();
  t.setDuration(60);
  const stop = vi.fn(),
    starts: number[] = [];
  await t.play(async (from) => {
    starts.push(from);
    return { position: () => from, stop };
  });
  t.seek(23);
  await Promise.resolve();
  expect(starts).toEqual([0, 23]);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(t.snapshot().status).toBe("playing");
  t.dispose();
});
it("the last rapid seek owns playback even when earlier preparation resolves last", async () => {
  const t = new Transport();
  t.setDuration(60);
  const pending: ((h: PlaybackHandle) => void)[] = [];
  const stops = [vi.fn(), vi.fn(), vi.fn()];
  const first = t.play(() => new Promise((resolve) => pending.push(resolve)));
  t.seek(12);
  t.seek(33);
  pending[2]({ position: () => 33, stop: stops[2] });
  await Promise.resolve();
  pending[1]({ position: () => 12, stop: stops[1] });
  pending[0]({ position: () => 0, stop: stops[0] });
  await first;
  expect(t.snapshot().position).toBe(33);
  expect(stops[0]).toHaveBeenCalled();
  expect(stops[1]).toHaveBeenCalled();
  expect(stops[2]).not.toHaveBeenCalled();
  t.dispose();
});
it("seeking outside a loop disables it and preserves the requested position", () => {
  const t = new Transport();
  t.setDuration(60);
  t.setLoop({ start: 4, end: 8 });
  t.seek(27);
  expect(t.snapshot()).toMatchObject({
    position: 27,
    loop: null,
    status: "paused",
  });
  t.dispose();
});
it("natural ending retains the end position and replay deliberately starts from zero", async () => {
  vi.useFakeTimers();
  const t = new Transport();
  t.setDuration(10);
  let at = 0;
  const driver = async (from: number) => {
    at = from;
    return { position: () => at, stop: vi.fn() };
  };
  await t.play(driver);
  at = 11;
  await vi.advanceTimersByTimeAsync(30);
  expect(t.snapshot()).toMatchObject({ position: 10, status: "paused" });
  await t.play();
  expect(t.snapshot().position).toBe(0);
  t.dispose();
});
