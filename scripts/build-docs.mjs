import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  copyFile,
  cp,
} from "node:fs/promises";
import { marked } from "marked";
await mkdir("public/docs", { recursive: true });
const files = (await readdir("docs")).filter((f) => f.endsWith(".md"));
const escape = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const template = (title, html) =>
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} · 弦作文档</title><style>body{font:16px/1.85 system-ui,'Microsoft YaHei',sans-serif;color:#2b4536;background:#f7f9f4;margin:0}header{background:#214a39;color:white;padding:24px max(24px,calc((100vw - 1000px)/2))}header a{color:inherit;margin-right:25px}main{max-width:1000px;padding:30px 24px 80px;margin:auto}h1{font-size:32px}h2{margin-top:40px}a{color:#386d4d}table{border-collapse:collapse;width:100%;display:block;overflow:auto}td,th{border:1px solid #d9e2d1;padding:10px 15px;text-align:left}pre{background:#eaf0e3;padding:20px;overflow:auto;border-radius:8px}code{font-size:14px;background:#edf2e7;padding:2px 4px}pre code{padding:0}li{margin:5px 0}img{max-width:100%}.index-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:15px}.index-grid a{background:white;border:1px solid #dce5d3;border-radius:8px;padding:20px}blockquote{border-left:3px solid #8aa576;padding-left:20px;color:#7a8f6b}</style></head><body><header><a href="../index.html">弦作 Stringcraft</a><a href="index.html">文档导航</a><a href="https://github.com/h0ll0w-AkuZr0guY/Stringcraft">GitHub 源码</a></header><main>${html}</main></body></html>`;
for (const f of files) {
  const md = await readFile("docs/" + f, "utf-8");
  const html = (await marked(md)).replace(
    /href="([^"#]+)\.md(#[^"]*)?"/g,
    'href="$1.html$2"',
  );
  await writeFile(
    "public/docs/" + f.replace(".md", ".html"),
    template(md.split("\n")[0].replace(/^# /, ""), html),
  );
}
await writeFile(
  "public/docs/index.html",
  template(
    "使用与开发文档",
    `<p>STRINGCRAFT DOCUMENTATION</p><h1>从第一次弹奏，到下一次开发。</h1><p>先从使用指南开始。参与开发的 AI 和贡献者请阅读架构、公共接口及贡献规范。</p><div class="index-grid">${await Promise.all(files.map(async (f) => `<a href="${f.replace(".md", ".html")}">${escape((await readFile("docs/" + f, "utf-8")).split("\n")[0].replace(/^# /, ""))}</a>`)).then((a) => a.join(""))}</div>`,
  ),
);
console.log(`Built ${files.length} documentation pages`);

await cp("docs/assets", "public/docs/assets", { recursive: true });
