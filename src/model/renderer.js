"use strict";
// WebGL の準備・シェーダー・カメラ。three.js を使わず生で書く。
//
// iPhone で落ちないための約束（CLAUDE.md 10章）
// - 重い準備計算をすべて終えてから getContext する
// - webgl2 → webgl2（AAなし）→ webgl → experimental-webgl の順に、毎回新しい canvas で試す
// - createShader が null なら失敗として扱う
// - スマホでは描画解像度の倍率を1.5まで、アンチエイリアスなし
// - uniform 配列はループでなく直接添字で参照する

const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  || matchMedia("(pointer: coarse)").matches;

const MAX_PADS = 6;
const PAD_DEPTH = 0.03; // 座面からこの深さまで入った頂点を面に押し出す

// 体：骨2本をデュアルクォータニオンで混ぜる（aExtra.x=1 の頂点は線形で混ぜる）
const VS_BODY = `
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec3 aCol;
attribute vec3 aBone;   // DQ の番号0, 番号1, 番号0の重み
attribute vec2 aExtra;  // 線形で混ぜるか, 握りの対象か
attribute vec3 aP2;     // 握ったときの位置
attribute vec3 aN2;     // 握ったときの法線
uniform mat4 uViewProj;
uniform vec4 uDQ[30];
uniform vec2 uGrip;
uniform vec4 uPadC[${MAX_PADS}];  // 中心xyz, cos(x軸回転)
uniform vec4 uPadS[${MAX_PADS}];  // 半分の大きさxyz（x<=0 で無効）, sin(x軸回転)
varying vec3 vNrm;
varying vec3 vCol;
varying vec3 vPos;

vec3 dqPoint(vec4 r, vec4 d, vec3 p) {
  return p + 2.0 * cross(r.xyz, cross(r.xyz, p) + r.w * p) + 2.0 * (r.w * d.xyz - d.w * r.xyz + cross(r.xyz, d.xyz));
}
vec3 qRot(vec4 r, vec3 v) { return v + 2.0 * cross(r.xyz, cross(r.xyz, v) + r.w * v); }
vec3 pad(vec3 P, vec4 c, vec4 s) {
  if (s.x <= 0.0) return P;
  vec3 q = P - c.xyz;
  vec3 l = vec3(q.x, c.w * q.y + s.w * q.z, -s.w * q.y + c.w * q.z);
  if (abs(l.x) < s.x && abs(l.z) < s.z && l.y < s.y && l.y > s.y - ${PAD_DEPTH.toFixed(3)}) {
    l.y = s.y;
    return c.xyz + vec3(l.x, c.w * l.y - s.w * l.z, s.w * l.y + c.w * l.z);
  }
  return P;
}
void main() {
  int i0 = int(aBone.x + 0.5);
  int i1 = int(aBone.y + 0.5);
  float w0 = aBone.z;
  float w1 = 1.0 - w0;
  vec4 r0 = uDQ[i0 * 2];
  vec4 d0 = uDQ[i0 * 2 + 1];
  vec4 r1 = uDQ[i1 * 2];
  vec4 d1 = uDQ[i1 * 2 + 1];
  float g = aExtra.y * (i0 == 10 ? uGrip.x : uGrip.y);
  vec3 p = mix(aPos, aP2, g);
  vec3 n0 = normalize(mix(aNrm, aN2, g));
  vec3 P;
  vec3 N;
  if (aExtra.x > 0.5) {
    P = w0 * dqPoint(r0, d0, p) + w1 * dqPoint(r1, d1, p);
    N = w0 * qRot(r0, n0) + w1 * qRot(r1, n0);
  } else {
    if (dot(r0, r1) < 0.0) { r1 = -r1; d1 = -d1; }
    vec4 r = w0 * r0 + w1 * r1;
    vec4 d = w0 * d0 + w1 * d1;
    float l = length(r);
    r /= l; d /= l;
    P = dqPoint(r, d, p);
    N = qRot(r, n0);
  }
  P = pad(P, uPadC[0], uPadS[0]);
  P = pad(P, uPadC[1], uPadS[1]);
  P = pad(P, uPadC[2], uPadS[2]);
  P = pad(P, uPadC[3], uPadS[3]);
  P = pad(P, uPadC[4], uPadS[4]);
  P = pad(P, uPadC[5], uPadS[5]);
  vNrm = N;
  vCol = aCol;
  vPos = P;
  gl_Position = uViewProj * vec4(P, 1.0);
}`;

// 器具：骨ごとの 4×4 行列（ケーブルは伸び縮みするので行列）
const VS_PROPS = `
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec3 aCol;
attribute float aBone;
uniform mat4 uViewProj;
uniform mat4 uM[8];
varying vec3 vNrm;
varying vec3 vCol;
varying vec3 vPos;
void main() {
  mat4 m = uM[int(aBone + 0.5) - 14];
  vec4 P = m * vec4(aPos, 1.0);
  vNrm = (m * vec4(aNrm, 0.0)).xyz;
  vCol = aCol;
  vPos = P.xyz;
  gl_Position = uViewProj * P;
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
// 3×3（行優先）と平行移動から列優先の 4×4
function mat4FromRT(R, t) {
  return [R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, t[0], t[1], t[2], 1];
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
    const label = `${type}${attrs.antialias ? "(AA)" : ""}`;
    const canvas = document.createElement("canvas");
    let gl = null;
    try {
      gl = canvas.getContext(type, Object.assign({ alpha: false, depth: true, powerPreference: "default", preserveDrawingBuffer: false }, attrs));
    } catch (e) {
      log.push(`${label}: 例外 ${e.message}`);
      continue;
    }
    if (!gl) { log.push(`${label}: 取得できず`); continue; }
    if (gl.isContextLost()) { log.push(`${label}: 失われたコンテキスト`); continue; }
    try {
      const body = buildProgram(gl, VS_BODY, ["aPos", "aNrm", "aCol", "aBone", "aExtra", "aP2", "aN2"], ["uViewProj", "uEye", "uDQ", "uGrip", "uPadC", "uPadS"]);
      const props = buildProgram(gl, VS_PROPS, ["aPos", "aNrm", "aCol", "aBone"], ["uViewProj", "uEye", "uM"]);
      host.appendChild(canvas);
      log.push(`${label}: OK`);
      return { gl, canvas, body, props, type, log };
    } catch (e) {
      log.push(`${label}: ${e.message}`);
    }
  }
  const err = new Error("3D表示を使えません");
  err.log = log;
  throw err;
}

function buildProgram(gl, vs, attribs, uniforms) {
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
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`リンク: ${gl.getProgramInfoLog(p)}`);
  const u = { p, n: attribs.length };
  for (const name of uniforms) u[name] = gl.getUniformLocation(p, name.match(/^u(DQ|PadC|PadS|M)$/) ? `${name}[0]` : name);
  return u;
}

// ---- カメラ（注視点のまわりを回る）----
function createCamera() {
  return { target: [0, 0.9, 0], dist: 2.6, yaw: 0, pitch: 0.08, fovy: 0.6, free: 1 };
}
function cameraEye(cam) {
  const cp = Math.cos(cam.pitch);
  return [cam.target[0] + cam.dist * cp * Math.sin(cam.yaw), cam.target[1] + cam.dist * Math.sin(cam.pitch), cam.target[2] + cam.dist * cp * Math.cos(cam.yaw)];
}

function createRenderer(host, batches) {
  const ctx = createContext(host);
  const { gl, canvas } = ctx;
  const cam = createCamera();
  const maxDpr = IS_MOBILE ? 1.5 : 2;
  let lost = false;
  let queued = false;
  const listeners = { lost: [] };
  const buf = (data, target) => { const x = gl.createBuffer(); gl.bindBuffer(target || gl.ARRAY_BUFFER, x); gl.bufferData(target || gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return x; };

  // 体のまとまりを GPU に送る（送ったら JS 側の配列は捨ててよい。色は後で差し替える）
  const body = batches.map((b) => ({
    pos: buf(b.pos), nrm: buf(b.nrm), col: buf(b.col), bone: buf(b.bone), extra: buf(b.extra), p2: buf(b.p2), n2: buf(b.n2),
    idx: buf(b.idx, gl.ELEMENT_ARRAY_BUFFER), ni: b.ni,
    idxEx: b.idxEx ? buf(b.idxEx, gl.ELEMENT_ARRAY_BUFFER) : null, niEx: b.niEx,
  }));
  let props = null;
  let useExerciseIdx = false;
  const uni = {
    dq: new Float32Array(120), mats: new Float32Array(128), grip: new Float32Array(2),
    padC: new Float32Array(MAX_PADS * 4), padS: new Float32Array(MAX_PADS * 4),
  };
  // 初期値：恒等変換
  for (let i = 0; i < 15; i++) uni.dq[i * 8 + 3] = 1;
  for (let i = 0; i < 8; i++) { uni.mats[i * 16] = uni.mats[i * 16 + 5] = uni.mats[i * 16 + 10] = uni.mats[i * 16 + 15] = 1; }

  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); lost = true; listeners.lost.forEach((f) => f()); });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const w = Math.max(1, Math.round(host.clientWidth * dpr)), h = Math.max(1, Math.round(host.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  function attrib(i, b, size, type, normalized) {
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, size, type || gl.FLOAT, !!normalized, 0, 0);
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
    // 模型に使える高さの割合 free（画面下の操作部分を除いた上側）に収まるよう引き、その範囲の真ん中に映す。
    // 縦長の画面では横幅にも収まるようさらに引く（種目のカメラは縦横比 0.69 の画面で決めている）
    const aspect = canvas.width / canvas.height;
    const free = Math.min(1, Math.max(0.35, cam.free || 1));
    const fit = Math.max(1, 0.69 / (aspect / free));
    const eye = cameraEye(Object.assign({}, cam, { dist: cam.dist * fit / free }));
    const near = cam.near || 0.05;
    let proj = mat4Perspective(cam.fovy, aspect, near, 20);
    const shift = cam.shiftY == null ? 1 - free : cam.shiftY;
    if (shift) proj = mat4Mul([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, shift, 0, 1], proj);
    const vp = mat4Mul(proj, mat4LookAt(eye, cam.target, [0, 1, 0]));

    const P = ctx.body;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.uViewProj, false, vp);
    gl.uniform3fv(P.uEye, eye);
    gl.uniform4fv(P.uDQ, uni.dq);
    gl.uniform2fv(P.uGrip, uni.grip);
    gl.uniform4fv(P.uPadC, uni.padC);
    gl.uniform4fv(P.uPadS, uni.padS);
    for (const b of body) {
      attrib(0, b.pos, 3); attrib(1, b.nrm, 3); attrib(2, b.col, 3, gl.UNSIGNED_BYTE, true);
      attrib(3, b.bone, 3); attrib(4, b.extra, 2); attrib(5, b.p2, 3); attrib(6, b.n2, 3);
      const ex = useExerciseIdx && b.idxEx;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ex ? b.idxEx : b.idx);
      gl.drawElements(gl.TRIANGLES, ex ? b.niEx : b.ni, gl.UNSIGNED_SHORT, 0);
    }
    for (let i = 4; i < 7; i++) gl.disableVertexAttribArray(i);

    if (props && props.ni) {
      const Q = ctx.props;
      gl.useProgram(Q.p);
      gl.uniformMatrix4fv(Q.uViewProj, false, vp);
      gl.uniform3fv(Q.uEye, eye);
      gl.uniformMatrix4fv(Q.uM, false, uni.mats);
      attrib(0, props.pos, 3); attrib(1, props.nrm, 3); attrib(2, props.col, 3, gl.UNSIGNED_BYTE, true); attrib(3, props.bone, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, props.idx);
      gl.drawElements(gl.TRIANGLES, props.ni, gl.UNSIGNED_SHORT, 0);
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
  // 1本目の指が触れたら、取りこぼした古い指を消す（離れた通知を取りこぼすと「2本指のまま」になり、回せなくなっていた）
  canvas.addEventListener("pointerdown", (e) => { if (e.isPrimary) { pointers.clear(); pinch0 = 0; } try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 取れなくても動く */ } pointers.set(e.pointerId, [e.clientX, e.clientY]); if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); dist0 = cam.dist; } });
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
      cam.dist = Math.max(0.4, Math.min(6, dist0 * pinch0 / Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1]))));
    }
    request();
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch0 = 0; };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("lostpointercapture", up);
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); cam.dist = Math.max(0.4, Math.min(6, cam.dist * Math.exp(e.deltaY * 0.001))); request(); }, { passive: false });
  window.addEventListener("resize", request);

  return {
    ctx, cam, request, draw,
    onLost(f) { listeners.lost.push(f); },
    // 色の差し替え（まとまりごとの Uint8Array）
    setColors(cols) {
      cols.forEach((c, i) => { gl.bindBuffer(gl.ARRAY_BUFFER, body[i].col); gl.bufferSubData(gl.ARRAY_BUFFER, 0, c); });
    },
    useExerciseParts(on) { useExerciseIdx = on; },
    setProps(m) {
      if (props) for (const k of ["pos", "nrm", "col", "bone", "idx"]) gl.deleteBuffer(props[k]);
      props = m && m.ni ? { pos: buf(m.pos), nrm: buf(m.nrm), col: buf(m.col), bone: buf(m.bone), idx: buf(m.idx, gl.ELEMENT_ARRAY_BUFFER), ni: m.ni } : null;
    },
    // dq: 15骨×(実部4+双対部4), mats: 8行列×16, grip: [右,左], pads: [{c,h,rx}]
    setPose(dq, mats, grip, pads) {
      uni.dq.set(dq);
      uni.mats.set(mats);
      uni.grip[0] = grip[0]; uni.grip[1] = grip[1];
      uni.padC.fill(0); uni.padS.fill(0);
      (pads || []).slice(0, MAX_PADS).forEach((p, i) => {
        uni.padC.set([p.c[0], p.c[1], p.c[2], Math.cos(p.rx || 0)], i * 4);
        uni.padS.set([p.h[0], p.h[1], p.h[2], Math.sin(p.rx || 0)], i * 4);
      });
    },
    info() {
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      return { type: ctx.type, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), dpr: Math.min(window.devicePixelRatio || 1, maxDpr) };
    },
  };
}
