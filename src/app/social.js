"use strict";
// 仲間タブ：仲間とのランキングと記録の共有（CLAUDE.md 14章）。サーバーは social-server/（Cloudflare Workers + D1）。
//
// 初期値はオフ。「始める」を押して登録するまでは、何も外に送らない（通信もしない）。
// トークンは記録（tlog-data-v1）とは別のキー tlog-social-v1 に置く。バックアップの JSON には入らない。
// 仲間の名前など、他人が決めた文字は必ず textContent で表示する（HTML として入れない）。

const Social = (() => {
  // サーバーの場所（social-server/client.json からビルドで入る）。空なら仲間タブを出さない
  const config = { url: "__SOCIAL_URL__" };
  const configured = () => /^https?:\/\//.test(config.url);
  const KEY = "tlog-social-v1";

  // { token, user: {id, name, friendCode, showWeight, inRanking}, recovery?: 控えてもらう復旧コード, lost?: 無効になった理由 }
  let st = load();
  function load() {
    try { const v = JSON.parse(localStorage.getItem(KEY)); return v && typeof v === "object" ? v : {}; }
    catch (e) { return {}; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* 容量不足。次に開いたときにやり直す */ }
  }
  const on = () => configured() && !!st.token;

  // 画面だけの状態（保存しない）
  const view = { starting: false, links: null, transfer: null, msg: null };

  // ---- 通信 ----

  const MESSAGES = {
    "bad name": "表示名は2〜20文字にしてください（改行や一部の記号は使えません）。",
    "code not found": "コードが見つかりません。入力を確かめてください（引き継ぎコードは10分で切れます）。",
    "own code": "自分の友達コードです。",
    "too many friends": "仲間は50人までです。",
    "too many requests": "操作が続いたので、少し待ってからもう一度試してください。",
    "request not found": "その申請はもうありません。",
    "link not found": "そのつながりはもうありません。",
  };
  class ApiError extends Error {
    constructor(status, code) { super(MESSAGES[code] || `サーバーでエラーが起きました（${status}）`); this.status = status; this.code = code; }
  }

  async function api(method, path, body) {
    if (!configured()) throw new Error("共有のサーバーが設定されていません");
    const headers = { "Content-Type": "application/json" };
    if (st.token) headers.Authorization = `Bearer ${st.token}`;
    let res;
    try {
      res = await fetch(config.url.replace(/\/$/, "") + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new Error("通信できませんでした。電波のあるところでもう一度試してください。");
    }
    const j = await res.json().catch(() => ({}));
    if (res.status === 401 && st.token) {
      // 別の端末に引き継いだ・復旧コードを使った・アカウントを消した、のどれか
      st = { lost: "この端末のログインは無効になりました。別の端末に引き継いだか、復旧コードを使ったためです。復旧コードがあれば、下から戻せます。" };
      save();
      throw new ApiError(401, "lost");
    }
    if (!res.ok) throw new ApiError(res.status, j.error);
    return j;
  }

  // 登録・引き継ぎ・復旧で受け取ったトークンを保存する
  function signedIn(r) {
    view.transfer = null;
    st = { token: r.token, user: r.user };
    if (r.recovery) st.recovery = r.recovery;
    save();
  }

  // ---- 画面 ----

  // 小さな DOM 組み立て。文字は textContent で入れる
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const k in props || {}) {
      if (k === "class") el.className = props[k];
      else if (k.startsWith("data-") || k.startsWith("aria-") || k === "type" || k === "placeholder" || k === "autocomplete" || k === "inputmode" || k === "maxlength") el.setAttribute(k, props[k]);
      else el[k] = props[k];
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }
  const section = (title, ...kids) => h("section", { class: "card social" }, h("h3", { class: "sub" }, title), ...kids);

  function render(root) {
    root.replaceChildren(h("h2", { class: "tab-title" }, "仲間"));
    if (view.msg) root.append(h("div", { class: "notice", role: "status" }, view.msg));
    if (!on()) { renderOff(root); return; }
    if (st.recovery) { renderRecovery(root); return; }
    root.append(friendsSection(), settingsSection());
    loadLinks(root);
  }

  // オフのとき：説明と、送る情報・送らない情報、始めるボタン
  function renderOff(root) {
    if (st.lost) root.append(h("div", { class: "notice" }, st.lost));
    root.append(section("仲間と記録を見せ合う",
      h("p", null, "お互いに承認した仲間どうしで、その日のトレーニングを共有し、いいねを付け合い、週ごとのランキングで競えます。ランキングは「予定日の実施率」と「トレーニングした日数」で、重量の大きさでは競いません。"),
      h("p", { class: "muted small" }, "オンにするまで、この端末からは何も送りません。記録は今までどおりこの端末に保存され、仲間の機能を使わなくても、電波がなくても使えます。"),
      h("h4", null, "送る情報"),
      h("ul", { class: "plain" },
        h("li", null, "表示名"),
        h("li", null, "共有した日の記録（種目名・セット・回数・重量・自己ベストの印）。重量は設定で載せないこともできます"),
        h("li", null, "ランキング用に、日ごとの「予定日か」「トレーニングしたか」")),
      h("h4", null, "送らない情報"),
      h("ul", { class: "plain" },
        h("li", null, "体重・体脂肪率・ウエスト"),
        h("li", null, "メモ・RIR"),
        h("li", null, "共有していない日の記録の中身")),
      h("p", { class: "muted small" }, "記録は自己申告なので、仲間内で楽しむ前提の機能です。"),
      view.starting ? startForm() : h("button", { class: "primary wide", "data-act": "s-start" }, "始める")));
    root.append(section("ほかの端末から移る",
      h("p", { class: "muted small" }, "前の端末の「仲間」→「設定」で発行した引き継ぎコード、または登録したときの復旧コードを入れてください。"),
      h("div", { class: "s-inline" },
        h("input", { id: "s-transfer", placeholder: "引き継ぎコード", autocomplete: "off" }),
        h("button", { "data-act": "s-redeem" }, "引き継ぐ")),
      h("div", { class: "s-inline" },
        h("input", { id: "s-recover", placeholder: "復旧コード", autocomplete: "off" }),
        h("button", { "data-act": "s-recover" }, "戻す"))));
  }

  function startForm() {
    return h("div", { class: "s-start" },
      h("label", null, "表示名（2〜20文字。仲間に見えます）", h("input", { id: "s-name", maxlength: "20", autocomplete: "nickname" })),
      h("div", { class: "row-btns" },
        h("button", { class: "primary", "data-act": "s-register" }, "登録する"),
        h("button", { class: "ghost", "data-act": "s-cancel" }, "やめる")));
  }

  // 登録・復旧の直後に一度だけ見せる復旧コード
  function renderRecovery(root) {
    root.append(section("復旧コードを控えてください",
      h("p", null, "端末をなくしたときに、仲間やランキングを取り戻すためのコードです。この画面でしか表示しません。スクリーンショットやメモで控えてください。"),
      h("p", { class: "s-code", id: "s-recovery-code" }, st.recovery),
      h("p", { class: "muted small" }, "このコードを知っている人は、あなたになりすませます。人に見せないでください。"),
      h("div", { class: "row-btns" },
        h("button", { "data-act": "s-copy", "data-copy": st.recovery }, "コピー"),
        h("button", { class: "primary", "data-act": "s-recovery-done" }, "控えました"))));
  }

  function friendsSection() {
    const u = st.user;
    return section("仲間の管理",
      h("p", { class: "muted small" }, "自分の友達コード（仲間に伝えて、申請してもらいます）"),
      h("p", { class: "s-code", id: "s-friend-code" }, u.friendCode),
      h("div", { class: "row-btns" },
        h("button", { "data-act": "s-copy", "data-copy": u.friendCode }, "コピー"),
        navigator.share ? h("button", { "data-act": "s-share" }, "共有") : null,
        h("button", { class: "ghost", "data-act": "s-newcode" }, "作り直す")),
      h("div", { class: "s-inline" },
        h("input", { id: "s-code", placeholder: "仲間の友達コード", autocomplete: "off" }),
        h("button", { class: "primary", "data-act": "s-request" }, "申請")),
      h("div", { id: "s-links" }, h("p", { class: "muted small" }, "読み込み中…")));
  }

  async function loadLinks(root) {
    try {
      view.links = await api("GET", "/links");
    } catch (e) {
      const box = root.querySelector("#s-links");
      if (e.code === "lost") { render(root); return; }
      if (box) box.replaceChildren(h("p", { class: "muted small" }, e.message));
      return;
    }
    const box = root.querySelector("#s-links");
    if (!box) return;
    const L = view.links;
    const person = (p, ...btns) => h("li", { class: "s-person" }, h("span", { class: "s-name" }, p.name), h("span", { class: "row-btns" }, ...btns));
    const parts = [];
    if (L.incoming.length) parts.push(h("h4", null, `届いた申請（${L.incoming.length}）`), h("ul", { class: "plain" }, L.incoming.map((p) => person(p,
      h("button", { class: "small primary", "data-act": "s-accept", "data-id": p.id }, "承認"),
      h("button", { class: "small", "data-act": "s-reject", "data-id": p.id }, "拒否")))));
    if (L.outgoing.length) parts.push(h("h4", null, "承認待ち"), h("ul", { class: "plain" }, L.outgoing.map((p) => person(p,
      h("button", { class: "small", "data-act": "s-remove", "data-id": p.id, "data-label": "もう一度押すと取り消す" }, "取り消す")))));
    parts.push(h("h4", null, `仲間（${L.friends.length} / 50）`));
    parts.push(L.friends.length
      ? h("ul", { class: "plain" }, L.friends.map((p) => person(p, h("button", { class: "small danger", "data-act": "s-remove", "data-id": p.id, "data-label": "もう一度押すと解除" }, "解除"))))
      : h("p", { class: "muted small" }, "まだいません。友達コードを伝え合って、申請・承認してください。"));
    box.replaceChildren(...parts);
  }

  function settingsSection() {
    const u = st.user;
    const t = view.transfer;
    const check = (id, label, checked) => h("label", { class: "s-check" }, h("input", { type: "checkbox", id, checked }), label);
    return section("設定",
      h("label", null, "表示名", h("span", { class: "s-inline" },
        h("input", { id: "s-rename", maxlength: "20", value: u.name }),
        h("button", { "data-act": "s-rename" }, "変更"))),
      check("s-weight", "共有する記録に重量を載せる", u.showWeight),
      h("p", { class: "muted small" }, "オフにすると、回数とセット数だけを載せます。すでに共有した記録からも重量を消します。"),
      check("s-ranking", "ランキングに参加する", u.inRanking),
      h("h4", null, "機種変更"),
      t ? h("div", null,
        h("p", { class: "s-code" }, t.code),
        h("p", { class: "muted small" }, `新しい端末の「仲間」タブで入力してください。${fmtTime(t.expiresAt)} まで・1回だけ使えます。使うと、この端末では使えなくなります。`))
        : h("button", { "data-act": "s-transfer" }, "引き継ぎコードを発行"),
      h("h4", null, "削除"),
      h("p", { class: "muted small" }, "サーバー上のあなたのデータ（表示名・つながり・共有した記録・いいね・ランキング用の記録）をすべて消します。この端末の記録は消えません。"),
      h("button", { class: "danger", "data-act": "s-delete" }, "アカウントと全データを削除"));
  }

  function fmtTime(ms) { const d = new Date(ms); return `${d.getHours()}:${pad2(d.getMinutes())}`; }

  // ---- 操作 ----

  async function onClick(btn, root) {
    const act = btn.dataset.act;
    const val = (id) => (root.querySelector(`#${id}`) || {}).value || "";
    view.msg = null;
    if (act === "s-start") { view.starting = true; render(root); const n = root.querySelector("#s-name"); if (n) n.focus(); return; }
    if (act === "s-cancel") { view.starting = false; render(root); return; }
    if (act === "s-copy") { copy(btn.dataset.copy, btn); return; }
    if (act === "s-share") {
      navigator.share({ text: `トレーニング手帳の友達コード：${st.user.friendCode}` }).catch(() => {});
      return;
    }
    // 2段階の確認
    if (act === "s-remove" && !confirmTwice(btn, btn.dataset.label)) return;
    if (act === "s-newcode" && !confirmTwice(btn, "もう一度押すと作り直す（前のコードは使えなくなります）")) return;
    if (act === "s-delete") {
      if (!confirmTwice(btn, "もう一度押すと削除")) return;
      if (!confirm("サーバー上のあなたのデータをすべて削除します。仲間とのつながりも消え、元に戻せません。よろしいですか？")) return;
    }
    btn.disabled = true;
    try {
      switch (act) {
        case "s-register": {
          const name = val("s-name").trim();
          if (Array.from(name).length < 2) throw new Error(MESSAGES["bad name"]);
          signedIn(await api("POST", "/register", { name }));
          view.starting = false;
          break;
        }
        case "s-redeem": signedIn(await api("POST", "/transfer/redeem", { code: val("s-transfer") })); view.msg = "引き継ぎました。前の端末では使えなくなりました。"; break;
        case "s-recover": signedIn(await api("POST", "/recover", { code: val("s-recover") })); break;
        case "s-recovery-done": delete st.recovery; save(); break;
        case "s-request": {
          const r = await api("POST", "/links/request", { code: val("s-code") });
          view.msg = r.status === "accepted" ? "仲間になりました。" : "申請しました。相手が承認すると仲間になります。";
          break;
        }
        case "s-accept": await api("POST", "/links/accept", { id: btn.dataset.id }); break;
        case "s-reject": await api("POST", "/links/reject", { id: btn.dataset.id }); break;
        case "s-remove": await api("POST", "/links/remove", { id: btn.dataset.id }); break;
        case "s-newcode": await updateUser(api("POST", "/me/friend-code", {})); break;
        case "s-rename": await updateUser(api("POST", "/me", { name: val("s-rename") })); view.msg = "表示名を変えました。"; break;
        case "s-transfer": view.transfer = await api("POST", "/transfer/issue", {}); break;
        case "s-delete":
          await api("POST", "/account/delete", {});
          st = {};
          save();
          view.transfer = null;
          view.msg = "サーバー上のデータを削除しました。この端末の記録はそのままです。";
          break;
      }
    } catch (e) {
      if (e.code !== "lost") view.msg = e.message;
    } finally {
      btn.disabled = false;
    }
    render(root);
  }

  async function onChange(el, root) {
    const field = el.id === "s-weight" ? "showWeight" : el.id === "s-ranking" ? "inRanking" : null;
    if (!field) return;
    el.disabled = true;
    view.msg = null;
    try {
      await updateUser(api("POST", "/me", { [field]: el.checked }));
    } catch (e) {
      if (e.code !== "lost") view.msg = e.message;
    }
    render(root);
  }

  async function updateUser(p) {
    const r = await p;
    st.user = r.user;
    save();
  }

  function copy(text, btn) {
    const done = () => { const t = btn.textContent; btn.textContent = "コピーしました"; setTimeout(() => { if (btn.isConnected) btn.textContent = t; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => {});
  }

  function bind(root) {
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act^='s-']");
      if (b) onClick(b, root);
    });
    root.addEventListener("change", (e) => onChange(e.target, root));
    // 入力欄で Enter を押したら、隣のボタンを押したことにする
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.target.tagName !== "INPUT" || e.target.type === "checkbox") return;
      const box = e.target.closest(".s-inline, .s-start");
      const b = box && box.querySelector("button");
      if (b) { e.preventDefault(); b.click(); }
    });
  }

  // サーバーが設定されているときだけ仲間タブを出す
  function applyConfig() {
    const tab = document.querySelector('[data-tab="friends"]');
    if (tab) tab.hidden = !configured();
    // 6つ並ぶときは字を少し小さくして、375px 幅に収める
    const tabs = document.querySelector(".tabs");
    if (tabs) tabs.classList.toggle("six", configured());
  }

  return { config, configured, on, render, bind, applyConfig };
})();

function renderFriends(root) { Social.render(root); }
function bindFriends(root) { Social.bind(root); }
