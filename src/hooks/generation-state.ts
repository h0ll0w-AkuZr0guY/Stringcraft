import type {
  GenerationPhase,
  PluginProblem,
  Recovery,
} from "../../packages/music/generate";
export interface GenerationTask {
  id: string;
  projectId: string;
  phase: GenerationPhase;
  status: "running" | "success" | "error" | "cancelled";
  startedAt: number;
  endedAt?: number;
  message: string;
  count?: number;
  recovery?: Recovery;
  problems?: PluginProblem[];
}
