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
test("提案：前回に重量の記録がなければ重量を提案しない", () => {
  const s = T.suggest(bench, { sets: [{ w: "", r: 5, done: true }, { w: "", r: 5, done: true }] });
  assert.equal(s.w, null); assert.match(s.reason, /重量の記録なし/);
  assert.equal(T.suggest({ ...bench, start: 40 }, { sets: [{ w: "", r: 5 }] }).w, 40);
});
test("数値の読み取り：現行版と同じく parseFloat", () => {
  assert.equal(T.num("60kg"), 60); assert.equal(T.num(""), null); assert.equal(T.num("abc"), null); assert.equal(T.num(2.5), 2.5);
});
test("ルーティンの曜日：weekday、なければキー名", () => {
  assert.equal(T.routineWeekday({ key: "x", weekday: 3 }), 3);
  assert.equal(T.routineWeekday({ key: "thu" }), 4);
  assert.equal(T.routineWeekday({ key: "zzz" }), 0);
  assert.equal(T.routineWeekday({ key: "mon", weekday: "0" }), 0);
});
test("自己ベスト：最高重量・推定1RM・自重の回数", () => {
  const ws = T.sortedWorkouts({ a: W("2026-10-01", "bench", [{ w: 60, r: 8 }, { w: 62.5, r: 5 }]) });
  const best = T.bestBefore(ws, "bench", "2026-10-08");
  assert.equal(best.w, 62.5);
  assert.equal(T.setPB({ w: 65, r: 3 }, best, bench), "weight");
  assert.equal(T.setPB({ w: 60, r: 10 }, best, bench), "e1rm");
  assert.equal(T.setPB({ w: 60, r: 8 }, best, bench), null);
  assert.equal(T.setPB({ w: 65, r: 3 }, null, bench), null, "初めての種目には付けない");
  const chin = T.CATALOG.byId.chin;
  const bwBest = T.bestBefore(T.sortedWorkouts({ a: W("2026-10-01", "chin", [{ w: "", r: 8 }]) }), "chin", "2026-10-08");
  assert.equal(T.setPB({ w: "", r: 9 }, bwBest, chin), "reps");
  const marked = T.markPBs([{ date: "1", sets: [{ w: 60, r: 8 }] }, { date: "2", sets: [{ w: 60, r: 8 }] }, { date: "3", sets: [{ w: 62.5, r: 6 }] }]);
  assert.deepEqual(marked.map((x) => x.pb), [false, false, true]);
});
test("週ごとのセット数：8週、古い順", () => {
  const ws = T.sortedWorkouts({ a: W("2026-10-26", "bench", [{ w: 60, r: 8 }, { w: 60, r: 8 }]), b: W("2026-10-12", "bench", [{ w: 60, r: 8 }]) });
  const v = T.weeklyVolumes(ws, "2026-10-28", 8);
  assert.equal(v.length, 8);
  assert.equal(v[7].start, "2026-10-26"); assert.equal(v[7].vol["胸"], 2);
  assert.equal(v[5].start, "2026-10-12"); assert.equal(v[5].vol["胸"], 1);
});
test("デロード：伸び悩み＋追い込み続きなら提案、順調なら提案しない", () => {
  const make = (grow, rir) => {
    const col = {};
    for (let k = 0; k < 18; k++) {
      const d = T.addDays("2026-09-21", k * 2 + (k % 3));
      const w = 60 + (grow ? k * 1 : (k < 9 ? k * 0.5 : 4));
      for (const id of ["bench", "squat", "c_dbrow"]) col[`${d}_${id}`] = W(d, id, [{ w, r: 6, rir }, { w, r: 6, rir }], "胸");
    }
    return T.sortedWorkouts(col);
  };
  const bad = T.deloadAdvice(make(false, "0"), "2026-10-28");
  assert.equal(bad.suggest, true); assert.ok(bad.reasons.length >= 2, bad.reasons.join(" / "));
  const good = T.deloadAdvice(make(true, "2"), "2026-10-28");
  assert.equal(good.suggest, false, good.reasons.join(" / "));
  assert.equal(T.deloadAdvice([], "2026-10-28").suggest, false);
});
test("Epley", () => { assert.ok(Math.abs(T.epley(100, 3) - 110) < 1e-9); });

test("達成率：予定日・実施・セット・連続週・カレンダー", () => {
  // 月・木にルーティン（各4セット＝2種目×2）。2026-10-05 は月曜
  const days = [
    { key: "a", title: "A", weekday: 1, exercises: [{ id: "bench", sets: 2 }, { id: "c_run", sets: 2, cardio: true }] },
    { key: "b", title: "B", weekday: 4, exercises: [{ id: "squat", sets: 4 }] },
  ];
  const wk = (date, dayKey, exercises) => ({ date, dayKey, exercises });
  const S = (done) => ({ w: 60, r: 5, done });
  const ws = [
    wk("2026-10-05", "a", [{ id: "bench", sets: [S(true), S(true)] }, { id: "c_run", cardio: true, sets: [{ w: "", r: 20 }, { w: "", r: "" }] }]), // 3/4
    wk("2026-10-08", "b", [{ id: "squat", sets: [S(true), S(true), S(true), S(true)] }]), // 4/4
    wk("2026-10-12", "a", [{ id: "bench", sets: [S(true), S(false)] }]),               // 月：1/4（記録あり）
    // 10-15（木）は休み
    wk("2026-10-17", "b", [{ id: "squat", sets: [S(true), S(true), S(true), S(true)] }]), // 土に振り替え
    wk("2026-10-19", "a", [{ id: "bench", sets: [{ w: "", r: "", done: false }] }]),  // 空の記録は数えない
  ];
  assert.equal(T.doneSets(ws[0]), 3);
  assert.equal(T.plannedSets(ws[0], days), 4);
  assert.equal(T.plannedSets(wk("x", "gone", [{ sets: [{}, {}, {}] }]), days), 3, "ルーティンがなければ記録のセット数");
  const a = T.adherence(ws, days, "2026-10-01", "2026-10-21");
  // 予定日は最初の記録の日（10-05）から：5,8,12,15,19 → 実施 5,8,12
  assert.equal(a.planned, 5);
  assert.equal(a.hit, 3);
  assert.equal(a.trained, 4);
  assert.ok(Math.abs(a.rate - 0.6) < 1e-9);
  assert.ok(Math.abs(a.setRate - (3 + 4 + 1 + 4) / 16) < 1e-9);
  assert.equal(T.adherence([], days, "2026-10-01", "2026-10-31").rate, null);
  // 連続週：10/5週=2日、10/12週=2日（12と17）、10/19週は途中
  assert.equal(T.weekStreak(ws, days, "2026-10-21"), 2);
  assert.equal(T.weekStreak(ws.slice(0, 3), days, "2026-10-21"), 0, "先週が1日だけなら途切れる");
  assert.equal(T.weekStreak(ws.slice(0, 3), days, "2026-10-13"), 1, "今週が途中なら先週から数える");
  assert.equal(T.weekStreak([], days, "2026-10-21"), 0);
  // カレンダー：2026年10月は木曜はじまり → 先頭に空き3つ、31日、7の倍数
  const by = T.trainingByDate(ws, days);
  const cells = T.monthCells(2026, 10, by, days);
  assert.equal(cells.length % 7, 0);
  assert.ok(cells.slice(0, 3).every((c) => c === null));
  assert.equal(cells[3].date, "2026-10-01");
  assert.equal(cells.filter(Boolean).length, 31);
  const c5 = cells.find((c) => c && c.date === "2026-10-05");
  assert.equal(c5.plannedDay, true);
  assert.equal(c5.train.done, 3);
  assert.equal(cells.find((c) => c && c.date === "2026-10-19").train, null, "空の記録はなし");
});

console.log(`${n} 件すべて通過`);
