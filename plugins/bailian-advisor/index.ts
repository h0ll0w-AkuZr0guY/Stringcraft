import { askAdvice } from "../../packages/music/advisor";
import type { MusicPlugin } from "../../packages/contracts";
export default { advise: askAdvice } satisfies MusicPlugin;
