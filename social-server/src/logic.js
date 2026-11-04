// 共有サーバーの計算と入力の検査。D1 にも Workers にも触らない（Node でも検査できるように）

export const MAX_FRIENDS = 50;
export const MAX_PENDING = 50;
const JST_MS = 9 * 3600 * 1000;
const DAY_MS = 86400000;

// ---- 日付（日本時間） ----

const pad2 = (n) => String(n).padStart(2, "0");
function utcYmd(d) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }

// その時刻の日本時間の日付
export function jstDate(nowMs) { return utcYmd(new Date(nowMs + JST_MS)); }

export function validDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d) && utcYmd(d) === s;
}
export function addDays(s, n) { return utcYmd(new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY_MS)); }
// 1=月 … 7=日
export function weekdayOf(s) { const g = new Date(`${s}T00:00:00Z`).getUTCDay(); return g === 0 ? 7 : g; }
// その日を含む週の月曜
export function weekStart(s) { return addDays(s, 1 - weekdayOf(s)); }

// ---- コード ----

// Crockford の base32（I L O U を使わない。読み違えやすい文字は入力時に読み替える）
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function randomCode(len) {
  const b = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (const x of b) s += B32[x & 31]; // 256 は 32 で割り切れるので偏らない
  return s;
}
export function normCode(s) {
  if (typeof s !== "string") return "";
  return s.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}
// 4文字ずつ区切って見せる
export function fmtCode(s) { return s.replace(/(.{4})(?=.)/g, "$1-"); }

export function b64url(bytes) {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// トークン（256ビット）
export function randomToken() { return b64url(crypto.getRandomValues(new Uint8Array(32))); }
export async function sha256hex(s) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(h, (x) => x.toString(16).padStart(2, "0")).join("");
}

// ---- 入力の検査 ----

// 制御文字・書式文字・私用領域・行区切りを含むものは断る
const BAD_CHARS = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u;
function cleanText(s, min, max) {
  if (typeof s !== "string") return null;
  const t = s.normalize("NFC").trim().replace(/\s+/g, " ");
  const len = Array.from(t).length;
  if (len < min || len > max || BAD_CHARS.test(t)) return null;
  return t;
}
// 表示名は2〜20文字
export function validName(s) { return cleanText(s, 2, 20); }

const MUSCLES = ["胸", "背中", "肩", "二頭", "三頭", "前もも", "もも裏", "お尻", "ふくらはぎ", "腹", "有酸素"];
const okNum = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10000;

// 投稿の中身を決まった形に作り直す。知らない項目は捨てる。showWeight がオフなら重量を捨てる。
// 返り値 { exercises: [{ name, muscle, sets: [{ w?, r }], pb, cardio?, bw? }] } または null（形が正しくない）
export function cleanPostBody(body, showWeight) {
  if (!body || !Array.isArray(body.exercises) || !body.exercises.length || body.exercises.length > 30) return null;
  const exercises = [];
  for (const e of body.exercises) {
    if (!e || typeof e !== "object") return null;
    const name = cleanText(e.name, 1, 40);
    if (!name || !MUSCLES.includes(e.muscle) || !Array.isArray(e.sets) || !e.sets.length || e.sets.length > 30) return null;
    const sets = [];
    for (const s of e.sets) {
      if (!s || typeof s !== "object" || !okNum(s.r)) return null;
      const o = {};
      if (showWeight && s.w != null) { if (!okNum(s.w)) return null; o.w = s.w; }
      o.r = s.r;
      sets.push(o);
    }
    const x = { name, muscle: e.muscle, sets, pb: e.pb === true };
    if (e.cardio === true) x.cardio = true;
    if (e.bw === true) x.bw = true;
    exercises.push(x);
  }
  return { exercises };
}
// 重量だけ消す（設定で重量を載せないにしたとき、置いてある投稿から消す）
export function stripWeights(body) {
  return { exercises: body.exercises.map((e) => Object.assign({}, e, { sets: e.sets.map((s) => ({ r: s.r })) })) };
}

// 投稿のキー（<YYYY-MM-DD>_<dayKey>）
export function validPostKey(k) {
  if (typeof k !== "string" || k.length > 60) return null;
  const m = k.match(/^(\d{4}-\d{2}-\d{2})_([A-Za-z0-9_-]{1,40})$/);
  return m && validDate(m[1]) ? m[1] : null;
}
export function cleanTitle(s) { return s == null || s === "" ? "" : cleanText(s, 1, 40); }

// ルーティンの曜日（[1,3,5] など）→ "135"
export function cleanWeekdays(a) {
  if (!Array.isArray(a) || a.length > 7) return null;
  const set = new Set();
  for (const x of a) { if (!Number.isInteger(x) || x < 1 || x > 7) return null; set.add(x); }
  return Array.from(set).sort().join("");
}

// ---- ランキング ----

// 週ごとの集計。
// people: [{ id, name, plan: "135", since: 登録した日 }]
// rows:   { id: { date: { planned, trained } } }（手帳から届いた日ごとの記録）
// 予定日は届いた記録を優先し、届いていない日は登録後のルーティンの曜日から決める。
// 今日は、まだ時間があるので「予定日でトレーニング済み」のときだけ実施率に数える。
// 返り値 { start, end, rate: [{ id, name, rank, planned, done, value }], days: [{ id, name, rank, value }] }
export function rankWeek(people, rows, start, today) {
  const end = addDays(start, 6);
  const last = today < end ? today : end;
  const rate = [], days = [];
  for (const p of people) {
    let planned = 0, done = 0, trained = 0;
    for (let d = start; d <= last; d = addDays(d, 1)) {
      const r = rows[p.id] && rows[p.id][d];
      const isPlanned = r ? !!r.planned : (d >= p.since && p.plan.includes(String(weekdayOf(d))));
      const isTrained = !!(r && r.trained);
      if (isTrained) trained++;
      if (isPlanned && (d < today || isTrained)) { planned++; if (isTrained) done++; }
    }
    if (planned) rate.push({ id: p.id, name: p.name, planned, done, value: done / planned });
    days.push({ id: p.id, name: p.name, value: trained });
  }
  return { start, end, rate: ranked(rate), days: ranked(days) };
}
// 大きい順。同点は同じ順位（1, 1, 3）
function ranked(list) {
  list.sort((a, b) => b.value - a.value || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return list.map((x) => Object.assign(x, { rank: 1 + list.filter((y) => y.value > x.value).length }));
}
