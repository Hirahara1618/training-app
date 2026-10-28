"use strict";
// 脚の種目（前もも・もも裏・お尻・ふくらはぎ）

// バーを僧帽筋の上に担ぐ（スクワット・グッドモーニング）
function backBar(fit) {
  const barY = fit.rig.c7[1] - 0.06;
  const rest = [0, barY, fit.backZ(barY) - 0.02];
  return (sk) => sk.onThorax(rest);
}
function backBarHands() {
  return { hands: (sg, sk, bar) => [sg * 0.3, bar[1] + 0.005, bar[2] + 0.01], pole: (sg) => [sg * 0.35, -1, -0.55], grip: 1 };
}

// バックスクワット（ハイバー）。t=0 立った姿勢、t=1 しゃがんだ底
defineExercise({
  id: "squat",
  roles: { main: ["quads"], sub: ["glutes", "adductors"], support: ["abs", "erectors", "hams"] },
  cam: { target: [0, 0.82, 0], dist: 3.7 },
  barPath: true,
  pose(t, fit) {
    const e = ease(t), rig = fit.rig;
    const leg = { x: 0.15, abd: lerp(0.28, 0.42, e) };
    return Object.assign({
      hip: mix2([rig.hipC[2] - 0.005, rig.hipC[1] - 0.005], [-0.14, 0.44], e),
      trunk: lerp(0.04, 0.78, e), head: lerp(-0.02, -0.45, e),
      legs: { R: leg, L: leg }, bar: backBar(fit),
    }, backBarHands());
  },
  props() { return [...floorMat(), ...barbell()]; },
});

// フロントスクワット：バーを肩の前に乗せ、ひじを高く。上体は立てたまま
defineExercise({
  id: "c_frontsq",
  roles: { main: ["quads"], sub: ["glutes", "adductors"], support: ["abs", "erectors"] },
  cam: { target: [0, 0.82, 0], dist: 3.7 },
  barPath: true,
  pose(t, fit) {
    const e = ease(t), rig = fit.rig;
    const leg = { x: 0.15, abd: lerp(0.28, 0.42, e) };
    const rest = [0, 1.36, fit.frontZ(1.36) + 0.06];
    return {
      hip: mix2([rig.hipC[2] - 0.005, rig.hipC[1] - 0.005], [-0.07, 0.43], e),
      trunk: lerp(0.02, 0.4, e), head: lerp(0, -0.3, e),
      legs: { R: leg, L: leg },
      bar: (sk) => sk.onThorax(rest),
      elbow: (sg, sk) => V.add(sk.shoulder(sg), V.scale(V.norm(sk.dir(22, [sg * 0.25, -0.15, 1])), rig.sides.R.Lu)),
      hands: (sg, sk, bar) => [sg * 0.2, bar[1] + 0.005, bar[2] - 0.005],
      pole: (sg, sk) => sk.dir(22, [sg * 0.2, -1, 0]),
      grip: 0.4,
    };
  },
  props() { return [...floorMat(), ...barbell()]; },
});

// ゴブレットスクワット：ダンベル1本を縦に胸の前で持つ
defineExercise({
  id: "c_goblet",
  roles: { main: ["quads"], sub: ["glutes", "adductors"], support: ["abs", "erectors", "forearms"] },
  cam: { target: [0, 0.8, 0], dist: 3.5, yaw: 0.6 },
  pose(t, fit) {
    const e = ease(t), rig = fit.rig;
    const leg = { x: 0.17, abd: lerp(0.32, 0.45, e) };
    const rest = [0, 1.16, fit.frontZ(1.16) + 0.13];
    return {
      hip: mix2([rig.hipC[2] - 0.005, rig.hipC[1] - 0.005], [-0.06, 0.41], e),
      trunk: lerp(0.04, 0.38, e), head: lerp(0, -0.3, e),
      legs: { R: leg, L: leg },
      bar: (sk) => sk.onThorax(rest),
      hands: (sg, sk, bar) => V.add(bar, [sg * 0.055, 0.085, -0.01]),
      pole: (sg) => [sg * 0.25, -1, 0.2],
      palm: (sg) => [-sg, 0.4, -0.2],
      grip: 0.5,
    };
  },
  props: () => [
    ...floorMat(),
    { cyl: { a: [0, -0.07, 0], b: [0, 0.07, 0], r: 0.016 }, bone: 15, color: "metal" },
    { cyl: { a: [0, -0.11, 0], b: [0, -0.07, 0], r: 0.1 }, bone: 15, color: "plate" },
    { cyl: { a: [0, 0.07, 0], b: [0, 0.11, 0], r: 0.1 }, bone: 15, color: "plate" },
  ],
});

// 片脚を前に出してしゃがむ（ブルガリアンスクワット・ランジ）。ダンベルを両手に下げる
function splitSquat(id, o) {
  defineExercise({
    id, roles: o.roles,
    cam: { target: [0, 0.75, -0.05], dist: 3.5, yaw: 1.35 },
    pose(t, fit) {
      const rig = fit.rig, e = ease(t);
      return {
        hip: mix2(o.hip0, o.hip1, e), trunk: lerp(0.08, 0.18, e), head: -0.05,
        legs: { R: { ankle: o.front, x: 0.12, abd: 0.08 }, L: Object.assign({ x: 0.1, abd: 0 }, o.rear) },
        hands: (sg, sk) => { const S = sk.shoulder(sg), L = sideReach(fit.rig, Math.abs(S[0]) + 0.07, 0.985); return [S[0] + sg * 0.07, S[1] - L, S[2] + 0.02]; },
        pole: (sg) => [sg * 0.2, 0, -1],
        palm: (sg) => [-sg, 0, 0],
        grip: 1,
      };
    },
    props: (fit) => [...floorMat(), ...(o.bench || []), ...dumbbells(fit.rig, ["R", "L"], 0.055)],
  });
}
const SPLIT_ROLES = { main: ["quads", "glutes"], sub: ["adductors", "hams"], support: ["abs", "calves", "forearms"] };
splitSquat("bss", {
  roles: SPLIT_ROLES, hip0: [-0.02, 0.75], hip1: [-0.06, 0.46], front: [0.28, 0.054],
  rear: { ankle: [-0.64, 0.47], foot: { shin: 1.3 } },
  bench: [{ box: { c: [0.08, 0.39, -0.76], s: [0.45, 0.06, 0.3] }, color: "pad", pad: true }, { box: { c: [0.08, 0.18, -0.76], s: [0.07, 0.36, 0.07] }, color: "frame" }],
});
splitSquat("c_lunge", {
  roles: SPLIT_ROLES, hip0: [-0.03, 0.72], hip1: [-0.03, 0.43], front: [0.32, 0.054],
  rear: { ankle: [-0.38, 0.09], foot: 0.6 },
});

// 座って脚で押す（レッグプレス・カーフレイズ）
const LEGPRESS = { hip: [0.0, 0.55], th: -0.45 };
function legPressBase(rig) { return { hip: LEGPRESS.hip, trunk: LEGPRESS.th, head: 0.15 }; }
function legPressHands() {
  return { hands: (sg) => [sg * 0.29, LEGPRESS.hip[1] - 0.02, LEGPRESS.hip[0] + 0.05], pole: (sg) => [sg * 0.4, 0, -1], knuckles: [0, 0, -1], grip: 1 };
}
function legPressProps(fit) {
  const items = [...floorMat(), ...seatProps(fit, LEGPRESS.hip, { backLen: 0.75, backY: 1.15 })];
  for (const s of [-1, 1]) items.push({ cyl: { a: [s * 0.29, LEGPRESS.hip[1] - 0.02, -0.08], b: [s * 0.29, LEGPRESS.hip[1] - 0.02, 0.16], r: 0.016 }, color: "metal", grip: true });
  return items;
}
// 足の裏の台（骨15、足首の位置が原点）。足の裏が +z を向くとき
function footPlate(z) { return [{ box: { c: [0, 0.05, z || 0.075], s: [0.62, 0.55, 0.03] }, bone: 15, color: "frame", label: "足の台" }]; }

defineExercise({
  id: "c_legpress",
  roles: { main: ["quads"], sub: ["glutes", "adductors"], support: ["hams", "calves"] },
  cam: { target: [0, 0.7, 0.35], dist: 3.4, yaw: 1.2 },
  fitPads: seatFits(LEGPRESS.hip, LEGPRESS.th),
  start: 1,
  pose(t, fit) {
    const e = ease(t), A = mix2([0.4, 0.71], [0.715, 0.66], e);
    const leg = { ankle: A, x: 0.13, abd: lerp(0.3, 0.12, e), foot: -Math.PI / 2 };
    return Object.assign(legPressBase(fit.rig), { legs: { R: leg, L: leg }, bar: [0, A[1], A[0]] }, legPressHands());
  },
  props: (fit) => [...legPressProps(fit), ...footPlate()],
});

// アングルド・レッグ・プレス：45°の台を押し上げる
const ALP = { hip: [0.0, 0.45], th: -1.15 };
const RAIL = [Math.SQRT1_2, Math.SQRT1_2]; // [z, y]
defineExercise({
  id: "alp",
  roles: { main: ["quads"], sub: ["glutes", "adductors"], support: ["hams", "calves"] },
  cam: { target: [0, 0.75, 0.4], dist: 3.6, yaw: 1.3 },
  fitPads: seatFits(ALP.hip, ALP.th, { backFrom: 0.08 }),
  start: 1,
  pose(t, fit) {
    const e = ease(t), d = lerp(0.42, 0.74, e);
    const A = [ALP.hip[0] + RAIL[0] * d, ALP.hip[1] + RAIL[1] * d];
    const leg = { ankle: A, x: 0.13, abd: lerp(0.3, 0.12, e), foot: -2.356 };
    return {
      hip: ALP.hip, trunk: ALP.th, head: 0.35, legs: { R: leg, L: leg }, bar: [0, A[1], A[0]],
      hands: (sg) => [sg * 0.3, ALP.hip[1] + 0.02, ALP.hip[0] - 0.02], pole: (sg) => [sg * 0.4, 0, -1], knuckles: [0, 0, -1], grip: 1,
    };
  },
  props(fit) {
    const items = [...floorMat(), ...seatProps(fit, ALP.hip, { backLen: 0.8, backY: 1.1 })];
    const off = 0.075;
    items.push({ box: { c: [0, RAIL[1] * off, RAIL[0] * off], s: [0.62, 0.03, 0.55], rx: -2.356 }, bone: 15, color: "frame", label: "足の台" });
    for (const s of [-1, 1]) {
      items.push({ cyl: { a: [s * 0.4, 0.25, 0.25], b: [s * 0.4, 0.25 + 1.3 * RAIL[1], 0.25 + 1.3 * RAIL[0]], r: 0.03 }, color: "frame" });
      items.push({ cyl: { a: [s * 0.3, ALP.hip[1] + 0.02, -0.12], b: [s * 0.3, ALP.hip[1] + 0.02, 0.1], r: 0.016 }, color: "metal", grip: true });
    }
    return items;
  },
});

// ハックスクワット：45°の背もたれと肩のパッドごと、レールに沿ってしゃがむ
const HACK = { th: -0.785, A: [0.25, 0.254] };
defineExercise({
  id: "c_hacksq",
  roles: { main: ["quads"], sub: ["glutes", "adductors"], support: ["hams", "calves"] },
  cam: { target: [0, 0.85, 0.05], dist: 3.6, yaw: 1.3 },
  fitPads: [{ name: "back", n: torsoFront(HACK.th), slots: [14, 0], y: [0.95, 3] }],
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), L = (rig.sides.R.L1 + rig.sides.R.L2) * 0.975;
    const hip0 = [HACK.A[0] - L * 0.5, HACK.A[1] + L * 0.866];
    const s = lerp(0, 0.42, e), down = [Math.SQRT1_2, -Math.SQRT1_2];
    const hip = [hip0[0] + down[0] * s, hip0[1] + down[1] * s];
    const leg = { ankle: HACK.A, x: 0.13, abd: lerp(0.25, 0.4, e) };
    return {
      hip, trunk: HACK.th, head: 0.3, legs: { R: leg, L: leg }, bar: [0, hip[1], hip[0]],
      hands: (sg, sk) => sk.onThorax([sg * 0.25, 1.36, 0.14]), pole: (sg) => [sg * 0.4, -1, 0.3], knuckles: [0, 0, 1], grip: 1,
    };
  },
  props(fit) {
    const s0 = fit.s0, b0 = fit.bar0;
    const items = [...floorMat()];
    items.push(padOn(fit.back, s0.sk.onThorax([0, 1.1, 0]), [0.36, 0.07, 0.8], null, b0));
    for (const sg of [-1, 1]) {
      const p = V.sub(s0.sk.onThorax([sg * 0.14, 1.47, 0.04]), b0);
      items.push({ cyl: { a: V.add(p, [0, 0, -0.08]), b: V.add(p, [0, 0, 0.1]), r: 0.045 }, bone: 15, color: "pad", label: "肩のパッド" });
      items.push({ cyl: { a: [sg * 0.42, 0.1, 0.4], b: [sg * 0.42, 0.1 + 1.6 * 0.707, 0.4 - 1.6 * 0.707], r: 0.03 }, color: "frame" });
    }
    items.push({ box: { c: [0, 0.1, 0.27], s: [0.6, 0.2, 0.42] }, color: "frame", label: "足の台" });
    return items;
  },
});

// レッグ・エクステンション：座って、ひざから先を前へ伸ばす（足首の前にローラー）
const SEATED_LEG = { hip: [0.0, 0.55], th: -0.15 };
function fixedKnee(rig, side, hip, dir) {
  const s = rig.sides[side], H = [s.H[0], hip[1], hip[0]];
  return V.add(H, V.scale(V.norm(dir), s.L1));
}
function shinAnkle(K, beta, L2) { return [K[2] + L2 * Math.sin(beta), K[1] - L2 * Math.cos(beta)]; } // [z,y]、beta は真下から前へ
defineExercise({
  id: "legext",
  roles: { main: ["quads"], sub: [], support: ["hipflex"] },
  cam: { target: [0, 0.75, 0.2], dist: 3.2, yaw: 1.2 },
  fitPads: seatFits(SEATED_LEG.hip, SEATED_LEG.th),
  pose(t, fit) {
    const rig = fit.rig, beta = lerp(0.15, 1.45, ease(t)), L2 = rig.sides.R.L2;
    const legs = {};
    for (const side of ["R", "L"]) {
      const K = fixedKnee(rig, side, SEATED_LEG.hip, [0, -0.1, 1]);
      legs[side] = { ankle: shinAnkle(K, beta, L2), x: Math.abs(rig.sides[side].H[0]), abd: 0, foot: { shin: 0.15 } };
    }
    const K = fixedKnee(rig, "R", SEATED_LEG.hip, [0, -0.1, 1]);
    const A = shinAnkle(K, beta, L2);
    const roller = [0, A[1] + 0.04 * Math.cos(beta) + 0.075 * Math.sin(beta), A[0] - 0.04 * Math.sin(beta) + 0.075 * Math.cos(beta)];
    return {
      hip: SEATED_LEG.hip, trunk: SEATED_LEG.th, legs, bar: roller,
      ...legPressHands(),
      cables: () => [[[0.32, K[1], K[2]], [0.32, roller[1], roller[2]]]],
    };
  },
  props: (fit) => [
    ...floorMat(), ...seatProps(fit, SEATED_LEG.hip, { seatLen: 0.5 }),
    { cyl: { a: [-0.26, 0, 0], b: [0.26, 0, 0], r: 0.045 }, bone: 15, color: "pad", label: "ローラー" },
    ...leverItems(1, 0.025),
    ...[-1, 1].map((s) => ({ cyl: { a: [s * 0.29, SEATED_LEG.hip[1] - 0.02, -0.08], b: [s * 0.29, SEATED_LEG.hip[1] - 0.02, 0.16], r: 0.016 }, color: "metal", grip: true })),
  ],
});

// ---- もも裏 ----

// ルーマニアンデッドリフト：ひざを少し曲げたまま、股関節から前傾してバーを下ろす
defineExercise({
  id: "rdl",
  roles: { main: ["hams", "glutes"], sub: ["erectors", "adductors"], support: ["forearms", "traps", "lats"] },
  cam: { target: [0, 0.75, 0], dist: 3.7, yaw: 1.2 },
  barPath: true,
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), gx = 0.24;
    return {
      hip: [rig.hipC[2] - 0.27 * e, rig.hipC[1] - 0.005 - 0.07 * e], trunk: 1.2 * e, head: -0.35 * e,
      legs: standLegs(0.11, 0.1),
      bar: (sk) => { const S = sk.shoulder(-1), L = sideReach(rig, gx, 0.99), dz = lerp(0.1, 0.03, e); return [0, S[1] - Math.sqrt(L * L - dz * dz), S[2] + dz]; },
      hands: (sg, sk, bar) => [sg * gx, bar[1], bar[2]],
      pole: (sg) => [sg * 0.25, 0, -1], grip: 1,
    };
  },
  props: () => [...floorMat(), ...barbell()],
});

// グッドモーニング：バーを担いで、股関節から前傾
defineExercise({
  id: "c_goodmorning",
  roles: { main: ["hams", "erectors"], sub: ["glutes"], support: ["abs", "adductors"] },
  cam: { target: [0, 0.9, 0], dist: 3.7, yaw: 1.2 },
  barPath: true,
  pose(t, fit) {
    const rig = fit.rig, e = ease(t);
    return Object.assign({
      hip: [rig.hipC[2] - 0.24 * e, rig.hipC[1] - 0.005 - 0.06 * e], trunk: 1.2 * e, head: -0.4 * e,
      legs: standLegs(0.13, 0.12), bar: backBar(fit),
    }, backBarHands());
  },
  props: () => [...floorMat(), ...barbell()],
});

// ライイングレッグカール：うつぶせで、かかとをお尻へ（足首の後ろにローラー）
const PRONE = { hip: [0.0, 0.62] };
defineExercise({
  id: "plc",
  roles: { main: ["hams"], sub: ["calves"], support: ["glutes"] },
  cam: { target: [0, 0.75, 0.0], dist: 3.4, yaw: 1.4 },
  fitPads: [{ name: "bench", n: [0, 1, 0], slots: [14, 0, 2, 5], x: [-0.2, 0.2], z: [-0.38, 0.62] }],
  pose(t, fit) {
    const rig = fit.rig, beta = lerp(0.05, 1.7, ease(t)), L2 = rig.sides.R.L2;
    const legs = {};
    let K, A;
    for (const side of ["R", "L"]) {
      K = fixedKnee(rig, side, PRONE.hip, [0, -0.04, -1]);
      A = [K[2] - L2 * Math.cos(beta), K[1] + L2 * Math.sin(beta)];
      legs[side] = { ankle: A, x: Math.abs(rig.sides[side].H[0]) + 0.01, abd: 0, foot: { shin: 0.45 } };
    }
    const sd = [-Math.cos(beta), Math.sin(beta)], np = [Math.sin(beta), Math.cos(beta)]; // すねの向き・ふくらはぎ側 [z,y]
    const roller = [0, A[1] + np[1] * 0.088 - sd[1] * 0.03, A[0] + np[0] * 0.088 - sd[0] * 0.03];
    return {
      hip: PRONE.hip, trunk: Math.PI / 2 - 0.04, head: -0.15, legs, bar: roller,
      hands: (sg) => [sg * 0.2, PRONE.hip[1] - 0.12, PRONE.hip[0] + 0.72],
      pole: (sg) => [sg * 0.5, -1, 0], knuckles: (sg) => [sg, 0, 0], grip: 1,
      cables: () => [[[0.3, K[1], K[2]], [0.3, roller[1], roller[2]]]],
    };
  },
  props(fit) {
    const top = fit.bench.d;
    return [
      ...floorMat(),
      padOn(fit.bench, [0, top, 0.12], [0.36, 0.08, 1.0]),
      { box: { c: [0, (top - 0.08) / 2, 0.12], s: [0.1, top - 0.08, 0.8] }, color: "frame" },
      { cyl: { a: [-0.24, 0, 0], b: [0.24, 0, 0], r: 0.045 }, bone: 15, color: "pad", label: "ローラー" },
      ...leverItems(1, 0.025),
      { cyl: { a: [-0.3, PRONE.hip[1] - 0.12, PRONE.hip[0] + 0.72], b: [0.3, PRONE.hip[1] - 0.12, PRONE.hip[0] + 0.72], r: 0.016 }, color: "metal", grip: true },
    ];
  },
});

// シーテッドレッグカール：座って、伸ばした脚を下へ曲げる（ももの上にパッド）
defineExercise({
  id: "c_seatedlc",
  roles: { main: ["hams"], sub: ["calves"], support: [] },
  cam: { target: [0, 0.75, 0.2], dist: 3.2, yaw: 1.2 },
  fitPads: seatFits(SEATED_LEG.hip, -0.25),
  pose(t, fit) {
    const rig = fit.rig, beta = lerp(1.45, -0.2, ease(t)), L2 = rig.sides.R.L2;
    const legs = {};
    let K, A;
    for (const side of ["R", "L"]) {
      K = fixedKnee(rig, side, SEATED_LEG.hip, [0, -0.06, 1]);
      A = shinAnkle(K, beta, L2);
      legs[side] = { ankle: A, x: Math.abs(rig.sides[side].H[0]), abd: 0, foot: { shin: 0.2 } };
    }
    const sd = [Math.sin(beta), -Math.cos(beta)], np = [-Math.cos(beta), -Math.sin(beta)];
    const roller = [0, A[1] + np[1] * 0.088 - sd[1] * 0.03, A[0] + np[0] * 0.088 - sd[0] * 0.03];
    return {
      hip: SEATED_LEG.hip, trunk: -0.25, legs, bar: roller, ...legPressHands(),
      cables: () => [[[0.32, K[1], K[2]], [0.32, roller[1], roller[2]]]],
    };
  },
  props(fit) {
    const K = fixedKnee(fit.rig, "R", SEATED_LEG.hip, [0, -0.06, 1]);
    return [
      ...floorMat(), ...seatProps(fit, SEATED_LEG.hip, { seatLen: 0.5 }),
      { cyl: { a: [-0.26, K[1] + 0.1, K[2] - 0.1], b: [0.26, K[1] + 0.1, K[2] - 0.1], r: 0.045 }, color: "pad", label: "ももパッド" },
      { cyl: { a: [-0.26, 0, 0], b: [0.26, 0, 0], r: 0.045 }, bone: 15, color: "pad", label: "ローラー" },
      ...leverItems(1, 0.025),
      ...[-1, 1].map((s) => ({ cyl: { a: [s * 0.29, SEATED_LEG.hip[1] - 0.02, -0.08], b: [s * 0.29, SEATED_LEG.hip[1] - 0.02, 0.16], r: 0.016 }, color: "metal", grip: true })),
    ];
  },
});

// ---- お尻 ----

// ヒップスラスト：肩甲骨をベンチの縁に乗せ、腰に乗せたバーを押し上げる
const THRUST = { edge: [-0.45, 0.43], A: [0.33, 0.054] };
defineExercise({
  id: "c_hipthrust",
  roles: { main: ["glutes"], sub: ["hams", "quads"], support: ["abs", "erectors", "adductors"] },
  cam: { target: [0, 0.5, -0.05], dist: 3.4, yaw: 1.3 },
  barPath: true,
  pose(t, fit) {
    const rig = fit.rig, th = lerp(-0.95, -1.55, ease(t));
    const C0 = [0, 1.2, fit.backZ(1.2)];
    const o = M3.apply(M3.rx(th), V.sub(C0, rig.hipC));
    const hip = [THRUST.edge[0] - o[2], THRUST.edge[1] - o[1]];
    const leg = { ankle: THRUST.A, x: 0.15, abd: 0.15 };
    const rest = [0, 0.86, fit.frontZ(0.86) + 0.03];
    return {
      hip, trunk: th, head: 0.35, legs: { R: leg, L: leg },
      bar: (sk) => sk.onPelvis(rest),
      hands: (sg, sk, bar) => [sg * 0.42, bar[1], bar[2]],
      pole: (sg) => [sg * 0.4, -1, 0.2], grip: 1,
    };
  },
  props: () => [
    ...floorMat(),
    { box: { c: [0, THRUST.edge[1] - 0.04, THRUST.edge[0] - 0.17], s: [1.1, 0.08, 0.36] }, color: "pad", pad: true },
    { box: { c: [0, (THRUST.edge[1] - 0.08) / 2, THRUST.edge[0] - 0.17], s: [0.9, THRUST.edge[1] - 0.08, 0.2] }, color: "frame" },
    ...barbell(),
  ],
});

// ヒップアブダクション（マシン）：座って、ひざの外側のパッドを外へ押し開く
defineExercise({
  id: "c_abduction",
  roles: { main: ["glutes"], sub: [], support: ["abs"] },
  cam: { target: [0, 0.7, 0.25], dist: 3.2, yaw: 0.4 },
  fitPads: seatFits(SEATED_LEG.hip, -0.15),
  pose(t, fit) {
    const rig = fit.rig, a = lerp(0.08, 0.55, ease(t)), s = rig.sides.R;
    const leg = { ankle: [SEATED_LEG.hip[0] + s.L1 * Math.cos(a) * 0.99 + 0.02, s.A[1] + 0.16], x: Math.abs(s.H[0]) + s.L1 * Math.sin(a), abd: a, foot: 0 };
    const pad = (sg, out) => {
      const K = out.extra[sg < 0 ? "kneeR" : "kneeL"], o = [sg * Math.cos(a), 0, -Math.sin(a)];
      const c = V.add(K, V.scale(o, 0.085));
      return [V.add(c, [0, -0.06, 0]), V.add(c, [0, 0.1, 0])];
    };
    return {
      hip: SEATED_LEG.hip, trunk: -0.15, legs: { R: leg, L: leg }, ...legPressHands(),
      cables: (sk, out) => [pad(-1, out), pad(1, out)],
    };
  },
  props: (fit) => [
    ...floorMat(), ...seatProps(fit, SEATED_LEG.hip, { seatLen: 0.5 }),
    ...[16, 17].map((bone) => ({ cyl: { a: [0, 0, 0], b: [0, 1, 0], r: 0.04 }, bone, color: "pad", label: "ひざのパッド" })),
    ...[-1, 1].map((s) => ({ cyl: { a: [s * 0.29, SEATED_LEG.hip[1] - 0.02, -0.08], b: [s * 0.29, SEATED_LEG.hip[1] - 0.02, 0.16], r: 0.016 }, color: "metal", grip: true })),
  ],
});

// ケーブルキックバック：右足首に低い滑車のケーブルをつけ、脚を後ろへ蹴り上げる
defineExercise({
  id: "c_cablekick",
  roles: { main: ["glutes"], sub: ["hams"], support: ["abs", "erectors"] },
  cam: { target: [0, 0.75, 0.1], dist: 3.4, yaw: 1.4 },
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), hip = [0.05, 0.8], p = [-0.07, 0.12, 0.72];
    return {
      hip, trunk: 0.32, head: -0.15,
      legs: { R: { ankle: V.lerp([hip[0] + 0.1, 0.1], [hip[0] - 0.5, 0.3], e).slice(0, 2), x: 0.08, abd: 0.05, foot: { shin: 0.3 } }, L: { x: 0.1, abd: 0.08 } },
      hands: (sg) => [sg * 0.2, 1.05, 0.48],
      pole: (sg) => [sg * 0.4, -1, -0.3], gripAxis: () => [1, 0, 0], grip: 1,
      cables: (sk, out) => [[p, V.add(out.extra.ankleR, [0, 0, 0.06])]],
    };
  },
  props: () => [
    ...floorMat(), ...cableTower([-0.07, 0.12, 0.72]), ...cableItems(1),
    { cyl: { a: [-0.45, 1.05, 0.48], b: [0.45, 1.05, 0.48], r: 0.018 }, color: "metal", grip: true },
    post(-0.45, 0.48, 1.08, 0.05), post(0.45, 0.48, 1.08, 0.05),
  ],
});

// ---- ふくらはぎ ----
// かかとを上げる：足の母指球より少し先（指の付け根）を支点に、足首ごと上がる
// （足を1枚の板として回すので、支点を指先寄りにして、指が台に入る深さを小さくしている）
function calfPivot(rig, side) { return V.add(rig.sides[side].T, [0, 0, 0.05]); }
function calfAnkle(rig, side, phi, lift, dz) {
  const s = rig.sides[side], P = calfPivot(rig, side);
  const A = V.add(V.add(P, [0, lift, dz || 0]), M3.apply(M3.rx(phi), V.sub(s.A, P)));
  return [A[2], A[1]];
}

// スタンディングカーフレイズ：台に母指球を乗せ、肩のパッドごと体を持ち上げる
const CALF_BLOCK = 0.08;
defineExercise({
  id: "c_standcalf",
  roles: { main: ["calves"], sub: [], support: ["quads", "abs"] },
  cam: { target: [0, 0.9, 0.0], dist: 3.8, yaw: 1.35 },
  pose(t, fit) {
    const rig = fit.rig, phi = lerp(-0.3, 0.33, ease(t)), s = rig.sides.R;
    const A = calfAnkle(rig, "R", phi, CALF_BLOCK);
    const d = [A[0] - s.A[2], A[1] - s.A[1]];
    const leg = { ankle: A, abd: 0, foot: phi };
    return {
      hip: [rig.hipC[2] + d[0] - 0.005, rig.hipC[1] + d[1] - 0.004], trunk: 0.02,
      legs: { R: leg, L: leg }, bar: [0, d[1], d[0]],
      hands: (sg, sk) => V.add(sk.shoulder(sg), [sg * 0.04, 0.12, 0.1]),
      pole: (sg) => [sg * 0.3, -1, 0.3], knuckles: [0, 0, 1], grip: 1,
    };
  },
  props(fit) {
    const rig = fit.rig, P = calfPivot(rig, "R"), b0 = fit.bar0, s0 = fit.s0;
    const items = [...floorMat(), { box: { c: [0, CALF_BLOCK / 2, P[2] + 0.03], s: [0.6, CALF_BLOCK, 0.13] }, color: "frame", label: "台" }];
    for (const sg of [-1, 1]) {
      const p = V.sub(s0.sk.onThorax([sg * 0.13, 1.47, 0.05]), b0);
      items.push({ cyl: { a: V.add(p, [0, 0, -0.08]), b: V.add(p, [0, 0, 0.12]), r: 0.045 }, bone: 15, color: "pad", label: "肩のパッド" });
    }
    return items;
  },
});

// カーフレイズ（レッグプレス）：脚を伸ばしたまま、足首を伸ばして台を押す
defineExercise({
  id: "calf",
  roles: { main: ["calves"], sub: [], support: ["quads"] },
  cam: { target: [0, 0.7, 0.4], dist: 3.3, yaw: 1.3 },
  fitPads: seatFits(LEGPRESS.hip, LEGPRESS.th),
  pose(t, fit) {
    const rig = fit.rig, phi = lerp(-0.25, 0.45, ease(t));
    const A = [LEGPRESS.hip[0] + 0.755, LEGPRESS.hip[1] + 0.08];
    const leg = { ankle: A, x: 0.12, abd: 0.05, foot: { shin: phi } };
    return Object.assign(legPressBase(rig), {
      legs: { R: leg, L: leg },
      bar: (sk) => { const p = sk.onBone(4, calfPivot(rig, "R")); return [0, p[1], p[2]]; },
    }, legPressHands());
  },
  props: (fit) => [...legPressProps(fit), { box: { c: [0, 0.05, 0.05], s: [0.62, 0.55, 0.03] }, bone: 15, color: "frame", label: "足の台" }],
});

// シーテッドカーフレイズ：座って、ひざの上のパッドごとかかとを上げる
const SEATCALF_DZ = 0.36; // 立ったときより足を前へ（ひざを約90°に）
defineExercise({
  id: "c_seatcalf",
  roles: { main: ["calves"], sub: [], support: [] },
  cam: { target: [0, 0.55, 0.25], dist: 3.0, yaw: 1.3 },
  fitPads: [{ name: "seat", n: [0, 1, 0], x: [-0.2, 0.2], z: [-0.16, 0.22], slots: [0, 2, 5] }],
  pose(t, fit) {
    const rig = fit.rig, phi = lerp(-0.3, 0.33, ease(t)), hip = [-0.05, 0.53];
    const leg = { ankle: calfAnkle(rig, "R", phi, CALF_BLOCK, SEATCALF_DZ), x: 0.1, abd: 0.05, foot: phi };
    return {
      hip, trunk: 0.15, legs: { R: leg, L: leg },
      bar: (sk) => { const K = sk.extra.kneeR; return [0, K[1] + 0.1, K[2] - 0.02]; },
      hands: (sg, sk, bar) => V.add(bar, [sg * 0.3, 0.01, -0.03]),
      pole: (sg) => [sg * 0.5, -0.5, -1], knuckles: [0, 0, -1], grip: 1,
    };
  },
  props(fit) {
    const P = calfPivot(fit.rig, "R");
    return [
      ...floorMat(), padOn(fit.seat, [0, fit.seat.d, 0.0], [0.4, 0.08, 0.4]),
      { box: { c: [0, (fit.seat.d - 0.08) / 2, 0.0], s: [0.08, fit.seat.d - 0.08, 0.08] }, color: "frame" },
      { box: { c: [0, CALF_BLOCK / 2, P[2] + SEATCALF_DZ + 0.03], s: [0.6, CALF_BLOCK, 0.13] }, color: "frame", label: "台" },
      { cyl: { a: [-0.3, 0, 0], b: [0.3, 0, 0], r: 0.045 }, bone: 15, color: "pad", label: "ももパッド" },
      ...[-1, 1].map((s) => ({ cyl: { a: [s * 0.3, -0.04, -0.03], b: [s * 0.3, 0.06, -0.03], r: 0.016 }, bone: 15, color: "metal", grip: true })),
    ];
  },
});
