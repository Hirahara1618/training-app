"use strict";
// 腹の種目。クランチ系は股関節ではなく背骨（胸郭）で丸める

const MAT_TOP = 0.02;
function exerciseMat() { return [{ box: { c: [0, MAT_TOP / 2, 0], s: [0.7, MAT_TOP, 1.9] }, color: "pad", pad: true, label: "マット" }]; }

// アブドミナル（マシン）：座って、胸の前のパッドとハンドルごと背骨を丸める
const ABM = { hip: [0.0, 0.53], th: -0.05 };
defineExercise({
  id: "abmachine",
  roles: { main: ["abs"], sub: ["hipflex"], support: ["serratus"] },
  cam: { target: [0, 1.0, 0.1], dist: 3.3, yaw: 1.2 },
  fitPads: seatFits(ABM.hip, ABM.th, { backFrom: 0.05 }),
  pose(t, fit) {
    const rig = fit.rig, e = ease(t);
    return {
      hip: ABM.hip, trunk: lerp(-0.05, 0.12, e), spine: 0.8 * e, head: 0.2 * e,
      legs: seatedLegs(rig, ABM.hip),
      bar: (sk) => sk.onThorax([0, 1.28, fit.frontZ(1.28) + 0.06]),
      hands: (sg, sk) => sk.onThorax([sg * 0.13, 1.47, 0.11]),
      pole: (sg, sk) => sk.dir(22, [sg * 0.5, -1, 0.3]),
      knuckles: (sg, sk) => sk.dir(22, [0, 0, 1]),
      grip: 1,
      cables: (sk, out) => ["R", "L"].map((s, k) => [[(k ? 1 : -1) * 0.3, 1.2, -0.05], out.extra[`grip${s}`]]),
    };
  },
  props: (fit) => [
    ...floorMat(), ...seatProps(fit, ABM.hip, { backLen: 0.3, backY: 0.98 }),
    { cyl: { a: [-0.2, 0, 0], b: [0.2, 0, 0], r: 0.05 }, bone: 15, color: "pad", label: "胸のパッド" },
    ...leverItems(2, 0.02), ...dHandles(fit.rig),
  ],
});

// V クランチ：仰向けから、上体と伸ばした脚を同時に上げる（お尻で支える）
defineExercise({
  id: "vcrunch",
  roles: { main: ["abs"], sub: ["hipflex"], support: ["quads"] },
  cam: { target: [0, 0.35, 0.0], dist: 3.0, yaw: 1.35 },
  ground: { slots: [0, 14, 2, 5, 1], y: MAT_TOP },
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), hip = [0.0, 0.3];
    const legA = lerp(0.04, 0.85, e), L = (rig.sides.R.L1 + rig.sides.R.L2) * 0.97;
    const leg = { ankle: [hip[0] + L * Math.cos(legA), hip[1] + L * Math.sin(legA) - 0.07], x: 0.1, abd: 0, foot: 0.3 };
    return {
      hip, trunk: -Math.PI / 2 + 0.5 * e, spine: 0.45 * e, head: 0.35 * e, legs: { R: leg, L: leg },
      hands: (sg, sk) => {
        const S = sk.shoulder(sg), K = sk.extra[sg < 0 ? "kneeR" : "kneeL"];
        return V.add(S, V.scale(slerpDir([sg * 0.15, 0.05, -1], V.sub(V.add(K, [sg * 0.17, 0, 0]), S), e), armReach(rig) * 0.85));
      },
      pole: (sg) => [sg * 0.5, -1, 0], palm: (sg) => [-sg, 0, 0], grip: 0,
    };
  },
  props: () => [...floorMat(), ...exerciseMat()],
});

// クランチ：仰向けでひざを立て、背骨を丸めて肩を浮かせる
defineExercise({
  id: "c_crunch",
  roles: { main: ["abs"], sub: [], support: ["hipflex"] },
  cam: { target: [0, 0.3, -0.1], dist: 2.8, yaw: 1.35 },
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), hip = [0.0, supineHipY(fit, MAT_TOP)];
    const leg = { ankle: [0.42, MAT_TOP + rig.sides.R.A[1]], x: 0.12, abd: 0.1 };
    return {
      hip, trunk: -Math.PI / 2, spine: 0.6 * e, head: 0.3 * e, legs: { R: leg, L: leg },
      hands: (sg, sk) => sk.onThorax([-sg * 0.11, 1.26, fit.frontZ(1.26) + 0.06]),
      pole: (sg, sk) => sk.dir(22, [sg * 0.6, -1, 0.15]),
      palm: (sg, sk) => sk.dir(22, [0, 0, -1]),
      grip: 0,
    };
  },
  props: () => [...floorMat(), ...exerciseMat()],
});

// ハンギングレッグレイズ：バーにぶら下がり、伸ばした脚を前へ上げる（骨盤を後ろへ傾け、背中を少し丸める）
defineExercise({
  id: "c_hangleg",
  roles: { main: ["abs", "hipflex"], sub: ["quads"], support: ["forearms", "lats"] },
  cam: { target: [0, 1.45, 0.1], dist: 4.0, yaw: 1.2 },
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), gx = 0.3, L = sideReach(rig, gx, 0.985);
    const S = [PULL_BAR.z - 0.02, PULL_BAR.y - Math.sqrt(L * L - 0.02 * 0.02)];
    const th = lerp(0.02, -0.28, e), spine = 0.3 * e;
    const hip = hipFromShoulder(rig, th, S, spine);
    const a = lerp(0.06, 1.45, e), Lg = (rig.sides.R.L1 + rig.sides.R.L2) * 0.97;
    const leg = { ankle: [hip[0] + Lg * Math.sin(a), hip[1] - Lg * Math.cos(a)], x: 0.09, abd: 0.02, foot: 0.4 };
    return {
      hip, trunk: th, spine, head: 0.15 * e, legs: { R: leg, L: leg },
      hands: (sg) => [sg * gx, PULL_BAR.y, PULL_BAR.z],
      pole: (sg) => [sg, -1, 0.1], gripAxis: () => [1, 0, 0], gripSign: 1, grip: 1,
    };
  },
  props: () => [...floorMat(), { cyl: { a: [-0.7, PULL_BAR.y, PULL_BAR.z], b: [0.7, PULL_BAR.y, PULL_BAR.z], r: 0.016 }, color: "metal", grip: true },
    post(-0.72, PULL_BAR.z, PULL_BAR.y + 0.05, 0.06), post(0.72, PULL_BAR.z, PULL_BAR.y + 0.05, 0.06)],
});

// ひざ立ち（アブローラー・ケーブルクランチ）：ひざを床に、すねは後ろへ寝かせる
const KNEEL_K = [0.0, 0.075]; // ひざの関節の中心 [z, y]
function kneelLegs(rig, hip) {
  const L2 = rig.sides.R.L2 * 0.995;
  const leg = { ankle: [KNEEL_K[0] - L2, KNEEL_K[1] + 0.005], x: 0.1, abd: 0, foot: { shin: 1.3 } };
  return { R: leg, L: leg };
}
function kneelHip(rig, phi) { const L1 = rig.sides.R.L1; return [KNEEL_K[0] + L1 * Math.sin(phi), KNEEL_K[1] + L1 * Math.cos(phi)]; }

// アブローラー：ひざ立ちから、ローラーを前へ転がして体を伸ばす
const ROLLER_R = 0.09;
defineExercise({
  id: "c_abroller",
  roles: { main: ["abs"], sub: ["lats", "hipflex"], support: ["delts", "triceps", "serratus"] },
  cam: { target: [0, 0.35, 0.35], dist: 3.2, yaw: 1.35 },
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), gx = 0.12;
    const phi = lerp(0.08, 1.12, e), th = lerp(1.3, 1.5, e);
    const hip = kneelHip(rig, phi);
    const L = sideReach(rig, gx, 0.97), y = MAT_TOP + ROLLER_R;
    return {
      hip, trunk: th, head: lerp(-0.2, -0.45, e), legs: kneelLegs(rig, hip),
      bar: (sk) => { const S = sk.shoulder(-1), dy = S[1] - y; return [0, y, S[2] + (dy < L ? Math.sqrt(L * L - dy * dy) * e : 0) + 0.02]; },
      hands: (sg, sk, bar) => [sg * gx, bar[1], bar[2]],
      pole: (sg) => [sg * 0.5, -0.3, -1], grip: 1,
    };
  },
  props: () => [
    ...floorMat(), ...exerciseMat(),
    { cyl: { a: [-0.03, 0, 0], b: [0.03, 0, 0], r: ROLLER_R }, bone: 15, color: "plate", label: "ローラー" },
    { cyl: { a: [-0.2, 0, 0], b: [0.2, 0, 0], r: 0.015 }, bone: 15, color: "metal" },
  ],
});

// ケーブルクランチ：ひざ立ちで、頭の横に持ったロープごと背骨を丸める
const CRUNCH_PULLEY = [0, 2.0, 0.85];
defineExercise({
  id: "c_cablecrunch",
  roles: { main: ["abs"], sub: [], support: ["hipflex", "lats"] },
  cam: { target: [0, 0.85, 0.25], dist: 3.4, yaw: 1.3 },
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), hip = kneelHip(rig, 0.12);
    return {
      hip, trunk: lerp(0.3, 0.6, e), spine: 0.8 * e, head: 0.3 * e, legs: kneelLegs(rig, hip),
      hands: (sg, sk) => sk.onBone(1, [sg * 0.14, 1.5, 0.06]),
      pole: (sg, sk) => sk.dir(22, [sg * 0.4, -1, 0.5]),
      palm: (sg, sk) => sk.dir(22, [-sg, 0, 0]),
      grip: 1,
      ...ropeAttach(CRUNCH_PULLEY, 0.26),
    };
  },
  props: () => [...floorMat(), ...exerciseMat(), ...cableTower(CRUNCH_PULLEY), ...cableItems(1), ...ropeItems()],
});

// プランク：ひじと前腕、つま先で体を一直線に支える（呼吸程度の小さな動き）
defineExercise({
  id: "c_plank",
  roles: { main: ["abs"], sub: ["delts", "quads"], support: ["serratus", "glutes", "erectors"] },
  cam: { target: [0, 0.3, 0.0], dist: 3.0, yaw: 1.2 },
  pose(t, fit) {
    const rig = fit.rig, A = [-0.86, 0.13];
    const Lb = 0.5025 + (rig.sides.R.L1 + rig.sides.R.L2) * 0.995;
    const Sy = MAT_TOP + 0.05 + rig.sides.R.Lu + 0.012 * t;
    const S = [A[0] + Math.sqrt(Lb * Lb - (Sy - A[1]) ** 2), Sy];
    const th = Math.atan2(S[0] - A[0], S[1] - A[1]) + 0.036 - 0.02 * t;
    const hip = hipFromShoulder(rig, th, S);
    const leg = { ankle: A, x: 0.1, abd: 0, foot: "shin", toe: 0.8 };
    const elbow = (sg, sk) => { const Sh = sk.shoulder(sg); return [Sh[0] * 0.85, MAT_TOP + 0.05, Sh[2] + 0.01]; };
    return {
      hip, trunk: th, head: -0.15, legs: { R: leg, L: leg },
      elbow,
      hands: (sg, sk) => { const E = elbow(sg, sk); return [E[0] * 0.45, MAT_TOP + 0.045, E[2] + forearmReach(rig) * 0.93]; },
      pole: (sg) => [0, 0, -1], palm: (sg) => [-sg, -0.3, 0], grip: 0.5,
    };
  },
  props: () => [...floorMat(), ...exerciseMat()],
});
