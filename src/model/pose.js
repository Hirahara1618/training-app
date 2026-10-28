"use strict";
// 姿勢 → 骨の変換（CLAUDE.md 6.4）
//
// pose(t) が返すもの（位置はメートル、z が体の前、y が上）:
// { hip:[z,y], trunk:前傾(rad), spine?:背骨の屈曲, head?:角度, shrug?:肩の挙上m,
//   legs:{R:{ankle:[z,y], x?:足首の左右の位置, foot: 角度|"shin"|{shin:差分}, abd?:外転}, L:{…}},
//   hands: (sg, sk)=>[x,y,z]（握る位置）, pole: (sg, sk)=>肘の向き, elbow?: (sg, sk)=>肘の位置,
//   palm?: (sg, sk)=>手のひらの向き, grip?: 0〜1, bar?: [x,y,z] | sk=>[x,y,z],
//   gripAxis?: sg=>握る棒の軸（バーがあれば x 軸）, gripSign?: ±1（+1 順手）,
//   cables?: [[始点,終点],…] }
// sg は右=-1・左=+1。sk は体幹まで解いた途中の骨格（onThorax, onPelvis, shoulder）。

function rigid(R, J0, J) { return { R, t: V.sub(J, M3.apply(R, J0)) }; }
function applyT(T, p) { return V.add(M3.apply(T.R, p), T.t); }

// 2関節の IK。根元 A から先端 C までを長さ L1, L2 でつなぎ、関節を kdir 側に出す
function twoBone(A, C, L1, L2, kdir) {
  let d = V.sub(C, A);
  let D = V.len(d);
  d = V.scale(d, 1 / (D || 1));
  D = clamp(D, Math.abs(L1 - L2) + 1e-4, (L1 + L2) * 0.9995);
  const a = (L1 * L1 - L2 * L2 + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  let k = V.perp(kdir, d);
  if (V.len(k) < 1e-6) k = V.perp([0, 0, 1], d);
  k = V.norm(k);
  return { mid: V.add(A, V.add(V.scale(d, a), V.scale(k, h))), end: V.add(A, V.scale(d, D)) };
}

function resolveFn(x, ...args) { return typeof x === "function" ? x(...args) : x; }

// state は種目ごとに持ち回る（手のねじれを前のコマから連続させる）
function solvePose(rig, P, state) {
  state = state || {};
  const out = { bones: {}, extra: {} };
  const B = out.bones;

  // 骨盤・胸郭・頭
  const R0 = M3.rx(P.trunk || 0);
  const hipC = [0, P.hip[1], P.hip[0]];
  B[0] = rigid(R0, rig.hipC, hipC);
  const R22 = M3.mul(R0, M3.rx(P.spine || 0));
  B[22] = rigid(R22, rig.SP, applyT(B[0], rig.SP));
  const R1 = M3.mul(R22, M3.rx(P.head || 0));
  B[1] = rigid(R1, rig.NP, applyT(B[22], rig.NP));

  const sk = {
    onPelvis: (p) => applyT(B[0], p),
    onThorax: (p) => applyT(B[22], p),
    shoulder: (sg) => shoulderPos(rig, P, B, sg),
    rig,
  };
  out.sk = sk;

  // 脚：股関節を通る体の側面の平面内で解く
  for (const side of ["R", "L"]) {
    const s = rig.sides[side], ids = BONE[side];
    const L = (P.legs && P.legs[side]) || {};
    const H = applyT(B[0], s.H);
    const ax = L.x == null ? s.A[0] : s.sg * Math.abs(L.x); // 足幅（足首の左右の位置）
    const A = L.ankle ? [ax, L.ankle[1], L.ankle[0]] : [ax, s.A[1], s.A[2]];
    const Rabd = M3.ry(s.sg * (L.abd || 0)); // 外転：つま先と膝を外へ（ry(+) は前を +x へ回す）
    const side0 = [1, 0, 0];
    const n = M3.apply(M3.mul(Rabd, R0), side0);
    const fwd = V.cross(V.norm(V.sub(A, H)), n);   // 膝が出る向き
    const { mid: K, end: Ae } = twoBone(H, A, s.L1, s.L2, fwd);
    B[ids.thigh] = rigid(M3.align(V.sub(s.K, s.H), side0, V.sub(K, H), n), s.H, H);
    const Rshin = M3.align(V.sub(s.A, s.K), side0, V.sub(Ae, K), n);
    B[ids.shin] = rigid(Rshin, s.K, K);
    let Rf;
    if (L.foot === "shin") Rf = Rshin;
    else if (L.foot && typeof L.foot === "object") Rf = M3.mul(M3.axis(V.norm(n), L.foot.shin), Rshin);
    else Rf = M3.mul(Rabd, M3.rx(L.foot || 0));
    B[ids.foot] = rigid(Rf, s.A, Ae);
  }

  // バー（他の位置の基準になるので先に決める）
  const bar = P.bar ? resolveFn(P.bar, sk) : null;
  out.extra.bar = bar;

  // 腕
  state.twist = state.twist || { R: null, L: null };
  for (const side of ["R", "L"]) {
    const s = rig.sides[side], ids = BONE[side], sg = s.sg, h = rig.hand[side];
    const S = shoulderPos(rig, P, B, sg);
    const G = resolveFn(P.hands, sg, sk, bar);
    const pole = V.norm(resolveFn(P.pole, sg, sk) || [sg, -1, -0.5]);
    const fixedElbow = P.elbow ? P.elbow(sg, sk) : null;
    let Rh = state.lastRh && state.lastRh[side] ? state.lastRh[side] : M3.I();
    let E, W, Ru, Rfo, Rhand;
    for (let it = 0; it < 4; it++) {
      // 握る位置が G に来るように手首の目標を決める
      const Wt = V.sub(G, M3.apply(Rh, V.sub(h.Cb, s.W)));
      if (fixedElbow) {
        E = fixedElbow;
        W = V.add(E, V.scale(V.norm(V.sub(Wt, E)), s.Lf));
      } else {
        const r = twoBone(S, Wt, s.Lu, s.Lf, pole);
        E = r.mid; W = r.end;
      }
      // 曲げの面：肩・手首と、肘がその線からずれる向き（ほぼ伸びているときは pole）
      const sw = V.norm(V.sub(W, S));
      let kd = V.perp(V.sub(E, S), sw);
      kd = V.len(kd) > 0.004 ? V.norm(kd) : V.norm(V.perp(pole, sw));
      const n = V.norm(V.cross(V.sub(W, S), kd));
      Ru = M3.align(V.sub(s.E, s.S), s.n0, V.sub(E, S), n);
      const Rf0 = M3.align(V.sub(s.W, s.E), s.n0, V.sub(W, E), n);
      // 手のひらのねじれ（前腕の軸まわり）。前腕は半分、手は全部
      const f = V.norm(V.sub(W, E));
      let cur, want;
      const axis = P.gripAxis ? P.gripAxis(sg) : (bar ? [1, 0, 0] : null);
      if (axis) {
        cur = M3.apply(Rf0, h.a0);
        want = V.scale(axis, (P.gripSign == null ? 1 : P.gripSign) * sg);
      } else {
        cur = M3.apply(Rf0, h.p0);
        want = P.palm ? resolveFn(P.palm, sg, sk) : cur;
      }
      const c = V.perp(cur, f), w = V.perp(want, f);
      let T = Math.atan2(V.dot(f, V.cross(c, w)), V.dot(c, w));
      // ±180°付近で向きが飛ばないよう、前のコマから連続させる
      const prev = state.twist[side];
      if (prev != null) T = prev + wrapPi(T - prev);
      state.twistNext = state.twistNext || {};
      state.twistNext[side] = T;
      Rfo = M3.mul(M3.axis(f, T / 2), Rf0);
      Rhand = M3.mul(M3.axis(f, T), Rf0);
      Rh = Rhand;
    }
    B[ids.upper] = rigid(Ru, s.S, S);
    B[ids.fore] = rigid(Rfo, s.E, E);
    B[ids.hand] = rigid(Rhand, s.W, W);
    state.lastRh = state.lastRh || {};
    state.lastRh[side] = Rhand;
    out.extra[`grip${side}`] = applyT(B[ids.hand], h.Cb);
    out.extra[`elbow${side}`] = E;
  }
  state.twist = state.twistNext;
  out.grip = P.grip == null ? (bar ? 1 : 0) : P.grip;
  out.cables = P.cables ? resolveFn(P.cables, sk, out) : [];
  return out;
}

function shoulderPos(rig, P, B, sg) {
  const s = rig.sides[sg < 0 ? "R" : "L"];
  const S = applyT(B[22], s.S);
  return P.shrug ? V.add(S, M3.apply(B[22].R, [0, P.shrug, 0])) : S;
}

// 腕の長さ（肩から握る位置まで、肘を伸ばしたとき）
function armReach(rig) {
  const s = rig.sides.R;
  return s.Lu + s.Lf + V.dist(s.W, rig.hand.R.Cb) * 0.9;
}
