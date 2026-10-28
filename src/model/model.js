"use strict";
// 筋肉模型ページの起動。
// 順番が大事：メッシュを読む → 準備計算をすべて終える → それから WebGL のコンテキストを作る。

// MESH_FILES はビルドで埋め込まれる：{ normal: {bin, manifest}, mobile: {bin, manifest}, joints }
const VERSION = "__VERSION__";
const params = new URLSearchParams(location.search);
const APP_MODE = params.get("app") === "1";
// ?q=hi / ?q=lo で通常版・スマホ版を選べる（検査用）
const QUALITY = params.get("q") === "hi" ? "normal" : params.get("q") === "lo" ? "mobile" : (IS_MOBILE ? "mobile" : "normal");

const ROLE_COLORS = {
  main: [0.784, 0.275, 0.227],     // #c8463a
  sub: [0.239, 0.455, 0.769],      // #3d74c4
  support: [0.435, 0.69, 0.243],   // #6fb03e
  other: [0.5, 0.51, 0.54],
  bone: [0.8, 0.78, 0.72],
  tissue: [0.62, 0.62, 0.64],
};
// 役割のない「その他」のパーツを、どの筋の仲間として色を付けるか
const TISSUE_ROLE = { FMA11336: "abs", FMA258847: "calves", FMA58776: "glutes" };
const PERIOD = 3.2; // 1回の動作の秒数（始め→動き→終わり→戻り）

const View = {
  renderer: null, parts: null, rig: null, meta: null, baseFit: null,
  ex: null, fit: null, state: null, showPath: true, playing: true, t: 0, t0: 0, raf: 0,
};

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
function roleColor(def) {
  const roleOf = {};
  for (const k of ["support", "sub", "main"]) for (const r of def.roles[k] || []) roleOf[r] = k;
  return (p) => {
    if (HIGHLIGHT.has(p.id)) return [0.95, 0.8, 0.2];
    if (p.c === "b") return ROLE_COLORS.bone;
    const r = p.c === "t" ? TISSUE_ROLE[p.id] : p.r;
    if (roleOf[r]) return ROLE_COLORS[roleOf[r]];
    return p.c === "t" ? ROLE_COLORS.tissue : ROLE_COLORS.other;
  };
}

// 静止姿勢の体を測る（正中付近の背中側・前側の表面）
function makeFit(parts, rig) {
  const memo = {};
  const scan = (y) => {
    const key = y.toFixed(3);
    if (memo[key]) return memo[key];
    let lo = Infinity, hi = -Infinity;
    for (const p of parts) {
      for (let i = 0; i < p.pos.length / 3; i++) {
        const s0 = p.bones[i * 3];
        if (s0 >= 8 && s0 <= 13) continue; // 腕は除く
        const x = p.pos[i * 3], vy = p.pos[i * 3 + 1], z = p.pos[i * 3 + 2];
        if (Math.abs(x) > 0.04 || Math.abs(vy - y) > 0.012) continue;
        if (z < lo) lo = z;
        if (z > hi) hi = z;
      }
    }
    return (memo[key] = { lo, hi });
  };
  // 背中・お尻の最も後ろ（寝る種目で、股関節から床までの高さを決める）
  let backMin = Infinity;
  for (const p of parts) for (let i = 0; i < p.pos.length / 3; i++) {
    const s0 = p.bones[i * 3];
    if ((s0 === 0 || s0 === 14) && !PELVIS_PARTS[p.id]) backMin = Math.min(backMin, p.pos[i * 3 + 2]);
  }
  return { rig, backZ: (y) => scan(y).lo, frontZ: (y) => scan(y).hi, backMin };
}

const VIEWS = { front: 0, oblique: Math.PI / 4, side: Math.PI / 2, back: Math.PI };

// ---- 種目 ----
function solveAt(t, state) {
  const ex = View.ex;
  const s = solvePose(View.rig, ex.pose(t, View.fit), state || View.state);
  if (View.ground) {
    const g = View.ground, x = clamp(t, 0, 1) * (g.length - 1), k = Math.min(g.length - 2, Math.floor(x));
    shiftSolved(s, lerp(g[k], g[k + 1], x - k));
  }
  return s;
}

// 体の頂点のうち、条件に合うものの dot(v, n) の最小値（t の姿勢で）
function bodyMinAlong(s, n, f) {
  const slots = f.slots || [0, 14, 2, 5];
  let m = Infinity;
  skinFast(View.parts, bodyDQ(s), s.gripLR, (p) => !PELVIS_PARTS[p.id], (p, i, x, y, z) => {
    if (!slots.includes(p.bones[i * 3])) return;
    if ((f.x && (x < f.x[0] || x > f.x[1])) || (f.y && (y < f.y[0] || y > f.y[1])) || (f.z && (z < f.z[0] || z > f.z[1]))) return;
    const d = x * n[0] + y * n[1] + z * n[2];
    if (d < m) m = d;
  });
  return m;
}

// 床に寝る・座る種目：t ごとに体の最低点を床（ground.y）に合わせる上下の補正の表
function groundTable(def) {
  const g = def.ground, st = {}, out = [];
  View.ground = null;
  for (let k = 0; k <= 20; k++) {
    const s = solveAt(k / 20, st);
    out.push((g.y || 0) - 0.012 - bodyMinAlong(s, [0, 1, 0], g));
  }
  return out;
}

function selectExercise(id) {
  const r = View.renderer;
  const def = EXERCISES[id] || null;
  View.ex = def;
  $("#ex").value = def ? id : "";
  $("#ex-controls").hidden = !def;
  if (!def) {
    // 解剖模型モード：静止姿勢、全筋肉を赤茶、骨をアイボリー
    cancelAnimationFrame(View.raf);
    r.setPose(bodyDQ({ bones: Object.fromEntries(BODY_BONES.map((b) => [b, { R: M3.I(), t: [0, 0, 0] }])) }), new Float32Array(128).map((_, i) => (i % 16) % 5 === 0 ? 1 : 0), [0, 0], []);
    r.setColors(batchColors(View.meta, anatomyColor));
    r.useExerciseParts(false);
    r.setProps(null);
    Object.assign(r.cam, { target: [0, 0.76, 0], dist: 3.6, near: null });
    $("#ex-name").textContent = "全身（解剖模型）";
    $("#legend").hidden = true;
    r.request();
    return;
  }
  View.state = {};
  View.fit = Object.create(View.baseFit);
  View.ground = def.ground ? groundTable(def) : null;
  // t=0 の姿勢で体を測り、座面・背もたれを体に合わせる（1.2cm だけ沈み込ませる。座面の処理で平らになる）
  const s0 = solveAt(0, {});
  const fits = def.fitPads || (def.seat ? [{ name: "seat", n: [0, 1, 0], x: def.seat.x, z: def.seat.z }] : []);
  for (const f of fits) {
    const n = V.norm(f.n);
    View.fit[f.name] = { n, d: bodyMinAlong(s0, n, f) + 0.012 };
  }
  if (View.fit.seat) View.fit.seatTop = View.fit.seat.d;
  View.fit.s0 = s0;
  View.fit.bar0 = s0.extra.bar || [0, 0, 0];
  View.fit.barTopZ = s0.extra.bar ? s0.extra.bar[2] : null;
  View.state = {};
  buildProps();
  r.setColors(batchColors(View.meta, roleColor(def)));
  r.useExerciseParts(true);
  Object.assign(r.cam, { target: def.cam.target.slice(), dist: def.cam.dist, near: null, yaw: def.cam.yaw == null ? VIEWS.oblique : def.cam.yaw });
  const c = CATALOG.byId[id];
  $("#ex-name").textContent = c ? c.name : id;
  $("#legend").hidden = false;
  $("#path").hidden = !def.barPath;
  View.t0 = performance.now();
  if (View.playing) loop(); else renderAt(View.t);
}

function buildProps() {
  const def = View.ex;
  let items = def.props(View.fit);
  if (def.barPath && View.showPath) {
    const st = {};
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const s = solvePose(View.rig, def.pose(i / 40, View.fit), st);
      if (s.extra.bar) pts.push(s.extra.bar);
    }
    if (pts.length) items = items.concat(barPathItems(pts));
  }
  View.props = propMesh(items);
  View.renderer.setProps(View.props);
}

function renderAt(t) {
  const s = solveAt(t);
  // 座面（バーと一緒に動くものは今の位置に）
  const bar = s.extra.bar || [0, 0, 0];
  const pads = View.props.boxes.filter((b) => b.pad && (b.bone === 14 || b.bone === 15))
    .map((b) => ({ c: b.bone === 15 ? V.add(b.c, bar) : b.c, h: b.h, rx: b.rx }));
  View.renderer.setPose(bodyDQ(s), equipMats(s), s.gripLR, pads);
  View.solved = s;
  View.t = t;
  $("#t").value = Math.round(t * 100);
}

// 周期：始め → 動き → 終わり → 戻り。start:1 の種目は終わり（t=1）から始める
function phaseT(u) {
  const f = u < 0.15 ? 0 : u < 0.5 ? (u - 0.15) / 0.35 : u < 0.65 ? 1 : 1 - (u - 0.65) / 0.35;
  return View.ex.start ? 1 - f : f;
}

function loop() {
  cancelAnimationFrame(View.raf);
  const step = (now) => {
    if (!View.ex || !View.playing) return;
    renderAt(phaseT(((now - View.t0) / 1000 / PERIOD) % 1));
    View.renderer.draw();
    View.raf = requestAnimationFrame(step);
  };
  View.raf = requestAnimationFrame(step);
}

function setPlaying(on) {
  View.playing = on;
  $("#play").textContent = on ? "❚❚" : "▶";
  if (on) { View.t0 = performance.now(); loop(); } else cancelAnimationFrame(View.raf);
}

function buildSelect() {
  let h = `<option value="">全身（解剖模型）</option>`;
  for (const m of MUSCLES) {
    const list = CATALOG.list.filter((c) => c.muscle === m && EXERCISES[c.id]);
    if (list.length) h += `<optgroup label="${esc(m)}">${list.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</optgroup>`;
  }
  $("#ex").innerHTML = h;
}

async function main() {
  document.body.classList.toggle("app-mode", APP_MODE);
  $("#ver").textContent = `版 ${VERSION}`;
  buildSelect();
  let batches;
  try {
    const { buf, manifest } = await loadMesh();
    setStatus("模型を準備中…");
    await new Promise((r) => setTimeout(r, 0)); // 文言を先に描かせる
    View.parts = decodeParts(buf, manifest);
    View.rig = buildRig(MESH_FILES.joints, manifest.zMin);
    buildHand(View.rig, View.parts);
    buildSkin(View.rig, View.parts);
    batches = packBatches(View.parts, anatomyColor, (p) => !!PELVIS_PARTS[p.id]);
    View.meta = batches.map((b) => ({ nv: b.nv, parts: b.parts }));
    View.baseFit = makeFit(View.parts, View.rig);
  } catch (e) {
    showFailure("模型を読み込めませんでした", [e.message, (e.stack || "").split("\n").slice(0, 3).join(" / ")]);
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
  r.onLost(() => { cancelAnimationFrame(View.raf); showFailure("3D表示が止まりました（context lost）", ["端末の負荷が高すぎた可能性があります"]); });
  r.cam.yaw = VIEWS.oblique;
  setStatus("");
  const info = r.info();
  $("#gl-info").textContent = `${info.type} · ${QUALITY === "mobile" ? "スマホ版" : "通常版"} · ${info.gpu}`;
  selectExercise(decodeURIComponent(location.hash.slice(1)));
  window.__ready = true;
}

// ---- 操作 ----
$("#views").addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (!b || !View.renderer) return;
  View.renderer.cam.yaw = VIEWS[b.dataset.view];
  View.renderer.request();
});
$("#ex").addEventListener("change", (e) => {
  const id = e.target.value;
  history.replaceState(null, "", id ? `#${id}` : location.pathname + location.search);
  if (View.renderer) selectExercise(id);
});
window.addEventListener("hashchange", () => { if (View.renderer) selectExercise(decodeURIComponent(location.hash.slice(1))); });
$("#play").addEventListener("click", () => setPlaying(!View.playing));
$("#t").addEventListener("input", (e) => {
  if (!View.ex) return;
  setPlaying(false);
  renderAt(Number(e.target.value) / 100);
  View.renderer.request();
});
$("#path").addEventListener("click", () => {
  View.showPath = !View.showPath;
  $("#path").classList.toggle("off", !View.showPath);
  if (View.ex) { buildProps(); renderAt(View.t); View.renderer.request(); }
});
$("#reload").addEventListener("click", () => location.reload());

// ---- 検査用 ----
// 姿勢を決めて即描画（スクリーンショット用）。near=true で拡大
window.__shot = (id, t, yaw, near) => {
  if (!View.renderer) return false;
  setPlaying(false);
  if ((View.ex ? View.ex.id : "") !== (id || "")) selectExercise(id || "");
  const cam = View.renderer.cam;
  if (yaw != null) cam.yaw = yaw;
  if (View.ex) {
    renderAt(t);
    cam.dist = View.ex.cam.dist * (near ? 0.55 : 1);
  }
  View.renderer.draw();
  return true;
};
// 指定の点（"gripR" などの名前でもよい）を注視して描く
window.__look = (target, dist, yaw, pitch) => {
  const r = View.renderer;
  if (!r) return false;
  const t = typeof target === "string" ? View.solved.extra[target] : target;
  Object.assign(r.cam, { target: t.slice(), dist, yaw, pitch: pitch == null ? r.cam.pitch : pitch, near: 0.01 });
  r.draw();
  return true;
};
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
