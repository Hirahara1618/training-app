"use strict";
// 肩の種目

// オーバーヘッドプレス：鎖骨の前から頭上へ。バーが顔の前を通るあいだは頭を引く
defineExercise({
  id: "ohp",
  roles: { main: ["delts"], sub: ["triceps", "traps"], support: ["abs", "erectors", "serratus"] },
  cam: { target: [0, 1.1, 0], dist: 3.7, yaw: 1.0 },
  barPath: true,
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), gx = 0.27;
    const back = smoothstep(0.45, 1, e);
    return {
      hip: standHip(rig), trunk: lerp(0.0, -0.04, e), head: -0.22 * Math.sin(Math.PI * clamp(e * 1.4, 0, 1)),
      legs: standLegs(0.12, 0.1),
      bar: (sk) => {
        const S = sk.shoulder(-1), c = sk.onThorax([0, 1.36, fit.frontZ(1.36) + 0.035]);
        const top = [0, S[1] + sideReach(rig, gx, 0.98), S[2] + 0.0];
        return [0, lerp(c[1], top[1], e), lerp(c[2], top[2], back)];
      },
      hands: (sg, sk, bar) => [sg * gx, bar[1], bar[2]],
      pole: (sg) => V.lerp([sg * 0.25, -1, 0.7], [sg, 0, -0.1], e),
      grip: 1,
    };
  },
  props: () => [...floorMat(), ...barbell()],
});

// 座って背もたれのあるベンチ（ダンベルショルダープレス・オーバーヘッドエクステンション）
const UPRIGHT = { hip: [0.0, 0.53], th: -0.08 };
function uprightBase(rig) { return { hip: UPRIGHT.hip, trunk: UPRIGHT.th, legs: seatedLegs(rig, UPRIGHT.hip, { reach: 0.46, x: 0.2, abd: 0.25 }) }; }
function uprightProps(fit) { return [...floorMat(), ...seatProps(fit, UPRIGHT.hip, { backLen: 0.72, backY: 1.15 })]; }

defineExercise({
  id: "c_dbsp",
  roles: { main: ["delts"], sub: ["triceps", "traps"], support: ["serratus", "forearms"] },
  cam: { target: [0, 1.15, 0], dist: 3.5, yaw: 0.6 },
  fitPads: seatFits(UPRIGHT.hip, UPRIGHT.th),
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), gx1 = 0.12;
    const hand = (sg, sk) => {
      const S = sk.shoulder(sg);
      return V.lerp([sg * 0.28, S[1] + 0.07, S[2] + 0.02], [sg * gx1, S[1] + sideReach(rig, gx1, 0.97), S[2] + 0.02], e);
    };
    return Object.assign(uprightBase(rig), {
      hands: hand,
      pole: (sg) => [sg * 0.5, -1, 0],
      knuckles: (sg) => [sg, 0, 0],
      grip: 1,
    });
  },
  props: (fit) => [...uprightProps(fit), ...dumbbells(fit.rig)],
});

// ショルダープレス（マシン／コンバージング）：手のひらはねじらない。レバーとフレーム
defineExercise({
  id: "cspress",
  roles: { main: ["delts"], sub: ["triceps", "traps"], support: ["serratus"] },
  cam: { target: [0, 1.15, 0], dist: 3.5, yaw: 0.7 },
  fitPads: seatFits(UPRIGHT.hip, UPRIGHT.th),
  pose(t, fit) {
    const rig = fit.rig, e = ease(t);
    return Object.assign(uprightBase(rig), {
      hands: (sg, sk) => {
        const S = sk.shoulder(sg);
        return V.lerp([sg * 0.27, S[1] + 0.06, S[2] + 0.08], [sg * 0.15, S[1] + sideReach(rig, 0.15, 0.95), S[2] + 0.1], e);
      },
      pole: (sg) => [sg * 0.5, -1, 0],
      knuckles: (sg) => [sg, 0, 0],
      grip: 1,
      cables: (sk, out) => ["R", "L"].map((s, k) => [[(k ? 1 : -1) * 0.34, 0.95, -0.28], V.add(out.extra[`grip${s}`], [0, -0.02, -0.06])]),
    });
  },
  props: (fit) => [...uprightProps(fit), post(-0.34, -0.28, 0.95, 0.07), post(0.34, -0.28, 0.95, 0.07), ...leverItems(2, 0.022), ...dHandles(fit.rig)],
});

// 肩を中心に横へ円弧で上げる（サイドレイズ。肘の角度は固定）
function lateralArc(sg, sk, phi, R, front) {
  return V.add(sk.shoulder(sg), V.scale(V.norm([sg * Math.sin(phi), -Math.cos(phi), front || 0.12]), R));
}

defineExercise({
  id: "c_dblr",
  roles: { main: ["delts"], sub: ["traps"], support: ["scap", "forearms"] },
  cam: { target: [0, 1.05, 0], dist: 3.6, yaw: 0.3 },
  pose(t, fit) {
    const rig = fit.rig, phi = lerp(0.3, 1.45, ease(t)), R = armReach(rig) * 0.93;
    return {
      hip: standHip(rig), trunk: 0.06, legs: standLegs(0.12, 0.1),
      hands: (sg, sk) => lateralArc(sg, sk, phi, R, 0.14),
      pole: [0, 0.3, -1],
      knuckles: [0, 0, -1],
      grip: 1,
    };
  },
  props: (fit) => [...floorMat(), ...dumbbells(fit.rig, ["R", "L"], 0.055)],
});

// ラテラル・レイズ（マシン）：座って肘を約90°曲げ、二の腕の外側のパッドで持ち上げる
defineExercise({
  id: "latraise",
  roles: { main: ["delts"], sub: ["traps"], support: ["scap"] },
  cam: { target: [0, 1.1, 0], dist: 3.4, yaw: 0.35 },
  fitPads: seatFits(UPRIGHT.hip, UPRIGHT.th),
  pose(t, fit) {
    const rig = fit.rig, phi = lerp(0.12, 1.45, ease(t)), Lu = rig.sides.R.Lu;
    const elbow = (sg, sk) => V.add(sk.shoulder(sg), V.scale(V.norm([sg * Math.sin(phi), -Math.cos(phi), 0.06]), Lu));
    const padSeg = (sg, sk) => {
      const E = elbow(sg, sk), o = [sg * Math.cos(phi), Math.sin(phi), 0];
      const c = V.add(E, V.scale(o, 0.09));
      return [V.add(c, [0, 0, -0.11]), V.add(c, [0, 0, 0.0])];
    };
    return Object.assign(uprightBase(rig), {
      elbow,
      hands: (sg, sk) => V.add(elbow(sg, sk), [0, -0.02, forearmReach(rig)]),
      pole: [0, 0, -1],
      knuckles: [0, -1, 0],
      grip: 1,
      ropes: (sk) => [padSeg(-1, sk), padSeg(1, sk)],
      cables: (sk) => [-1, 1].map((sg) => { const S = sk.shoulder(sg); return [V.add(S, [0, 0, -0.17]), padSeg(sg, sk)[0]]; }),
    });
  },
  props: (fit) => [
    ...uprightProps(fit), ...leverItems(2, 0.02),
    ...[20, 21].map((bone) => ({ cyl: { a: [0, 0, 0], b: [0, 1, 0], r: 0.042 }, bone, color: "pad", label: "腕のパッド" })),
    ...dHandles(fit.rig),
  ],
});

// ケーブルサイドレイズ：反対側の低い滑車から、右腕を横へ上げる
defineExercise({
  id: "cablelr",
  roles: { main: ["delts"], sub: ["traps"], support: ["scap", "abs"] },
  cam: { target: [0, 1.05, 0], dist: 3.6, yaw: 0.3 },
  pose(t, fit) {
    const rig = fit.rig, phi = lerp(0.05, 1.42, ease(t)), R = armReach(rig) * 0.93;
    return {
      hip: standHip(rig), trunk: 0.05, legs: standLegs(0.13, 0.1),
      hands: (sg, sk) => (sg < 0 ? lateralArc(sg, sk, phi, R, 0.32) : sk.onPelvis([0.17, 0.97, 0.12])),
      pole: (sg) => (sg < 0 ? [0, 0.3, -1] : [0.6, 0, -1]),
      knuckles: (sg) => (sg < 0 ? [0, 0, -1] : null),
      palm: [-1, 0, 0],
      grip: (sg) => (sg < 0 ? 1 : 0),
      cables: (sk, out) => { const p = [0.32, 0.12, 0.2]; return [[p, toward(out.extra.gripR, p, 0.05)]]; },
    };
  },
  props: (fit) => [...floorMat(), ...cableTower([0.32, 0.12, 0.2]), ...cableItems(1), ...dHandles(fit.rig, ["R"])],
});

// リア・デルト（マシン）：ペックフライと同じマシンに逆向きに座る（マシン本体は体の前）
defineExercise({
  id: "reardelt",
  roles: { main: ["delts"], sub: ["scap", "traps"], support: ["triceps"] },
  cam: { target: [0, 1.1, 0.1], dist: 3.4, yaw: -2.6 },
  fitPads: [
    { name: "seat", n: [0, 1, 0], x: [-0.2, 0.2], z: [-0.16, 0.24], slots: [0, 2, 5] },
    { name: "chest", n: [0, 0.12, -1], slots: [14, 0], y: [0.93, 1.43], x: [-0.16, 0.16] },
  ],
  pose(t, fit) {
    const rig = fit.rig, R = armReach(rig) * 0.9, phi = flyAngle(t, R, true), hip = [0.0, 0.53];
    return {
      hip, trunk: 0.05, legs: seatedLegs(rig, hip),
      hands: (sg, sk) => V.add(sk.shoulder(sg), V.scale(V.norm([sg * Math.cos(phi), -0.06, Math.sin(phi)]), R)),
      pole: (sg) => [sg * Math.sin(phi), 0.35, -Math.cos(phi) * 0.6],
      knuckles: [0, -1, 0],
      grip: 1,
      ...flyArms(),
    };
  },
  props(fit) {
    const a = fit.s0.sk.onThorax([0, 1.18, 0.15]);
    const pad = padOn(fit.chest, a, [0.3, 0.07, 0.48]);
    return [
      ...floorMat(), padOn(fit.seat, [0, fit.seat.d, 0.04], [0.4, 0.08, 0.4]),
      { box: { c: [0, (fit.seat.d - 0.08) / 2, 0.04], s: [0.08, fit.seat.d - 0.08, 0.08] }, color: "frame" },
      pad, { box: { c: [0, pad.box.c[1] / 2, pad.box.c[2] + 0.08], s: [0.07, pad.box.c[1], 0.07] }, color: "frame" },
      ...machineFrame(0.62, 2.0), ...flyArmItems(), ...dHandles(fit.rig),
    ];
  },
});

// フェイスプル：高い滑車のロープを、ひじを高く外へ開いて顔の横へ引く
const FACEPULL = [0, 1.72, 0.98];
defineExercise({
  id: "c_facepull",
  roles: { main: ["delts", "scap"], sub: ["traps"], support: ["biceps", "forearms"] },
  cam: { target: [0, 1.25, 0.3], dist: 3.4, yaw: 1.0 },
  pose(t, fit) {
    const rig = fit.rig, e = ease(t);
    return {
      hip: standHip(rig), trunk: -0.05, legs: standLegs(0.14, 0.12),
      hands: (sg, sk) => {
        const S = sk.shoulder(sg);
        return V.lerp([sg * 0.07, S[1] + 0.04, S[2] + 0.5], [sg * 0.25, S[1] + 0.13, S[2] + 0.05], e);
      },
      pole: (sg) => [sg, -0.1, -0.6],
      palm: () => V.norm(V.lerp([0, -1, 0], [0, -0.2, 1], ease(t))),
      grip: 1,
      ...ropeAttach(FACEPULL, 0.12),
    };
  },
  props: () => [...floorMat(), ...cableTower(FACEPULL), ...cableItems(1), ...ropeItems()],
});
// ロープ：滑車 p からケーブルが来て、両手の間（滑車側へ d 寄せた点）で二股に分かれる
function ropeAttach(p, d) {
  const knot = (out) => toward(V.scale(V.add(out.extra.gripR, out.extra.gripL), 0.5), p, d);
  return {
    cables: (sk, out) => [[p, knot(out)]],
    ropes: (sk, out) => [[knot(out), out.extra.gripR], [knot(out), out.extra.gripL]],
  };
}

// アップライトロウ：太ももの前から胸の高さへ、ひじを高く外へ
defineExercise({
  id: "c_uprow",
  roles: { main: ["delts"], sub: ["traps"], support: ["biceps", "forearms"] },
  cam: { target: [0, 1.0, 0], dist: 3.6, yaw: 0.6 },
  barPath: true,
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), gx = 0.15;
    return {
      hip: standHip(rig), trunk: 0.03, legs: standLegs(0.12, 0.1),
      bar: (sk) => {
        const S = sk.shoulder(-1), L = sideReach(rig, gx, 0.985), dz = 0.1;
        const p = V.lerp([0, S[1] - Math.sqrt(L * L - dz * dz), S[2] + dz + 0.01], [0, S[1] - 0.04, S[2] + 0.17], e);
        return V.add(p, [0, 0, 0.045 * Math.sin(Math.PI * e)]);
      },
      hands: (sg, sk, bar) => [sg * gx, bar[1], bar[2]],
      pole: (sg) => [sg, 0.6, -0.2],
      grip: 1,
    };
  },
  props: () => [...floorMat(), ...barbell()],
});

// シュラッグ：腕を伸ばしたまま肩をすくめる
defineExercise({
  id: "c_shrug",
  roles: { main: ["traps"], sub: ["scap"], support: ["forearms"] },
  cam: { target: [0, 1.05, 0], dist: 3.4, yaw: 0.6 },
  barPath: true,
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), gx = 0.24;
    return {
      hip: standHip(rig), trunk: 0.02, legs: standLegs(0.12, 0.1), shrug: 0.07 * e,
      bar: (sk) => { const S = sk.shoulder(-1), L = sideReach(rig, gx, 0.99), dz = 0.105; return [0, S[1] - Math.sqrt(L * L - dz * dz), S[2] + dz]; },
      hands: (sg, sk, bar) => [sg * gx, bar[1], bar[2]],
      pole: (sg) => [sg * 0.2, 0, -1],
      grip: 1,
    };
  },
  props: () => [...floorMat(), ...barbell()],
});
