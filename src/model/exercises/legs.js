"use strict";
// 脚の種目

// バックスクワット（ハイバー）。t=0 立った姿勢、t=1 しゃがんだ底
defineExercise({
  id: "squat",
  roles: { main: ["quads"], sub: ["glutes", "adductors"], support: ["abs", "erectors", "hams"] },
  cam: { target: [0, 0.82, 0], dist: 3.7 },
  barPath: true,
  pose(t, fit) {
    const e = ease(t), rig = fit.rig;
    // バーは僧帽筋の上（静止姿勢の背中の表面から決める）
    const barY = rig.c7[1] - 0.06;
    const barRest = [0, barY, fit.backZ(barY) - 0.02];
    const leg = { x: 0.15, abd: lerp(0.28, 0.42, e) };
    return {
      hip: mix2([rig.hipC[2] - 0.005, rig.hipC[1] - 0.005], [-0.14, 0.44], e),
      trunk: lerp(0.04, 0.78, e),
      head: lerp(-0.02, -0.45, e),
      legs: { R: leg, L: leg },
      bar: (sk) => sk.onThorax(barRest),
      hands: (sg, sk, bar) => [sg * 0.3, bar[1] + 0.005, bar[2] + 0.01],
      pole: (sg) => [sg * 0.35, -1, -0.55],
      grip: 1,
    };
  },
  props() { return [...floorMat(), ...barbell()]; },
});
