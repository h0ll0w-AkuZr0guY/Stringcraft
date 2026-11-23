import { catalog, install, installed } from "../plugin-host";

export async function workbenchComponentProblems() {
  const required = new Set([
    "piano-roll",
    "note-audio",
    "note-exporters",
    "melody-tracker",
    "harmony-analysis",
    "rhythm-analysis",
    "arrangement-planner",
  ]);
  const items = (await catalog()).filter((m) => required.has(m.id));
  const problems = [];
  for (const m of items) {
    const p = await installed(m.id);
    if (!p?.enabled || !p.code || p.manifest.sha256 !== m.sha256)
      problems.push(m);
  }
  return problems;
}

/** Explicit repair only. Hidden modules retain the same integrity/transaction checks. */
export async function repairWorkbenchComponents() {
  const problems = await workbenchComponentProblems();
  for (const m of problems) await install(m);
}
