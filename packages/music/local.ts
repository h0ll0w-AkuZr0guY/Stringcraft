import type { Job, NoteEvent } from "../contracts";
let session: string | undefined;
export async function localCapabilities() {
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
  const r = await fetch("/api/v1/" + path, {
    ...init,
    headers: { ...init?.headers, Authorization: "Bearer " + session },
  });
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
): Promise<{ duration: number; bpm: number; notes: NoteEvent[] }> {
  const form = new FormData();
  form.set("file", file);
  form.set("mode", mode);
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
        return current.result as {
          duration: number;
          bpm: number;
          notes: NoteEvent[];
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
