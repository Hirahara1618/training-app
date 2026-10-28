"use strict";
// 胸の種目

// ベンチプレス。t=0 胸まで下ろした、t=1 腕を伸ばした上。上から始める（start:1）
defineExercise({
  id: "bench",
  roles: { main: ["pecs"], sub: ["delts", "triceps"], support: ["serratus", "lats"] },
  cam: { target: [0, 0.7, -0.25], dist: 3.2, yaw: 2.3 },
  start: 1,
  barPath: true,
  seat: { x: [-0.14, 0.14], z: [-0.95, 0.22] },
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), gx = 0.38;
    const hip = [0.3, 0.6];
    const leg = { ankle: [0.72, rig.sides.R.A[1]], x: 0.24, abd: 0.35 };
    const chestY = 1.17;
    const barAt = (sk) => {
      const S = sk.shoulder(-1);
      const top = [0, S[1] + sideReach(rig, gx, 0.985), S[2] + 0.03];
      const p = sk.onThorax([0, chestY, fit.frontZ(chestY) + 0.02]);
      const bottom = [0, p[1], p[2]];
      return V.lerp(bottom, top, e);
    };
    return {
      hip, trunk: -Math.PI / 2,
      legs: { R: leg, L: leg },
      bar: barAt,
      hands: (sg, sk, bar) => [sg * gx, bar[1], bar[2]],
      pole: (sg) => [sg, -0.7, 0.45],
      grip: 1,
    };
  },
  props(fit) {
    const top = fit.seatTop;
    return [
      ...floorMat(),
      ...flatBench(top, -0.95, 0.22),
      // ラックの支柱（頭の側）
      post(-0.55, -0.42, 1.25), post(0.55, -0.42, 1.25),
      ...barbell(),
    ];
  },
});
