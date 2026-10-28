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

// 平らなベンチ：座面（PAD）と脚
function flatBench(top, z0, z1, width) {
  const w = width || 0.28, zc = (z0 + z1) / 2, len = Math.abs(z1 - z0);
  return [
    { box: { c: [0, top - 0.035, zc], s: [w, 0.07, len] }, color: "pad", pad: true },
    { box: { c: [0, (top - 0.07) / 2, zc], s: [0.07, top - 0.07, len * 0.8] }, color: "frame" },
    { box: { c: [0, 0.02, z0 + 0.08 * Math.sign(z1 - z0)], s: [0.4, 0.04, 0.06] }, color: "frame" },
    { box: { c: [0, 0.02, z1 - 0.08 * Math.sign(z1 - z0)], s: [0.4, 0.04, 0.06] }, color: "frame" },
  ];
}

// 柱（床から高さ h）
function post(x, z, h, size) {
  const s = size || 0.06;
  return { box: { c: [x, h / 2, z], s: [s, h, s] }, color: "frame" };
}
