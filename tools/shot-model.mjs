// 模型ページを4方向から撮って1枚に並べる（目視確認用）。
// 使い方: npm run build && node tools/shot-model.mjs [出力先] [hi|lo]
// ヘッドレスの WebGL は SwiftShader（ソフトウェア描画）で動かす。

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "tools/out"));
const Q = process.argv[3] || "hi";
const PORT = 8093;
fs.mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, [path.join(ROOT, "tools/serve.mjs"), path.join(ROOT, "dist"), String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 760 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/model.html?q=${Q}`);
  await page.waitForFunction(() => window.__ready || !document.querySelector("#fail").hidden, null, { timeout: 120000 });
  if (!(await page.evaluate(() => window.__ready))) {
    console.log(await page.textContent("#fail"));
    process.exitCode = 1;
  } else {
    console.log(`表示まで ${Date.now() - t0} ms · ${await page.textContent("#gl-info")}`);
    const shots = [];
    for (const [name, yaw] of [["front", 0], ["oblique", Math.PI / 4], ["side", Math.PI / 2], ["back", Math.PI]]) {
      await page.evaluate((y) => window.__view(y, 0.08), yaw);
      const f = path.join(OUT, `model-${Q}-${name}.png`);
      await page.screenshot({ path: f });
      shots.push(f);
    }
    console.log(shots.join("\n"));
  }
  if (logs.length) console.log(logs.join("\n"));
} finally {
  await browser.close();
  server.kill();
}
