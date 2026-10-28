"use strict";
// 日付・数値・DOM の小道具

const DAY_MS = 86400000;
const WD_NAMES = ["なし", "月", "火", "水", "木", "金", "土", "日"];

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function pad2(n) { return String(n).padStart(2, "0"); }
function ymd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function todayYmd() { return ymd(new Date()); }
function parseYmd(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
// b − a の日数
function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / DAY_MS); }
// 1=月 … 7=日
function weekdayOf(s) { const g = parseYmd(s).getDay(); return g === 0 ? 7 : g; }
function fmtDate(s) { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}（${WD_NAMES[weekdayOf(s)]}）`; }
function fmtDateY(s) { const d = parseYmd(s); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; }
function fmtAgo(days) {
  if (days <= 0) return "今日";
  if (days === 1) return "昨日";
  return `${days}日前`;
}

// 入力値を数値に。空・不正は null。
// 現行版と同じく parseFloat で読む（以前の記録に "60kg" のような文字列が入っていても読めるように）
function num(v) {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function round2(n) { return Math.round(n * 100) / 100; }
function fmtNum(n) { return n == null ? "" : String(round2(n)); }
function fmtSec(sec) { sec = Math.max(0, Math.round(sec)); return `${Math.floor(sec / 60)}:${pad2(sec % 60)}`; }
function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

// 最後の呼び出しから ms 後に実行。flush() で待たずに実行する
function debounce(fn, ms) {
  let t = null, args = null;
  const run = () => { t = null; const a = args; args = null; fn(...a); };
  const f = (...a) => { args = a; clearTimeout(t); t = setTimeout(run, ms); };
  f.flush = () => { if (t) { clearTimeout(t); run(); } };
  f.pending = () => t !== null;
  return f;
}

// Service Worker を登録し、開くたびに更新を確かめる。
// 同じ URL で登録済みだと register() は何もしないので、update() を呼ばないと新しい版への入れ替えがブラウザ任せになる
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js").then((r) => r.update()).catch(() => {});
}

// 画面の設定（期間の選択など）。記録とは別のキーに置く
function uiGet(key, fallback) {
  try { const v = localStorage.getItem("tlog-ui-" + key); return v == null ? fallback : JSON.parse(v); }
  catch (e) { return fallback; }
}
function uiSet(key, value) {
  try { localStorage.setItem("tlog-ui-" + key, JSON.stringify(value)); } catch (e) { /* 設定は失っても困らない */ }
}

// 2段階の確認ボタン：1回目で文言が変わり、3秒以内にもう一度押すと true
function confirmTwice(btn, label) {
  if (btn.dataset.armed === "1") return true;
  const orig = btn.textContent;
  btn.dataset.armed = "1";
  btn.classList.add("armed");
  btn.textContent = label || "もう一度押すと削除";
  setTimeout(() => {
    if (!btn.isConnected) return;
    btn.dataset.armed = "";
    btn.classList.remove("armed");
    btn.textContent = orig;
  }, 3000);
  return false;
}
