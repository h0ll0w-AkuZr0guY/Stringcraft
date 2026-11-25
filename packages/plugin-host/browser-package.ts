import { unzipSync } from "fflate";
import { SDK_VERSION, type PluginManifest } from "../contracts";
import { practicePublicKey } from "./practice-public-key";

export async function verifyBrowserPackage(bytes: ArrayBuffer) {
  if (bytes.byteLength > 266240) throw new Error("插件包超过大小限制。");
  const names = new Set<string>();
  const files = unzipSync(new Uint8Array(bytes), {
    filter: (file) => {
      if (
        !["manifest.json", "manifest.sig", "plugin.mjs"].includes(file.name) ||
        names.has(file.name) ||
        file.originalSize > 262144
      )
        throw new Error("插件包文件无效。");
      names.add(file.name);
      return true;
    },
  });
  if (names.size !== 3) throw new Error("缺少插件清单、签名或模块。");
  const manifest = new Uint8Array(files["manifest.json"]);
  const signature = new Uint8Array(files["manifest.sig"]);
  const code = new Uint8Array(files["plugin.mjs"]);
  const key = await crypto.subtle.importKey(
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
      key,
      signature,
      manifest,
    ))
  )
    throw new Error("插件发行签名无法验证。");
  const info = JSON.parse(new TextDecoder().decode(manifest)) as PluginManifest;
  if (
    !/^[a-z][a-z0-9-]{1,60}$/.test(info.id) ||
    !/^\d+\.\d+\.\d+$/.test(info.version) ||
    info.runtime !== "browser" ||
    ![1, SDK_VERSION].includes(info.sdk) ||
    info.size !== code.length ||
    !Array.isArray(info.dependencies) ||
    !Array.isArray(info.capabilities)
  )
    throw new Error("插件与当前工作台不兼容。");
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", code)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  if (info.sha256 !== digest) throw new Error("插件内容摘要不匹配。");
  return { manifest: info, code: new TextDecoder().decode(code) };
}
