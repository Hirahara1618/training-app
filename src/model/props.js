"use strict";
// 器具のメッシュ（箱・円柱・チューブ）と、器具の骨（14–21）の行列（CLAUDE.md 6.5）
//
// 器具の定義（種目の props が返す配列の要素）
//   { box: {c:[x,y,z], s:[幅,高さ,奥行], rx?:x軸回転}, bone?:14, color, pad?:true }   pad=座面（体を押し出す）
//   { cyl: {a:[...], b:[...], r}, bone?, color }
//   { tube: {pts:[[...],...], r}, bone?, color }
// 骨15（バー）はバーの中心を原点に、16/17（ケーブル）は (0,0,0)→(0,1,0) の単位円柱で作る。
// 18/19（手に持つ器具）は静止姿勢の手の位置で作る。

const PROP_COLORS = {
  floor: [0.2, 0.22, 0.25],
  pad: [0.16, 0.17, 0.2],
  frame: [0.36, 0.38, 0.42],
  metal: [0.68, 0.7, 0.73],
  plate: [0.12, 0.12, 0.14],
  cable: [0.08, 0.08, 0.09],
  path: [0.98, 0.78, 0.25],
};

function propMesh(items, segs) {
  segs = segs || (IS_MOBILE ? 12 : 18);
  const pos = [], nrm = [], col = [], bone = [], idx = [];
  const boxes = [], cyls = [];
  const vert = (p, n, c, b) => { pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]); col.push(c[0] * 255, c[1] * 255, c[2] * 255); bone.push(b); return pos.length / 3 - 1; };

  for (const it of items) {
    const c = PROP_COLORS[it.color] || it.color || PROP_COLORS.frame;
    const b = it.bone == null ? 14 : it.bone;
    if (it.box) {
      const { c: ctr, s, rx } = it.box;
      const R = M3.rx(rx || 0), h = V.scale(s, 0.5);
      const faces = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
        [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
      for (const [n, u, w] of faces) {
        const base = pos.length / 3;
        for (const [su, sw] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const l = [0, 1, 2].map((k) => n[k] * h[k] + u[k] * su * h[k] + w[k] * sw * h[k]);
          vert(V.add(ctr, M3.apply(R, l)), M3.apply(R, n), c, b);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      boxes.push({ c: ctr, h, rx: rx || 0, pad: !!it.pad, bone: b });
    } else if (it.cyl) {
      const { a, b: e, r } = it.cyl;
      addTube(vert, idx, [a, e], r, c, b, segs, true);
      cyls.push({ a, b: e, r, bone: b });
    } else if (it.tube) {
      addTube(vert, idx, it.tube.pts, it.tube.r, c, b, 8, false);
    }
  }
  return {
    pos: new Float32Array(pos), nrm: new Float32Array(nrm), col: new Uint8Array(col), bone: new Float32Array(bone),
    idx: new Uint16Array(idx), ni: idx.length, boxes, cyls,
  };
}

// 折れ線に沿った管（caps=true なら両端にふた）
function addTube(vert, idx, pts, r, c, b, segs, caps) {
  const rings = [];
  for (let i = 0; i < pts.length; i++) {
    const d = V.norm(V.sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
    const u = V.norm(V.perp(Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], d));
    const w = V.cross(d, u);
    const ring = [];
    for (let k = 0; k < segs; k++) {
      const t = (k / segs) * Math.PI * 2;
      const n = V.add(V.scale(u, Math.cos(t)), V.scale(w, Math.sin(t)));
      ring.push(vert(V.add(pts[i], V.scale(n, r)), n, c, b));
    }
    rings.push({ ring, d });
  }
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let k = 0; k < segs; k++) {
      const a = rings[i].ring[k], bb = rings[i].ring[(k + 1) % segs], cc = rings[i + 1].ring[(k + 1) % segs], dd = rings[i + 1].ring[k];
      idx.push(a, bb, cc, a, cc, dd);
    }
  }
  if (caps) {
    for (const [i, sgn] of [[0, -1], [pts.length - 1, 1]]) {
      const n = V.scale(rings[i].d, sgn);
      const center = vert(pts[i], n, c, b);
      const ring = [];
      for (let k = 0; k < segs; k++) {
        const t = (k / segs) * Math.PI * 2;
        const d = rings[i].d, u = V.norm(V.perp(Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], d)), w = V.cross(d, u);
        ring.push(vert(V.add(pts[i], V.scale(V.add(V.scale(u, Math.cos(t)), V.scale(w, Math.sin(t))), r)), n, c, b));
      }
      for (let k = 0; k < segs; k++) idx.push(center, ring[k], ring[(k + 1) % segs]);
    }
  }
}

// ---- よく使う器具 ----
const PLATE_X = [0.68, 0.725];  // プレートの内側・外側（バーの中心から）

function barbell() {
  const items = [{ cyl: { a: [-1.1, 0, 0], b: [1.1, 0, 0], r: 0.014 }, bone: 15, color: "metal" }];
  for (const s of [-1, 1]) {
    items.push({ cyl: { a: [s * 0.64, 0, 0], b: [s * 1.1, 0, 0], r: 0.025 }, bone: 15, color: "metal" });
    items.push({ cyl: { a: [s * 0.64, 0, 0], b: [s * 0.665, 0, 0], r: 0.038 }, bone: 15, color: "metal" });
    items.push({ cyl: { a: [s * PLATE_X[0], 0, 0], b: [s * PLATE_X[1], 0, 0], r: 0.225 }, bone: 15, color: "plate" });
  }
  return items;
}

function floorMat() { return [{ box: { c: [0, -0.01, 0.1], s: [1.8, 0.02, 2.6] }, color: "floor" }]; }

// バーの軌道線：t=0〜1 のバーの中心の通り道を、プレートの外側に細いチューブで描く
function barPathItems(points) {
  const items = [];
  for (const s of [-1, 1]) items.push({ tube: { pts: points.map((p) => [p[0] + s * (PLATE_X[1] + 0.03), p[1], p[2]]), r: 0.005 }, color: "path" });
  return items;
}

// ---- 器具の骨の行列（列優先 4×4 を 8本）----
function equipMats(solved) {
  const out = new Float32Array(128);
  const put = (i, m) => out.set(m, (i - 14) * 16);
  const I = mat4FromRT(M3.I(), [0, 0, 0]);
  for (let i = 14; i < 22; i++) put(i, I);
  if (solved.extra.bar) put(15, mat4FromRT(M3.I(), solved.extra.bar));
  (solved.cables || []).slice(0, 2).forEach(([a, b], k) => {
    // 単位円柱 (0,0,0)→(0,1,0) を a→b に伸ばす
    const d = V.sub(b, a);
    const u = V.norm(V.perp(Math.abs(d[1]) / (V.len(d) || 1) < 0.9 ? [0, 1, 0] : [1, 0, 0], V.norm(d)));
    const x = V.norm(V.cross(d, u)), z = V.norm(V.cross(x, d));
    put(16 + k, [x[0], x[1], x[2], 0, d[0], d[1], d[2], 0, z[0], z[1], z[2], 0, a[0], a[1], a[2], 1]);
  });
  put(18, mat4FromRT(solved.bones[10].R, solved.bones[10].t));
  put(19, mat4FromRT(solved.bones[13].R, solved.bones[13].t));
  return out;
}

// ---- 体の骨のデュアルクォータニオン（シェーダーに渡す並び）----
function bodyDQ(solved) {
  const out = new Float32Array(120);
  BODY_BONES.forEach((b, slot) => {
    const T = solved.bones[b];
    const { r, d } = dqFrom(T.R, T.t);
    out.set(r, slot * 8);
    out.set(d, slot * 8 + 4);
  });
  return out;
}

// CPU 側で体の頂点を動かす（シェーダーと同じ式）。fn(part, i, [x,y,z]) を頂点ごとに呼ぶ
function skinParts(parts, dq, grip, filter, fn) {
  const R = (s) => [dq[s * 8], dq[s * 8 + 1], dq[s * 8 + 2], dq[s * 8 + 3]];
  const D = (s) => [dq[s * 8 + 4], dq[s * 8 + 5], dq[s * 8 + 6], dq[s * 8 + 7]];
  for (const p of parts) {
    if (filter && !filter(p)) continue;
    const n = p.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const s0 = p.bones[i * 3], s1 = p.bones[i * 3 + 1], w0 = p.bones[i * 3 + 2], w1 = 1 - w0;
      const g = p.extra[i * 2 + 1] * (s0 === 10 ? grip[0] : grip[1]);
      const v = [0, 1, 2].map((k) => p.pos[i * 3 + k] + (p.p2[i * 3 + k] - p.pos[i * 3 + k]) * g);
      let r0 = R(s0), d0 = D(s0), r1 = R(s1), d1 = D(s1), out;
      if (p.extra[i * 2] > 0.5) {
        out = V.add(V.scale(dqPoint(r0, d0, v), w0), V.scale(dqPoint(r1, d1, v), w1));
      } else {
        if (r0[0] * r1[0] + r0[1] * r1[1] + r0[2] * r1[2] + r0[3] * r1[3] < 0) { r1 = r1.map((x) => -x); d1 = d1.map((x) => -x); }
        const r = r0.map((x, k) => x * w0 + r1[k] * w1), d = d0.map((x, k) => x * w0 + d1[k] * w1);
        const l = Math.hypot(...r);
        out = dqPoint(r.map((x) => x / l), d.map((x) => x / l), v);
      }
      fn(p, i, out);
    }
  }
}
