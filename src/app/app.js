"use strict";
// 手帳アプリの起動とタブの切り替え

let db = null;
let currentTab = "today";

const TABS = {
  today: { render: renderToday, bind: bindToday },
  muscles: { render: renderMuscles, bind: bindMuscles },
  weight: { render: renderWeight, bind: bindWeight },
  history: { render: renderHistory, bind: bindHistory },
  routine: { render: renderRoutine, bind: bindRoutine },
};

function tabEl(name) { return $(`#tab-${name}`); }

function showTab(name) {
  if (currentTab === "today") flushToday();
  currentTab = name;
  for (const k in TABS) {
    tabEl(k).hidden = k !== name;
    $(`[data-tab="${k}"]`).setAttribute("aria-selected", k === name ? "true" : "false");
  }
  TABS[name].render(tabEl(name));
  updateSaveBar();
  window.scrollTo(0, 0);
}

// 入力欄を触っている最中か（描き直すと入力が飛ぶので避ける）
function isEditing() {
  const a = document.activeElement;
  return !!a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && tabEl(currentTab).contains(a);
}

function onDataChanged(source) {
  const root = tabEl(currentTab);
  if (currentTab === "today") {
    // このタブ自身の保存では描き直さない
    if (source === "remote" && !(Today.save && Today.save.pending()) && !isEditing()) renderToday(root);
    return;
  }
  if (currentTab === "routine") {
    if (!Routine.dirty) { Routine.draft = null; renderRoutine(root); }
    return;
  }
  // 自分の操作による変更は描き直す（Safari ではボタンを押しても入力欄のフォーカスが残る）
  if (source === "local" || !isEditing()) TABS[currentTab].render(root);
}

function showBanner(msg) {
  const b = $("#banner");
  b.textContent = msg;
  b.hidden = !msg;
}

function start() {
  try {
    db = createLocalDb(DATA_KEY);
    db.get(db.collection("program"));
  } catch (e) {
    showBanner(`記録を読み込めません：${e.message}`);
    return;
  }
  if (db.readOnly) showBanner(db.readOnly);
  // 端末の空き容量が減っても消されないように頼む
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  for (const k in TABS) TABS[k].bind(tabEl(k));
  RestTimer.init();
  bindSaveBar();
  db.onSnapshot(db.collection(null), onDataChanged);

  $(".tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) showTab(b.dataset.tab);
  });
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-go]");
    if (g) showTab(g.dataset.go);
  });
  // 画面を離れるときは待たずに保存
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushToday(); });
  window.addEventListener("pagehide", flushToday);
  // 日付が変わってから戻ってきたら今日に合わせる
  let lastDay = todayYmd();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || todayYmd() === lastDay) return;
    if (Today.date === lastDay) Today.date = todayYmd();
    lastDay = todayYmd();
    if (currentTab === "today" && !isEditing()) renderToday(tabEl("today"));
  });

  showTab("today");
}

registerServiceWorker();
start();
