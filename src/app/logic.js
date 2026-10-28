"use strict";
// 記録から数字を出す計算。DOM に触らない（Node でも検査できるように）

// 記録が入っているセットか
function setHasData(s) {
  return !!s && (num(s.r) != null || num(s.w) != null || !!s.done || !!(s.lv && String(s.lv).trim()));
}

// workouts コレクション（{id: Workout}）を新しい順の配列に
function sortedWorkouts(col) {
  return Object.values(col || {})
    .filter((w) => w && typeof w.date === "string")
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))));
}

// beforeDate より前で、その種目に記録がある最後の回 { date, sets }
function lastRecord(workouts, exId, beforeDate) {
  for (const w of workouts) {
    if (w.date >= beforeDate) continue;
    for (const e of w.exercises || []) {
      if (e.id !== exId) continue;
      const sets = (e.sets || []).filter(setHasData);
      if (sets.length) return { date: w.date, sets };
    }
  }
  return null;
}

// 次回重量の提案。前回の最大重量で、規定セット数すべてが上限回数に届いていれば +inc、
// 届いていなければ同じ重量で回数を伸ばす。自重は w を加重として扱う。
// 返り値 { w, up, reason } または null
function suggest(def, prev) {
  if (def.cardio) return null;
  const inc = num(def.inc) || 0;
  const sets = prev ? prev.sets.filter((s) => num(s.r) != null) : [];
  if (!sets.length) {
    const start = num(def.start);
    if (start != null) return { w: start, up: false, reason: "開始重量" };
    if (def.bw) return { w: 0, up: false, reason: "自重から" };
    return null;
  }
  const maxW = Math.max(...sets.map((s) => num(s.w) || 0));
  const reached = sets.filter((s) => (num(s.w) || 0) === maxW && num(s.r) >= num(def.repMax)).length;
  const need = num(def.sets) || 1;
  const wLabel = fmtLoad(maxW, def.bw);
  if (reached >= need) {
    if (inc > 0) return { w: round2(maxW + inc), up: true, reason: `前回 ${wLabel} で${need}セットとも${def.repMax}回 → +${fmtNum(inc)}kg` };
    return { w: maxW, up: false, reason: def.bw ? "全セット上限回数 → 加重を検討" : "全セット上限回数に到達" };
  }
  return { w: maxW, up: false, reason: `${wLabel} のまま回数を伸ばす（上限${def.repMax}回 ${reached}/${need}セット）` };
}

function fmtLoad(w, bw) {
  if (bw) return w ? `自重+${fmtNum(w)}kg` : "自重";
  return `${fmtNum(w)}kg`;
}

// セットを短い文字列に（60×8、自重は 自重×10、有酸素は 30分 5km）
function fmtSet(s, def) {
  if (def && def.cardio) {
    const parts = [];
    if (num(s.r) != null) parts.push(`${fmtNum(num(s.r))}分`);
    if (num(s.w) != null) parts.push(`${fmtNum(num(s.w))}km`);
    if (s.lv) parts.push(String(s.lv));
    return parts.join(" ") || "—";
  }
  const w = num(s.w);
  const r = num(s.r);
  const wTxt = def && def.bw ? (w ? `+${fmtNum(w)}` : "自重") : (w == null ? "—" : fmtNum(w));
  return `${wTxt}×${r == null ? "—" : r}`;
}

// 推定1RM（Epley）
function epley(w, r) { return w * (1 + r / 30); }

// 種目ごとの記録を古い順に [{date, sets, name, muscle, cardio}]
function exerciseHistory(workouts, exId) {
  const out = [];
  for (const w of workouts) {
    for (const e of w.exercises || []) {
      if (e.id !== exId) continue;
      const sets = (e.sets || []).filter(setHasData);
      if (sets.length) out.push({ date: w.date, sets, name: e.name, muscle: e.muscle, cardio: !!e.cardio });
    }
  }
  return out.reverse();
}

// 記録のある種目の一覧 {id: {id, name, muscle, cardio, last}}（名前・部位は最新の記録から）
function recordedExercises(workouts) {
  const out = {};
  for (const w of workouts) {
    for (const e of w.exercises || []) {
      if (!(e.sets || []).some(setHasData)) continue;
      if (!out[e.id]) out[e.id] = { id: e.id, name: e.name, muscle: e.muscle, cardio: !!e.cardio, last: w.date };
    }
  }
  return out;
}

// 部位ごとに最後に記録した日 {部位: date}
function lastTrainedByMuscle(workouts) {
  const out = {};
  for (const w of workouts) {
    for (const e of w.exercises || []) {
      if (!e.muscle || out[e.muscle]) continue;
      if ((e.sets || []).some(setHasData)) out[e.muscle] = w.date;
    }
  }
  return out;
}

// ルーティンの曜日（1=月…7=日、0=なし）。weekday がない以前のルーティンはキーの名前から決める（現行版と同じ）
const KEY_WEEKDAY = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
function routineWeekday(d) {
  if (!d) return 0;
  const w = num(d.weekday);
  if (w != null) return w;
  return KEY_WEEKDAY[d.key] || 0;
}

// 月曜はじまりの週の初日
function weekStart(date) { return addDays(date, 1 - weekdayOf(date)); }

// その週の部位別セット数（有酸素は除く）
function weekVolume(workouts, date) {
  const from = weekStart(date), to = addDays(from, 6);
  const out = {};
  for (const w of workouts) {
    if (w.date < from || w.date > to) continue;
    for (const e of w.exercises || []) {
      if (e.cardio || !e.muscle) continue;
      const n = (e.sets || []).filter((s) => num(s.r) != null || s.done).length;
      if (n) out[e.muscle] = (out[e.muscle] || 0) + n;
    }
  }
  return out;
}

// ---- 体重 ----

// bodyweight コレクションを古い順の [{date, kg}]
function bwEntries(col) {
  return Object.values(col || {})
    .filter((e) => e && typeof e.date === "string" && num(e.kg) != null)
    .map((e) => ({ date: e.date, kg: num(e.kg) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// date を含む直近7日（date−6〜date）の平均。記録がなければ null
function avg7(entries, date) {
  const from = addDays(date, -6);
  let sum = 0, n = 0;
  for (const e of entries) if (e.date >= from && e.date <= date) { sum += e.kg; n++; }
  return n ? sum / n : null;
}

// 最新・直近7日平均・4週間前の7日平均との差
function bwStats(entries) {
  if (!entries.length) return null;
  const last = entries[entries.length - 1];
  const a = avg7(entries, last.date);
  const b = avg7(entries, addDays(last.date, -28));
  return { latest: last, avg7: a, avg7Prev: b, diff4w: a != null && b != null ? a - b : null };
}

const BW_RANGES = [
  { key: "7d", label: "7日", days: 7 },
  { key: "1m", label: "1か月", days: 30 },
  { key: "3m", label: "3か月", days: 91 },
  { key: "6m", label: "半年", days: 182 },
  { key: "1y", label: "1年", days: 365 },
  { key: "all", label: "全期間", days: null },
];

// 期間内の点と7日移動平均の線。移動平均は期間より前の記録も使う
function bwSeries(entries, rangeKey, today) {
  const r = BW_RANGES.find((x) => x.key === rangeKey) || BW_RANGES[1];
  const from = r.days == null ? (entries[0] ? entries[0].date : today) : addDays(today, 1 - r.days);
  const pts = entries.filter((e) => e.date >= from && e.date <= today);
  const line = pts.map((e) => ({ date: e.date, kg: avg7(entries, e.date) }));
  const change = line.length >= 2 ? line[line.length - 1].kg - line[0].kg : null;
  return { from, to: today, points: pts, line, change };
}
