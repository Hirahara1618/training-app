"use strict";
// 胸の種目

// 仰向けで平らなベンチに寝る（ベンチ・ダンベルプレス・フライ・ライイングエクステンション）
const SUPINE_HIP = [0.3, 0.6];
function supinePose(rig) {
  const leg = { ankle: [0.72, rig.sides.R.A[1]], x: 0.24, abd: 0.35 };
  return { hip: SUPINE_HIP, trunk: -Math.PI / 2, legs: { R: leg, L: leg } };
}
const SUPINE_SEAT = { x: [-0.14, 0.14], z: [-0.95, 0.22] };
function flatBenchProps(fit, rack) {
  const items = [...floorMat(), ...flatBench(fit.seatTop, -0.95, 0.22)];
  if (rack) items.push(post(-0.55, -0.42, 1.25), post(0.55, -0.42, 1.25));
  return items;
}
// 胸の位置（仰向け・インクラインで、バーやダンベルを下ろす高さ）
function chestPoint(sk, fit, y, out) { return sk.onThorax([0, y, fit.frontZ(y) + (out || 0)]); }

// バーベルを胸から真上へ押す（t=0 胸、t=1 上。上から始める）
function benchPress(id, o) {
  defineExercise({
    id, roles: o.roles,
    cam: { target: [0, 0.7, -0.25], dist: 3.2, yaw: 2.3 },
    start: 1, barPath: true, seat: SUPINE_SEAT,
    pose(t, fit) {
      const rig = fit.rig, e = ease(t);
      const barAt = (sk) => {
        const S = sk.shoulder(-1);
        const top = [0, S[1] + sideReach(rig, o.gx, 0.985), S[2] + 0.03];
        const p = chestPoint(sk, fit, o.chestY || 1.17, 0.02);
        return V.lerp([0, p[1], p[2]], top, e);
      };
      return Object.assign(supinePose(rig), {
        bar: barAt,
        hands: (sg, sk, bar) => [sg * o.gx, bar[1], bar[2]],
        pole: (sg) => o.pole(sg),
        grip: 1,
      });
    },
    props: (fit) => [...flatBenchProps(fit, true), ...barbell()],
  });
}
benchPress("bench", { gx: 0.38, pole: (sg) => [sg, -0.7, 0.45], roles: { main: ["pecs"], sub: ["delts", "triceps"], support: ["serratus", "lats"] } });
benchPress("bench8", { gx: 0.38, pole: (sg) => [sg, -0.7, 0.45], roles: { main: ["pecs"], sub: ["delts", "triceps"], support: ["serratus", "lats"] } });

// ダンベルプレス（平らなベンチ）
defineExercise({
  id: "c_dbpress",
  roles: { main: ["pecs"], sub: ["delts", "triceps"], support: ["serratus", "forearms"] },
  cam: { target: [0, 0.7, -0.25], dist: 3.2, yaw: 2.3 },
  start: 1, seat: SUPINE_SEAT,
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), gx0 = 0.27, gx1 = 0.15;
    return Object.assign(supinePose(rig), {
      hands: (sg, sk) => {
        const S = sk.shoulder(sg), c = chestPoint(sk, fit, 1.2, 0);
        const bottom = [sg * gx0, c[1] + 0.03, c[2]];
        const top = [sg * gx1, S[1] + sideReach(rig, gx1, 0.975), S[2] + 0.03];
        return V.lerp(bottom, top, e);
      },
      pole: (sg) => [sg, -0.9, 0.3],
      knuckles: (sg) => [sg, 0, 0],
      grip: 1,
    });
  },
  props: (fit) => [...flatBenchProps(fit), ...dumbbells(fit.rig)],
});

// ダンベルフライ：肩を中心とした円弧（肘の角度は固定）
defineExercise({
  id: "c_dbfly",
  roles: { main: ["pecs"], sub: ["delts"], support: ["biceps", "serratus"] },
  cam: { target: [0, 0.7, -0.25], dist: 3.2, yaw: 2.3 },
  start: 1, seat: SUPINE_SEAT,
  pose(t, fit) {
    const rig = fit.rig, phi = lerp(1.32, 0.12, ease(t)), R = armReach(rig) * 0.9;
    return Object.assign(supinePose(rig), {
      hands: (sg, sk) => V.add(sk.shoulder(sg), V.scale([sg * Math.sin(phi), Math.cos(phi), 0.06], R)),
      pole: (sg) => [sg * Math.cos(phi), -Math.sin(phi), 0.45],
      knuckles: [0, 0, 1],
      grip: 1,
    });
  },
  props: (fit) => [...flatBenchProps(fit), ...dumbbells(fit.rig)],
});

// ---- インクラインベンチ（背もたれ約30°）----
const INCLINE = { hip: [0.0, 0.55], th: -1.05 };
function inclineFits() { return seatFits(INCLINE.hip, INCLINE.th, { backFrom: 0.1 }); }
function inclineBase(rig) { return { hip: INCLINE.hip, trunk: INCLINE.th, legs: seatedLegs(rig, INCLINE.hip, { reach: 0.5, x: 0.22, abd: 0.3 }) }; }
function inclineProps(fit) { return [...floorMat(), ...seatProps(fit, INCLINE.hip, { backLen: 0.85, backY: 1.15 })]; }

defineExercise({
  id: "c_inbench",
  roles: { main: ["pecs"], sub: ["delts", "triceps"], support: ["serratus"] },
  cam: { target: [0, 0.95, -0.15], dist: 3.3, yaw: 2.3 },
  start: 1, barPath: true, fitPads: inclineFits(),
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), gx = 0.36;
    return Object.assign(inclineBase(rig), {
      bar: (sk) => {
        const S = sk.shoulder(-1), c = chestPoint(sk, fit, 1.27, 0.02);
        return V.lerp([0, c[1], c[2]], [0, S[1] + sideReach(rig, gx, 0.985), S[2]], e);
      },
      hands: (sg, sk, bar) => [sg * gx, bar[1], bar[2]],
      pole: (sg) => [sg, -0.6, 0.35],
      grip: 1,
    });
  },
  props: (fit) => [...inclineProps(fit), post(-0.55, -0.62, 1.55), post(0.55, -0.62, 1.55), ...barbell()],
});

// インクラインダンベルプレス：下で前腕はほぼ垂直、上は肩の真上でダンベルは左右水平・すき間あり
defineExercise({
  id: "idpress",
  roles: { main: ["pecs"], sub: ["delts", "triceps"], support: ["serratus", "forearms"] },
  cam: { target: [0, 0.95, -0.15], dist: 3.3, yaw: 2.3 },
  start: 1, fitPads: inclineFits(),
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), gx1 = 0.15;
    return Object.assign(inclineBase(rig), {
      hands: (sg, sk) => {
        const S = sk.shoulder(sg), c = chestPoint(sk, fit, 1.25, 0);
        const bottom = [sg * 0.29, c[1] + 0.04, c[2] - 0.02];
        const top = [sg * gx1, S[1] + sideReach(rig, gx1, 0.975), S[2]];
        return V.lerp(bottom, top, e);
      },
      pole: (sg) => [sg, -1, 0.1],
      knuckles: (sg) => [sg, 0, 0],
      grip: 1,
    });
  },
  props: (fit) => [...inclineProps(fit), ...dumbbells(fit.rig)],
});

// ---- 座って押すマシン ----
const SEATED_UP = { hip: [0.0, 0.53], th: -0.12 };
function seatedBase(rig, o) {
  o = o || {};
  const hip = o.hip || SEATED_UP.hip;
  return { hip, trunk: o.th == null ? SEATED_UP.th : o.th, legs: seatedLegs(rig, hip, o.legs) };
}
// マシンの枠：後ろの2本柱と上の梁、床の足、後ろにウエイトスタック
function machineFrame(z, h) {
  h = h || 1.9;
  const back = z + Math.sign(z || -1) * 0.25;
  return [
    post(-0.42, z, h), post(0.42, z, h), tube([-0.42, h - 0.03, z], [0.42, h - 0.03, z], 0.03),
    ...floorFoot(-0.5, 0.5, z), ...weightStack(0, back, h - 0.25),
    tube([-0.2, h - 0.03, z], [-0.2, h - 0.03, back], 0.025), tube([0.2, h - 0.03, z], [0.2, h - 0.03, back], 0.025),
  ];
}

// チェストプレス（マシン）：座って前へ押す。レバーとハンドル
defineExercise({
  id: "c_chestpress",
  roles: { main: ["pecs"], sub: ["delts", "triceps"], support: ["serratus"] },
  cam: { target: [0, 1.0, 0.2], dist: 3.2, yaw: 0.9 },
  fitPads: seatFits(SEATED_UP.hip, SEATED_UP.th),
  pose(t, fit) {
    const rig = fit.rig, e = ease(t);
    return Object.assign(seatedBase(rig), {
      hands: (sg, sk) => {
        const S = sk.shoulder(sg);
        return V.lerp([sg * 0.25, S[1] - 0.08, S[2] + 0.1], [sg * 0.17, S[1] - 0.06, S[2] + sideReach(rig, 0.17, 0.96)], e);
      },
      pole: (sg) => [sg, -0.7, -0.4],
      knuckles: [0, -1, 0],
      grip: 1,
      cables: (sk, out) => ["R", "L"].map((s, k) => [[(k ? 1 : -1) * 0.34, 1.75, -0.12], V.add(out.extra[`grip${s}`], [0, 0.07, 0])]),
    });
  },
  props: (fit) => [...floorMat(), ...seatProps(fit, SEATED_UP.hip), ...machineFrame(-0.2), ...leverItems(2, 0.022), ...dHandles(fit.rig)],
});

// ペック・フライ：肩を中心に水平の円弧で、手を前で合わせる
function flyAngle(t, R, rev) {
  const end = Math.acos(clamp(-0.078 / R, -1, 1));
  const e = ease(t);
  return rev ? lerp(end, 0.05, e) : lerp(0.12, end, e);
}
defineExercise({
  id: "pecfly",
  roles: { main: ["pecs"], sub: ["delts"], support: ["biceps", "serratus"] },
  cam: { target: [0, 1.05, 0.1], dist: 3.2, yaw: 0.6 },
  fitPads: seatFits(SEATED_UP.hip, -0.05),
  pose(t, fit) {
    const rig = fit.rig, R = armReach(rig) * 0.9, phi = flyAngle(t, R);
    return Object.assign(seatedBase(rig, { th: -0.05 }), {
      hands: (sg, sk) => V.add(sk.shoulder(sg), V.scale(V.norm([sg * Math.cos(phi), -0.08, Math.sin(phi)]), R)),
      pole: (sg) => [sg * Math.sin(phi), -0.5, -Math.cos(phi)],
      knuckles: [0, -1, 0],
      grip: 1,
      ...flyArms(),
    });
  },
  props: (fit) => [...floorMat(), ...seatProps(fit, SEATED_UP.hip), ...machineFrame(-0.22, 2.0), ...flyArmItems(), ...dHandles(fit.rig)],
});

// ペックデックの腕：肩の真上の軸から水平に伸びる腕（骨16,17）と、そこから下がる縦のハンドル（骨20,21）
function flyArms() {
  const top = (sk, sg) => sk.shoulder(sg)[1] + 0.42;
  return {
    cables: (sk, out) => ["R", "L"].map((s, k) => {
      const sg = k ? 1 : -1, S = sk.shoulder(sg), g = out.extra[`grip${s}`], y = top(sk, sg);
      return [[S[0], y, S[2] - 0.02], [g[0], y, g[2]]];
    }),
    ropes: (sk, out) => ["R", "L"].map((s, k) => {
      const g = out.extra[`grip${s}`];
      return [[g[0], top(sk, k ? 1 : -1), g[2]], V.add(g, [0, 0.07, 0])];
    }),
  };
}
function flyArmItems() {
  return [...leverItems(2, 0.022), ...[20, 21].map((bone) => ({ cyl: { a: [0, 0, 0], b: [0, 1, 0], r: 0.015 }, bone, color: "frame" }))];
}

// ケーブルクロスオーバー：高い滑車から、手を体の前で合わせる円弧
const XOVER = [0.85, 2.05, -0.05];
defineExercise({
  id: "c_cablecross",
  roles: { main: ["pecs"], sub: ["delts"], support: ["abs", "serratus"] },
  cam: { target: [0, 1.15, 0], dist: 3.8, yaw: 0.5 },
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), R = armReach(rig) * 0.9, th = 0.22;
    return {
      hip: standHip(rig), trunk: th, legs: standLegs(0.14, 0.12),
      hands: (sg, sk) => arcPoint(sk.shoulder(sg), [sg * 0.85, 0.35, 0.4], [-sg * 0.2, -0.62, 0.76], e, R),
      pole: (sg) => [sg * 0.6, -0.3, -0.75],
      palm: (sg) => [-sg, 0, 0],
      grip: 1,
      cables: (sk, out) => ["R", "L"].map((s, k) => { const p = [(k ? 1 : -1) * XOVER[0], XOVER[1], XOVER[2]]; return [p, toward(out.extra[`grip${s}`], p, 0.05)]; }),
    };
  },
  props: (fit) => [...floorMat(), ...cableTower([-XOVER[0], XOVER[1], XOVER[2]], -1), ...cableTower([XOVER[0], XOVER[1], XOVER[2]], 1), ...cableItems(2), ...dHandles(fit.rig)],
});

// ディップス：平行棒で体を上下（下で少し前傾、膝を曲げる）
const DIP_BAR = { y: 1.4, z: 0.1, x: 0.26 };
defineExercise({
  id: "dips",
  roles: { main: ["pecs", "triceps"], sub: ["delts"], support: ["abs", "serratus"] },
  cam: { target: [0, 1.25, 0.05], dist: 3.6, yaw: 0.9 },
  start: 1,
  pose(t, fit) {
    const rig = fit.rig, e = ease(t);
    const L = sideReach(rig, DIP_BAR.x, 0.985);
    const top = [DIP_BAR.z - 0.01, DIP_BAR.y + L], bottom = [DIP_BAR.z + 0.04, DIP_BAR.y + L - 0.26];
    const S = mix2(bottom, top, e), th = lerp(0.42, 0.12, e);
    const hip = hipFromShoulder(rig, th, S);
    const leg = { ankle: [hip[0] - 0.3, hip[1] - 0.6], x: 0.09, abd: 0.05, foot: 0.3 };
    return {
      hip, trunk: th, head: lerp(-0.25, -0.1, e), legs: { R: leg, L: leg },
      hands: (sg) => [sg * DIP_BAR.x, DIP_BAR.y, DIP_BAR.z],
      pole: (sg) => [sg * 0.25, 0, -1],
      knuckles: [0, 0, -1],
      grip: 1,
    };
  },
  props() {
    const items = [...floorMat()];
    for (const s of [-1, 1]) {
      items.push({ cyl: { a: [s * DIP_BAR.x, DIP_BAR.y, -0.35], b: [s * DIP_BAR.x, DIP_BAR.y, 0.55], r: 0.02 }, color: "metal", grip: true });
      items.push(post(s * DIP_BAR.x, -0.33, DIP_BAR.y, 0.05), post(s * DIP_BAR.x, 0.53, DIP_BAR.y, 0.05));
    }
    return items;
  },
});

// 腕立て伏せ：足首と手を床に置き、体はまっすぐ
defineExercise({
  id: "c_pushup",
  roles: { main: ["pecs"], sub: ["triceps", "delts"], support: ["abs", "serratus", "quads"] },
  cam: { target: [0, 0.35, 0.0], dist: 3.0, yaw: 1.0 },
  start: 1,
  pose(t, fit) {
    const rig = fit.rig, e = ease(t);
    const A = [-0.78, 0.13], gz = 0.42, gx = 0.26;
    const Lb = 0.5025 + (rig.sides.R.L1 + rig.sides.R.L2) * 0.995;
    const Sy = lerp(0.2, 0.025 + sideReach(rig, gx, 0.975), e);
    const S = [A[0] + Math.sqrt(Lb * Lb - (Sy - A[1]) ** 2), Sy];
    const th = Math.atan2(S[0] - A[0], S[1] - A[1]) + 0.036;
    const hip = hipFromShoulder(rig, th, S);
    const leg = { ankle: A, x: 0.1, abd: 0, foot: "shin" };
    return {
      hip, trunk: th, head: -0.1, legs: { R: leg, L: leg },
      hands: (sg) => [sg * gx, 0.025, gz],
      pole: (sg) => [sg * 0.6, 0.3, -1],
      palm: [0, -1, 0],
      grip: 0,
    };
  },
  props: () => floorMat(),
});
