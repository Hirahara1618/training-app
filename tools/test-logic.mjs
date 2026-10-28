// 手帳の計算ロジック（src/app/logic.js）の検査。ブラウザなしで node で動く。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = vm.createContext({ console });
for (const f of ["src/shared/catalog.js", "src/app/util.js", "src/app/logic.js"]) {
  // const/let の宣言も ctx から見えるように、最後に globalThis へ出す
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  const names = [...src.matchAll(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  vm.runInContext(`${src}\n;Object.assign(globalThis, {${names.join(",")}});`, ctx, { filename: f });
}
const T = ctx;
let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

test("カタログ：80種目・模型71・ID重複なし・部位が正しい", () => {
  assert.equal(T.CATALOG.list.length, 80);
  assert.equal(T.CATALOG.list.filter((e) => e.model).length, 71);
  assert.equal(new Set(T.CATALOG.list.map((e) => e.id)).size, 80);
  for (const e of T.CATALOG.list) assert.ok(T.MUSCLES.includes(e.muscle), e.id);
  assert.equal(T.CATALOG.byId.c_goblet.inc, 2);
  assert.equal(T.CATALOG.byId.dips.bw, true);
  assert.equal(T.CATALOG.byId.c_run.cardio, true);
  assert.equal(T.hasModel("c_run"), false);
  assert.equal(T.hasModel("bench8"), true);
});

const bench = { ...T.CATALOG.byId.bench }; // 3×5–8, 刻み2.5
test("提案：全セット上限に届いたら +刻み", () => {
  const s = T.suggest(bench, { sets: [{ w: 60, r: 8 }, { w: 60, r: 8 }, { w: 60, r: 8 }] });
  assert.equal(s.w, 62.5); assert.equal(s.up, true);
});
test("提案：届いていなければ同じ重量", () => {
  const s = T.suggest(bench, { sets: [{ w: 60, r: 8 }, { w: 60, r: 7 }, { w: 60, r: 6 }] });
  assert.equal(s.w, 60); assert.equal(s.up, false);
});
test("提案：最大重量のセットだけ数える", () => {
  const s = T.suggest(bench, { sets: [{ w: 55, r: 8 }, { w: 60, r: 8 }, { w: 60, r: 8 }] });
  assert.equal(s.w, 60);
});
test("提案：2.3kg刻みでも小数の誤差が出ない", () => {
  const d = { ...T.CATALOG.byId.latpd, inc: 2.3 };
  const s = T.suggest(d, { sets: [1, 2, 3].map(() => ({ w: 41.4, r: 12 })) });
  assert.equal(s.w, 43.7);
});
test("提案：記録なしなら開始重量、なければ null", () => {
  assert.equal(T.suggest({ ...bench, start: 40 }, null).w, 40);
  assert.equal(T.suggest(bench, null), null);
  assert.equal(T.suggest(T.CATALOG.byId.c_run, null), null);
});
test("提案：自重は加重欄として扱う", () => {
  const chin = T.CATALOG.byId.chin; // 6–10, inc 0
  const s = T.suggest(chin, { sets: [{ w: "", r: 10 }, { w: "", r: 10 }, { w: "", r: 10 }] });
  assert.equal(s.w, 0); assert.match(s.reason, /加重/);
  assert.equal(T.fmtLoad(5, true), "自重+5kg");
});

const W = (date, id, sets, muscle = "胸", extra = {}) => ({ date, dayKey: "a", exercises: [{ id, name: id, muscle, sets, ...extra }] });
test("前回の記録：指定日より前で、記録のある最後の回", () => {
  const ws = T.sortedWorkouts({
    a: W("2026-10-01", "bench", [{ w: 50, r: 8 }]),
    b: W("2026-10-08", "bench", [{ w: "", r: "" }]),
    c: W("2026-10-15", "bench", [{ w: 55, r: 8 }]),
  });
  assert.equal(T.lastRecord(ws, "bench", "2026-10-15").date, "2026-10-01");
  assert.equal(T.lastRecord(ws, "bench", "2026-10-16").date, "2026-10-15");
});
test("週のセット数：月曜はじまり、有酸素は除く", () => {
  const ws = T.sortedWorkouts({
    a: W("2026-10-25", "bench", [{ w: 60, r: 8 }]),                       // 日曜（前の週）
    b: W("2026-10-26", "bench", [{ w: 60, r: 8 }, { w: 60, r: 8 }, { w: "", r: "" }]),
    c: W("2026-10-28", "c_run", [{ w: 5, r: 30 }], "有酸素", { cardio: true }),
  });
  const v = T.weekVolume(ws, "2026-10-28");
  assert.deepEqual({ ...v }, { "胸": 2 });
  assert.equal(T.weekStart("2026-11-01"), "2026-10-26");
});
test("体重：7日平均・4週間前との差・期間の変化", () => {
  const col = {};
  for (let i = 0; i < 60; i++) { const d = T.addDays("2026-09-01", i); col[d] = { date: d, kg: 70 - i * 0.1 }; }
  const e = T.bwEntries(col);
  const st = T.bwStats(e);
  assert.equal(st.latest.date, "2026-10-30");
  assert.ok(Math.abs(st.diff4w - -2.8) < 1e-9);
  const s = T.bwSeries(e, "7d", "2026-10-30");
  assert.equal(s.points.length, 7);
  // 期間の最初の点の平均には期間より前の記録も入る
  assert.ok(Math.abs(s.line[0].kg - T.avg7(e, "2026-10-24")) < 1e-9);
  assert.ok(Math.abs(s.change - -0.6) < 1e-9);
});
test("Epley", () => { assert.ok(Math.abs(T.epley(100, 3) - 110) < 1e-9); });

console.log(`${n} 件すべて通過`);
