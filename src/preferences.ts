import type { AISettings } from "../packages/music/advisor";

export type TextSize = "standard" | "large" | "largest";
export const textSizes: Record<TextSize, number> = {
  standard: 1,
  large: 1.15,
  largest: 1.3,
};
export const textLabels: Record<TextSize, string> = {
  standard: "标准",
  large: "较大",
  largest: "最大",
};

export function getPreference<T>(key: string, fallback: T): T {
  try {
    return (
      JSON.parse(localStorage.getItem("stringcraft:" + key) ?? "null") ??
      fallback
    );
  } catch {
    return fallback;
  }
}

export function setPreference<T>(key: string, value: T) {
  try {
    localStorage.setItem("stringcraft:" + key, JSON.stringify(value));
  } catch {
    /* The app is also usable with storage disabled. */
  }
}

export function initialAI(): AISettings {
  const defaults = {
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  };
  const saved = getPreference("provider", defaults);
  return {
    endpoint:
      typeof saved.endpoint === "string" ? saved.endpoint : defaults.endpoint,
    model: typeof saved.model === "string" ? saved.model : defaults.model,
    key: "",
  };
}
