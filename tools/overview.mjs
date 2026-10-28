// 全種目の一覧シート：種目ごとに「始め・終わり」を斜めと横から撮って並べる（目視の見落とし探し用）。
// 使い方: npm run build && node tools/overview.mjs <出力先> [種目ID,…|all] [1枚あたりの種目数]

import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "tools/out"));
const ARG = process.argv[3] || "all";
const PER = Number(process.argv[4] || 6);
const PORT = 8099;
fs.mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, [path.join(ROOT, "tools/serve.mjs"), path.join(ROOT, "dist"), String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ channel: "chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 260, height: 300 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log(`pageerror: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/model.html?q=lo`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
  await page.addStyleTag({ content: ".top,.bottom{display:none!important}" });
  const ids = ARG === "all" ? await page.evaluate(() => CATALOG.list.filter((c) => c.model && EXERCISES[c.id]).map((c) => c.id)) : ARG.split(",");
  for (let k = 0; k < ids.length; k += PER) {
    const files = [];
    for (const id of ids.slice(k, k + PER)) {
      for (const [t, yaw, name] of [[0, 0.8, "t0"], [1, 0.8, "t1"], [0, 1.5708, "t0side"], [1, 1.5708, "t1side"]]) {
        await page.evaluate(([i, tt, y]) => { __shot(i, tt, y); }, [id, t, yaw]);
        const f = path.join(OUT, `ov_${id}_${name}.png`);
        await page.screenshot({ path: f });
        files.push(f, `${id} ${name}`);
      }
    }
    const sheet = path.join(OUT, `overview-${String(k / PER + 1).padStart(2, "0")}.png`);
    execFileSync("py", ["-3.13", "-I", path.join(ROOT, "tools/sheet.py"), sheet, "8", ...files]);
    for (let i = 0; i < files.length; i += 2) fs.unlinkSync(files[i]);
    console.log(sheet);
  }
} finally {
  await browser.close();
  server.kill();
}
