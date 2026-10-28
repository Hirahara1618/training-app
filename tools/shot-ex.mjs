// 種目の静止画シート：種目ごとに t × 視点 を撮り、1枚に並べる（CLAUDE.md 8章）。
// 使い方: npm run build && node tools/shot-ex.mjs <出力先> <種目ID,…> [t の並び 0,0.5,1] [hi|lo] [near]
// シートの合成は Python（PIL）: tools/sheet.py

import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "tools/out"));
const IDS = (process.argv[3] || "squat,deadlift,bench,latpd").split(",");
const TS = (process.argv[4] || "0,0.5,1").split(",").map(Number);
const Q = process.argv[5] || "hi";
const NEAR = process.argv[6] === "near";
const VIEWS = [["正面", 0], ["斜め", Math.PI / 4], ["横", Math.PI / 2], ["背面", Math.PI]];
const PORT = 8095;
fs.mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, [path.join(ROOT, "tools/serve.mjs"), path.join(ROOT, "dist"), String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 520 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`${m.type()}: ${m.text()}`); });
  await page.goto(`http://localhost:${PORT}/model.html?q=${Q}`);
  await page.waitForFunction(() => window.__ready || !document.querySelector("#fail").hidden, null, { timeout: 120000 });
  if (!(await page.evaluate(() => window.__ready))) throw new Error(await page.textContent("#fail"));
  // 操作部品を隠して模型だけ撮る
  await page.addStyleTag({ content: ".top,.bottom{display:none!important}" });
  for (const id of IDS) {
    const files = [];
    for (const t of TS) {
      for (const [label, yaw] of VIEWS) {
        await page.evaluate(([i, tt, y, n]) => window.__shot(i, tt, y, n), [id, t, yaw, NEAR]);
        const f = path.join(OUT, `${id}_t${t}_${yaw.toFixed(2)}.png`);
        await page.screenshot({ path: f });
        files.push({ f, label: `${id} t=${t} ${label}` });
      }
    }
    const sheet = path.join(OUT, `sheet-${id}${NEAR ? "-near" : ""}.png`);
    execFileSync("py", ["-3.13", "-I", path.join(ROOT, "tools/sheet.py"), sheet, String(VIEWS.length), ...files.flatMap((x) => [x.f, x.label])]);
    for (const x of files) fs.unlinkSync(x.f);
    console.log(sheet);
  }
  if (logs.length) console.log(logs.join("\n"));
} finally {
  await browser.close();
  server.kill();
}
