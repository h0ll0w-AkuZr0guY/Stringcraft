import { spawnSync } from "node:child_process";
const r = spawnSync(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test", "tests/e2e/quality.spec.ts"],
  { stdio: "inherit", env: { ...process.env, STRINGCRAFT_QUALITY: "1" } },
);
process.exit(r.status ?? 1);
