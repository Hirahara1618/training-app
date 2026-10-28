"use strict";
// 背中の種目

// デッドリフト。t=0 床から引き始め、t=1 立ち上がり。
// バーの位置と胴の角度を決め、腕を伸ばしたまま握れる肩の位置から骨盤の位置を逆算する
defineExercise({
  id: "deadlift",
  roles: { main: ["glutes", "hams", "erectors"], sub: ["quads", "adductors", "traps", "lats"], support: ["abs", "forearms"] },
  cam: { target: [0, 0.72, 0], dist: 3.7 },
  barPath: true,
  pose(t, fit) {
    const rig = fit.rig, gx = 0.24;
    // 前半はおもに膝を伸ばし、後半で股関節を伸ばす
    const u = ease(t), late = ease(clamp((t - 0.25) / 0.75, 0, 1));
    const bar = [0, lerp(0.225, 0.765, u), lerp(0.125, 0.172, u)];
    const th = lerp(1.12, 0.0, late * 0.85 + u * 0.15);
    const L = sideReach(rig, gx, 0.99);
    const dz = lerp(0.06, -0.075, u);               // 肩はバーより前 → 後ろ
    const S = [bar[2] + dz, bar[1] + Math.sqrt(L * L - dz * dz)];
    const leg = { x: 0.12, abd: 0.12 };
    return {
      hip: hipFromShoulder(rig, th, S),
      trunk: th,
      head: lerp(-0.5, -0.02, u),
      legs: { R: leg, L: leg },
      bar,
      hands: (sg) => [sg * gx, bar[1], bar[2]],
      pole: (sg) => [sg * 0.25, 0, -1],
      grip: 1,
    };
  },
  props() { return [...floorMat(), ...barbell()]; },
});

// ラット・プルダウン。t=0 腕を伸ばした上、t=1 胸の前まで引いた
defineExercise({
  id: "latpd",
  roles: { main: ["lats"], sub: ["biceps", "scap", "delts"], support: ["forearms", "abs"] },
  cam: { target: [0, 1.12, 0.15], dist: 3.6 },
  seat: { x: [-0.2, 0.2], z: [-0.12, 0.26] },
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), gx = 0.42;
    const th = lerp(-0.1, -0.26, e);
    const hip = [0.0, 0.53];
    const leg = { ankle: [0.47, rig.sides.R.A[1]], x: 0.13, abd: 0.08 };
    // 上：肩の真上より少し前で腕を伸ばす。下：胸の前
    const top = (sg, sk) => { const S = sk.shoulder(sg); const L = sideReach(rig, gx, 0.985); return [sg * gx, S[1] + L * 0.985, S[2] + L * 0.17]; };
    const bottom = (sg, sk) => { const p = sk.onThorax([0, 1.31, fit.frontZ(1.31) + 0.075]); return [sg * gx, p[1], p[2]]; };
    return {
      hip, trunk: th, head: lerp(-0.08, 0.1, e),
      legs: { R: leg, L: leg },
      hands: (sg, sk) => V.lerp(top(sg, sk), bottom(sg, sk), e),
      bar: (sk) => { const a = V.lerp(top(1, sk), bottom(1, sk), e); return [0, a[1], a[2]]; },
      pole: (sg) => [sg * 0.9, -1, -0.15],
      grip: 1,
      cables: (sk, out) => [[[0, 2.3, out.extra.bar[2]], V.add(out.extra.bar, [0, 0.02, 0])]],
    };
  },
  props(fit) {
    const top = fit.seatTop, barTopZ = fit.barTopZ || 0.25;
    return [
      ...floorMat(),
      { box: { c: [0, top - 0.04, 0.07], s: [0.42, 0.08, 0.4] }, color: "pad", pad: true },
      { box: { c: [0, (top - 0.08) / 2, 0.07], s: [0.08, top - 0.08, 0.08] }, color: "frame" },
      // 太ももを押さえるパッド
      { cyl: { a: [-0.24, top + 0.19, 0.3], b: [0.24, top + 0.19, 0.3], r: 0.05 }, color: "pad" },
      tube([0, 0.05, 0.62], [0, top + 0.2, 0.62], 0.035), tube([-0.26, top + 0.19, 0.62], [0.26, top + 0.19, 0.62], 0.025),
      // 前のケーブルタワーと、上の腕の先の滑車
      ...cableTower([0, 2.3, barTopZ], 0.7),
      // ケーブルとバー（ゆるく曲がった幅広のバー）
      { cyl: { a: [0, 0, 0], b: [0, 1, 0], r: 0.004 }, bone: 16, color: "cable" },
      { tube: { pts: [[-0.6, 0.06, 0], [-0.45, 0.02, 0], [0, 0, 0], [0.45, 0.02, 0], [0.6, 0.06, 0]], r: 0.014 }, bone: 15, color: "metal" },
    ];
  },
});

// ダイバージング・ラット・プルダウン：左右別のハンドルが外へ開きながら下がる（レバー）
defineExercise({
  id: "divpd",
  roles: { main: ["lats"], sub: ["biceps", "scap", "delts"], support: ["forearms", "abs"] },
  cam: { target: [0, 1.12, 0.1], dist: 3.6 },
  seat: { x: [-0.2, 0.2], z: [-0.12, 0.26] },
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), hip = [0.0, 0.53];
    const leg = { ankle: [0.47, rig.sides.R.A[1]], x: 0.13, abd: 0.08 };
    return {
      hip, trunk: lerp(-0.08, -0.2, e), head: lerp(-0.05, 0.08, e), legs: { R: leg, L: leg },
      hands: (sg, sk) => {
        const S = sk.shoulder(sg), L = sideReach(rig, 0.32, 0.975);
        return V.lerp([sg * 0.32, S[1] + Math.sqrt(L * L - 0.12 * 0.12), S[2] + 0.12], [sg * 0.43, S[1] - 0.02, S[2] - 0.0], e);
      },
      pole: (sg) => [sg * 0.3, -1, -0.2],
      palm: (sg) => [-sg, 0, 0],
      grip: 1,
      cables: (sk, out) => ["R", "L"].map((s, k) => [[(k ? 1 : -1) * 0.14, 2.2, -0.3], V.add(out.extra[`grip${s}`], [0, 0.07, 0])]),
    };
  },
  props(fit) {
    const top = fit.seatTop;
    return [
      ...floorMat(),
      { box: { c: [0, top - 0.04, 0.07], s: [0.42, 0.08, 0.4] }, color: "pad", pad: true },
      { box: { c: [0, (top - 0.08) / 2, 0.07], s: [0.08, top - 0.08, 0.08] }, color: "frame" },
      { cyl: { a: [-0.24, top + 0.19, 0.3], b: [0.24, top + 0.19, 0.3], r: 0.05 }, color: "pad" },
      tube([0, 0.05, 0.62], [0, top + 0.2, 0.62], 0.035), tube([-0.26, top + 0.19, 0.62], [0.26, top + 0.19, 0.62], 0.025),
      post(-0.25, -0.42, 2.3, 0.07), post(0.25, -0.42, 2.3, 0.07), tube([-0.25, 2.25, -0.42], [0.25, 2.25, -0.42], 0.035),
      { box: { c: [0, 2.25, -0.33], s: [0.36, 0.08, 0.16] }, color: "steel" },
      ...floorFoot(-0.35, 0.35, -0.42), ...weightStack(0, -0.66, 1.9),
      ...leverItems(2, 0.022), ...dHandles(fit.rig),
    ];
  },
});

// 懸垂：バーにぶら下がり、あごがバーを越えるまで引く。上で体を少し後ろに傾け、頭を引く
const PULL_BAR = { y: 2.12, z: 0.1 };
function pullUp(id, o) {
  defineExercise({
    id, roles: o.roles,
    cam: { target: [0, 1.45, 0.05], dist: 4.0, yaw: 0.7 },
    pose(t, fit) {
      const rig = fit.rig, e = ease(t), dx = o.gx - Math.abs(rig.sides.R.S[0]);
      const L = sideReach(rig, o.gx, 0.985);
      const S = mix2([PULL_BAR.z - 0.02, PULL_BAR.y - Math.sqrt(L * L - 0.02 * 0.02)], [PULL_BAR.z - 0.09, PULL_BAR.y - 0.13 - dx * 0.2], e);
      const th = lerp(0.03, -0.17, e);
      const hip = hipFromShoulder(rig, th, S);
      const leg = { ankle: [hip[0] - 0.12, hip[1] - 0.73], x: 0.08, abd: 0.02, foot: 0.35 };
      return {
        hip, trunk: th, head: lerp(0, -0.3, e), legs: { R: leg, L: leg },
        hands: (sg) => [sg * o.gx, PULL_BAR.y, PULL_BAR.z],
        pole: o.pole, gripSign: o.gripSign, gripAxis: () => [1, 0, 0], grip: 1,
      };
    },
    props() {
      return [...floorMat(), { cyl: { a: [-0.7, PULL_BAR.y, PULL_BAR.z], b: [0.7, PULL_BAR.y, PULL_BAR.z], r: 0.016 }, color: "metal", grip: true },
        post(-0.72, PULL_BAR.z, PULL_BAR.y + 0.05, 0.06), post(0.72, PULL_BAR.z, PULL_BAR.y + 0.05, 0.06)];
    },
  });
}
pullUp("chin", { gx: 0.2, gripSign: -1, pole: (sg) => [sg * 0.3, -1, 0.45], roles: { main: ["lats"], sub: ["biceps", "scap"], support: ["forearms", "abs", "delts"] } });
pullUp("c_pullup", { gx: 0.34, gripSign: 1, pole: (sg) => [sg, -1, 0.1], roles: { main: ["lats"], sub: ["scap", "biceps", "delts"], support: ["forearms", "abs"] } });

// シーテッド・ロウ：低い滑車から V ハンドルを腹へ引く
defineExercise({
  id: "srow",
  roles: { main: ["lats", "scap"], sub: ["biceps", "delts", "traps"], support: ["erectors", "forearms"] },
  cam: { target: [0, 0.75, 0.35], dist: 3.4, yaw: 1.1 },
  fitPads: [{ name: "seat", n: [0, 1, 0], x: [-0.2, 0.2], z: [-0.18, 0.2], slots: [0, 2, 5] }],
  pose(t, fit) {
    const e = ease(t), hip = [0.0, 0.42];
    const leg = { ankle: [0.6, 0.24], x: 0.13, abd: 0.05, foot: -1.25 };
    return {
      hip, trunk: lerp(0.32, -0.06, e), head: lerp(-0.2, 0, e), legs: { R: leg, L: leg },
      hands: (sg, sk) => {
        const S = sk.shoulder(sg), c = sk.onThorax([0, 1.04, fit.frontZ(1.04) + 0.07]);
        return V.lerp([sg * 0.055, S[1] - 0.12, S[2] + 0.5], [sg * 0.055, c[1], c[2]], e);
      },
      pole: (sg) => [sg * 0.45, -0.3, -1],
      knuckles: [0, -1, 0],
      grip: 1,
      cables: (sk, out) => { const m = V.scale(V.add(out.extra.gripR, out.extra.gripL), 0.5); const p = [0, 0.3, 1.05]; return [[p, toward(m, p, 0.05)]]; },
    };
  },
  props(fit) {
    const top = fit.seat.d;
    return [
      ...floorMat(),
      padOn(fit.seat, [0, top, 0.0], [0.36, 0.08, 0.5]),
      { box: { c: [0, (top - 0.08) / 2, 0.3], s: [0.12, top - 0.08, 1.4] }, color: "frame" },
      { box: { c: [0, 0.26, 0.69], s: [0.5, 0.32, 0.03], rx: -0.1 }, color: "frame", label: "足の台" },
      ...cableTower([0, 0.3, 1.05]), ...cableItems(1),
      ...vHandle(fit.rig),
    ];
  },
});
// V ハンドル（両手で握る短い棒、手と一緒に動く）
function vHandle(rig) {
  return heldItems(rig, ["R", "L"], (h) => [{ cyl: { a: V.add(h.Cb, V.scale(h.a0, -0.055)), b: V.add(h.Cb, V.scale(h.a0, 0.055)), r: 0.016 }, color: "metal" }]);
}

// 立って前傾し、バーベルを腹へ引く
const BENT = { hip: [-0.13, 0.76], th: 0.95 };
defineExercise({
  id: "c_bbrow",
  roles: { main: ["lats", "scap"], sub: ["traps", "biceps", "delts"], support: ["erectors", "hams", "glutes"] },
  cam: { target: [0, 0.85, 0.1], dist: 3.6, yaw: 1.0 },
  barPath: true,
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), gx = 0.26;
    const bar = (sk) => {
      const S = sk.shoulder(-1), L = sideReach(rig, gx, 0.985);
      const c = sk.onThorax([0, 1.05, fit.frontZ(1.05) + 0.035]);
      return V.lerp([0, S[1] - Math.sqrt(L * L - 0.05 * 0.05), S[2] + 0.05], c, e);
    };
    return {
      hip: BENT.hip, trunk: BENT.th, head: -0.45, legs: standLegs(0.13, 0.1),
      bar, hands: (sg, sk, b) => [sg * gx, b[1], b[2]],
      pole: (sg) => [sg * 0.4, 0.5, -0.65], grip: 1,
    };
  },
  props: () => [...floorMat(), ...barbell()],
});

// ワンハンドダンベルロウ：左膝と左手をベンチにつき、右手で引く
defineExercise({
  id: "c_dbrow",
  roles: { main: ["lats"], sub: ["scap", "biceps", "delts"], support: ["erectors", "forearms", "abs"] },
  cam: { target: [0, 0.7, 0.1], dist: 3.2, yaw: -1.0 },
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), hip = [-0.12, 0.8], th = 1.3;
    return {
      hip, trunk: th, head: -0.5,
      legs: {
        R: { ankle: [hip[0] + 0.12, rig.sides.R.A[1] + 0.012], x: 0.27, abd: 0.15 },
        L: { ankle: [hip[0] - 0.34, 0.415], x: 0.08, abd: 0, foot: { shin: 1.25 } },
      },
      hands: (sg, sk) => {
        const S = sk.shoulder(sg);
        if (sg > 0) return [0.21, 0.39, S[2] + 0.03];
        return V.lerp(V.add(S, [-0.02, -0.53, 0.04]), V.add(S, [-0.05, -0.12, -0.24]), e);
      },
      pole: (sg) => (sg > 0 ? [0.4, 0, -1] : [-0.2, 0.6, -0.8]),
      knuckles: (sg) => (sg > 0 ? [1, 0, 0] : [0, 0, -1]),
      grip: (sg) => (sg < 0 ? 1 : 0),
    };
  },
  props: (fit) => [
    ...floorMat(),
    { box: { c: [0.2, 0.34, -0.2], s: [0.36, 0.06, 1.1] }, color: "pad", pad: true },
    ...[-0.62, 0.22].flatMap((z) => [tube([0.2, 0.05, z], [0.2, 0.3, z], 0.03), ...floorFoot(0.02, 0.38, z)]),
    { box: { c: [0.2, 0.29, -0.2], s: [0.24, 0.03, 1.0] }, color: "steel", nocheck: true },
    ...dumbbells(fit.rig, ["R"]),
  ],
});

// インクライン・レバー・ロウ：胸を傾いたパッドにあて、レバーのハンドルを引く
const ILROW = { hip: [-0.1, 0.88], th: 0.75 };
defineExercise({
  id: "ilrow",
  roles: { main: ["lats", "scap"], sub: ["traps", "biceps", "delts"], support: ["forearms"] },
  cam: { target: [0, 0.95, 0.2], dist: 3.4, yaw: 1.1 },
  fitPads: [{ name: "chest", n: [0, Math.sin(ILROW.th), -Math.cos(ILROW.th)], slots: [14], y: [1.0, 1.4] }],
  pose(t) {
    const e = ease(t);
    const leg = { ankle: [0.16, 0.21], x: 0.14, abd: 0.12 };
    return {
      hip: ILROW.hip, trunk: ILROW.th, head: -0.3, legs: { R: leg, L: leg },
      hands: (sg, sk) => {
        const S = sk.shoulder(sg);
        return V.lerp(V.add(S, [sg * 0.08, -0.52, 0.08]), V.add(S, [sg * 0.08, -0.2, -0.17]), e);
      },
      pole: (sg) => [sg * 0.35, 0.5, -0.8],
      knuckles: (sg) => [sg, 0, 0],
      grip: 1,
      cables: (sk, out) => ["R", "L"].map((s, k) => [[(k ? 1 : -1) * 0.3, 0.32, 0.72], V.add(out.extra[`grip${s}`], [0, 0.0, 0.05])]),
    };
  },
  props(fit) {
    const a = fit.s0.sk.onThorax([0, 1.2, 0.1]);
    const pad = padOn(fit.chest, a, [0.34, 0.07, 0.5]);
    return [
      ...floorMat(), pad,
      { box: { c: [pad.box.c[0], pad.box.c[1] / 2, pad.box.c[2] + 0.06], s: [0.08, pad.box.c[1], 0.08] }, color: "frame" },
      { box: { c: [0, 0.075, 0.12], s: [0.5, 0.15, 0.45] }, color: "frame", label: "足の台" },
      post(-0.3, 0.72, 0.4), post(0.3, 0.72, 0.4),
      ...leverItems(2, 0.022), ...dHandles(fit.rig),
    ];
  },
});

// T バーロウ：後ろの床に支点がある棒を、またいで胸へ引く
defineExercise({
  id: "c_tbar",
  roles: { main: ["lats", "scap"], sub: ["traps", "biceps", "delts"], support: ["erectors", "hams", "glutes"] },
  cam: { target: [0, 0.8, 0.0], dist: 3.6, yaw: 1.1 },
  pose(t, fit) {
    const rig = fit.rig, e = ease(t);
    return {
      hip: BENT.hip, trunk: BENT.th, head: -0.45, legs: standLegs(0.22, 0.25),
      hands: (sg, sk) => {
        const S = sk.shoulder(sg), c = sk.onThorax([0, 1.0, fit.frontZ(1.0) + 0.13]);
        const L = sideReach(rig, 0.06, 0.985);
        return V.lerp([sg * 0.06, S[1] - L, S[2] + 0.05], [sg * 0.06, c[1], c[2]], e);
      },
      pole: (sg) => [sg * 0.45, 0.5, -0.6],
      knuckles: [0, 0, -1],
      grip: 1,
      cables: (sk, out) => {
        const m = V.scale(V.add(out.extra.gripR, out.extra.gripL), 0.5), P = [0, 0.03, -0.95];
        const d = V.norm(V.sub(m, P));
        return [[P, V.add(m, V.scale(d, 0.34))], [V.add(m, V.scale(d, 0.25)), V.add(m, V.scale(d, 0.3))]];
      },
    };
  },
  props: (fit) => [
    ...floorMat(),
    { cyl: { a: [0, 0, 0], b: [0, 1, 0], r: 0.025 }, bone: 16, color: "metal", label: "Tバー" },
    { cyl: { a: [0, 0, 0], b: [0, 1, 0], r: 0.16 }, bone: 17, color: "plate", label: "プレート", touches: [16] },
    { box: { c: [0, 0.03, -0.95], s: [0.2, 0.06, 0.2] }, color: "frame" },
    ...vHandle(fit.rig),
  ],
});

// バックエクステンション（45°）：脚を台に固定し、股関節から上体を起こす
const BEXT = { hip: [0.0, 1.0] };
defineExercise({
  id: "c_backext",
  roles: { main: ["erectors"], sub: ["glutes", "hams"], support: ["abs"] },
  cam: { target: [0, 0.8, 0.0], dist: 3.6, yaw: 1.2 },
  fitPads: [{ name: "thigh", n: [0, Math.SQRT1_2, -Math.SQRT1_2], slots: [2, 5], y: [0.68, 1.05] }],
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), th = lerp(2.2, 0.82, e);
    const legLen = (rig.sides.R.L1 + rig.sides.R.L2) * 0.985;
    const A = [BEXT.hip[0] - legLen * Math.SQRT1_2, BEXT.hip[1] - legLen * Math.SQRT1_2];
    const leg = { ankle: A, x: 0.1, abd: 0.05, foot: "shin" };
    return {
      hip: BEXT.hip, trunk: th, head: lerp(-0.4, -0.1, e), legs: { R: leg, L: leg },
      hands: (sg, sk) => sk.onThorax([-sg * 0.11, 1.27, fit.frontZ(1.27) + 0.06]),
      pole: (sg, sk) => sk.dir(22, [sg * 0.6, -1, 0.15]),
      palm: (sg, sk) => sk.dir(22, [0, 0, -1]),
      grip: 0,
    };
  },
  props(fit) {
    const s0 = fit.s0, ank = s0.extra.ankleR, a = s0.sk.onPelvis([0, 0.78, 0.1]);
    const pad = padOn(fit.thigh, a, [0.4, 0.07, 0.24], [0, -0.24]);
    const sole = V.add(ank, M3.apply(s0.bones[4].R, [0, -0.06, 0.03]));
    return [
      ...floorMat(), pad,
      ...[-1, 1].map((s) => ({ box: { c: [s * 0.25, pad.box.c[1] / 2, pad.box.c[2] - 0.1], s: [0.06, pad.box.c[1], 0.06] }, color: "frame" })),
      { cyl: { a: [-0.2, ank[1] + 0.05, ank[2] - 0.075], b: [0.2, ank[1] + 0.05, ank[2] - 0.075], r: 0.04 }, color: "pad" },
      { box: { c: [0, sole[1] - 0.02, sole[2] - 0.02], s: [0.42, 0.03, 0.3], rx: Math.PI / 4 }, color: "frame", label: "足の台" },
      { box: { c: [0, 0.25, ank[2] - 0.05], s: [0.08, 0.5, 0.08] }, color: "frame" },
    ];
  },
});
