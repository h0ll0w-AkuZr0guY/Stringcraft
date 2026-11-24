import type {
  HarmonyAnalysis,
  Job,
  ModelExecution,
  NoteEvent,
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
async function authenticatedResponse(path: string, init?: RequestInit) {
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
  return r;
}
async function request(path: string, init?: RequestInit) {
  return (await authenticatedResponse(path, init)).json();
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
  tracks?: import("../contracts").ProjectTrack[];
  duration: number;
  bpm: number;
  notes: NoteEvent[];
  harmonyAnalysis?: HarmonyAnalysis;
  melodyEvidence?: NoteEvent[];
  executions?: ModelExecution[];
  warnings?: string[];
  sourceOffset?: number;
  run?: import("../contracts").LocalAnalysisRun;
}
export async function savedAudioAsset(
  id: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await authenticatedResponse(
    `assets/${encodeURIComponent(id)}`,
    { signal },
  );
  if (!response.ok)
    throw new Error("轨道音频不可用，请重新关联工程音频或分析录音。");
  return response.blob();
}
export async function pinAudioAssets(
  project: import("../contracts").MusicProject,
) {
  const ids =
    project.tracks?.flatMap((t) => (t.asset ? [t.asset.id] : [])) ?? [];
  if (ids.length)
    await request("assets/references", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, assetIds: ids }),
    });
}
export async function releaseAudioAssets(id: string) {
  await request(`assets/references/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
export async function exportAudioProject(
  project: import("../contracts").MusicProject,
) {
  return (
    await authenticatedResponse("project-bundles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project }),
    })
  ).blob();
}
export async function importAudioProject(file: File) {
  const form = new FormData();
  form.set("file", file);
  return (
    await request("project-bundles/import", { method: "POST", body: form })
  ).project as import("../contracts").MusicProject;
}
export async function analyzeSavedTrack(
  assetId: string,
  operation: "vocal-melody" | "transcribe",
  signal: AbortSignal,
  progress: (j: Job) => void,
  backingAssetId?: string,
): Promise<LocalAnalysisResult> {
  const job: Job = await request("jobs/from-asset", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assetId, operation, backingAssetId }),
  });
  const cancel = () => {
    void request("jobs/" + job.id, { method: "DELETE" }).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
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
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
  } finally {
    signal.removeEventListener("abort", cancel);
  }
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
