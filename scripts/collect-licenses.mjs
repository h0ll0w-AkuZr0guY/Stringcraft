import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
const lock = JSON.parse(await readFile("package-lock.json", "utf-8")),
  sections = [];
for (const [dir, metadata] of Object.entries(lock.packages)) {
  if (!dir || metadata.dev) continue;
  try {
    const pkg = JSON.parse(
      await readFile(path.join(dir, "package.json"), "utf-8"),
    );
    const files = (await readdir(dir)).filter((f) =>
      /^licen[sc]e|^notice|^copying/i.test(f),
    );
    const text = await Promise.all(
      files.map(async (f) => {
        try {
          return `\n${f}\n${await readFile(path.join(dir, f), "utf-8")}`;
        } catch {
          return "";
        }
      }),
    );
    sections.push(
      `${pkg.name}@${pkg.version} (${pkg.license ?? "see upstream"})\n${pkg.homepage ?? pkg.repository?.url ?? ""}\n${text.join("\n")}`,
    );
  } catch {}
}
await mkdir("public/legal", { recursive: true });
await writeFile(
  "public/legal/THIRD_PARTY_NOTICES.txt",
  sections.join("\n\n" + "=".repeat(72) + "\n\n"),
);
console.log(`Collected ${sections.length} runtime dependency notices`);
