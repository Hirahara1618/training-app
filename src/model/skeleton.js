"use strict";
// 骨格（静止姿勢）と重み付け（CLAUDE.md 6.1, 6.2）
//
// 骨の番号: 0 骨盤, 1 頭, 2–4 右 太もも・すね・足, 5–7 左, 8–10 右 上腕・前腕・手, 11–13 左, 22 胸郭
// 器具: 14 静止, 15 バー, 16–17 ケーブル, 18–19 ダンベル, 20–21 ロープ
// シェーダーの DQ 配列では 0–13 をそのまま、胸郭(22)を 14 番目に置く。

const BONE = {
  pelvis: 0, head: 1, thorax: 22,
  R: { thigh: 2, shin: 3, foot: 4, upper: 8, fore: 9, hand: 10 },
  L: { thigh: 5, shin: 6, foot: 7, upper: 11, fore: 12, hand: 13 },
};
const BODY_BONES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 22];
function boneSlot(b) { return b === 22 ? 14 : b; }

// 肩まわりの薄い筋：上腕の線分からの距離 [ここより遠いと体幹, ここより近いと上腕]
const SHOULDER_BLEND = { pecs: [0.07, 0.02], lats: [0.04, 0.012], scap: [0.04, 0.012], serratus: [0.03, 0.01], delts: [0.11, 0.035], traps: [0.04, 0.012] };
// 上腕の付け根付近だけに限る筋（腕を上げたとき体から離れないように）
const SHOULDER_ROOT_ONLY = { lats: 1, scap: 1, serratus: 1, traps: 1 };
// 線形（LBS）で混ぜる筋。DQS だと腕を頭上に上げたとき膨らむ
const LBS_ROLES = { lats: 1, pecs: 1, delts: 1, scap: 1, serratus: 1, traps: 1 };
const LEG_ROLES = { glutes: 1, hipflex: 1, quads: 1, adductors: 1, hams: 1 };

const PELVIS_PARTS = { FMA16586: 1, FMA16202: 1 };         // 寛骨・仙骨（種目表示では描かない）
const SCAP_BONES = { FMA13322: 1, FMA13395: 1 };           // 鎖骨・肩甲骨
const PATELLA = "FMA24486";
const SHIN_BONES = { FMA24477: 1, FMA24480: 1 };
const FORE_BONES = { FMA23464: 1, FMA23467: 1 };
const CERVICAL = { FMA12521: 1, FMA12522: 1, FMA12523: 1, FMA12524: 1, FMA12525: 1 };
const HEAD_BONES = { FMA52734: 1, FMA52735: 1, FMA52736: 1, FMA52748: 1, FMA52738: 1, FMA52788: 1, FMA52892: 1, FMA53649: 1, FMA53647: 1 };
const FOOT_BONES = new Set(["FMA24482", "FMA24497", "FMA24500", "FMA24507", "FMA24509", "FMA24511", "FMA24513", "FMA24515", "FMA43253",
  "FMA32634", "FMA32636", "FMA32638", "FMA32640", "FMA32642", "FMA32644", "FMA32646", "FMA230986", "FMA32650", "FMA32652", "FMA32654", "FMA32656", "FMA32658"]);
const HAND_BONE_IDS = new Set(Array.from({ length: 23 }, (_, i) => `FMA${24450 + i}`));
const METACARPALS = ["FMA24466", "FMA24468", "FMA24470", "FMA24472"]; // 人差し指〜小指
const THUMB_PARTS = new Set(["FMA24450", "FMA24459", "FMA24464", "FMA37386", "FMA37390", "FMA46110", "FMA65198"]);
const FINGER_BONES = new Set(["FMA24451", "FMA24452", "FMA24453", "FMA24454", "FMA24455", "FMA24456", "FMA24457", "FMA24458",
  "FMA24460", "FMA24461", "FMA24462", "FMA24463", ...METACARPALS]);
const GRIP_RADIUS = 0.021; // 指の芯からバーの中心まで（m）

// ---- 静止姿勢の骨格 ----
function buildRig(joints, zMin) {
  const w = (p) => [p[0] / 1000, (p[2] - zMin) / 1000, -p[1] / 1000];
  const J = {};
  for (const k in joints) J[k] = w(joints[k]);
  const sides = {};
  for (const [s, f] of [["R", (p) => p], ["L", V.mirror]]) {
    sides[s] = {
      H: f(J.hip), K: f(J.knee), A: f(J.ankle), T: f(J.toe),
      S: f(J.shoulder), E: f(J.elbow), W: f(J.wrist), F: f(J.fingertip), sg: s === "R" ? -1 : 1,
    };
    const x = sides[s];
    x.Lu = V.dist(x.S, x.E); x.Lf = V.dist(x.E, x.W);
    x.L1 = V.dist(x.H, x.K); x.L2 = V.dist(x.K, x.A);
    x.uHat = V.norm(V.sub(x.E, x.S)); x.fHat = V.norm(V.sub(x.W, x.E));
    // 腕の曲げの面の法線（肩・手首と、肘がその線からずれる向きで決める）
    const sw = V.sub(x.W, x.S);
    x.kdir0 = V.norm(V.perp(V.sub(x.E, x.S), V.norm(sw)));
    x.n0 = V.norm(V.cross(sw, x.kdir0));
  }
  const hipC = [0, J.hip[1], J.hip[2]];
  return {
    J, sides, hipC,
    SP: [0, J.l5[1] + 0.07, J.l5[2]],          // 胸郭の回転中心（L5 の 7cm 上）
    NP: [0, J.c7[1] + 0.03, J.c7[2]],          // 頭の回転中心
    c7: J.c7, skullc: J.skullc,
  };
}

// 手の形（指の付け根の線、手のひらの向き、握る位置）をメッシュから求める
function buildHand(rig, parts) {
  const R = rig.sides.R;
  const byId = {};
  for (const p of parts) if (p.side !== "L") byId[p.id] = p;
  const fdir = V.norm(V.sub(R.F, R.W));
  const mcp = METACARPALS.map((id) => {
    const pos = byId[id].pos, pts = [];
    for (let i = 0; i < pos.length; i += 3) pts.push([pos[i], pos[i + 1], pos[i + 2]]);
    pts.sort((a, b) => V.dot(b, fdir) - V.dot(a, fdir));
    const top = pts.slice(0, Math.max(3, Math.round(pts.length * 0.1)));
    return V.scale(top.reduce((s, p) => V.add(s, p), [0, 0, 0]), 1 / top.length);
  });
  const Kc = V.scale(mcp.reduce((s, p) => V.add(s, p), [0, 0, 0]), 1 / 4);
  const a0 = V.norm(V.sub(mcp[3], mcp[0]));                 // 人差し指 → 小指
  const fh = V.norm(V.perp(V.sub(R.F, Kc), a0));            // 指の向き
  // 手のひら側：小指球の筋の重心がある側
  let palmSide = [0, 0, 0], n = 0;
  for (const id of ["FMA37396", "FMA37398", "FMA37400"]) {
    const pos = byId[id].pos;
    for (let i = 0; i < pos.length; i += 3) { palmSide = V.add(palmSide, [pos[i], pos[i + 1], pos[i + 2]]); n++; }
  }
  palmSide = V.sub(V.scale(palmSide, 1 / n), Kc);
  let p0 = V.norm(V.cross(a0, fh));
  if (V.dot(p0, palmSide) < 0) p0 = V.scale(p0, -1);
  const Cb = V.add(Kc, V.scale(p0, GRIP_RADIUS));
  // 親指と他の指を見分けるための点
  const sample = (ids, step) => {
    const out = [];
    for (const id of ids) { const pos = byId[id].pos; for (let i = 0; i < pos.length; i += 3 * step) out.push([pos[i], pos[i + 1], pos[i + 2]]); }
    return out;
  };
  const hand = { R: { Kc, a0, fh, p0, Cb }, thumbPts: sample(THUMB_PARTS, 2), fingerPts: sample(FINGER_BONES, 2) };
  hand.R.curlAxis = V.norm(V.cross(fh, p0));
  hand.L = { Kc: V.mirror(Kc), a0: V.mirror(a0), fh: V.mirror(fh), p0: V.mirror(p0), Cb: V.mirror(Cb) };
  hand.L.curlAxis = V.norm(V.cross(hand.L.fh, hand.L.p0));
  rig.hand = hand;
  return hand;
}

// ---- 重み付け ----
// 返り値 [b0, b1, w0]（b0 の重みが w0、b1 が 1−w0）
function skinWeights(rig, p, v) {
  const sideKey = p.side === "L" || (p.side === "C" && v[0] > 0) ? "L" : "R";
  const s = rig.sides[sideKey], B = BONE[sideKey];
  const y = v[1], z = v[2];

  const trunk = () => [22, 0, smoothstep(rig.SP[1] - 0.06, rig.SP[1] + 0.16, y)];
  const neck = () => [1, 22, smoothstep(rig.c7[1] + 0.01, rig.skullc[1] - 0.03, y)];
  const hip = () => {
    const back = smoothstep(s.H[2] + 0.02, s.H[2] - 0.07, z);
    return [B.thigh, 0, smoothstep(s.H[1] + 0.07 + 0.05 * back, s.H[1] - 0.05 - 0.13 * back, y)];
  };
  const knee = (shift) => [B.thigh, B.shin, smoothstep(s.K[1] - 0.045 + (shift || 0), s.K[1] + 0.045 + (shift || 0), y)];
  const ankle = () => [B.shin, B.foot, smoothstep(s.A[1] - 0.025, s.A[1] + 0.035, y)];
  const elbow = () => {
    const tu = V.dot(V.sub(v, s.S), s.uHat);
    return [B.upper, B.fore, 1 - smoothstep(s.Lu - 0.05, s.Lu + 0.025, tu)];
  };
  const wrist = () => {
    const tf = V.dot(V.sub(v, s.E), s.fHat);
    return [B.fore, B.hand, 1 - smoothstep(s.Lf - 0.025, s.Lf + 0.015, tf)];
  };
  const shoulder = (role) => {
    const [far, near] = SHOULDER_BLEND[role];
    let w = smoothstep(far, near, segDist(v, s.S, s.E));
    if (SHOULDER_ROOT_ONLY[role]) w *= smoothstep(0.12, 0.06, V.dist(v, s.S));
    if (w > 0.001) return [B.upper, 22, w];
    if (role === "traps" && y > rig.c7[1] + 0.02) return neck();
    return trunk();
  };
  const legMid = (s.H[1] + s.K[1]) / 2, shinMid = (s.K[1] + s.A[1]) / 2;

  if (PELVIS_PARTS[p.id]) return [0, 0, 1];
  if (SCAP_BONES[p.id]) return shoulder("scap");
  if (p.id === PATELLA) return knee();
  if (SHIN_BONES[p.id]) return [B.shin, B.shin, 1];
  if (FOOT_BONES.has(p.id) || p.r === "foot") return [B.foot, B.foot, 1];
  if (p.id === "FMA258847") return ankle();
  if (FORE_BONES[p.id]) return [B.fore, B.fore, 1];
  if (HAND_BONE_IDS.has(p.id) || p.r === "hand") return [B.hand, B.hand, 1];
  if (CERVICAL[p.id] || p.r === "neck") return neck();
  if (HEAD_BONES[p.id] || p.r === "face") return [1, 1, 1];
  if (SHOULDER_BLEND[p.r]) return shoulder(p.r);
  if (p.r === "biceps" || p.r === "triceps") return elbow();
  if (p.r === "forearms") return V.dot(V.sub(v, s.E), s.fHat) < s.Lf * 0.5 ? elbow() : wrist();
  // 薄筋はすねにつく：膝の平面を少し上げて、膝の内側から飛び出さないように
  if (p.id === "FMA43883") return y > legMid ? hip() : knee(0.02);
  if (LEG_ROLES[p.r] || p.id === "FMA58776") return y > legMid ? hip() : knee();
  if (p.r === "calves" || p.r === "shin") return y > shinMid ? knee() : ankle();
  return trunk(); // 腹・脊柱起立筋・白線・肋骨・胸骨・脊椎
}

// 部品ごとに、頂点の骨・重み・握りの位置を作る
function buildSkin(rig, parts) {
  const hand = rig.hand;
  for (const p of parts) {
    const n = p.pos.length / 3;
    const bones = new Float32Array(n * 3);  // slot0, slot1, w0
    const extra = new Float32Array(n * 2);  // LBS, 握り
    const p2 = new Float32Array(p.pos);
    const n2 = new Float32Array(p.nrm);
    const lbs = LBS_ROLES[p.r] || SCAP_BONES[p.id] ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const v = [p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]];
      let [b0, b1, w0] = skinWeights(rig, p, v);
      if (w0 < 0.5) { [b0, b1, w0] = [b1, b0, 1 - w0]; } // 重い方を b0 に
      bones[i * 3] = boneSlot(b0); bones[i * 3 + 1] = boneSlot(b1); bones[i * 3 + 2] = w0;
      extra[i * 2] = lbs;
      // 握り：手の骨にほぼ全部ついていて、指の付け根より先にある頂点（腱も含む、親指は除く）
      const sideKey = b0 === 10 ? "R" : b0 === 13 ? "L" : null;
      if (sideKey && w0 > 0.98) {
        const h = hand[sideKey];
        const rel = V.sub(v, h.Kc);
        const sAlong = V.dot(rel, h.fh);
        if (sAlong > 0 && !isThumb(hand, sideKey, v)) {
          const phi = Math.min(sAlong / GRIP_RADIUS, 3.0);
          const r = GRIP_RADIUS - V.dot(rel, h.p0);
          const l = V.dot(rel, h.a0);
          const q = V.add(V.add(h.Cb, V.scale(h.a0, l)), V.add(V.scale(h.p0, -r * Math.cos(phi)), V.scale(h.fh, r * Math.sin(phi))));
          p2[i * 3] = q[0]; p2[i * 3 + 1] = q[1]; p2[i * 3 + 2] = q[2];
          // 法線も指の曲がりに合わせて回す（軸 fh×p0、角度 φ で fh が p0 側へ倒れる）
          const nr = M3.apply(M3.axis(h.curlAxis, phi), [p.nrm[i * 3], p.nrm[i * 3 + 1], p.nrm[i * 3 + 2]]);
          n2[i * 3] = nr[0]; n2[i * 3 + 1] = nr[1]; n2[i * 3 + 2] = nr[2];
          extra[i * 2 + 1] = 1;
        }
      }
    }
    p.bones = bones; p.extra = extra; p.p2 = p2; p.n2 = n2;
  }
}

function isThumb(hand, sideKey, v) {
  const m = sideKey === "L" ? V.mirror(v) : v;  // 標本点は右手のもの
  let best = Infinity, thumb = false;
  for (const q of hand.thumbPts) { const d = V.dist(m, q); if (d < best) { best = d; thumb = true; } }
  for (const q of hand.fingerPts) { const d = V.dist(m, q); if (d < best) { best = d; thumb = false; } }
  return thumb;
}
