export interface MusicRuleCard {
  id: string;
  title: string;
  source: { title: string; url: string; location: string };
  scope: string;
  strength: "hard" | "soft";
  positive: string;
  negative: string;
  exceptions: string;
  implementation: string;
}
export interface MusicAssessment {
  version: 1;
  profile: "pop-accompaniment" | "pop-fingerstyle" | "melody-practice";
  protectedIds: string[];
  findings: { ruleId: string; sourceIds: string[]; reason: string }[];
  rules: MusicRuleCard[];
}
export function validateMusicAssessment(value: MusicAssessment) {
  if (
    !value ||
    value.version !== 1 ||
    !["pop-accompaniment", "pop-fingerstyle", "melody-practice"].includes(
      value.profile,
    ) ||
    !Array.isArray(value.protectedIds) ||
    value.protectedIds.length > 100000 ||
    value.protectedIds.some((id) => typeof id !== "string") ||
    !Array.isArray(value.findings) ||
    value.findings.length > 20000 ||
    !Array.isArray(value.rules) ||
    value.rules.length > 100
  )
    throw new Error("音乐评估记录无效");
  for (const r of value.rules)
    if (
      !r ||
      ![
        r.id,
        r.title,
        r.scope,
        r.positive,
        r.negative,
        r.exceptions,
        r.implementation,
        r.source?.title,
        r.source?.location,
      ].every((s) => typeof s === "string" && s.length <= 4000) ||
      !["hard", "soft"].includes(r.strength) ||
      typeof r.source.url !== "string" ||
      !/^https:\/\//.test(r.source.url)
    )
      throw new Error("音乐规则来源无效");
  const rules = new Set(value.rules.map((r) => r.id));
  for (const f of value.findings)
    if (
      !f ||
      !rules.has(f.ruleId) ||
      typeof f.reason !== "string" ||
      f.reason.length > 4000 ||
      !Array.isArray(f.sourceIds) ||
      f.sourceIds.some((id) => typeof id !== "string")
    )
      throw new Error("音乐规则发现无效");
}
