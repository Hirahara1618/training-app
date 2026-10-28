"use strict";
// 検査ツール（CLAUDE.md 8章）。ページに __check / __self / __smooth を公開する。
// 体の頂点は CPU 側でシェーダーと同じ式で動かす（座面の押し出しの前の位置で測る）。

const REGION_NAMES = ["骨盤", "頭", "右太もも", "右すね", "右足", "左太もも", "左すね", "左足",
  "右上腕", "右前腕", "右手", "左上腕", "左前腕", "左手", "胸郭"];
const LIMIT = { pad: 0.03, other: 0.015, self: 0.01 };
const SMOOTH_MIN = 0.02;

// 速い版の頂点変形：fn(part, i, x, y, z) を呼ぶ（配列を作らない）
function skinFast(parts, dq, grip, filter, fn) {
  for (const p of parts) {
    if (filter && !filter(p)) continue;
    const n = p.pos.length / 3, P = p.pos, Q = p.p2, BN = p.bones, EX = p.extra;
    for (let i = 0; i < n; i++) {
      const s0 = BN[i * 3], s1 = BN[i * 3 + 1], w0 = BN[i * 3 + 2], w1 = 1 - w0;
      const g = EX[i * 2 + 1] * (s0 === 10 ? grip[0] : grip[1]);
      const px = P[i * 3] + (Q[i * 3] - P[i * 3]) * g, py = P[i * 3 + 1] + (Q[i * 3 + 1] - P[i * 3 + 1]) * g, pz = P[i * 3 + 2] + (Q[i * 3 + 2] - P[i * 3 + 2]) * g;
      const a = s0 * 8, b = s1 * 8;
      let x, y, z;
      if (EX[i * 2] > 0.5 || s0 === s1) {
        // 線形（同じ骨なら DQS も同じ）
        let o = dqP(dq, a, 1, px, py, pz); x = o[0] * w0; y = o[1] * w0; z = o[2] * w0;
        o = dqP(dq, b, 1, px, py, pz); x += o[0] * w1; y += o[1] * w1; z += o[2] * w1;
      } else {
        const sgn = dq[a] * dq[b] + dq[a + 1] * dq[b + 1] + dq[a + 2] * dq[b + 2] + dq[a + 3] * dq[b + 3] < 0 ? -1 : 1;
        for (let k = 0; k < 8; k++) BLEND[k] = dq[a + k] * w0 + dq[b + k] * w1 * sgn;
        const l = Math.hypot(BLEND[0], BLEND[1], BLEND[2], BLEND[3]);
        for (let k = 0; k < 8; k++) BLEND[k] /= l;
        const o = dqP(BLEND, 0, 1, px, py, pz); x = o[0]; y = o[1]; z = o[2];
      }
      fn(p, i, x, y, z);
    }
  }
}
const BLEND = new Float64Array(8);
const DQ_OUT = [0, 0, 0];
function dqP(q, o, _, px, py, pz) {
  const rx = q[o], ry = q[o + 1], rz = q[o + 2], rw = q[o + 3], dx = q[o + 4], dy = q[o + 5], dz = q[o + 6], dw = q[o + 7];
  // c1 = r × p + w p
  const c1x = ry * pz - rz * py + rw * px, c1y = rz * px - rx * pz + rw * py, c1z = rx * py - ry * px + rw * pz;
  DQ_OUT[0] = px + 2 * (ry * c1z - rz * c1y) + 2 * (rw * dx - dw * rx + ry * dz - rz * dy);
  DQ_OUT[1] = py + 2 * (rz * c1x - rx * c1z) + 2 * (rw * dy - dw * ry + rz * dx - rx * dz);
  DQ_OUT[2] = pz + 2 * (rx * c1y - ry * c1x) + 2 * (rw * dz - dw * rz + rx * dy - ry * dx);
  return DQ_OUT;
}

function applyMat4(m, p) {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}

// 器具の当たり判定の形を、その姿勢の世界座標にする
function worldPrims(props, mats) {
  const M = (b) => mats.subarray((b - 14) * 16, (b - 14) * 16 + 16);
  const out = [];
  for (const bx of props.boxes) {
    const c = applyMat4(M(bx.bone), bx.c);
    const r = Math.hypot(...bx.h);
    out.push({ kind: "box", c, h: bx.h, cs: Math.cos(bx.rx), sn: Math.sin(bx.rx), pad: bx.pad, bone: bx.bone, label: bx.label, grip: bx.grip,
      lo: V.sub(c, [r, r, r]), hi: V.add(c, [r, r, r]) });
  }
  for (const cy of props.cyls) {
    const a = applyMat4(M(cy.bone), cy.a), b = applyMat4(M(cy.bone), cy.b);
    const ab = V.sub(b, a);
    out.push({ kind: "cyl", a, ab, L2: V.dot(ab, ab), r: cy.r, bone: cy.bone, label: cy.label, grip: cy.grip,
      lo: [Math.min(a[0], b[0]) - cy.r, Math.min(a[1], b[1]) - cy.r, Math.min(a[2], b[2]) - cy.r],
      hi: [Math.max(a[0], b[0]) + cy.r, Math.max(a[1], b[1]) + cy.r, Math.max(a[2], b[2]) + cy.r] });
  }
  return out;
}

// 点が形の中にどれだけ入っているか（入っていなければ 0）
function penetration(pr, x, y, z) {
  if (x < pr.lo[0] || x > pr.hi[0] || y < pr.lo[1] || y > pr.hi[1] || z < pr.lo[2] || z > pr.hi[2]) return 0;
  if (pr.kind === "box") {
    const qx = x - pr.c[0], qy0 = y - pr.c[1], qz0 = z - pr.c[2];
    const qy = pr.cs * qy0 + pr.sn * qz0, qz = -pr.sn * qy0 + pr.cs * qz0;
    const dx = pr.h[0] - Math.abs(qx), dy = pr.h[1] - Math.abs(qy), dz = pr.h[2] - Math.abs(qz);
    if (dx <= 0 || dy <= 0 || dz <= 0) return 0;
    // 座面は上の面から測る（体は上から乗るので）
    if (pr.pad) return pr.h[1] - qy;
    return Math.min(dx, dy, dz);
  }
  const px = x - pr.a[0], py = y - pr.a[1], pz = z - pr.a[2];
  const t = (px * pr.ab[0] + py * pr.ab[1] + pz * pr.ab[2]) / pr.L2;
  if (t <= 0 || t >= 1) return 0;
  const d = Math.hypot(px - pr.ab[0] * t, py - pr.ab[1] * t, pz - pr.ab[2] * t);
  if (d >= pr.r) return 0;
  const L = Math.sqrt(pr.L2);
  return Math.min(pr.r - d, t * L, (1 - t) * L);
}

// 握っている（または手の中を通る）器具：バー・手の器具・握る棒・ケーブル・ロープ
function isHeld(pr) { return pr.grip || (pr.bone >= 15 && pr.bone <= 21); }

function framesOf(n) { return Array.from({ length: n + 1 }, (_, k) => k / n); }

// 器具へのめり込み。部位×器具ごとの最大の深さ（m）と、そのときの t
function inspectCheck(id, n) {
  n = n || 100;
  setPlaying(false);
  selectExercise(id);
  if (!View.ex) return { error: `種目がありません: ${id}` };
  View.state = {};
  const res = {};
  for (const t of framesOf(n)) {
    const s = solveAt(t);
    const prims = worldPrims(View.props, equipMats(s));
    const holding = s.grip > 0;
    skinFast(View.parts, bodyDQ(s), s.gripLR, (p) => !PELVIS_PARTS[p.id], (p, i, x, y, z) => {
      const slot = p.bones[i * 3];
      const hand = slot === 10 || slot === 13;
      for (const pr of prims) {
        // 握っている手と、握っている器具は除く
        if (hand && holding && isHeld(pr)) continue;
        const d = penetration(pr, x, y, z);
        if (d <= 0) continue;
        const key = `${REGION_NAMES[slot]}→${pr.label}`;
        if (!res[key] || d > res[key].depth) res[key] = { depth: d, t, limit: pr.pad ? LIMIT.pad : LIMIT.other };
      }
      // 逆向きの検査のために、動かした頂点をパーツごとに取っておく
      const buf = p._posed || (p._posed = new Float32Array(p.pos.length));
      buf[i * 3] = x; buf[i * 3 + 1] = y; buf[i * 3 + 2] = z;
      if (i === 0) p._lo = [x, y, z], p._hi = [x, y, z];
      else { if (x < p._lo[0]) p._lo[0] = x; if (y < p._lo[1]) p._lo[1] = y; if (z < p._lo[2]) p._lo[2] = z; if (x > p._hi[0]) p._hi[0] = x; if (y > p._hi[1]) p._hi[1] = y; if (z > p._hi[2]) p._hi[2] = z; }
    });
    // 器具が体の中に入っていないか（細いバーは頂点の検査では深さが半径までしか出ないため）
    for (const pr of prims) {
      if (pr.pad || pr.label === "床") continue;
      const heldBy = holding && isHeld(pr);
      for (const sp of samplePrim(pr)) {
        for (const p of View.parts) {
          if (PELVIS_PARTS[p.id] || !p._posed) continue;
          if (sp.q[0] < p._lo[0] || sp.q[0] > p._hi[0] || sp.q[1] < p._lo[1] || sp.q[1] > p._hi[1] || sp.q[2] < p._lo[2] || sp.q[2] > p._hi[2]) continue;
          if (!insidePart(p, sp.q)) continue;
          const near = nearestVertex(p, sp.q);
          const slot = p.bones[near.i * 3];
          if (heldBy && (slot === 10 || slot === 13 || slot === 9 || slot === 12)) continue;
          const d = near.d + sp.extra;
          const key = `${REGION_NAMES[slot]}→${pr.label}`;
          if (!res[key] || d > res[key].depth) res[key] = { depth: d, t, limit: LIMIT.other };
        }
      }
    }
  }
  return summarize(res);
}

// 器具の上に検査する点を並べる。円柱は軸の上（深さに半径を足す）、箱は表面
function samplePrim(pr) {
  const out = [];
  if (pr.kind === "cyl") {
    const L = Math.sqrt(pr.L2), n = Math.max(2, Math.ceil(L / 0.01));
    for (let k = 0; k <= n; k++) out.push({ q: V.add(pr.a, V.scale(pr.ab, k / n)), extra: pr.r });
    return out;
  }
  const step = 0.02;
  const axes = [0, 1, 2];
  for (const ax of axes) for (const sgn of [-1, 1]) {
    const [u, w] = axes.filter((k) => k !== ax);
    const nu = Math.max(1, Math.round(2 * pr.h[u] / step)), nw = Math.max(1, Math.round(2 * pr.h[w] / step));
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nw; j++) {
      const l = [0, 0, 0];
      l[ax] = sgn * pr.h[ax]; l[u] = -pr.h[u] + (2 * pr.h[u] * i) / nu; l[w] = -pr.h[w] + (2 * pr.h[w] * j) / nw;
      out.push({ q: [pr.c[0] + l[0], pr.c[1] + pr.cs * l[1] - pr.sn * l[2], pr.c[2] + pr.sn * l[1] + pr.cs * l[2]], extra: 0 });
    }
  }
  return out;
}

// 点がパーツ（閉じた曲面）の内側か：x・y・z の3方向に光線を飛ばし、交わる回数の偶奇の多数決
function insidePart(p, q) {
  let votes = 0;
  for (let ax = 0; ax < 3; ax++) if (rayParity(p, q, ax)) votes++;
  return votes >= 2;
}
function rayParity(p, q, ax) {
  const P = p._posed, I = p.idx, u = (ax + 1) % 3, w = (ax + 2) % 3;
  const qu = q[u] + 1.3e-7, qw = q[w] + 1.7e-7; // 辺や頂点にちょうど当たらないよう少しずらす
  let hits = 0;
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
    const au = P[a + u] - qu, aw = P[a + w] - qw, bu = P[b + u] - qu, bw = P[b + w] - qw, cu = P[c + u] - qu, cw = P[c + w] - qw;
    // 光線（u,w 平面の原点）が三角形の投影の内側か
    const d1 = au * bw - aw * bu, d2 = bu * cw - bw * cu, d3 = cu * aw - cw * au;
    if (!((d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0))) continue;
    const s = d1 + d2 + d3;
    const hitAx = (P[c + ax] * d1 + P[a + ax] * d2 + P[b + ax] * d3) / s;
    if (hitAx > q[ax]) hits++;
  }
  return hits % 2 === 1;
}
function nearestVertex(p, q) {
  const P = p._posed;
  let best = Infinity, bi = 0;
  for (let i = 0; i < P.length; i += 3) {
    const d = (P[i] - q[0]) ** 2 + (P[i + 1] - q[1]) ** 2 + (P[i + 2] - q[2]) ** 2;
    if (d < best) { best = d; bi = i / 3; }
  }
  return { d: Math.sqrt(best), i: bi };
}

// 胴体の芯（楕円柱）：静止姿勢の胴の断面を 5cm ごとに測り、その 75%
function torsoCore() {
  if (View.core) return View.core;
  const rig = View.rig, y0 = rig.hipC[1] + 0.05, y1 = rig.c7[1] - 0.05;
  const slices = [];
  for (let y = y0; y <= y1 + 1e-6; y += 0.05) slices.push({ y, xmax: 0, zlo: Infinity, zhi: -Infinity });
  for (const p of View.parts) {
    if (PELVIS_PARTS[p.id]) continue;
    for (let i = 0; i < p.pos.length / 3; i++) {
      const s = p.bones[i * 3];
      if (s !== 0 && s !== 14) continue;
      const x = p.pos[i * 3], y = p.pos[i * 3 + 1], z = p.pos[i * 3 + 2];
      const k = Math.round((y - y0) / 0.05);
      if (k < 0 || k >= slices.length || Math.abs(y - slices[k].y) > 0.01) continue;
      const sl = slices[k];
      sl.xmax = Math.max(sl.xmax, Math.abs(x)); sl.zlo = Math.min(sl.zlo, z); sl.zhi = Math.max(sl.zhi, z);
    }
  }
  View.core = slices.map((s) => ({ y: s.y, ax: s.xmax * 0.75, az: (s.zhi - s.zlo) / 2 * 0.75, cz: (s.zhi + s.zlo) / 2 }));
  return View.core;
}

// 腕（前腕・手・上腕）が胴体の芯や太ももの芯に入っていないか
function inspectSelf(id, n) {
  n = n || 100;
  setPlaying(false);
  selectExercise(id);
  if (!View.ex) return { error: `種目がありません: ${id}` };
  View.state = {};
  const rig = View.rig, core = torsoCore();
  const res = {};
  const THIGH_R = 0.05;
  for (const t of framesOf(n)) {
    const s = solveAt(t);
    const inv = (b) => ({ R: M3.T(s.bones[b].R), t: s.bones[b].t });
    const Tp = inv(0), Tt = inv(22);
    const thighs = ["R", "L"].map((k) => {
      const sd = rig.sides[k], b = BONE[k].thigh;
      return { a: applyT(s.bones[b], sd.H), b: applyT(s.bones[b], sd.K), name: k === "R" ? "右太もも" : "左太もも" };
    });
    skinFast(View.parts, bodyDQ(s), s.gripLR, (p) => !PELVIS_PARTS[p.id], (p, i, x, y, z) => {
      const slot = p.bones[i * 3], w0 = p.bones[i * 3 + 2];
      if (slot < 8 || slot > 13 || w0 < 0.9) return;
      // 上腕の付け根（肩）は胴の隣にあるのが普通なので除く
      if (slot === 8 || slot === 11) {
        const sd = rig.sides[slot === 8 ? "R" : "L"];
        const v = [p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]];
        if (V.dot(V.sub(v, sd.S), sd.uHat) < sd.Lu * 0.35) return;
      }
      const w = [x, y, z];
      // 胴体：胸郭と骨盤それぞれの静止姿勢の座標に戻して、芯の楕円に入っているか
      for (const T of [Tt, Tp]) {
        const q = M3.apply(T.R, V.sub(w, T.t));
        const k = Math.round((q[1] - core[0].y) / 0.05);
        if (k < 0 || k >= core.length) continue;
        const c = core[k];
        const rho = Math.hypot(q[0] / c.ax, (q[2] - c.cz) / c.az);
        if (rho >= 1) continue;
        const d = (1 - rho) * Math.min(c.ax, c.az);
        const key = `${REGION_NAMES[slot]}→胴体`;
        if (!res[key] || d > res[key].depth) res[key] = { depth: d, t, limit: LIMIT.self };
      }
      for (const th of thighs) {
        const d = THIGH_R - segDist(w, th.a, th.b);
        if (d <= 0) continue;
        const key = `${REGION_NAMES[slot]}→${th.name}`;
        if (!res[key] || d > res[key].depth) res[key] = { depth: d, t, limit: LIMIT.self };
      }
    });
  }
  return summarize(res);
}

// コマ間の腕の骨の行列の変化量。中央値の3倍を超える跳ねを探す
function inspectSmooth(id, n) {
  n = n || 100;
  setPlaying(false);
  selectExercise(id);
  if (!View.ex) return { error: `種目がありません: ${id}` };
  View.state = {};
  const bones = [8, 9, 10, 11, 12, 13];
  const steps = Object.fromEntries(bones.map((b) => [b, []]));
  let prev = null;
  for (const t of framesOf(n)) {
    const s = solveAt(t);
    if (prev) for (const b of bones) {
      const A = s.bones[b], B = prev.bones[b];
      let dr = 0;
      for (let k = 0; k < 9; k++) dr += (A.R[k] - B.R[k]) ** 2;
      steps[b].push({ t, d: Math.sqrt(dr) + V.dist(A.t, B.t) / 0.1 });
    }
    prev = s;
  }
  const out = { ok: true, bones: {} };
  for (const b of bones) {
    const ds = steps[b].map((x) => x.d).sort((a, c) => a - c);
    const med = ds[Math.floor(ds.length / 2)];
    // 中央値の3倍超。ただし、ほとんど動かない骨のわずかな揺れ（0.02 未満）は跳ねとしない
    const jumps = steps[b].filter((x) => x.d > med * 3 && x.d > SMOOTH_MIN).map((x) => ({ t: x.t, ratio: x.d / (med || 1e-9), d: x.d }));
    out.bones[REGION_NAMES[b]] = { median: med, max: ds[ds.length - 1], jumps };
    if (jumps.length) out.ok = false;
  }
  return out;
}

function summarize(res) {
  const items = Object.entries(res).map(([key, v]) => ({ key, depth: v.depth, t: v.t, limit: v.limit, ok: v.depth <= v.limit }))
    .sort((a, b) => b.depth / b.limit - a.depth / a.limit);
  return { ok: items.every((x) => x.ok), items };
}

window.__check = inspectCheck;
window.__self = inspectSelf;
window.__smooth = inspectSmooth;
