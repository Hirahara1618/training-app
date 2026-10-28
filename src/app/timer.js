"use strict";
// 休憩タイマー（画面下に固定）。終了時刻で数えるので、画面を離れて戻っても正しい残り時間になる。
// 通知をオンにしていれば、終了時刻を通知サーバーに予約する（画面を消しても知らせる。push.js）

const RestTimer = (() => {
  let end = 0;
  let tick = null;
  let audio = null;
  let hideTimer = null;

  function el() { return $("#timer"); }

  function start(sec) {
    sec = num(sec);
    if (!sec || sec <= 0) return;
    end = Date.now() + sec * 1000;
    // 音はユーザーの操作中に用意しておかないと iOS で鳴らない
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
    } catch (e) { audio = null; }
    clearTimeout(hideTimer);
    el().hidden = false;
    el().classList.remove("finished");
    document.body.classList.add("has-timer");
    clearInterval(tick);
    tick = setInterval(render, 250);
    render();
    notify();
  }

  // 終了時刻を通知サーバーに予約し直す。続けて押されたときは最後の1回だけ送る
  let notifyTimer = null;
  function notify() {
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
      if (end > Date.now()) RestPush.schedule(end).catch(() => {});
    }, 400);
  }

  function adjust(sec) {
    if (!end) return;
    end = Math.max(Date.now() + 1000, end + sec * 1000);
    el().classList.remove("finished");
    if (!tick) tick = setInterval(render, 250);
    render();
    notify();
  }

  function stop() {
    clearTimeout(notifyTimer);
    if (end > Date.now()) RestPush.cancel().catch(() => {});
    clearInterval(tick);
    tick = null;
    end = 0;
    el().hidden = true;
    document.body.classList.remove("has-timer");
  }

  function render() {
    const left = Math.ceil((end - Date.now()) / 1000);
    $("#timer-left").textContent = fmtSec(Math.max(0, left));
    if (left <= 0) finish();
  }

  function finish() {
    clearInterval(tick);
    tick = null;
    el().classList.add("finished");
    $("#timer-left").textContent = "休憩終了";
    beep();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    // 画面を見ているなら、届いた通知は閉じる（届くのが少し遅れることがあるので、少し後にも）
    if (!document.hidden) { RestPush.clearShown(); setTimeout(RestPush.clearShown, 3000); }
    hideTimer = setTimeout(stop, 8000);
  }

  function beep() {
    if (!audio) return;
    try {
      const t0 = audio.currentTime;
      for (let i = 0; i < 2; i++) {
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t0 + i * 0.3);
        g.gain.exponentialRampToValueAtTime(0.3, t0 + i * 0.3 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.3 + 0.2);
        o.connect(g).connect(audio.destination);
        o.start(t0 + i * 0.3);
        o.stop(t0 + i * 0.3 + 0.22);
      }
    } catch (e) { /* 音が出なくても困らない */ }
  }

  function init() {
    $("#timer").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.t === "stop") stop();
      else adjust(Number(b.dataset.t));
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      if (end && tick) render();
      if (!end || end <= Date.now()) RestPush.clearShown();
    });
  }

  return { start, stop, init };
})();
