"use strict";
// WebGL の準備・シェーダー・カメラ。three.js を使わず生で書く。
//
// iPhone で落ちないための約束（CLAUDE.md 10章）
// - 重い準備計算をすべて終えてから getContext する
// - webgl2 → webgl2（AAなし）→ webgl → experimental-webgl の順に、毎回新しい canvas で試す
// - createShader が null なら失敗として扱う
// - スマホでは描画解像度の倍率を1.5まで、アンチエイリアスなし

const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  || matchMedia("(pointer: coarse)").matches;

const VS = `
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec3 aCol;
uniform mat4 uViewProj;
varying vec3 vNrm;
varying vec3 vCol;
varying vec3 vPos;
void main() {
  vNrm = aNrm;
  vCol = aCol;
  vPos = aPos;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const FS = `
precision mediump float;
uniform vec3 uEye;
varying vec3 vNrm;
varying vec3 vCol;
varying vec3 vPos;
void main() {
  vec3 n = normalize(vNrm);
  vec3 v = normalize(uEye - vPos);
  if (dot(n, v) < 0.0) n = -n;               // 裏面も表として照らす
  vec3 key = normalize(vec3(0.35, 0.75, 0.55));
  vec3 fill = normalize(vec3(-0.6, 0.2, -0.4));
  float d = max(dot(n, key), 0.0) * 0.75 + max(dot(n, fill), 0.0) * 0.22;
  float hemi = 0.5 + 0.5 * n.y;                // 上からの環境光
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.18;
  vec3 h = normalize(key + v);
  float spec = pow(max(dot(n, h), 0.0), 32.0) * 0.12;
  vec3 c = vCol * (0.28 + 0.14 * hemi + d) + vec3(spec + rim);
  gl_FragColor = vec4(pow(c, vec3(1.0 / 1.1)), 1.0);
}`;

// ---- 行列（列優先、Float32Array(16)）----
function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function mat4LookAt(eye, target, up) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1,
  ]);
}
function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

// ---- コンテキスト ----
// 試した内容を残す（失敗時に画面へ出して、利用者のスクリーンショットから原因を特定できるように）
function createContext(host) {
  const tries = [
    ["webgl2", { antialias: !IS_MOBILE }],
    ["webgl2", { antialias: false }],
    ["webgl", { antialias: false }],
    ["experimental-webgl", { antialias: false }],
  ];
  const log = [];
  for (const [type, attrs] of tries) {
    const canvas = document.createElement("canvas");
    let gl = null;
    try {
      gl = canvas.getContext(type, Object.assign({ alpha: false, depth: true, powerPreference: "default", preserveDrawingBuffer: false }, attrs));
    } catch (e) {
      log.push(`${type}${attrs.antialias ? "(AA)" : ""}: 例外 ${e.message}`);
      continue;
    }
    if (!gl) { log.push(`${type}${attrs.antialias ? "(AA)" : ""}: 取得できず`); continue; }
    if (gl.isContextLost()) { log.push(`${type}: 失われたコンテキスト`); continue; }
    try {
      const prog = buildProgram(gl);
      host.appendChild(canvas);
      log.push(`${type}${attrs.antialias ? "(AA)" : ""}: OK`);
      return { gl, canvas, prog, type, log, webgl2: type === "webgl2" };
    } catch (e) {
      log.push(`${type}: ${e.message}`);
    }
  }
  const err = new Error("3D表示を使えません");
  err.log = log;
  throw err;
}

function buildProgram(gl) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    if (!s) throw new Error("createShader が null（コンテキストが失われている）");
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`シェーダー: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const p = gl.createProgram();
  if (!p) throw new Error("createProgram が null");
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
  gl.bindAttribLocation(p, 0, "aPos");
  gl.bindAttribLocation(p, 1, "aNrm");
  gl.bindAttribLocation(p, 2, "aCol");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`リンク: ${gl.getProgramInfoLog(p)}`);
  return {
    p,
    uViewProj: gl.getUniformLocation(p, "uViewProj"),
    uEye: gl.getUniformLocation(p, "uEye"),
  };
}

// まとまりを GPU に送る。送ったら JS 側の配列は捨ててよい
function uploadBatches(gl, batches) {
  return batches.map((b) => {
    const buf = (data, target) => { const x = gl.createBuffer(); gl.bindBuffer(target || gl.ARRAY_BUFFER, x); gl.bufferData(target || gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return x; };
    return { pos: buf(b.pos), nrm: buf(b.nrm), col: buf(b.col), idx: buf(b.idx, gl.ELEMENT_ARRAY_BUFFER), ni: b.ni };
  });
}

// ---- カメラ（注視点のまわりを回る）----
function createCamera() {
  return { target: [0, 0.9, 0], dist: 2.6, yaw: 0, pitch: 0.08, fovy: 0.6 };
}
function cameraEye(cam) {
  const cp = Math.cos(cam.pitch);
  return [cam.target[0] + cam.dist * cp * Math.sin(cam.yaw), cam.target[1] + cam.dist * Math.sin(cam.pitch), cam.target[2] + cam.dist * cp * Math.cos(cam.yaw)];
}

function createRenderer(host, batches) {
  const ctx = createContext(host);
  const { gl, canvas, prog } = ctx;
  const gpu = uploadBatches(gl, batches);
  const cam = createCamera();
  const maxDpr = IS_MOBILE ? 1.5 : 2;
  let lost = false;
  let queued = false;
  const listeners = { lost: [] };

  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); lost = true; listeners.lost.forEach((f) => f()); });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const w = Math.max(1, Math.round(host.clientWidth * dpr)), h = Math.max(1, Math.round(host.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  function draw() {
    queued = false;
    if (lost) return;
    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.11, 0.125, 0.145, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(prog.p);
    const eye = cameraEye(cam);
    const vp = mat4Mul(mat4Perspective(cam.fovy, canvas.width / canvas.height, 0.05, 20), mat4LookAt(eye, cam.target, [0, 1, 0]));
    gl.uniformMatrix4fv(prog.uViewProj, false, vp);
    gl.uniform3fv(prog.uEye, eye);
    for (const b of gpu) {
      gl.bindBuffer(gl.ARRAY_BUFFER, b.pos); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.nrm); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.col); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.UNSIGNED_BYTE, true, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idx);
      gl.drawElements(gl.TRIANGLES, b.ni, gl.UNSIGNED_SHORT, 0);
    }
  }

  function request() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(draw);
  }

  // ドラッグで回す、ピンチ・ホイールで拡大
  const pointers = new Map();
  let pinch0 = 0, dist0 = 0;
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); dist0 = cam.dist; } });
  canvas.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = [e.clientX, e.clientY];
    pointers.set(e.pointerId, cur);
    if (pointers.size === 1) {
      cam.yaw -= (cur[0] - prev[0]) * 0.008;
      cam.pitch = Math.max(-1.2, Math.min(1.2, cam.pitch + (cur[1] - prev[1]) * 0.006));
    } else if (pointers.size === 2 && pinch0) {
      const [a, b] = [...pointers.values()];
      cam.dist = Math.max(0.6, Math.min(6, dist0 * pinch0 / Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1]))));
    }
    request();
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch0 = 0; };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); cam.dist = Math.max(0.6, Math.min(6, cam.dist * Math.exp(e.deltaY * 0.001))); request(); }, { passive: false });
  window.addEventListener("resize", request);

  return {
    ctx, cam, request, draw,
    onLost(f) { listeners.lost.push(f); },
    info() {
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      return { type: ctx.type, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), dpr: Math.min(window.devicePixelRatio || 1, maxDpr) };
    },
  };
}
