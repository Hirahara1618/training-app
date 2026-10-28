"use strict";
// 種目の定義で共通に使う器具と計算
//
// 種目の定義:
// { id, roles: {main:[役割], sub:[…], support:[…]}, cam: {target, dist, yaw?:最初の向き}, start?: 0|1, barPath?: true,
//   seat?: {x:[左,右], z:[前,後]}  … この範囲で t=0 の体の最低点を測り、fit.seatTop に入れる
//   pose(t, fit), props(fit) }
// fit には静止姿勢の体の寸法を測る関数と、座面の高さが入る。

const EXERCISES = {};
function defineExercise(def) { EXERCISES[def.id] = def; }

// 静止姿勢の骨盤（股関節の中心）から肩までのずれを、胴の角度 th で回したもの [z, y]
function torsoOffset(rig, th, spine, sg) {
  const s = rig.sides[sg < 0 ? "R" : "L"];
  const a = V.sub(rig.SP, rig.hipC);
  const b = M3.apply(M3.rx(spine || 0), V.sub(s.S, rig.SP));
  const o = M3.apply(M3.rx(th), V.add(a, b));
  return [o[2], o[1]];
}

// 肩をこの位置（[z,y]）に置く胴の角度 th のときの骨盤の位置 [z,y]
function hipFromShoulder(rig, th, S, spine) {
  const o = torsoOffset(rig, th, spine, -1);
  return [S[0] - o[0], S[1] - o[1]];
}

// 腕を伸ばしたときの、肩から握る位置までの横から見た長さ（握り幅 gx のとき）
function sideReach(rig, gx, slack) {
  const r = armReach(rig) * (slack || 0.985);
  const dx = Math.abs(gx) - Math.abs(rig.sides.R.S[0]);
  return Math.sqrt(Math.max(0.01, r * r - dx * dx));
}

function lerp3(a, b, t) { return V.lerp(a, b, t); }
function mix2(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]; }

// 鉄パイプ（フレーム）
function tube(a, b, r, color) { return { cyl: { a, b, r: r || 0.022 }, color: color || "steel" }; }
// 床に置く脚（横に渡したパイプと、両端のゴムの足）
function floorFoot(x0, x1, z) {
  return [tube([x0, 0.035, z], [x1, 0.035, z], 0.025), ...[x0, x1].map((x) => ({ box: { c: [x, 0.012, z], s: [0.06, 0.024, 0.08] }, color: "rubber", nocheck: true }))];
}

// 平らなベンチ：座面（PAD）と、パイプの脚（両端に床の足）
function flatBench(top, z0, z1, width) {
  const w = width || 0.28, zc = (z0 + z1) / 2, len = Math.abs(z1 - z0), sg = Math.sign(z1 - z0);
  const za = z0 + 0.12 * sg, zb = z1 - 0.12 * sg, under = top - 0.075;
  return [
    { box: { c: [0, top - 0.035, zc], s: [w, 0.07, len] }, color: "pad", pad: true },
    { box: { c: [0, under - 0.02, zc], s: [w * 0.75, 0.04, len * 0.92] }, color: "steel", nocheck: true },
    tube([0, 0.05, za], [0, under - 0.03, za], 0.03), tube([0, 0.05, zb], [0, under - 0.03, zb], 0.03),
    ...floorFoot(-0.22, 0.22, za), ...floorFoot(-0.22, 0.22, zb),
  ];
}

// ウエイトスタック：ガイドの棒2本と、重ねたプレート、上のふた（x, z が中心、ax はプレートの長い向き）
function weightStack(x, z, h, ax) {
  ax = ax || [1, 0, 0];
  const items = [], w = 0.32, alongX = Math.abs(ax[0]) > 0.5;
  const at = (u, y) => [x + ax[0] * u, y, z + ax[2] * u];
  const size = (a, b, c) => (alongX ? [a, b, c] : [c, b, a]);
  for (const u of [-0.11, 0.11]) items.push(tube(at(u, 0.04), at(u, h), 0.01, "metal"));
  for (let k = 0; k < 14; k++) {
    const y = 0.06 + k * 0.028;
    items.push({ box: { c: at(0, y + 0.012), s: size(w, 0.024, 0.12) }, color: "plate", nocheck: true });
  }
  items.push({ box: { c: at(0, 0.06 + 14 * 0.028 + 0.03), s: size(w, 0.05, 0.13) }, color: "steel", nocheck: true });
  items.push({ box: { c: at(0, 0.02), s: size(w + 0.1, 0.04, 0.2) }, color: "steel", nocheck: true });
  return items;
}

// 柱（床から高さ h、角パイプ）
function post(x, z, h, size) {
  const s = size || 0.06;
  return { box: { c: [x, h / 2, z], s: [s, h, s] }, color: "steel" };
}

// ---- 手に持つ器具（静止姿勢の手の位置で作り、手と一緒に動く：骨18=右, 19=左）----
// 軸は手の「人差し指→小指」の向き（握る位置 Cb を通る）
function heldItems(rig, sides, build) {
  const items = [];
  for (const side of sides) {
    const h = rig.hand[side], bone = side === "R" ? 18 : 19;
    for (const it of build(h)) items.push(Object.assign(it, { bone }));
  }
  return items;
}
function dumbbells(rig, sides, plateR) {
  const r = plateR || 0.065;
  return heldItems(rig, sides || ["R", "L"], (h) => {
    const at = (s) => V.add(h.Cb, V.scale(h.a0, s));
    return [
      { cyl: { a: at(-0.07), b: at(0.07), r: 0.016 }, color: "metal" },
      { cyl: { a: at(-0.105), b: at(-0.07), r }, color: "plate" },
      { cyl: { a: at(0.07), b: at(0.105), r }, color: "plate" },
    ];
  });
}
// D ハンドル：握る棒と、手の甲の側へ回る輪
function dHandles(rig, sides) {
  return heldItems(rig, sides || ["R", "L"], (h) => {
    const at = (s, back) => V.add(V.add(h.Cb, V.scale(h.a0, s)), V.scale(h.p0, -back));
    return [
      { cyl: { a: at(-0.06, 0), b: at(0.06, 0), r: 0.016 }, color: "metal" },
      { cyl: { a: at(-0.06, 0), b: at(0, 0.075), r: 0.006 }, color: "metal" },
      { cyl: { a: at(0.06, 0), b: at(0, 0.075), r: 0.006 }, color: "metal" },
    ];
  });
}

// ---- 体に合わせた座面・背もたれ ----
// fit[name] = {n, d}（面 dot(x,n)=d、n は体の側）。anchor（世界座標）を面に投影した点を中心に、
// 大きさ size=[幅, 厚み, 長さ] の箱を、上の面が体の側を向くように置く。offset は面に沿ったずれ [x, 長さ方向]
function padOn(fp, anchor, size, offset, moving) {
  const n = fp.n;
  const rx = Math.atan2(n[2], n[1]);
  const along = [0, -Math.sin(rx), Math.cos(rx)];
  let c = V.add(anchor, V.scale(n, fp.d - V.dot(anchor, n)));
  if (offset) c = V.add(V.add(c, [offset[0], 0, 0]), V.scale(along, offset[1] || 0));
  c = V.sub(c, V.scale(n, size[1] / 2));
  // moving にバーの t=0 の位置を渡すと、バーと一緒に動く座面になる（骨15。中心はバーからの相対）
  if (moving) c = V.sub(c, moving);
  return { box: { c, s: size, rx }, color: "pad", pad: true, bone: moving ? 15 : 14 };
}

// ケーブルタワー：滑車 p の奥（体から離れる向き）に、2本柱の枠とウエイトスタック。
// 滑車は枠から伸びる腕の先にある（体や器具の動く範囲に柱が入らないように）
function cableTower(p, dist) {
  let away = [p[0], 0, p[2]];
  if (V.len(away) < 0.05) away = [0, 0, 1];
  away = V.norm(away);
  const side = [away[2], 0, -away[0]];
  const T = V.add([p[0], 0, p[2]], V.scale(away, dist || 0.42));
  const at = (u, y) => V.add(V.add(T, V.scale(side, u)), [0, y, 0]);
  const items = [];
  for (const u of [-0.22, 0.22]) items.push({ box: { c: at(u, 1.15), s: [0.06, 2.3, 0.06] }, color: "steel" });
  items.push(tube(at(-0.22, 2.28), at(0.22, 2.28), 0.03));
  items.push(tube(at(-0.22, 0.04), at(0.22, 0.04), 0.03));
  items.push({ box: { c: at(0, 0.012), s: [0.7, 0.024, 0.7] }, color: "rubber", nocheck: true });
  items.push(...weightStack(T[0], T[2], 1.6, side));
  // 腕：枠から滑車まで（枠の高さ位置には横の梁）
  items.push(tube(at(0, p[1]), V.add(p, V.scale(away, 0.05)), 0.028));
  items.push(tube(at(-0.22, p[1]), at(0.22, p[1]), 0.03));
  // 滑車（車輪と両側の板）
  items.push({ cyl: { a: V.add(p, V.scale(side, -0.018)), b: V.add(p, V.scale(side, 0.018)), r: 0.045 }, color: "metal" });
  for (const sg of [-1, 1]) items.push({ cyl: { a: V.add(p, V.scale(side, sg * 0.022)), b: V.add(p, V.scale(side, sg * 0.03)), r: 0.055 }, color: "steel", nocheck: true });
  return items;
}
function cableItems(n) {
  const out = [];
  for (let k = 0; k < (n || 1); k++) out.push({ cyl: { a: [0, 0, 0], b: [0, 1, 0], r: 0.004 }, bone: 16 + k, color: "cable", touches: [15, 18, 19, 20, 21] });
  return out;
}
function ropeItems() {
  return [20, 21].map((bone) => ({ cyl: { a: [0, 0, 0], b: [0, 1, 0], r: 0.011 }, bone, color: "cable", touches: [16, 17, 18, 19] }));
}
// 点 b から a の向きへ d だけ寄せた点（ケーブルを握りこぶしの手前で止める）
function toward(b, a, d) { return V.add(b, V.scale(V.norm(V.sub(a, b)), d)); }

// 方向の球面補間（腕を円弧で動かすとき）
function slerpDir(a, b, t) {
  a = V.norm(a); b = V.norm(b);
  const w = Math.acos(clamp(V.dot(a, b), -1, 1));
  if (w < 1e-5) return a;
  return V.add(V.scale(a, Math.sin((1 - t) * w) / Math.sin(w)), V.scale(b, Math.sin(t * w) / Math.sin(w)));
}
// 中心 c から半径 r の円弧上の点（向き d0 → d1）
function arcPoint(c, d0, d1, t, r) { return V.add(c, V.scale(slerpDir(d0, d1, t), r)); }

// 静止姿勢の、肘から握る位置までの長さ
function forearmReach(rig) { const s = rig.sides.R; return V.dist(s.E, rig.hand.R.Cb); }

// 胴の角度 th のときの「体の上」「体の前」の向き（世界座標）
function torsoUp(th) { return [0, Math.cos(th), Math.sin(th)]; }
function torsoFront(th) { return [0, -Math.sin(th), Math.cos(th)]; }

// ---- 座る種目 ----
// 座面（上向き）と背もたれ（胴の前の向き）を t=0 の体に合わせる指定
function seatFits(hip, th, opts) {
  opts = opts || {};
  const f = [{ name: "seat", n: [0, 1, 0], x: [-0.2, 0.2], z: [hip[0] - 0.16, hip[0] + 0.24], slots: [0, 2, 5] }];
  if (opts.back !== false) f.push({ name: "back", n: torsoFront(th), slots: [14, 0], y: [hip[1] + (opts.backFrom || 0.12), 3] });
  return f;
}
// 座面・背もたれの器具（seatFits と組で使う）
function seatProps(fit, hip, opts) {
  opts = opts || {};
  const items = [];
  const top = fit.seat.d;
  items.push(padOn(fit.seat, [0, top, hip[0] + 0.04], [0.4, 0.08, opts.seatLen || 0.4]));
  items.push(tube([0, 0.05, hip[0] + 0.04], [0, Math.max(0.06, top - 0.09), hip[0] + 0.04], 0.035), ...floorFoot(-0.24, 0.24, hip[0] + 0.04));
  if (fit.back) {
    const a = fit.s0.sk.onThorax([0, opts.backY || 1.12, 0]);
    const pad = padOn(fit.back, a, [opts.backWidth || 0.32, 0.07, opts.backLen || 0.62]);
    items.push(pad);
    // 背もたれの支え（床から背もたれの裏まで）
    const c = pad.box.c, n = fit.back.n;
    const behind = V.sub(c, V.scale(n, 0.08));
    items.push(tube([0, 0.05, behind[2]], [0, behind[1], behind[2]], 0.03), ...floorFoot(-0.24, 0.24, behind[2]));
  }
  return items;
}
// 座ったときの脚（太ももをほぼ水平に、足を床に）
function seatedLegs(rig, hip, o) {
  o = o || {};
  const leg = { ankle: [hip[0] + (o.reach || 0.44), rig.sides.R.A[1]], x: o.x || 0.13, abd: o.abd == null ? 0.08 : o.abd };
  return { R: leg, L: leg };
}
// 寝たとき（仰向け）の股関節の高さ：床（またはマット）の上に背中が乗る
function supineHipY(fit, floorY) { return (floorY || 0) + fit.rig.hipC[2] - fit.backMin - 0.008; }
// 立ったときの脚
function standLegs(x, abd) { const l = { x: x || 0.11, abd: abd == null ? 0.1 : abd }; return { R: l, L: l }; }
// 静止姿勢の股関節の中心（立った姿勢）[z, y]
function standHip(rig) { return [rig.hipC[2], rig.hipC[1]]; }
// レバー（伸び縮みする円柱、骨16,17）
function leverItems(n, r) {
  const out = [];
  for (let k = 0; k < (n || 2); k++) out.push({ cyl: { a: [0, 0, 0], b: [0, 1, 0], r: r || 0.02 }, bone: 16 + k, color: "steel", touches: [15, 18, 19, 20, 21] });
  return out;
}
// 短いバー（カール・プレスダウン用。プレートは小さめ）
function shortBar(len, plateR) {
  const h = (len || 1.2) / 2;
  const items = [{ cyl: { a: [-h, 0, 0], b: [h, 0, 0], r: 0.014 }, bone: 15, color: "metal" }];
  if (plateR) for (const s of [-1, 1]) items.push({ cyl: { a: [s * (h - 0.12), 0, 0], b: [s * (h - 0.08), 0, 0], r: plateR }, bone: 15, color: "plate" });
  return items;
}
