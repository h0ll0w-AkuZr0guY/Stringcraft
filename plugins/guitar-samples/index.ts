import type { MusicPlugin } from "../../packages/contracts";
import { prepareAudio, renderWav, schedule } from "../../packages/music/audio";
export default {
  scheduleAudio: (
    ctx,
    notes,
    tone,
    from = 0,
    to = Infinity,
    speed = 1,
    atTime,
  ) => schedule(ctx, notes, tone, from, to, speed, undefined, atTime),
  prepareAudio,
  renderAudio: renderWav,
} satisfies MusicPlugin;
