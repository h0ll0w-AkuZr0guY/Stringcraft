/** Private-input evaluation of music planning and physical actions, not transcription accuracy. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { planArrangement } from "../plugins/arrangement-planner";
import { extractMelody } from "../plugins/melody";
import { arrange } from "../plugins/guitar";
import { projectScore } from "../packages/music/score";
import { arrangementRevision } from "../packages/music/arrangement-revision";
import {
  eventRole,
  soundingEvents,
  type MusicProject,
  type Arrangement,
  type GuitarNote,
} from "../packages/contracts";

function statistics(a: Arrangement) {
  const actions = (a.performance?.actions ?? []) as {
    role: string;
    sourceIds: string[];
    strokeId?: string;
    kind: string;
  }[];
  const ids = new Set(actions.flatMap((a) => a.sourceIds));
  let melodyTime = 0,
    paired = 0;
  const duration = a.notes.reduce(
    (end, n) => Math.max(end, n.start + n.duration),
    0,
  );
  for (let t = 0; t < duration; t += 0.02) {
    const active = a.notes.filter(
      (n) => n.start <= t && n.start + n.duration > t,
    );
    if (active.some((n) => n.role === "melody")) {
      melodyTime += 0.02;
      if (active.some((n) => n.role === "bass")) paired += 0.02;
    }
  }
  const melody =
    a.score?.events.filter(
      (e) => eventRole(e) === "melody" && e.midi !== null && !e.tieFrom,
    ) ?? [];
  return {
    notes: a.notes.length,
    melodyAnchors: melody.length,
    retainedMelody: melody.filter((e) => ids.has(e.id)).length,
    bassNotes: a.notes.filter((n) => n.role === "bass").length,
    innerNotes: a.notes.filter((n) => n.role === "harmony").length,
    melodyBassOverlap: melodyTime ? paired / melodyTime : null,
    brushes: new Set(actions.filter((a) => a.strokeId).map((a) => a.strokeId))
      .size,
    issues: a.performance?.issues ?? [],
    dropped: a.dropped.length,
  };
}
const [manifest, output, baselineFile] = process.argv.slice(2);
if (!manifest || !output)
  throw new Error(
    "Usage: evaluate-musical-arrangement <private-manifest> <report> [frozen-baseline-module]",
  );
const baseline = baselineFile
  ? await import(pathToFileURL(baselineFile).href)
  : null;
const cases = JSON.parse(await readFile(manifest, "utf8"));
const rows = [];
for (const item of cases) {
  const input = await readFile(item.path, "utf8"),
    parsed = JSON.parse(input);
  const project: MusicProject = parsed.schemaVersion
    ? parsed
    : {
        schemaVersion: 2,
        id: item.id,
        name: item.id,
        createdAt: "reference",
        updatedAt: "reference",
        duration: (parsed.score.durationBeats * 60) / parsed.score.tempo[0].bpm,
        bpm: parsed.score.tempo[0].bpm,
        beatOffset: parsed.score.beatOffsetSeconds,
        sourceOffset: 0,
        sourceKind: "musicxml",
        score: parsed.score,
        notes: soundingEvents(parsed.score),
        melody: soundingEvents(parsed.score).filter((n) => n.role === "melody"),
        arrangement: null,
        pluginVersions: {},
      };
  const source = projectScore(project);
  for (const variant of ["strum", "arpeggio", "fingerstyle"] as const) {
    if (
      project.sourceKind !== "audio" &&
      variant !== "fingerstyle" &&
      !source.chords.length
    )
      continue;
    const goal = variant === "fingerstyle" ? "fingerstyle" : "accompaniment",
      difficulty = variant === "fingerstyle" ? "hard" : "normal",
      pattern = variant === "fingerstyle" ? "arpeggio" : variant;
    const options = {
      goal,
      difficulty,
      pattern,
      capo: item.capo ?? 0,
      transpose: item.transpose ?? 0,
      bpm: project.bpm,
    } as const;
    const row: any = {
      id: item.id,
      sourceKind: project.sourceKind,
      sourceSha256: createHash("sha256").update(input).digest("hex"),
      variant,
    };
    if (baseline)
      try {
        const before = baseline.arrange(project.melody, {
          ...options,
          score: source,
        });
        row.before = statistics(before);
        if (item.projectOutput) {
          await mkdir(item.projectOutput, { recursive: true });
          await writeFile(
            `${item.projectOutput}/${variant}-before.json`,
            JSON.stringify({ ...project, arrangement: before }, null, 2),
          );
        }
      } catch (e) {
        row.before = { error: String(e) };
      }
    try {
      const draft = planArrangement(
        {
          score: source,
          sourceKind: project.sourceKind,
          melodyCandidates:
            project.sourceKind === "audio"
              ? extractMelody(project.notes)
              : undefined,
          melodyEvidence: project.melodyEvidence,
          inputFingerprint: arrangementRevision(project),
        },
        options,
      );
      const result = arrange(project.melody, {
        ...options,
        score: draft.score,
        phrases: draft.phrases,
      });
      row.after = {
        ...statistics(result),
        harmony: draft.statistics,
        decisions: draft.decisions.length,
      };
      if (item.projectOutput) {
        await mkdir(item.projectOutput, { recursive: true });
        await writeFile(
          `${item.projectOutput}/${variant}.json`,
          JSON.stringify(
            { ...project, arrangementDraft: draft, arrangement: result },
            null,
            2,
          ),
        );
      }
    } catch (e) {
      row.after = { error: String(e) };
    }
    rows.push(row);
    console.log(item.id, variant, JSON.stringify(row.after));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(
      output,
      JSON.stringify(
        {
          protocol: "local3-music-actions-v1",
          note: "Known-score behavior and noisy-input diagnostics; no subjective listening or recording-accuracy claim",
          rows,
        },
        null,
        2,
      ),
    );
  }
}
