"use strict";
// 筋肉模型ページの起動。
// 順番が大事：メッシュを読む → 準備計算をすべて終える → それから WebGL のコンテキストを作る。

// MESH_FILES はビルドで埋め込まれる：{ normal: {bin, manifest}, mobile: {bin, manifest}, joints }
const VERSION = "__VERSION__";
const params = new URLSearchParams(location.search);
const APP_MODE = params.get("app") === "1";
// ?q=hi / ?q=lo で通常版・スマホ版を選べる（検査用）
const QUALITY = params.get("q") === "hi" ? "normal" : params.get("q") === "lo" ? "mobile" : (IS_MOBILE ? "mobile" : "normal");

const View = { renderer: null, parts: null };

function setStatus(text) {
  const el = $("#status");
  el.hidden = !text;
  el.textContent = text || "";
}

function showFailure(title, lines) {
  const el = $("#fail");
  el.hidden = false;
  $("#fail-title").textContent = title;
  $("#fail-log").textContent = [
    ...lines,
    `メッシュ: ${QUALITY === "mobile" ? "スマホ版" : "通常版"}`,
    `版: ${VERSION}`,
    `端末: ${navigator.userAgent}`,
  ].join("\n");
  setStatus("");
}

async function loadMesh() {
  const f = MESH_FILES[QUALITY];
  setStatus("模型を読み込み中…");
  const res = await fetch(f.bin);
  if (!res.ok) throw new Error(`メッシュを取得できません（${res.status}）`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength !== f.manifest.bytes) throw new Error(`メッシュの大きさが合いません（${buf.byteLength} / ${f.manifest.bytes}）`);
  return { buf, manifest: f.manifest };
}

// ?hl=FMA13336,FMA13377 で指定パーツを青に（検査用）
const HIGHLIGHT = new Set((params.get("hl") || "").split(",").filter(Boolean));
function anatomyColor(p) {
  if (HIGHLIGHT.has(p.id)) return [0.24, 0.45, 0.77];
  return ANATOMY_COLORS[p.c] || ANATOMY_COLORS.m;
}

const VIEWS = { front: 0, oblique: Math.PI / 4, side: Math.PI / 2, back: Math.PI };

async function main() {
  document.body.classList.toggle("app-mode", APP_MODE);
  $("#ver").textContent = `版 ${VERSION}`;
  let batches, box;
  try {
    const { buf, manifest } = await loadMesh();
    setStatus("模型を準備中…");
    await new Promise((r) => setTimeout(r, 0)); // 文言を先に描かせる
    View.parts = decodeParts(buf, manifest);
    box = bounds(View.parts);
    batches = packBatches(View.parts, anatomyColor);
  } catch (e) {
    showFailure("模型を読み込めませんでした", [e.message]);
    return;
  }

  // ここまで終えてからコンテキストを作る
  let r;
  try {
    r = createRenderer($("#stage"), batches);
  } catch (e) {
    showFailure(e.message, e.log || []);
    return;
  }
  batches = null; // GPU に送ったので捨てる
  View.renderer = r;
  r.onLost(() => showFailure("3D表示が止まりました（context lost）", ["端末の負荷が高すぎた可能性があります"]));
  // 下のボタンの分だけ少し下を見る
  r.cam.target = [0, (box.lo[1] + box.hi[1]) / 2 - 0.06, 0];
  r.cam.dist = (box.hi[1] - box.lo[1]) * 2.25;
  r.request();
  setStatus("");
  const info = r.info();
  $("#gl-info").textContent = `${info.type} · ${QUALITY === "mobile" ? "スマホ版" : "通常版"} · ${info.gpu}`;
  window.__ready = true;
}

$("#views").addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (!b || !View.renderer) return;
  View.renderer.cam.yaw = VIEWS[b.dataset.view];
  View.renderer.request();
});
$("#reload").addEventListener("click", () => location.reload());

// 検査用：視点を決めて描く
window.__view = (yaw, pitch, dist) => {
  const r = View.renderer;
  if (!r) return false;
  if (yaw != null) r.cam.yaw = yaw;
  if (pitch != null) r.cam.pitch = pitch;
  if (dist != null) r.cam.dist = dist;
  r.draw();
  return true;
};

main();
