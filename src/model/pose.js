"use strict";
// 姿勢 → 骨の変換（CLAUDE.md 6.4）
//
// pose(t) が返すもの（位置はメートル、z が体の前、y が上）:
// { hip:[z,y], trunk:前傾(rad), spine?:背骨の屈曲, head?:角度, shrug?:肩の挙上m,
//   legs:{R:{ankle:[z,y], x?:足首の左右の位置, foot: 角度|"shin"|{shin:差分}, abd?:外転}, L:{…}},
//   hands: (sg, sk)=>[x,y,z]（握る位置）, pole: (sg, sk)=>肘の向き, elbow?: (sg, sk)=>肘の位置,
//   palm?: (sg, sk)=>手のひらの向き, grip?: 0〜1, bar?: [x,y,z] | sk=>[x,y,z],
//   gripAxis?: sg=>握る棒の軸（バーがあれば x 軸）, gripSign?: ±1（+1 順手）,
//   knuckles?: (sg, sk)=>人差し指→小指の向き（ダンベル・ハンドル。前腕と平行にしない）,
//   cables?: (sk, out)=>[[始点,終点],…]（骨16,17）, ropes?: 同じ（骨20,21） }
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

  // 肩甲骨の骨：胸郭と同じ回転で、肩甲骨の動きの分だけずれる
  for (const side of ["R", "L"]) {
    const sg = side === "R" ? -1 : 1;
    B[BONE[side].scap] = { R: R22, t: V.add(B[22].t, M3.apply(R22, scapShift(P, sg))) };
  }

  const sk = {
    onPelvis: (p) => applyT(B[0], p),
    onThorax: (p) => applyT(B[22], p),
    shoulder: (sg) => shoulderPos(rig, P, B, sg),
    // 骨に付いた点・向き（脚の骨は脚を解いたあとで使える）
    onBone: (b, p) => applyT(B[b], p),
    dir: (b, v) => M3.apply(B[b].R, v),
    rig,
  };
  out.sk = sk;
  sk.extra = out.extra;

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
    out.extra[`knee${side}`] = K;
    out.extra[`toe${side}`] = Math.max(0, Math.min(1, (L.toe || 0) / TOE_MAX));
    out.extra[`ankle${side}`] = Ae;
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
    // 手の回転 → 手首の目標 → 前腕の向き → ねじれ → 手の回転 … を収まるまで繰り返す
    // （途中で打ち切ると前のコマの結果に引きずられ、動きがガタつく）
    // 最初のコマ（前の結果がない）は十分に収束させる。そうしないと次のコマとの差が跳ねに見える
    let Wprev = null;
    const maxIt = state.lastRh && state.lastRh[side] ? 50 : 150;
    for (let it = 0; it < maxIt; it++) {
      // 握る位置が G に来るように手首の目標を決める
      const Wt = V.sub(G, M3.apply(Rh, V.sub(h.Cb, s.W)));
      if (Wprev && V.dist(Wt, Wprev) < 1e-6) break;
      Wprev = Wt;
      if (fixedElbow) {
        // 肘の位置は向きとして使い、上腕の長さは保つ
        E = V.add(S, V.scale(V.norm(V.sub(fixedElbow, S)), s.Lu));
        W = V.add(E, V.scale(V.norm(V.sub(Wt, E)), s.Lf));
      } else {
        const r = twoBone(S, Wt, s.Lu, s.Lf, pole);
        E = r.mid; W = r.end;
      }
      // 曲げの面。肘を固定する種目では上腕と pole の面（前腕の振りで上腕がねじれないように）。
      // それ以外は肩・手首と、肘がその線からずれる向き。ほぼ伸びているときは pole の向きへなめらかに移す
      let n;
      if (fixedElbow) {
        const u = V.norm(V.sub(E, S));
        n = V.norm(V.cross(u, V.norm(V.perp(pole, u))));
      } else {
        const sw = V.norm(V.sub(W, S));
        const kg = V.perp(V.sub(E, S), sw);
        let kp = V.norm(V.perp(pole, sw));
        if (V.dot(kp, kg) < 0) kp = V.scale(kp, -1);
        const w = smoothstep(0.002, 0.03, V.len(kg));
        const kd = V.norm(V.add(V.scale(kp, 1 - w), V.scale(V.norm(kg), w)));
        n = V.norm(V.cross(V.sub(W, S), kd));
      }
      Ru = M3.align(V.sub(s.E, s.S), s.n0, V.sub(E, S), n);
      const Rf0 = M3.align(V.sub(s.W, s.E), s.n0, V.sub(W, E), n);
      // 手のひらのねじれ（前腕の軸まわり）。前腕は半分、手は全部
      const f = V.norm(V.sub(W, E));
      let cur, want;
      const axis = P.gripAxis ? P.gripAxis(sg) : (bar ? [1, 0, 0] : null);
      const kn = P.knuckles ? resolveFn(P.knuckles, sg, sk) : null;
      if (kn) {
        // 人差し指 → 小指の向きを直接指定（ダンベル・ハンドル）
        cur = M3.apply(Rf0, h.a0);
        want = kn;
      } else if (axis) {
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
  // 握り（0〜1）。関数なら左右別 grip(sg)。後ろの2つは足の指の反り（0〜1）
  const g = P.grip == null ? (bar ? 1 : 0) : P.grip;
  out.gripLR = typeof g === "function" ? [g(-1), g(1)] : [g, g];
  out.gripLR.push(out.extra.toeR, out.extra.toeL);
  out.grip = Math.max(out.gripLR[0], out.gripLR[1]);
  out.cables = P.cables ? resolveFn(P.cables, sk, out) : [];
  out.ropes = P.ropes ? resolveFn(P.ropes, sk, out) : [];
  return out;
}

// 肩甲骨の動き（胸郭の座標でのずれ m）：elev 挙上(+)・下制(−)、pro 外転＝前へ(+)・内転＝寄せる(−)。shrug は elev と同じ
function scapShift(P, sg) {
  const sc = typeof P.scap === "function" ? P.scap(sg) : (P.scap || {});
  const elev = (sc.elev || 0) + (P.shrug || 0), pro = sc.pro || 0;
  return [sg * 0.35 * Math.max(0, pro) + sg * 0.25 * Math.min(0, pro), elev, pro];
}
function shoulderPos(rig, P, B, sg) {
  const s = rig.sides[sg < 0 ? "R" : "L"];
  return V.add(applyT(B[22], s.S), M3.apply(B[22].R, scapShift(P, sg)));
}

// 腕の長さ（肩から握る位置まで、肘を伸ばしたとき）
function armReach(rig) {
  const s = rig.sides.R;
  return s.Lu + s.Lf + V.dist(s.W, rig.hand.R.Cb) * 0.9;
}

// 骨格全体を上下に動かす（床に寝る・座る種目で体を床に乗せる）
function shiftSolved(out, dy) {
  if (!dy) return out;
  const d = [0, dy, 0];
  for (const b in out.bones) out.bones[b] = { R: out.bones[b].R, t: V.add(out.bones[b].t, d) };
  for (const k in out.extra) if (Array.isArray(out.extra[k])) out.extra[k] = V.add(out.extra[k], d);
  out.cables = out.cables.map(([a, b]) => [V.add(a, d), V.add(b, d)]);
  out.ropes = out.ropes.map(([a, b]) => [V.add(a, d), V.add(b, d)]);
  return out;
}
