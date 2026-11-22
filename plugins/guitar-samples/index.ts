import { schedule, renderWav } from "../../packages/music/audio";
import type { MusicPlugin } from "../../packages/contracts";
export default {
  scheduleAudio: schedule,
  renderAudio: renderWav,
} satisfies MusicPlugin;
