import type { MusicProject, NoteEvent } from "../contracts";
import { load } from "../plugin-host";
import { savedAudioAsset } from "./local";
import { filteredNotes } from "./note-edits";
import { editorTrackProject, projectTracks } from "./tracks";
import type { PlaybackDriver } from "./transport";

/** One context and one scheduled origin for every stem and synthesized voice. */
export function trackPlayback(
  project: MusicProject,
  ids: string[],
  settings: {
    mode: "audio" | "notes" | "mix";
    volumes: Record<string, number>;
    tone: string;
  },
  cache: Map<string, AudioBuffer>,
): PlaybackDriver {
  const material = projectTracks(project).filter((t) => ids.includes(t.id));
  return async (from, to, speed, current, signal) => {
    const ctx = new AudioContext();
    signal.addEventListener("abort", () => void ctx.close().catch(() => {}), {
      once: true,
    });
    await ctx.resume();
    let releaseNotes: (() => void) | undefined;
    try {
      const real: { buffer: AudioBuffer; gain: number; offset: number }[] = [],
        guitar: NoteEvent[] = [],
        neutral: NoteEvent[] = [];
      for (const track of material) {
        if (!current()) throw new DOMException("已取消", "AbortError");
        const gain = settings.volumes[track.id] ?? 1;
        if (gain <= 0) continue;
        if (track.asset && settings.mode !== "notes") {
          const key = `track:${track.asset.id}`;
          let buffer = cache.get(key);
          if (!buffer) {
            buffer = await ctx.decodeAudioData(
              await (
                await savedAudioAsset(track.asset.id, signal)
              ).arrayBuffer(),
            );
            cache.set(key, buffer);
            if (cache.size > 3) cache.delete(cache.keys().next().value!);
          }
          real.push({ buffer, gain, offset: track.asset.offsetSeconds });
        } else {
          const input =
            track.role === "arrangement"
              ? track.notes
              : filteredNotes(editorTrackProject(project, track.id));
          (track.role === "arrangement" ? guitar : neutral).push(
            ...input.map((n) => ({
              ...n,
              velocity: Math.min(1, n.velocity * gain),
            })),
          );
        }
      }
      if (material.every((t) => !t.asset && !t.notes.length))
        throw new Error("当前轨道还没有音符；请分析该轨道或选择轨道音频。");
      const renderer = guitar.length ? await load("guitar-samples") : null;
      if (renderer) await renderer.prepareAudio?.(ctx, guitar, settings.tone);
      const noteRenderer = neutral.length ? await load("note-audio") : null;
      if (!current()) throw new DOMException("已取消", "AbortError");
      const origin = ctx.currentTime + 0.08;
      if (renderer)
        await renderer.scheduleAudio!(
          ctx,
          guitar,
          settings.tone,
          from,
          to,
          speed,
          origin,
        );
      if (!current()) throw new DOMException("已取消", "AbortError");
      if (noteRenderer)
        releaseNotes = noteRenderer.scheduleNotes!(
          ctx,
          neutral,
          from,
          to,
          speed,
          origin,
        ).stop;
      for (const item of real) {
        const source = ctx.createBufferSource(),
          gain = ctx.createGain();
        source.buffer = item.buffer;
        source.playbackRate.value = speed;
        gain.gain.value = item.gain;
        source.connect(gain);
        gain.connect(ctx.destination);
        const offset = item.offset + from;
        if (offset < item.buffer.duration)
          source.start(
            origin,
            offset,
            Math.min(to - from, item.buffer.duration - offset),
          );
      }
      return {
        position: () => from + Math.max(0, ctx.currentTime - origin) * speed,
        stop: () => {
          releaseNotes?.();
          void ctx.close().catch(() => {});
        },
      };
    } catch (error) {
      void ctx.close().catch(() => {});
      throw error;
    }
  };
}
