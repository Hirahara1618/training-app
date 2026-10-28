// 頭を正面・斜め・横・種目表示で撮る（頭の形の確認用）。使い方: node tools/headshot.mjs <出力png>
import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
const out = process.argv[2];
const srv = spawn(process.execPath, ["tools/serve.mjs", "dist", "8098"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 400));
const b = await chromium.launch({ channel: "chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 300, height: 300 } });
await p.goto("http://localhost:8098/model.html?q=lo");
await p.waitForFunction(() => window.__ready);
await p.addStyleTag({ content: ".top,.bottom{display:none!important}" });
const files = [];
for (const [ex, yaw] of [["", 0], ["", 0.7], ["", 1.57], ["squat", 0.5]]) {
  await p.evaluate(([e]) => { __shot(e, 0, 0); }, [ex]);
  await p.evaluate(([y]) => window.__look([0, 1.5, 0.08], 0.75, y, 0.05), [yaw]);
  const f = `${out}_${files.length}.png`; await p.screenshot({ path: f }); files.push(f, `${ex || "anat"} ${yaw}`);
}
execFileSync("py", ["-3.13", "-I", "tools/sheet.py", out, "4", ...files]);
await b.close(); srv.kill();
