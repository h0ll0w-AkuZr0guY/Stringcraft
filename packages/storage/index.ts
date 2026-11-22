import { get, set, del, keys } from "idb-keyval";
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
export const removeProject = (id: string) => del(`project:${id}`);
