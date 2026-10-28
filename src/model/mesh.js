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
  const head = headPart(manifest);
  if (head) out.push(head);
  return out;
}

// 顔の細かい筋と頭蓋骨の代わりの、服屋のマネキンのような簡易的な頭。manifest.head は OBJ 座標の mm（外形の箱）。
// 楕円体を土台に、あごへ向けて細くし、鼻・眉・唇・あごのふくらみと目のくぼみを、なめらかな凹凸で付ける
function mannequinHead(du, df, dw) {
  // du: 左右, df: 前(+)後, dw: 上下（単位方向）。返り値は外形の箱で正規化した座標 [左右, 前, 上]
  // 後頭部〜頭頂の大きな楕円体と、前下の顔・あごの楕円体を、外側をなめらかに取ってつなぐ
  const ray = (c, r) => {
    const d = [du / r[0], df / r[1], dw / r[2]], q = [c[0] / r[0], c[1] / r[1], c[2] / r[2]];
    const A = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], B = d[0] * q[0] + d[1] * q[1] + d[2] * q[2];
    const C = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] - 1, D = B * B - A * C;
    return D > 0 ? (B + Math.sqrt(D)) / A : 0;
  };
  const r1 = ray([0, -0.12, 0.2], [0.98, 0.86, 0.8]);
  const r2 = ray([0, 0.22, -0.32], [0.6, 0.66, 0.66]);
  let r = Math.pow(r1 ** 8 + r2 ** 8, 1 / 8);
  // 顔の凹凸（前側だけ）：鼻、眉、目のくぼみ、唇、あご
  const g = (x, s) => Math.exp(-(x * x) / (s * s));
  const fr = Math.max(0, df);
  r += 0.12 * g(du, 0.07) * g(dw + 0.12, 0.13) * fr ** 4;
  r += 0.045 * g(dw - 0.08, 0.06) * g(du, 0.42) * fr ** 2;
  r -= 0.06 * g(Math.abs(du) - 0.24, 0.09) * g(dw + 0.02, 0.07) * fr ** 2;
  r += 0.035 * g(du, 0.14) * g(dw + 0.42, 0.05) * fr ** 2;
  r += 0.04 * g(du, 0.16) * g(dw + 0.62, 0.07) * fr ** 2;
  return [du * r, df * r, dw * r];
}
function headPart(manifest) {
  const h = manifest.head;
  if (!h) return null;
  const SEG = 48, RING = 32;
  const pos = [], idx = [];
  for (let i = 0; i <= RING; i++) {
    const th = (i / RING) * Math.PI;
    for (let j = 0; j < SEG; j++) {
      const ph = (j / SEG) * Math.PI * 2;
      // 前は OBJ の −y
      const [u, f, w] = mannequinHead(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th));
      const x = h.c[0] + h.r[0] * u;
      const y = h.c[1] - h.r[1] * f;
      const z = h.c[2] + h.r[2] * w;
      pos.push(x / 1000, (z - manifest.zMin) / 1000, -y / 1000);
    }
  }
  for (let i = 0; i < RING; i++) for (let j = 0; j < SEG; j++) {
    const a = i * SEG + j, b = i * SEG + (j + 1) % SEG, c = a + SEG, d = b + SEG;
    idx.push(a, c, b, b, c, d);
  }
  const p = { id: "HEAD", c: "t", r: "head", side: "C", pos: new Float32Array(pos), idx: new Uint16Array(idx) };
  p.nrm = smoothNormals(p.pos, p.idx);
  return p;
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

// 部品をまとまりに詰める。color(part) は [r,g,b]（0〜1）。
// hidden(part) が true の部品は、種目表示用のインデックス（idxEx）から外す
function packBatches(parts, color, hidden) {
  const batches = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const nv = cur.nv, ni = cur.ni;
    const b = {
      pos: new Float32Array(nv * 3), nrm: new Float32Array(nv * 3), col: new Uint8Array(nv * 3), idx: new Uint16Array(ni), nv, ni, parts: cur.parts,
      bone: new Float32Array(nv * 3), extra: new Float32Array(nv * 2), p2: new Float32Array(nv * 3), n2: new Float32Array(nv * 3),
    };
    const ex = [];
    let vo = 0, io = 0;
    for (const p of cur.parts) {
      const n = p.pos.length / 3;
      b.pos.set(p.pos, vo * 3);
      b.nrm.set(p.nrm, vo * 3);
      if (p.bones) { b.bone.set(p.bones, vo * 3); b.extra.set(p.extra, vo * 2); b.p2.set(p.p2, vo * 3); b.n2.set(p.n2, vo * 3); }
      else { b.p2.set(p.pos, vo * 3); b.n2.set(p.nrm, vo * 3); for (let i = 0; i < n; i++) b.bone[(vo + i) * 3 + 2] = 1; }
      const c = color(p);
      for (let i = 0; i < n; i++) { b.col[(vo + i) * 3] = c[0] * 255; b.col[(vo + i) * 3 + 1] = c[1] * 255; b.col[(vo + i) * 3 + 2] = c[2] * 255; }
      for (let i = 0; i < p.idx.length; i++) b.idx[io + i] = p.idx[i] + vo;
      if (!(hidden && hidden(p))) for (let i = 0; i < p.idx.length; i++) ex.push(p.idx[i] + vo);
      p.batch = batches.length; p.vStart = vo; p.iStart = io;
      vo += n; io += p.idx.length;
    }
    b.idxEx = new Uint16Array(ex);
    b.niEx = ex.length;
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

// まとまりごとの色の配列を作り直す（種目を変えたとき）
function batchColors(batches, color) {
  return batches.map((b) => {
    const col = new Uint8Array(b.nv * 3);
    for (const p of b.parts) {
      const c = color(p), n = p.pos.length / 3;
      for (let i = 0; i < n; i++) { col[(p.vStart + i) * 3] = c[0] * 255; col[(p.vStart + i) * 3 + 1] = c[1] * 255; col[(p.vStart + i) * 3 + 2] = c[2] * 255; }
    }
    return col;
  });
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
