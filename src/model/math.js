"use strict";
// ベクトル（[x,y,z]）、回転行列（3×3、行優先の長さ9の配列）、四元数（[x,y,z,w]）

const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  // a から b に垂直な成分
  perp: (a, b) => { const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; return [a[0] - b[0] * d, a[1] - b[1] * d, a[2] - b[2] * d]; },
  mirror: (a) => [-a[0], a[1], a[2]],
};

const M3 = {
  I: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
  mul(a, b) {
    const o = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    return o;
  },
  apply: (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]],
  T: (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]],
  // 列ベクトル a,b,c を並べた行列
  cols: (a, b, c) => [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]],
  rx(t) { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; },
  ry(t) { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; },
  rz(t) { const c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, s, c, 0, 0, 0, 1]; },
  // 軸 k（単位）まわりに t
  axis(k, t) {
    const c = Math.cos(t), s = Math.sin(t), C = 1 - c, [x, y, z] = k;
    return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
  },
  // 主軸 u と副軸 s（u に垂直化）からなる正規直交基底
  frame(u, s) {
    const x = V.norm(u);
    let y = V.perp(s, x);
    if (V.len(y) < 1e-6) y = V.perp(Math.abs(x[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], x);
    y = V.norm(y);
    return M3.cols(x, y, V.cross(x, y));
  },
  // 静止時の (u0, s0) を (u, s) に重ねる回転
  align(u0, s0, u, s) { return M3.mul(M3.frame(u, s), M3.T(M3.frame(u0, s0))); },
};

// 回転行列 → 四元数 [x,y,z,w]
function quatFromM3(m) {
  const tr = m[0] + m[4] + m[8];
  let x, y, z, w;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = s / 4; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    w = (m[7] - m[5]) / s; x = s / 4; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = s / 4; z = (m[5] + m[7]) / s;
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = s / 4;
  }
  const l = Math.hypot(x, y, z, w);
  return [x / l, y / l, z / l, w / l];
}

// 剛体変換 x' = R x + t をデュアルクォータニオン（実部 r、双対部 d）に
function dqFrom(R, t) {
  const r = quatFromM3(R);
  // d = 0.5 * (t,0) ⊗ r
  const d = [
    0.5 * (t[0] * r[3] + t[1] * r[2] - t[2] * r[1]),
    0.5 * (-t[0] * r[2] + t[1] * r[3] + t[2] * r[0]),
    0.5 * (t[0] * r[1] - t[1] * r[0] + t[2] * r[3]),
    -0.5 * (t[0] * r[0] + t[1] * r[1] + t[2] * r[2]),
  ];
  return { r, d };
}

// シェーダーと同じ式で点を動かす（CPU 側の検査・自動配置用）
function dqPoint(r, d, p) {
  const rv = [r[0], r[1], r[2]];
  const c1 = V.add(V.cross(rv, p), V.scale(p, r[3]));
  const a = V.add(p, V.scale(V.cross(rv, c1), 2));
  const tv = V.add(V.sub(V.scale([d[0], d[1], d[2]], r[3]), V.scale(rv, d[3])), V.cross(rv, [d[0], d[1], d[2]]));
  return V.add(a, V.scale(tv, 2));
}

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function ease(t) { return t * t * (3 - 2 * t); }
function wrapPi(a) { return a - 2 * Math.PI * Math.round(a / (2 * Math.PI)); }
const DEG = Math.PI / 180;

// 点と線分 ab の距離と、a からの軸方向の位置
function segDist(p, a, b) {
  const ab = V.sub(b, a), L2 = V.dot(ab, ab);
  const t = clamp(V.dot(V.sub(p, a), ab) / L2, 0, 1);
  return V.dist(p, V.add(a, V.scale(ab, t)));
}
