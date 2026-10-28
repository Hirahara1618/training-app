"use strict";
// 手帳アプリ本体（段階2で実装）

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
