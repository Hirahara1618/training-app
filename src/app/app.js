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
  friends: { render: renderFriends, bind: bindFriends },
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
  // 仲間タブは手帳の記録を表示しない（描き直すと入力中の文字が消える）
  if (currentTab === "friends") return;
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
  Social.applyConfig();
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
  // 数字の欄は、触ったら中身を全部選ぶ（そのまま打てば上書きになる）。
  // iOS はフォーカスの直後にカーソルを置き直すので、少し待ってから選ぶ
  document.addEventListener("focusin", (e) => {
    const el = e.target;
    if (el.tagName !== "INPUT" || !/^(decimal|numeric)$/.test(el.inputMode) || !el.value) return;
    setTimeout(() => {
      if (document.activeElement === el) el.setSelectionRange(0, el.value.length);
    }, 0);
  });
  // パソコンでは、クリックを離したときに選択が外れるので、フォーカスした直後の1回だけ止める
  document.addEventListener("mousedown", (e) => {
    const el = e.target;
    if (el.tagName !== "INPUT" || document.activeElement === el || !/^(decimal|numeric)$/.test(el.inputMode)) return;
    el.addEventListener("mouseup", (u) => u.preventDefault(), { once: true });
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
