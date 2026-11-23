import { get, set, delMany, keys } from "idb-keyval";
import { validateProject, type MusicProject } from "../contracts";
export async function saveProject(p: MusicProject) {
  validateProject(p);
  await set(`project:${p.id}`, { ...p, updatedAt: new Date().toISOString() });
}
export async function listProjects(): Promise<MusicProject[]> {
  const ids = (await keys()).filter((k) => String(k).startsWith("project:"));
  return (await Promise.all(ids.map((k) => get<MusicProject>(k))))
    .filter((p): p is MusicProject => !!p)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export const audioAssetKey = (
  p: Pick<MusicProject, "id" | "audioReference">,
) =>
  p.audioReference
    ? `audio-v2:${encodeURIComponent(p.id)}:${p.audioReference.sha256.toLowerCase()}`
    : `audio:${p.id}`;
export const audioAssetPrefix = (id: string) =>
  `audio-v2:${encodeURIComponent(id)}:`;
export async function removeProject(id: string) {
  const prefix = audioAssetPrefix(id);
  const audio = (await keys()).filter(
    (key) => typeof key === "string" && key.startsWith(prefix),
  );
  await delMany([`project:${id}`, `audio:${id}`, ...audio]);
}
