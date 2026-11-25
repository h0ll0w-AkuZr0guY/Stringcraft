import { delMany, get, setMany } from "idb-keyval";
import { unzipSync } from "fflate";
import type { PracticePlugin } from "../contracts/practice";
import { practicePublicKey } from "./practice-public-key";

const key = "plugin:private-practice";
const previous = key + ":previous";
const required = ["manifest.json", "manifest.sig", "practice.mjs"] as const;
const allowed = new Set<string>(required);
const maxBytes = 256 * 1024;
function checkDesktop() {
  if (
    import.meta.env.MODE === "pages" ||
    !(globalThis as { chrome?: { webview?: unknown } }).chrome?.webview
  )
    throw new Error("完整练习插件请在 Windows 桌面版导入。");
}
export async function verifyPracticeZip(bytes: ArrayBuffer) {
  if (bytes.byteLength > maxBytes + 8192)
    throw new Error("练习包超过大小限制。");
  const entries = new Set<string>();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(bytes), {
      filter: (f) => {
        if (
          !allowed.has(f.name) ||
          entries.has(f.name) ||
          f.originalSize > maxBytes
        )
          throw new Error("目录无效");
        entries.add(f.name);
        return true;
      },
    });
  } catch {
    throw new Error("练习包 ZIP 格式无效。");
  }
  if (entries.size !== required.length) throw new Error("练习包缺少必要文件。");
  const [manifestBytes, signature, module] = required.map(
    (name) => new Uint8Array(files[name]),
  );
  const trust = await crypto.subtle.importKey(
    "jwk",
    practicePublicKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  if (
    signature.length !== 64 ||
    !(await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      trust,
      signature,
      manifestBytes,
    ))
  )
    throw new Error("插件签名无法验证。已有插件保留。");
  const m = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
    id: string;
    version: string;
    sdk: number;
    sha256: string;
    size: number;
  };
  if (
    m.id !== "practice-full" ||
    !/^\d+\.\d+\.\d+$/.test(m.version) ||
    m.sdk !== 1 ||
    m.size !== module.length
  )
    throw new Error("练习插件版本不兼容。");
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", module)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (digest !== m.sha256)
    throw new Error("插件内容摘要不一致。已有插件保留。");
  return { manifest: m, module };
}
async function loadModule(module: Uint8Array): Promise<PracticePlugin> {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(module).buffer], { type: "text/javascript" }),
  );
  try {
    const p = (await import(/* @vite-ignore */ url)).default as PracticePlugin;
    if (
      p?.sdk !== 1 ||
      typeof p.create !== "function" ||
      !Array.isArray(p.modes) ||
      !["free", "rhythm", "wait"].every((mode) =>
        p.modes.includes(mode as (typeof p.modes)[number]),
      )
    )
      throw new Error("此插件缺少练习接口。");
    return p;
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function installPracticeZip(file: File) {
  checkDesktop();
  if (file.size > maxBytes + 8192) throw new Error("练习包超过大小限制。");
  const bytes = await file.arrayBuffer(),
    result = await verifyPracticeZip(bytes);
  await loadModule(result.module);
  const old = await get<ArrayBuffer>(key);
  if (
    old &&
    (await verifyPracticeZip(old)).manifest.sha256 === result.manifest.sha256
  )
    return result.manifest;
  await setMany([
    [key, bytes],
    [previous, old],
  ]);
  return result.manifest;
}
export async function privatePractice() {
  checkDesktop();
  const bytes = await get<ArrayBuffer>(key);
  if (!bytes) return;
  const pkg = await verifyPracticeZip(bytes);
  return {
    plugin: await loadModule(pkg.module),
    version: pkg.manifest.version,
  };
}
export async function removePrivatePractice() {
  checkDesktop();
  await delMany([key, previous]);
}
export async function rollbackPractice() {
  checkDesktop();
  const old = await get<ArrayBuffer>(previous);
  if (!old) throw new Error("暂无可恢复版本。");
  await verifyPracticeZip(old);
  const current = await get<ArrayBuffer>(key);
  await setMany([
    [key, old],
    [previous, current],
  ]);
}
