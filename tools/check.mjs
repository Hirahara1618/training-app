// 模型の自動検査（CLAUDE.md 8章）：器具へのめり込み・腕と胴体/太ももの重なり・腕の動きの跳ね。
// 使い方: npm run build && node tools/check.mjs [種目ID,…|all] [hi|lo] [分割数] [k/n（全種目を n 個に分けた k 番目）]
// 既定はスマホ版メッシュ（iPhone で見える形）で 100 分割。1つでも基準を超えたら終了コード 1。

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARG = process.argv[2] || "all";
const Q = process.argv[3] || "lo";
const N = Number(process.argv[4] || 100);
const PORT = 8097;

const server = spawn(process.execPath, [path.join(ROOT, "tools/serve.mjs"), path.join(ROOT, "dist"), String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const cm = (m) => (m * 100).toFixed(1).padStart(5) + "cm";
let failed = 0;
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 320 } });
  page.on("pageerror", (e) => console.log(`pageerror: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/model.html?q=${Q}`);
  await page.waitForFunction(() => window.__ready || !document.querySelector("#fail").hidden, null, { timeout: 120000 });
  if (ARG === "selftest") {
    // 検査そのものの確認：わざと壊した種目を作り、3つの検査がそれぞれ見つけるか
    const r = await page.evaluate((n) => {
      const base = EXERCISES.deadlift;
      defineExercise(Object.assign({}, base, {
        id: "_bad_bar",
        pose: (t, fit) => Object.assign(base.pose(t, fit), { bar: [0, 0.3, 0.07], hands: (sg) => [sg * 0.24, 0.3, 0.07] }),
      }));
      defineExercise(Object.assign({}, base, {
        id: "_bad_self",
        pose: (t, fit) => Object.assign(base.pose(1, fit), { bar: null, grip: 0, hands: (sg) => [-sg * 0.02, 1.0, 0.08], pole: (sg) => [sg, 0, 0] }),
      }));
      defineExercise(Object.assign({}, base, {
        id: "_bad_jump",
        pose: (t, fit) => Object.assign(base.pose(t, fit), { pole: (sg) => (t < 0.5 ? [sg * 0.25, 0, -1] : [sg * 0.25, 0, 1]) }),
      }));
      return { bar: __check("_bad_bar", n), self: __self("_bad_self", n), jump: __smooth("_bad_jump", n) };
    }, 20);
    const results = [["バーをすねに埋めた → めり込み検出", !r.bar.ok], ["前腕を胴体に入れた → 重なり検出", !r.self.ok], ["肘の向きを途中で反転 → 跳ね検出", !r.jump.ok]];
    for (const [name, ok] of results) { console.log(`  ${ok ? "ok" : "NG"}  ${name}`); if (!ok) failed++; }
    console.log(`    例: ${r.bar.items[0] ? `${r.bar.items[0].key} ${cm(r.bar.items[0].depth)}` : "-"} / ${r.self.items[0] ? `${r.self.items[0].key} ${cm(r.self.items[0].depth)}` : "-"}`);
    process.exitCode = failed ? 1 : 0;
    await browser.close();
    server.kill();
    process.exit();
  }
  let ids = ARG === "all" ? await page.evaluate(() => Object.keys(EXERCISES).filter((k) => !k.startsWith("_"))) : ARG.split(",");
  // 5番目の引数 "k/n" で分割して流す（GitHub Actions で並列に）
  const shard = (process.argv[5] || "").match(/^(\d+)\/(\d+)$/);
  if (shard) ids = ids.filter((_, i) => i % Number(shard[2]) === Number(shard[1]) - 1);
  console.log(`検査: ${ids.length}種目 · ${Q === "lo" ? "スマホ版" : "通常版"}メッシュ · ${N}分割`);
  for (const id of ids) {
    const t0 = Date.now();
    const r = await page.evaluate(([i, n]) => ({ check: __check(i, n), equip: __equip(i, Math.min(n, 50)), self: __self(i, n), smooth: __smooth(i, n) }), [id, N]);
    const ok = r.check.ok && r.equip.ok && r.self.ok && r.smooth.ok;
    if (!ok) failed++;
    console.log(`\n${ok ? "OK" : "NG"}  ${id}  (${((Date.now() - t0) / 1000).toFixed(1)}秒)`);
    const show = (title, res) => {
      const bad = res.items.filter((x) => !x.ok);
      const top = res.items.slice(0, 3);
      console.log(`  ${title}: ${bad.length ? `基準超え ${bad.length}件` : "基準内"}${res.items.length ? "" : "（接触なし）"}`);
      for (const x of (bad.length ? bad : top)) console.log(`    ${x.ok ? "  " : "✗ "}${x.key.padEnd(16, "　")} ${cm(x.depth)} / 基準 ${cm(x.limit)}  t=${x.t.toFixed(2)}`);
    };
    show("器具へのめり込み", r.check);
    show("器具同士のめり込み", r.equip);
    show("腕の重なり", r.self);
    const jumps = Object.entries(r.smooth.bones).filter(([, v]) => v.jumps.length);
    console.log(`  動きの跳ね: ${jumps.length ? "" : "なし"}`);
    for (const [name, v] of jumps) console.log(`    ✗ ${name} ${v.jumps.map((j) => `t=${j.t.toFixed(2)}（${j.d.toFixed(3)}、中央値の${j.ratio.toFixed(1)}倍）`).join(" ")}`);
  }
  console.log(`\n${failed ? `${failed}種目が基準を超えています` : "すべて基準内"}`);
} finally {
  await browser.close();
  server.kill();
}
process.exitCode = failed ? 1 : 0;
