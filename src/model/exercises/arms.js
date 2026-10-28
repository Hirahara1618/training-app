"use strict";
// 腕の種目（二頭・三頭）
// カール系：肘の位置を固定（elbow）し、前腕は少し外向き（人の腕の自然な角度）

// 体の横に置いた肘（立ってカール・プレスダウン）
function sideElbow(sk, sg, rig, fwd) {
  return V.add(sk.shoulder(sg), V.scale(V.norm([sg * 0.12, -1, fwd == null ? 0.08 : fwd]), rig.sides.R.Lu));
}
// 肘 E から、前腕の向き（下 → 前上）を角度 beta で回した握る位置。out は外向きの度合い
function curlHand(E, sg, beta, rig, out) {
  return V.add(E, V.scale(V.norm([sg * (out == null ? 0.2 : out), -Math.cos(beta), Math.sin(beta)]), forearmReach(rig) * 0.98));
}
const CURL_BETA = [0.3, 2.3];

function standingCurl(id, o) {
  defineExercise({
    id, roles: o.roles,
    cam: { target: [0, 1.0, 0], dist: 3.3, yaw: 1.0 },
    barPath: !!o.bar,
    pose(t, fit) {
      const rig = fit.rig, beta = lerp(CURL_BETA[0], CURL_BETA[1], ease(t));
      const elbow = (sg, sk) => sideElbow(sk, sg, rig);
      const hand = (sg, sk) => curlHand(elbow(sg, sk), sg, beta, rig);
      const P = {
        hip: standHip(rig), trunk: 0.03, legs: standLegs(0.12, 0.1),
        elbow, hands: hand, pole: (sg) => [sg * 0.2, 0, -1], grip: 1,
      };
      if (o.bar) {
        P.bar = (sk) => { const a = hand(-1, sk); return [0, a[1], a[2]]; };
        P.gripSign = -1;
      } else if (o.palm) P.palm = o.palm;
      else P.knuckles = (sg) => [-sg, 0, 0];
      if (o.pulley) Object.assign(P, o.rope ? ropeAttach(o.pulley, 0.12) : { cables: (sk, out) => [[o.pulley, toward(out.extra.bar, o.pulley, 0.03)]] });
      return P;
    },
    props: (fit) => {
      const items = [...floorMat()];
      if (o.pulley) items.push(...cableTower(o.pulley), ...cableItems(1));
      if (o.rope) items.push(...ropeItems());
      else if (o.bar) items.push(...shortBar(o.pulley ? 0.5 : 1.3, o.pulley ? 0 : 0.11));
      else items.push(...dumbbells(fit.rig, ["R", "L"], 0.055));
      return items;
    },
  });
}
const CURL_ROLES = { main: ["biceps"], sub: ["forearms"], support: ["delts"] };
standingCurl("c_bbcurl", { bar: true, roles: CURL_ROLES });
standingCurl("c_dbcurl", { roles: CURL_ROLES });
standingCurl("c_dbhammer", { palm: (sg) => [-sg, 0, 0], roles: { main: ["biceps", "forearms"], sub: [], support: ["delts"] } });
standingCurl("hammer", { palm: (sg) => [-sg, 0, 0], rope: true, pulley: [0, 0.12, 0.42], roles: { main: ["biceps", "forearms"], sub: [], support: ["delts"] } });
standingCurl("c_cablecurl", { bar: true, pulley: [0, 0.12, 0.42], roles: CURL_ROLES });

// インクラインダンベルカール：45°の背もたれで、腕は真下に垂らしたまま
const INCLINE45 = { hip: [0.0, 0.55], th: -0.75 };
defineExercise({
  id: "idcurl",
  roles: { main: ["biceps"], sub: ["forearms"], support: ["delts"] },
  cam: { target: [0, 0.95, -0.1], dist: 3.3, yaw: 1.2 },
  fitPads: seatFits(INCLINE45.hip, INCLINE45.th, { backFrom: 0.1 }),
  pose(t, fit) {
    const rig = fit.rig, beta = lerp(0.15, 2.0, ease(t));
    const elbow = (sg, sk) => V.add(sk.shoulder(sg), V.scale(V.norm([sg * 0.2, -1, -0.1]), rig.sides.R.Lu));
    return {
      hip: INCLINE45.hip, trunk: INCLINE45.th, legs: seatedLegs(rig, INCLINE45.hip, { reach: 0.5, x: 0.2, abd: 0.25 }),
      elbow, hands: (sg, sk) => curlHand(elbow(sg, sk), sg, beta, rig, 0.15),
      pole: (sg) => [sg * 0.2, 0, -1], knuckles: (sg) => [-sg, 0, 0], grip: 1,
    };
  },
  props: (fit) => [...floorMat(), ...seatProps(fit, INCLINE45.hip, { backLen: 0.8, backY: 1.15, backWidth: 0.24 }), ...dumbbells(fit.rig, ["R", "L"], 0.055)],
});

// プリーチャーカール：二の腕を前の傾いた台に乗せて
const PREACH = { hip: [-0.04, 0.53], th: 0.08 };
defineExercise({
  id: "preacher",
  roles: { main: ["biceps"], sub: ["forearms"], support: ["delts"] },
  cam: { target: [0, 1.0, 0.2], dist: 3.2, yaw: 1.2 },
  barPath: true,
  fitPads: [
    { name: "seat", n: [0, 1, 0], x: [-0.2, 0.2], z: [-0.16, 0.24], slots: [0, 2, 5] },
    { name: "arm", n: [0, 0.78, 0.62], slots: [8, 11], x: [-0.3, 0.3] },
  ],
  pose(t, fit) {
    const rig = fit.rig, e = ease(t);
    const u = V.norm([0, -0.62, 0.78]);
    const elbow = (sg, sk) => V.add(sk.shoulder(sg), V.scale(V.norm([sg * 0.07, u[1], u[2]]), rig.sides.R.Lu));
    const hand = (sg, sk) => V.add(elbow(sg, sk), V.scale(slerpDir([sg * 0.12, -0.6, 0.8], [sg * 0.12, 0.92, -0.25], e * 0.88), forearmReach(rig) * 0.98));
    return {
      hip: PREACH.hip, trunk: PREACH.th, legs: seatedLegs(rig, PREACH.hip),
      elbow, hands: hand, bar: (sk) => { const a = hand(-1, sk); return [0, a[1], a[2]]; },
      pole: (sg) => [sg * 0.2, -0.5, -1], gripSign: -1, grip: 1,
    };
  },
  props(fit) {
    const a = fit.s0.extra.elbowR;
    const pad = Object.assign(padOn(fit.arm, [0, a[1], a[2]], [0.46, 0.045, 0.26], [0, 0.12]), { label: "プリーチャー台" });
    return [
      ...floorMat(), padOn(fit.seat, [0, fit.seat.d, 0.04], [0.4, 0.08, 0.4]),
      { box: { c: [0, (fit.seat.d - 0.08) / 2, 0.04], s: [0.08, fit.seat.d - 0.08, 0.08] }, color: "frame" },
      pad, { box: { c: [0, pad.box.c[1] / 2, pad.box.c[2] + 0.05], s: [0.08, pad.box.c[1], 0.08] }, color: "frame" },
      ...shortBar(1.2, 0.11),
    ];
  },
});

// コンセントレーションカール：座って前かがみ、右ひじを右太ももの内側にあてる
defineExercise({
  id: "c_concurl",
  roles: { main: ["biceps"], sub: ["forearms"], support: [] },
  cam: { target: [0, 0.7, 0.2], dist: 3.0, yaw: -0.5 },
  fitPads: [{ name: "seat", n: [0, 1, 0], x: [-0.25, 0.25], z: [-0.16, 0.24], slots: [0, 2, 5] }],
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), hip = [0.0, 0.53];
    const kR = rig.sides.R.K, kL = rig.sides.L.K;
    const elbow = (sg, sk) => (sg < 0 ? V.add(sk.onBone(2, [kR[0] + 0.05, kR[1] + 0.1, kR[2] + 0.0]), [0.045, 0.03, 0]) : null);
    return {
      hip, trunk: 0.55, head: 0.2, legs: seatedLegs(rig, hip, { reach: 0.42, x: 0.3, abd: 0.5 }),
      elbow,
      hands: (sg, sk) => {
        if (sg > 0) return V.add(sk.onBone(5, [kL[0], kL[1] + 0.06, kL[2] + 0.06]), [0, 0.05, 0]);
        const E = elbow(sg, sk), S = sk.shoulder(sg);
        return V.add(E, V.scale(slerpDir([0.1, -1, 0.3], V.add(V.norm(V.sub(S, E)), [0, 0, 0.25]), e * 0.85), forearmReach(rig) * 0.98));
      },
      pole: (sg) => (sg < 0 ? [-0.3, -0.3, -1] : [0.5, 0.3, -0.6]),
      knuckles: (sg) => (sg < 0 ? [1, 0, 0] : null),
      palm: [0, -1, 0],
      grip: (sg) => (sg < 0 ? 1 : 0),
    };
  },
  props: (fit) => [
    ...floorMat(), padOn(fit.seat, [0, fit.seat.d, -0.06], [0.4, 0.08, 0.42]),
    { box: { c: [0, (fit.seat.d - 0.08) / 2, -0.06], s: [0.08, fit.seat.d - 0.08, 0.3] }, color: "frame" },
    ...dumbbells(fit.rig, ["R"], 0.055),
  ],
});

// ---- 三頭 ----

// ケーブルプレスダウン：ひじを体の横に固定し、前腕を下へ伸ばす
defineExercise({
  id: "pushdown",
  roles: { main: ["triceps"], sub: [], support: ["forearms", "abs", "lats"] },
  cam: { target: [0, 1.15, 0.15], dist: 3.4, yaw: 1.0 },
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), p = [0, 2.05, 0.4];
    const elbow = (sg, sk) => sideElbow(sk, sg, rig, 0.14);
    const hand = (sg, sk) => V.add(elbow(sg, sk), V.scale(slerpDir([sg * 0.12, 0.45, 1], [sg * 0.12, -1, 0.2], e), forearmReach(rig) * 0.98));
    return {
      hip: standHip(rig), trunk: 0.14, head: -0.1, legs: standLegs(0.13, 0.1),
      elbow, hands: hand, bar: (sk) => { const a = hand(-1, sk); return [0, a[1], a[2]]; },
      pole: (sg) => [sg * 0.2, 0, -1], grip: 1,
      cables: (sk, out) => [[p, toward(out.extra.bar, p, 0.03)]],
    };
  },
  props: () => [...floorMat(), ...cableTower([0, 2.05, 0.4]), ...cableItems(1), ...shortBar(0.5, 0)],
});

// オーバーヘッドトライセプスエクステンション：座って、頭の後ろから頭上へ
defineExercise({
  id: "ohte",
  roles: { main: ["triceps"], sub: [], support: ["delts", "abs", "forearms"] },
  cam: { target: [0, 1.25, 0], dist: 3.4, yaw: 1.2 },
  barPath: true,
  fitPads: seatFits(UPRIGHT.hip, UPRIGHT.th),
  pose(t, fit) {
    const rig = fit.rig, gam = lerp(2.45, 0.1, ease(t));
    const elbow = (sg, sk) => V.add(sk.shoulder(sg), V.scale(V.norm([-sg * 0.06, 1, -0.06]), rig.sides.R.Lu));
    const hand = (sg, sk) => V.add(elbow(sg, sk), V.scale(V.norm([sg * 0.02, Math.cos(gam), -Math.sin(gam)]), forearmReach(rig) * 0.98));
    return Object.assign(uprightBase(rig), {
      head: 0.12,
      elbow, hands: hand, bar: (sk) => { const a = hand(-1, sk); return [0, a[1], a[2]]; },
      pole: (sg) => [sg * 0.2, 0, 1], grip: 1,
    });
  },
  props: (fit) => [...floorMat(), ...seatProps(fit, UPRIGHT.hip, { backLen: 0.42, backY: 1.0 }), ...shortBar(1.1, 0.1)],
});

// ライイングトライセプスエクステンション：仰向けで、額の上へ下ろす
defineExercise({
  id: "c_skull",
  roles: { main: ["triceps"], sub: [], support: ["delts", "forearms"] },
  cam: { target: [0, 0.75, -0.3], dist: 3.0, yaw: 2.0 },
  start: 1, barPath: true, seat: SUPINE_SEAT,
  pose(t, fit) {
    const rig = fit.rig, gam = lerp(2.0, 0.12, ease(t));
    const elbow = (sg, sk) => V.add(sk.shoulder(sg), V.scale(V.norm([-sg * 0.02, 0.96, -0.28]), rig.sides.R.Lu));
    const hand = (sg, sk) => V.add(elbow(sg, sk), V.scale(V.norm([sg * 0.03, Math.cos(gam), -Math.sin(gam)]), forearmReach(rig) * 0.98));
    return Object.assign(supinePose(rig), {
      elbow, hands: hand, bar: (sk) => { const a = hand(-1, sk); return [0, a[1], a[2]]; },
      pole: (sg) => [sg * 0.2, 0, 1], grip: 1,
    });
  },
  props: (fit) => [...flatBenchProps(fit), ...shortBar(1.2, 0.11)],
});

// ナローグリップベンチプレス
benchPress("c_cgbench", { gx: 0.2, chestY: 1.15, pole: (sg) => [sg * 0.4, -1, 0.5], roles: { main: ["triceps"], sub: ["pecs", "delts"], support: ["serratus"] } });

// キックバック：前傾し、二の腕を胴と平行に保って、前腕を後ろへ伸ばす
defineExercise({
  id: "c_kickback",
  roles: { main: ["triceps"], sub: [], support: ["delts", "erectors"] },
  cam: { target: [0, 0.9, 0], dist: 3.3, yaw: 1.3 },
  pose(t, fit) {
    const rig = fit.rig, e = ease(t), th = 1.05, up = torsoUp(th);
    const elbow = (sg, sk) => V.add(sk.shoulder(sg), V.scale(V.norm([sg * 0.12, -up[1] - 0.15, -up[2]]), rig.sides.R.Lu));
    return {
      hip: [-0.14, 0.76], trunk: th, head: -0.45, legs: standLegs(0.13, 0.1),
      elbow, hands: (sg, sk) => V.add(elbow(sg, sk), V.scale(slerpDir([sg * 0.1, -1, 0.05], [sg * 0.1, -up[1], -up[2]], e), forearmReach(rig) * 0.98)),
      pole: (sg) => [sg * 0.2, 0.4, -1], palm: (sg) => [-sg, 0, 0], grip: 1,
    };
  },
  props: (fit) => [...floorMat(), ...dumbbells(fit.rig, ["R", "L"], 0.055)],
});
