"use strict";
// 保存層。localStorage の1キーに全データを JSON で置く。
// インターフェースは doc / collection / get / onSnapshot / set / delete。
// 将来クラウド同期に差し替えるときは、この形を保ったまま中身を入れ替える。
//
// データ: { program: { current: {days, updatedAt} }, workouts: {id: Workout}, bodyweight: {date: {...}} }

const DATA_KEY = "tlog-data-v1";
const COLLECTIONS = ["program", "workouts", "bodyweight"];

function emptyData() {
  return { program: {}, workouts: {}, bodyweight: {} };
}

// 足りない入れ物だけ補う。知らない項目は消さずに残す
function normalizeData(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("データの形が正しくありません");
  const out = Object.assign({}, d);
  for (const c of COLLECTIONS) {
    if (!out[c] || typeof out[c] !== "object" || Array.isArray(out[c])) out[c] = {};
  }
  return out;
}

function createLocalDb(key) {
  let cache = null;
  // 読めないデータがあったら、上書きしないよう書き込みを止める
  let readOnly = null;
  const listeners = [];

  function load() {
    const raw = localStorage.getItem(key);
    if (raw == null) return emptyData();
    try {
      return normalizeData(JSON.parse(raw));
    } catch (e) {
      readOnly = "保存データを読み込めませんでした。上書きしないよう、保存を止めています。";
      try { localStorage.setItem(`${key}-broken-${Date.now()}`, raw); } catch (e2) { /* 容量不足なら諦める */ }
      return emptyData();
    }
  }
  function data() {
    if (!cache) cache = load();
    return cache;
  }
  function notify(col, source) {
    for (const l of listeners.slice()) {
      if (l.col == null || l.col === col || col == null) l.cb(source);
    }
  }
  // 他のタブが書いたかもしれないので、書く直前に読み直す
  function mutate(col, fn) {
    if (readOnly) throw new Error(readOnly);
    cache = null;
    const d = data();
    fn(d);
    localStorage.setItem(key, JSON.stringify(d));
    notify(col, "local");
  }

  window.addEventListener("storage", (e) => {
    if (e.key !== key) return;
    cache = null;
    notify(null, "remote");
  });

  return {
    get readOnly() { return readOnly; },
    doc(col, id) { return { col, id: String(id) }; },
    collection(col) { return { col, id: null }; },
    // 文書1件、またはコレクション全体（{id: 値}）の写しを返す
    get(ref) {
      const c = data()[ref.col] || {};
      return clone(ref.id == null ? c : (c[ref.id] == null ? null : c[ref.id]));
    },
    set(ref, value) { mutate(ref.col, (d) => { d[ref.col][ref.id] = clone(value); }); },
    delete(ref) { mutate(ref.col, (d) => { delete d[ref.col][ref.id]; }); },
    // 変更のたびに cb(source) を呼ぶ。source は "local"（このタブ）か "remote"（他のタブ）。解除関数を返す
    onSnapshot(ref, cb) {
      const l = { col: ref.col, cb };
      listeners.push(l);
      return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
    },
    exportData() { return clone(data()); },
    replaceAll(newData) {
      const d = normalizeData(clone(newData));
      localStorage.setItem(key, JSON.stringify(d));
      readOnly = null;
      cache = null;
      notify(null, "local");
    },
  };
}
