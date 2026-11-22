export interface AISettings {
  key: string;
  endpoint: string;
  model: string;
}
export async function askAdvice(
  settings: AISettings,
  candidates: { capo: number; score: number }[],
  summary: { notes: number; difficulty: string },
  signal?: AbortSignal,
): Promise<{ capo: number; reason: string }> {
  const endpoint = new URL(settings.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password)
    throw new Error("API 地址必须使用 HTTPS");
  if (!settings.key.trim() || !settings.model.trim())
    throw new Error("请先填写 API Key 和模型");
  const response = await fetch(
    new URL(endpoint.href.replace(/\/$/, "") + "/chat/completions"),
    {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.any([
        AbortSignal.timeout(20000),
        ...(signal ? [signal] : []),
      ]),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.key.trim()}`,
      },
      body: JSON.stringify({
        model: settings.model.trim(),
        temperature: 0,
        max_tokens: 200,
        enable_thinking: false,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'Choose one provided guitar capo candidate. Return JSON {"capo": integer, "reason": "brief Chinese explanation"}. Preserve the original key. Do not invent notes.',
          },
          { role: "user", content: JSON.stringify({ summary, candidates }) },
        ],
      }),
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "密钥或地域配置不匹配"
        : response.status === 429
          ? "API 额度不足或请求过于频繁"
          : `模型请求失败（${response.status}）`,
    );
  const result = await response.json();
  let data;
  try {
    data = JSON.parse(result.choices[0].message.content);
  } catch {
    throw new Error("模型返回格式无效，保留本地建议");
  }
  if (
    !Number.isInteger(data.capo) ||
    !candidates.some((c) => c.capo === data.capo) ||
    typeof data.reason !== "string" ||
    data.reason.length > 500
  )
    throw new Error("模型建议未通过候选校验");
  return data;
}
