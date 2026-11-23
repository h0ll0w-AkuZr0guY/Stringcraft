import type {
  Job,
  NoteEvent,
  HarmonyAnalysis,
  ModelExecution,
} from "../contracts";
let session: string | undefined;
export interface LocalEngineState {
  status: "checking" | "missing" | "error" | "ready";
  ready: boolean;
  promoted?: boolean;
  message?: string;
  device?: "cpu" | "cuda";
  gpu?: string | null;
  executions?: ModelExecution[];
  warnings?: string[];
  pluginSha256?: string;
}
export interface LocalCapabilities {
  local: boolean;
  appVersion: string;
  buildSha: string;
  engine: LocalEngineState;
  plugin: { installed: boolean; ffmpeg: boolean };
}
export async function localCapabilities(): Promise<LocalCapabilities | null> {
  try {
    const r = await fetch("/api/v1/capabilities", {
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok || !r.headers.get("content-type")?.includes("json")) return null;
    return await r.json();
  } catch {
    return null;
  }
}
async function request(path: string, init?: RequestInit) {
  if (!session) {
    const r = await fetch("/api/v1/session");
    session = (await r.json()).token;
  }
  let r = await fetch("/api/v1/" + path, {
    ...init,
    headers: { ...init?.headers, Authorization: "Bearer " + session },
  });
  if (r.status === 401) {
    const auth = await fetch("/api/v1/session");
    session = (await auth.json()).token;
    r = await fetch("/api/v1/" + path, {
      ...init,
      headers: { ...init?.headers, Authorization: "Bearer " + session },
    });
  }
  if (!r.ok) {
    const data = await r.json().catch(() => null);
    throw new Error(data?.detail ?? `本地服务错误 ${r.status}`);
  }
  return r.json();
}
export async function analyzeLocal(
  file: File,
  mode: string,
  signal: AbortSignal,
  progress: (j: Job) => void,
  range?: { offset: number; seconds: number },
): Promise<LocalAnalysisResult> {
  const form = new FormData();
  form.set("file", file);
  form.set("mode", mode);
  if (range) {
    form.set("offset", String(range.offset));
    form.set("seconds", String(range.seconds));
  }
  const job: Job = await request("jobs", {
    method: "POST",
    body: form,
    signal,
  });
  const cancel = () => {
    void request("jobs/" + job.id, { method: "DELETE" }).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const current: Job = await request("jobs/" + job.id, { signal });
      progress(current);
      if (current.status === "completed")
        return {
          ...(current.result as LocalAnalysisResult),
          run: {
            jobId: job.id,
            cacheKey: job.cacheKey ?? "",
            cacheHit: !!job.cacheHit,
            executions:
              (current.result as LocalAnalysisResult).executions ?? [],
            warnings: (current.result as LocalAnalysisResult).warnings ?? [],
          },
        };
      if (current.status === "failed" || current.status === "cancelled")
        throw new Error(current.error?.message ?? current.message);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, 700);
        const abort = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          reject(new DOMException("已取消", "AbortError"));
        };
        signal.addEventListener("abort", abort, { once: true });
      });
    }
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

export interface LocalAnalysisResult {
  duration: number;
  bpm: number;
  notes: NoteEvent[];
  harmonyAnalysis?: HarmonyAnalysis;
  executions?: ModelExecution[];
  warnings?: string[];
  sourceOffset?: number;
  run?: import("../contracts").LocalAnalysisRun;
}
export async function localAsset(
  jobId: string,
  asset:
    | "accompaniment.wav"
    | "bass.wav"
    | "direct-harmony.json"
    | "separated-harmony.json",
) {
  if (!session) {
    const r = await fetch("/api/v1/session");
    session = (await r.json()).token;
  }
  let response = await fetch(
    `/api/v1/jobs/${encodeURIComponent(jobId)}/assets/${asset}`,
    { headers: { Authorization: "Bearer " + session } },
  );
  if (response.status === 401) {
    const auth = await fetch("/api/v1/session");
    session = (await auth.json()).token;
    response = await fetch(
      `/api/v1/jobs/${encodeURIComponent(jobId)}/assets/${asset}`,
      { headers: { Authorization: "Bearer " + session } },
    );
  }
  if (!response.ok) throw new Error("分离文件不可用，请重新分析录音。");
  return response.blob();
}
