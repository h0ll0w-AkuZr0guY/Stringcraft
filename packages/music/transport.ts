/** Project seconds are authoritative; renderers supply an audio-clock position. */
export type TransportStatus = "paused" | "loading" | "playing";
export interface PlaybackHandle {
  position(): number;
  stop(): void;
}
export type PlaybackDriver = (
  from: number,
  to: number,
  speed: number,
  current: () => boolean,
  signal: AbortSignal,
) => Promise<PlaybackHandle>;
export interface TransportSnapshot {
  position: number;
  status: TransportStatus;
  speed: number;
  duration: number;
  loop: { start: number; end: number } | null;
}
export class Transport {
  private value: TransportSnapshot = {
    position: 0,
    status: "paused",
    speed: 1,
    duration: 0,
    loop: null,
  };
  private listeners = new Set<() => void>();
  private handle: PlaybackHandle | null = null;
  private driver: PlaybackDriver | null = null;
  private revision = 0;
  private loading: AbortController | null = null;
  private frame: ReturnType<typeof setTimeout> | null = null;
  onError: (error: unknown) => void = () => {};
  snapshot = () => this.value;
  status = () => this.value.status;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<TransportSnapshot>) {
    this.value = { ...this.value, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private release() {
    this.revision++;
    this.loading?.abort();
    this.loading = null;
    if (this.frame) clearTimeout(this.frame);
    this.frame = null;
    this.handle?.stop();
    this.handle = null;
  }
  setDuration(duration: number) {
    if (!Number.isFinite(duration) || duration <= 0) return;
    this.update({
      duration,
      position: Math.min(this.value.position, duration),
    });
  }
  pause() {
    const position = this.handle?.position() ?? this.value.position;
    this.release();
    this.update({
      position: Math.max(0, Math.min(this.value.duration, position)),
      status: "paused",
    });
  }
  stop() {
    this.pause();
    this.update({ position: 0 });
  }
  async play(driver?: PlaybackDriver) {
    if (driver) this.driver = driver;
    if (!this.driver) return;
    this.release();
    const control = new AbortController();
    this.loading = control;
    const revision = this.revision,
      current = () => revision === this.revision;
    let from =
      this.value.position >= this.value.duration ? 0 : this.value.position;
    const loop = this.value.loop;
    if (loop && (from < loop.start || from >= loop.end)) from = loop.start;
    const to = loop?.end ?? this.value.duration;
    this.update({ position: from, status: "loading" });
    try {
      const handle = await this.driver(
        from,
        to,
        this.value.speed,
        current,
        control.signal,
      );
      if (!current()) {
        handle.stop();
        return;
      }
      this.handle = handle;
      this.update({ status: "playing" });
      const tick = () => {
        if (!current()) return;
        const position = Math.min(to, Math.max(from, handle.position()));
        this.update({ position });
        if (position >= to) {
          this.release();
          this.update({ position: to, status: "paused" });
          if (this.value.loop) {
            this.update({ position: this.value.loop.start });
            void this.play();
          }
          return;
        }
        this.frame = setTimeout(tick, 25);
      };
      tick();
    } catch (error) {
      if (current()) {
        this.release();
        this.update({ status: "paused" });
        this.onError(error);
      }
    }
  }
  seek(position: number) {
    if (!Number.isFinite(position)) return;
    const resume = this.value.status !== "paused";
    this.release();
    const at = Math.max(0, Math.min(this.value.duration, position));
    const loop = this.value.loop;
    this.update({
      position: at,
      status: "paused",
      loop: loop && (at < loop.start || at >= loop.end) ? null : loop,
    });
    if (resume) void this.play();
  }
  setSpeed(speed: number) {
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 3) return;
    const resume = this.value.status !== "paused";
    this.pause();
    this.update({ speed });
    if (resume) void this.play();
  }
  setLoop(loop: TransportSnapshot["loop"]) {
    if (
      loop &&
      (!Number.isFinite(loop.start) ||
        !Number.isFinite(loop.end) ||
        loop.start < 0 ||
        loop.end <= loop.start ||
        loop.end > this.value.duration)
    )
      throw new Error("循环范围无效");
    const resume = this.value.status !== "paused";
    this.pause();
    this.update({ loop });
    if (resume) void this.play();
  }
  dispose() {
    this.release();
    this.listeners.clear();
  }
}
