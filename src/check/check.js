"use strict";
// 3D表示チェック：WebGL の可否、GPU 名、uniform の上限、三角形の描画、模型のシェーダー

const rows = [];
function row(label, value, ok) {
  rows.push({ label, value: String(value), ok });
}
function render() {
  $("#rows").innerHTML = rows.map((r) =>
    `<div class="r"><b>${esc(r.label)}</b><span class="${r.ok === true ? "ok" : r.ok === false ? "ng" : ""}">${esc(r.value)}</span></div>`).join("");
}

function tryContext(type, attrs) {
  const c = document.createElement("canvas");
  try {
    const gl = c.getContext(type, attrs || {});
    return gl && !gl.isContextLost() ? gl : null;
  } catch (e) {
    return null;
  }
}

function info(gl) {
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    vtxUniforms: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
    fragUniforms: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
    attribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
    texSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    precision: (() => { const p = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT); return p && p.precision ? `highp ${p.precision}bit` : "highp なし"; })(),
  };
}

// 赤い三角形を描いて、中心の画素が赤くなるか確かめる
function triangleTest() {
  const canvas = $("#tri");
  const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true }) || canvas.getContext("experimental-webgl", { preserveDrawingBuffer: true });
  if (!gl) return { ok: false, msg: "WebGL を取得できません" };
  const sh = (type, src) => { const s = gl.createShader(type); if (!s) throw new Error("createShader が null"); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  try {
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, "attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}"));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, "precision mediump float;void main(){gl_FragColor=vec4(0.85,0.2,0.15,1.0);}"));
    gl.linkProgram(p);
    gl.useProgram(p);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.8, -0.8, 0.8, -0.8, 0, 0.8]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(4);
    gl.readPixels(canvas.width / 2, canvas.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ok = px[0] > 150 && px[1] < 100;
    return { ok, msg: ok ? "描けました（中央が赤）" : `中央の色が違います（${px.slice(0, 3).join(",")}）` };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

function run() {
  rows.length = 0;
  row("版", "__VERSION__");
  row("端末", navigator.userAgent);
  row("スマホ判定", IS_MOBILE ? "スマホ（軽量版メッシュ・倍率1.5まで・AAなし）" : "PC（通常版メッシュ）");
  row("画面", `${screen.width}×${screen.height} · 倍率 ${window.devicePixelRatio || 1}`);
  row("ホーム画面から", (navigator.standalone || matchMedia("(display-mode: standalone)").matches) ? "はい" : "いいえ（ブラウザで開いている）");
  row("Service Worker", "serviceWorker" in navigator ? (navigator.serviceWorker.controller ? "動作中" : "登録前／未制御") : "使えない", "serviceWorker" in navigator);

  const gl2 = tryContext("webgl2");
  const gl2n = tryContext("webgl2", { antialias: false });
  const gl1 = tryContext("webgl") || tryContext("experimental-webgl");
  row("WebGL2", gl2 ? "使える" : gl2n ? "AAなしなら使える" : "使えない", !!(gl2 || gl2n));
  row("WebGL1", gl1 ? "使える" : "使えない", !!gl1);
  const g = gl2 || gl2n || gl1;
  if (g) {
    const i = info(g);
    row("GPU", `${i.gpu}（${i.vendor}）`);
    // 模型の体のシェーダーは頂点 uniform を約50本使う（DQ 30本＋座面 12本＋行列など）
    row("頂点 uniform 上限", i.vtxUniforms, i.vtxUniforms >= 64);
    row("画素 uniform 上限", i.fragUniforms);
    row("頂点属性の上限", i.attribs, i.attribs >= 8);
    row("テクスチャ上限", i.texSize);
    row("精度", i.precision);
    // 調べ終わったコンテキストは手放す（iPhone は同時に持てる数が少ない）
    for (const x of [gl2, gl2n, gl1]) { const l = x && x.getExtension("WEBGL_lose_context"); if (l) l.loseContext(); }
  }

  // 模型ページと同じ手順でコンテキストを作り、模型のシェーダーをコンパイルする
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;left:-10px";
  document.body.appendChild(host);
  try {
    const ctx = createContext(host);
    row("模型のシェーダー", `コンパイルできました（${ctx.type}）`, true);
    row("試した順", ctx.log.join(" → "));
    const l = ctx.gl.getExtension("WEBGL_lose_context");
    if (l) l.loseContext();
  } catch (e) {
    row("模型のシェーダー", e.message, false);
    if (e.log) row("試した順", e.log.join(" → "), false);
  }
  host.remove();

  const tri = triangleTest();
  $("#tri-result").innerHTML = `<span class="${tri.ok ? "ok" : "ng"}">${esc(tri.msg)}</span>`;
  render();
}

$("#again").addEventListener("click", run);
registerServiceWorker();
run();
