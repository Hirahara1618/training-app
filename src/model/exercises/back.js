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
    const bar = [0, lerp(0.225, 0.765, u), lerp(0.125, 0.155, u)];
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
      post(0, 0.62, top + 0.2, 0.07),
      // 柱と上の梁・滑車
      post(0, 0.78, 2.35, 0.1),
      { box: { c: [0, 2.32, (barTopZ + 0.78) / 2], s: [0.08, 0.06, 0.78 - barTopZ + 0.1] }, color: "frame" },
      { cyl: { a: [-0.03, 2.3, barTopZ], b: [0.03, 2.3, barTopZ], r: 0.05 }, color: "metal" },
      // ケーブルとバー（ゆるく曲がった幅広のバー）
      { cyl: { a: [0, 0, 0], b: [0, 1, 0], r: 0.004 }, bone: 16, color: "cable" },
      { tube: { pts: [[-0.6, 0.06, 0], [-0.45, 0.02, 0], [0, 0, 0], [0.45, 0.02, 0], [0.6, 0.06, 0]], r: 0.014 }, bone: 15, color: "metal" },
    ];
  },
});
