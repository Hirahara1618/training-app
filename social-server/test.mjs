// 共有サーバーの検査（Node だけで動く部分）: 日本時間の週、コード、入力の検査、ランキングの計算
import assert from "node:assert/strict";
const L = await import("./src/logic.js");

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

test("日本時間の日付と週（月曜0時〜日曜24時）", () => {
  // 2026-11-08（日）23:59 JST = 14:59 UTC、2026-11-09（月）0:00 JST = 2026-11-08 15:00 UTC
  assert.equal(L.jstDate(Date.parse("2026-11-08T14:59:59Z")), "2026-11-08");
  assert.equal(L.jstDate(Date.parse("2026-11-08T15:00:00Z")), "2026-11-09");
  assert.equal(L.weekStart("2026-11-08"), "2026-11-02");
  assert.equal(L.weekStart("2026-11-09"), "2026-11-09");
  assert.equal(L.weekdayOf("2026-11-04"), 3);
  assert.equal(L.addDays("2026-12-31", 1), "2027-01-01");
  assert.ok(L.validDate("2028-02-29"));
  assert.ok(!L.validDate("2026-02-29"));
  assert.ok(!L.validDate("2026-1-01"));
});

test("コード：Crockford base32、区切りと読み違えの読み替え", () => {
  const c = L.randomCode(8);
  assert.match(c, /^[0-9A-HJKMNP-TV-Z]{8}$/);
  assert.equal(L.fmtCode("ABCD2345"), "ABCD-2345");
  assert.equal(L.normCode(" abcd-oil5 "), "ABCD0115");
  assert.match(L.randomToken(), /^[A-Za-z0-9_-]{43}$/);
});

test("表示名：2〜20文字、制御文字・書式文字を断る、前後の空白を除く", () => {
  assert.equal(L.validName("  たろう "), "たろう");
  assert.equal(L.validName("a"), null);
  assert.equal(L.validName("あ".repeat(20)), "あ".repeat(20));
  assert.equal(L.validName("あ".repeat(21)), null);
  assert.equal(L.validName("ab\u0000c"), null);
  assert.equal(L.validName("ab‮c"), null); // 右から左への上書き
  assert.equal(L.validName("ab​c"), null); // ゼロ幅スペース
  assert.equal(L.validName(123), null);
  assert.equal(L.validName("<b>x</b>"), "<b>x</b>"); // 文字としては通す（表示は textContent）
});

test("投稿の中身：決まった形だけ残し、重量を載せない設定では重量を捨てる", () => {
  const body = { exercises: [{ name: "ベンチプレス", muscle: "胸", pb: true, note: "メモ", sets: [{ w: 60, r: 8, rir: 1, done: true }] }], weight: 70 };
  assert.deepEqual(L.cleanPostBody(body, true), { exercises: [{ name: "ベンチプレス", muscle: "胸", sets: [{ w: 60, r: 8 }], pb: true }] });
  assert.deepEqual(L.cleanPostBody(body, false), { exercises: [{ name: "ベンチプレス", muscle: "胸", sets: [{ r: 8 }], pb: true }] });
  assert.equal(L.cleanPostBody({ exercises: [] }, true), null);
  assert.equal(L.cleanPostBody({ exercises: [{ name: "x", muscle: "首", sets: [{ r: 1 }] }] }, true), null);
  assert.equal(L.cleanPostBody({ exercises: [{ name: "x", muscle: "胸", sets: [{ r: -1 }] }] }, true), null);
  assert.equal(L.cleanPostBody({ exercises: [{ name: "x", muscle: "胸", sets: [{ r: 5, w: "60" }] }] }, true), null);
  assert.deepEqual(L.stripWeights({ exercises: [{ name: "x", muscle: "胸", pb: false, sets: [{ w: 1, r: 2 }] }] }).exercises[0].sets, [{ r: 2 }]);
});

test("投稿のキーと曜日", () => {
  assert.equal(L.validPostKey("2026-11-04_rmvs3k2i5sxh"), "2026-11-04");
  assert.equal(L.validPostKey("2026-11-04_"), null);
  assert.equal(L.validPostKey("2026-13-04_a"), null);
  assert.equal(L.validPostKey("2026-11-04_a/b"), null);
  assert.equal(L.cleanWeekdays([5, 1, 3, 1]), "135");
  assert.equal(L.cleanWeekdays([0]), null);
});

test("ランキング：実施率は予定日のうちの実施、日数はトレーニングした日、同点は同じ順位", () => {
  const start = "2026-11-02"; // 月
  const today = "2026-11-05"; // 木
  const people = [
    { id: "a", name: "A", plan: "135", since: "2026-10-01" }, // 月水金。月・水に実施 → 2/2
    { id: "b", name: "B", plan: "135", since: "2026-10-01" }, // 月だけ実施 → 1/2、日数は火も入れて2
    { id: "c", name: "C", plan: "", since: "2026-10-01" },    // 予定なし → 実施率に入らない
    { id: "d", name: "D", plan: "1234567", since: "2026-11-04" }, // 水に登録。水・木に実施（木＝今日）→ 2/2
  ];
  const rows = {
    a: { "2026-11-02": { planned: 1, trained: 1 }, "2026-11-04": { planned: 1, trained: 1 } },
    b: { "2026-11-02": { planned: 1, trained: 1 }, "2026-11-03": { planned: 0, trained: 1 } },
    c: { "2026-11-03": { planned: 0, trained: 1 } },
    d: { "2026-11-04": { planned: 1, trained: 1 }, "2026-11-05": { planned: 1, trained: 1 } },
  };
  const r = L.rankWeek(people, rows, start, today);
  assert.equal(r.end, "2026-11-08");
  assert.deepEqual(r.rate.map((x) => [x.id, x.rank, x.done, x.planned]), [["a", 1, 2, 2], ["d", 1, 2, 2], ["b", 3, 1, 2]]);
  assert.deepEqual(r.days.map((x) => [x.id, x.rank, x.value]), [["a", 1, 2], ["b", 1, 2], ["d", 1, 2], ["c", 4, 1]]);
  // 今日が予定日でまだ実施していない人は、今日を数えない（金曜に見ると A は 2/2 のまま、金を過ぎれば 2/3）
  const fri = L.rankWeek([people[0]], rows, start, "2026-11-06");
  assert.deepEqual([fri.rate[0].done, fri.rate[0].planned], [2, 2]);
  const sat = L.rankWeek([people[0]], rows, start, "2026-11-07");
  assert.deepEqual([sat.rate[0].done, sat.rate[0].planned], [2, 3]);
  // 先週（今日より前に終わった週）は7日分すべて
  const last = L.rankWeek([people[0]], {}, "2026-10-26", today);
  assert.deepEqual([last.rate[0].done, last.rate[0].planned], [0, 3]);
});

console.log(`${n} 件すべて通過`);
