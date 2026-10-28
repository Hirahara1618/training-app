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
  // 自重でない種目で、前回どのセットにも重量が入っていなければ、重量は提案しない（開始重量があればそれ）
  if (!def.bw && sets.every((s) => num(s.w) == null)) {
    const start = num(def.start);
    return start != null ? { w: start, up: false, reason: "前回は重量の記録なし（開始重量）" } : { w: null, up: false, reason: "前回は重量の記録なし" };
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

// bodyweight コレクションを古い順の [{date, kg}]。field で体脂肪率（fat）・ウエスト（waist）も同じ形で取り出せる
function bwEntries(col, field) {
  const f = field || "kg";
  return Object.values(col || {})
    .filter((e) => e && typeof e.date === "string" && num(e[f]) != null)
    .map((e) => ({ date: e.date, kg: num(e[f]) }))
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

// ---- 自己ベスト ----

// 1セットの推定1RM（重量がなければ null）
function setE1rm(s) {
  const w = num(s.w), r = num(s.r);
  return w != null && w > 0 && r != null && r > 0 ? epley(w, r) : null;
}

// beforeDate より前の記録での自己ベスト { w, e1rm, reps }（記録がなければ null）
function bestBefore(workouts, exId, beforeDate) {
  let best = null;
  for (const w of workouts) {
    if (w.date >= beforeDate) continue;
    for (const e of w.exercises || []) {
      if (e.id !== exId || e.cardio) continue;
      for (const s of e.sets || []) {
        const r = num(s.r);
        if (r == null || r <= 0) continue;
        best = best || { w: null, e1rm: null, reps: 0 };
        const wt = num(s.w);
        if (wt != null && (best.w == null || wt > best.w)) best.w = wt;
        const e1 = setE1rm(s);
        if (e1 != null && (best.e1rm == null || e1 > best.e1rm)) best.e1rm = e1;
        if (r > best.reps) best.reps = r;
      }
    }
  }
  return best;
}

// セットが自己ベストか："weight"（最高重量）, "e1rm"（推定1RM）, "reps"（自重の回数）, null
function setPB(s, best, def) {
  if (!best || def.cardio) return null;
  const r = num(s.r), w = num(s.w);
  if (r == null || r <= 0) return null;
  if (w != null && w > 0) {
    if (best.w != null && w > best.w + 1e-9) return "weight";
    const e1 = setE1rm(s);
    if (e1 != null && best.e1rm != null && e1 > best.e1rm + 1e-9) return "e1rm";
    return null;
  }
  // 重量なし：自重の種目だけ、回数で比べる（加重の記録がない場合）
  if (def.bw && best.w == null && r > best.reps) return "reps";
  return null;
}

// 種目の記録（古い順）に、その日に自己ベストを更新したかの印を付ける
function markPBs(hist) {
  let bw = null, be = null, br = 0;
  return hist.map((x, k) => {
    let pb = false;
    for (const s of x.sets) {
      const r = num(s.r), w = num(s.w), e1 = setE1rm(s);
      if (r == null || r <= 0) continue;
      if (k > 0 && ((w != null && bw != null && w > bw) || (e1 != null && be != null && e1 > be) || (w == null && bw == null && r > br))) pb = true;
    }
    for (const s of x.sets) {
      const r = num(s.r), w = num(s.w), e1 = setE1rm(s);
      if (r == null || r <= 0) continue;
      if (w != null && (bw == null || w > bw)) bw = w;
      if (e1 != null && (be == null || e1 > be)) be = e1;
      if (r > br) br = r;
    }
    return Object.assign({}, x, { pb });
  });
}

// ---- 週ごとの部位別セット数 ----

// 直近 n 週（今週を含む、古い順）の [{start, vol: {部位: セット数}}]
function weeklyVolumes(workouts, today, n) {
  const out = [];
  const ws = weekStart(today);
  for (let k = n - 1; k >= 0; k--) {
    const start = addDays(ws, -7 * k);
    out.push({ start, vol: weekVolume(workouts, start) });
  }
  return out;
}

// ---- デロード（軽い週）の提案 ----

// 直近6週の記録から、休養週を勧めるかと理由を返す { suggest, reasons: [] }
function deloadAdvice(workouts, today) {
  const reasons = [];
  const from6 = addDays(weekStart(today), -35), mid = addDays(weekStart(today), -14);
  // 1. 伸び悩み：直近6週に4回以上ある種目で、後半3週の最高推定1RMが前半3週を超えていない
  const per = {};
  for (const w of workouts) {
    if (w.date < from6 || w.date > today) continue;
    for (const e of w.exercises || []) {
      if (e.cardio) continue;
      let top = null;
      for (const s of e.sets || []) { const v = setE1rm(s); if (v != null && (top == null || v > top)) top = v; }
      if (top == null) continue;
      const p = (per[e.id] = per[e.id] || { name: e.name, n: 0, early: null, late: null });
      p.n++;
      const k = w.date < mid ? "early" : "late";
      if (p[k] == null || top > p[k]) p[k] = top;
    }
  }
  const tracked = Object.values(per).filter((p) => p.n >= 4 && p.early != null && p.late != null);
  const stalled = tracked.filter((p) => p.late <= p.early * 1.005);
  const stall = tracked.length >= 2 && stalled.length / tracked.length >= 0.5;
  if (stall) reasons.push(`主な種目の推定1RMが3週伸びていない（${stalled.map((p) => p.name).slice(0, 3).join("・")}${stalled.length > 3 ? " ほか" : ""}）`);
  // 2. 疲労：直近2週の RIR の平均が 0.5 以下（記録が6セット以上）
  const rirs = [];
  for (const w of workouts) {
    if (w.date < mid || w.date > today) continue;
    for (const e of w.exercises || []) for (const s of e.sets || []) {
      if (e.cardio || s.rir === "" || s.rir == null) continue;
      rirs.push(String(s.rir) === "4+" ? 4 : num(s.rir));
    }
  }
  const avgRir = rirs.length >= 6 ? rirs.reduce((a, b) => a + b, 0) / rirs.length : null;
  const tired = avgRir != null && avgRir <= 0.5;
  if (tired) reasons.push(`直近2週の RIR の平均が ${avgRir.toFixed(1)}（限界近くまで追い込み続けている）`);
  // 3. 連続：軽い週（セット数が平均の半分未満）なしで6週以上続いている
  const weeks = weeklyVolumes(workouts, today, 8).map((x) => Object.values(x.vol).reduce((a, b) => a + b, 0));
  const done = weeks.slice(0, -1); // 今週は途中なので除く
  const avg = done.filter((v) => v > 0).reduce((a, b) => a + b, 0) / Math.max(1, done.filter((v) => v > 0).length);
  let streak = 0;
  for (let k = done.length - 1; k >= 0 && done[k] >= avg * 0.5 && done[k] > 0; k--) streak++;
  const long = streak >= 6;
  if (long) reasons.push(`軽い週なしで ${streak}週続けて練習している`);
  const suggest = (stall && stalled.length >= 3) || [stall, tired, long].filter(Boolean).length >= 2;
  return { suggest, reasons };
}
