"use strict";
// 休憩タイマーの通知：画面を消しても、休憩の終わりを通知で知らせる。
// タイマーを始めたら終了時刻を通知サーバー（push-server/、Cloudflare Workers）に予約し、時刻になるとサーバーが
// Web Push を送る。送るのは購読の宛先と終了時刻だけで、記録は送らない。
// iPhone では「ホーム画面に追加」した手帳でだけ使える（iOS 16.4 以降）。

const RestPush = (() => {
  // 通知サーバーの場所と公開鍵（VAPID）。空なら通知の設定欄を出さない
  const config = { url: "__PUSH_URL__", key: "__PUSH_KEY__" };
  const configured = () => /^https?:\/\//.test(config.url) && config.key.length > 40;

  function supported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }
  function isIOS() {
    return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function standalone() {
    return navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  }

  async function subscription() {
    if (!supported()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }

  // 使える状態か。{ on, why }（why は使えないときの説明）
  async function status() {
    if (!supported()) {
      return { on: false, why: isIOS() && !standalone() ? "ホーム画面に追加した手帳で使えます（Safari のタブの中では使えません）。" : "このブラウザでは使えません。" };
    }
    if (Notification.permission === "denied") return { on: false, why: "通知が許可されていません。iPhone の「設定」→「通知」→「トレ手帳」で許可してください。" };
    const sub = await subscription();
    return { on: !!(sub && uiGet("push", false)), why: "" };
  }

  // 有効にする（ボタンを押したときに呼ぶ。許可を求めるのはユーザーの操作の中でないといけない）
  async function enable() {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("通知が許可されませんでした");
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(config.key) });
    uiSet("push", true);
    return sub;
  }

  async function disable() {
    uiSet("push", false);
    const sub = await subscription();
    if (sub) {
      await post("/cancel", { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  }

  // 終了時刻 at（ms）に通知を予約する。同じ端末の前の予約は置き換わる
  async function schedule(at) {
    if (!configured() || !uiGet("push", false)) return false;
    const sub = await subscription();
    if (!sub) return false;
    await post("/schedule", { subscription: sub.toJSON(), at });
    return true;
  }

  async function cancel() {
    if (!configured() || !uiGet("push", false)) return;
    const sub = await subscription();
    if (sub) await post("/cancel", { endpoint: sub.endpoint });
  }

  async function post(path, body) {
    const res = await fetch(config.url.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
    if (!res.ok) throw new Error(`通知サーバー ${res.status}`);
  }

  function b64urlToBytes(s) {
    const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return Uint8Array.from(b, (c) => c.charCodeAt(0));
  }

  // 履歴タブの設定欄
  function sectionHtml() {
    if (!configured()) return "";
    return `<section class="card push" id="push">
      <h3 class="sub">休憩タイマーの通知</h3>
      <p class="muted">画面を消していても、休憩の終わりを通知で知らせます。</p>
      <div id="push-body"><p class="muted small">確認中…</p></div>
    </section>`;
  }

  async function fill(root) {
    const body = root.querySelector("#push-body");
    if (!body) return;
    const st = await status().catch(() => ({ on: false, why: "状態を確かめられませんでした。" }));
    if (st.why) { body.innerHTML = `<p class="small">${esc(st.why)}</p>`; return; }
    body.innerHTML = st.on
      ? `<p>通知：<b>オン</b></p>
         <div class="row-btns"><button data-act="push-test">試す（10秒後に通知）</button><button data-act="push-off">オフにする</button></div>
         <p class="muted small">試すときは、ボタンを押したらすぐ画面を消すかホーム画面に戻ってください。</p>`
      : `<p>通知：オフ</p>
         <div class="row-btns"><button class="primary" data-act="push-on">オンにする</button></div>`;
  }

  async function onClick(btn, root) {
    const act = btn.dataset.act;
    btn.disabled = true;
    try {
      if (act === "push-on") await enable();
      else if (act === "push-off") await disable();
      else if (act === "push-test") {
        await schedule(Date.now() + 10000);
        btn.textContent = "予約しました";
        return;
      }
    } catch (e) {
      alert(`通知を設定できませんでした：${e.message}`);
    } finally {
      btn.disabled = false;
    }
    fill(root);
  }

  // 手帳を開いているときに届いた通知は、少し見せてから閉じる（画面の表示と音で十分なので）
  async function clearShown() {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg || !reg.getNotifications) return;
      for (const n of await reg.getNotifications({ tag: "rest" })) n.close();
    } catch (e) { /* 閉じられなくても困らない */ }
  }

  return { config, configured, status, enable, disable, schedule, cancel, sectionHtml, fill, onClick, clearShown };
})();
