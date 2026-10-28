// 解剖模型モードで、指定した点に寄って撮る（ぽつぽつ等の確認用）
// 使い方: node tools/closeup.mjs <出力png> [hi|lo] [hlパーツ,…]
import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
const out = process.argv[2], q = process.argv[3] || "lo", hl = process.argv[4] || "";
const srv = spawn(process.execPath, ["tools/serve.mjs", "dist", "8098"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 400));
const b = await chromium.launch({ channel: "chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1.5 });
await p.goto(`http://localhost:8098/model.html?q=${q}&hl=${hl}`);
await p.waitForFunction(() => window.__ready);
await p.addStyleTag({ content: ".top,.bottom{display:none!important}" });
const files = [];
for (const [name, target, yaw] of [["abs", [0, 1.05, 0.1], 0.2], ["thigh", [-0.12, 0.6, 0.05], -1.2], ["head", [0, 1.55, 0.05], 0.4]]) {
  await p.evaluate(([t, y]) => window.__look(t, 0.65, y, 0.05), [target, yaw]);
  const f = out.replace(".png", `_${name}.png`); await p.screenshot({ path: f }); files.push(f, name);
}
execFileSync("py", ["-3.13", "-I", "tools/sheet.py", out, "3", ...files]);
await b.close(); srv.kill();
