import { describe, it, expect } from "vitest";
import { demoProject } from "../packages/music/demo";
import { validateProject } from "../packages/contracts";
import { audioAssetKey, audioAssetPrefix } from "../packages/storage";

describe("recording provenance and playback mapping", () => {
  it("accepts legacy projects, verifies original identity and rejects invalid ranges", () => {
    const p = demoProject();
    validateProject(p);
    p.sourceKind = "audio";
    p.sourceAudioSha256 = "a".repeat(64);
    p.audioReference = {
      kind: "original",
      sha256: "a".repeat(64),
      durationSeconds: 30,
      offsetSeconds: 1,
    };
    validateProject(p);
    expect(() =>
      validateProject({
        ...p,
        audioReference: { ...p.audioReference!, sha256: "b".repeat(64) },
      }),
    ).toThrow("不能标为原文件");
    expect(() =>
      validateProject({
        ...p,
        audioReference: { ...p.audioReference!, offsetSeconds: 20 },
      }),
    ).toThrow("不能覆盖");
    expect(() =>
      validateProject({
        ...p,
        audioReference: { ...p.audioReference!, offsetSeconds: NaN },
      }),
    ).toThrow();
    const comparison = {
      ...p,
      audioReference: {
        ...p.audioReference,
        kind: "reference" as const,
        sha256: "b".repeat(64),
      },
    };
    validateProject(comparison);
    expect(comparison.sourceAudioSha256).toBe(p.sourceAudioSha256);
  });
  it("content-addressed project assets cannot collide through IDs containing separators", () => {
    const ref = {
      kind: "reference" as const,
      sha256: "a".repeat(64),
      durationSeconds: 30,
      offsetSeconds: 0,
    };
    const a = audioAssetKey({ id: "work", audioReference: ref }),
      b = audioAssetKey({ id: "work:child", audioReference: ref });
    expect(a).not.toBe(b);
    expect(b.startsWith(audioAssetPrefix("work"))).toBe(false);
    expect(audioAssetKey({ id: "legacy" })).toBe("audio:legacy");
  });
});
