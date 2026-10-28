"use strict";
// 加工済みメッシュ（body*.bin）を、描画用の頂点配列に組み立てる。
//
// 座標の変換: world = [x/1000, (z − zMin)/1000, −y/1000]（メートル、y上、+zが体の前、足元が y=0）
// manifest の m=1 のパーツは x を反転した左側も作る（三角形の向きも反転）。
// WebGL1 でも uint16 のインデックスで描けるよう、65535頂点ごとの「まとまり」に分ける。

const ANATOMY_COLORS = {
  m: [0.62, 0.27, 0.22],   // 筋：赤茶
  b: [0.90, 0.87, 0.78],   // 骨：アイボリー
  t: [0.80, 0.74, 0.66],   // 腱・筋膜
};

// 他のパーツとほぼ同じ面に重なってちらつくパーツを、法線の向きに押し出す（メートル）。
// 腹直筋は外腹斜筋の腱膜とほぼ重なり、斑点状に透けて見えた
const SURFACE_PUSH = { FMA13377: 0.002 };

function toWorld(qx, qy, qz, unit, zMin) {
  return [qx * unit / 1000, (qz * unit - zMin) / 1000, -qy * unit / 1000];
}

// 部品（パーツ×左右）の一覧を作る。頂点は世界座標の Float32Array
function decodeParts(buf, manifest) {
  const unit = manifest.unit, zMin = manifest.zMin;
  const out = [];
  for (const p of manifest.parts) {
    const q = new Int16Array(buf, p.o, p.nv * 3);
    const f = new Uint16Array(buf, p.o + p.nv * 6, p.nf * 3);
    for (const side of p.m ? ["R", "L"] : ["C"]) {
      const s = side === "L" ? -1 : 1;
      const pos = new Float32Array(p.nv * 3);
      for (let i = 0; i < p.nv; i++) {
        const w = toWorld(q[i * 3] * s, q[i * 3 + 1], q[i * 3 + 2], unit, zMin);
        pos[i * 3] = w[0]; pos[i * 3 + 1] = w[1]; pos[i * 3 + 2] = w[2];
      }
      const idx = new Uint16Array(f);
      // 左右反転すると裏返るので、三角形の向きを戻す。変換 (x,y,z)→(x,z,−y) は向きを保つ
      if (s < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      const nrm = smoothNormals(pos, idx);
      const push = SURFACE_PUSH[p.id];
      if (push) for (let i = 0; i < pos.length; i++) pos[i] += nrm[i] * push;
      out.push({ id: p.id, c: p.c, r: p.r, side, pos, idx, nrm });
    }
  }
  return out;
}

function smoothNormals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    // 面積で重み付け（外積をそのまま足す）
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

// 部品をまとまりに詰める。color(part) は [r,g,b]（0〜1）
function packBatches(parts, color) {
  const batches = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const nv = cur.nv, ni = cur.ni;
    const b = { pos: new Float32Array(nv * 3), nrm: new Float32Array(nv * 3), col: new Uint8Array(nv * 3), idx: new Uint16Array(ni), nv, ni, parts: cur.parts };
    let vo = 0, io = 0;
    for (const p of cur.parts) {
      const n = p.pos.length / 3;
      b.pos.set(p.pos, vo * 3);
      b.nrm.set(p.nrm, vo * 3);
      const c = color(p);
      for (let i = 0; i < n; i++) { b.col[(vo + i) * 3] = c[0] * 255; b.col[(vo + i) * 3 + 1] = c[1] * 255; b.col[(vo + i) * 3 + 2] = c[2] * 255; }
      for (let i = 0; i < p.idx.length; i++) b.idx[io + i] = p.idx[i] + vo;
      p.batch = batches.length; p.vStart = vo; p.iStart = io;
      vo += n; io += p.idx.length;
    }
    batches.push(b);
    cur = null;
  };
  for (const p of parts) {
    const n = p.pos.length / 3;
    if (cur && cur.nv + n > 65535) flush();
    if (!cur) cur = { nv: 0, ni: 0, parts: [] };
    cur.parts.push(p);
    cur.nv += n;
    cur.ni += p.idx.length;
  }
  flush();
  return batches;
}

function bounds(parts) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = p.pos[i + k];
    if (v < lo[k]) lo[k] = v;
    if (v > hi[k]) hi[k] = v;
  }
  return { lo, hi };
}
