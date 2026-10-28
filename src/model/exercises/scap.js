"use strict";
// 種目ごとの肩甲骨の動き（始め t=0 → 終わり t=1）。elev: 挙上(+)・下制(−)、pro: 外転＝前へ開く(+)・内転＝寄せる(−)、m
// 種目の pose が scap を返していなければ、この表の値を t で補間して足す。side を付けると片側だけ

const SCAP_MOTION = {
  // 引く：上や前で開き・上がり、引くと寄って下がる
  chin: { from: { elev: 0.025, pro: 0.01 }, to: { elev: -0.012, pro: -0.02 } },
  c_pullup: { from: { elev: 0.025, pro: 0.01 }, to: { elev: -0.012, pro: -0.02 } },
  latpd: { from: { elev: 0.025, pro: 0.01 }, to: { elev: -0.012, pro: -0.02 } },
  divpd: { from: { elev: 0.022, pro: 0.01 }, to: { elev: -0.012, pro: -0.022 } },
  c_hangleg: { from: { elev: 0.02 }, to: { elev: 0.02 } },
  srow: { from: { pro: 0.025 }, to: { pro: -0.028 } },
  c_bbrow: { from: { pro: 0.025 }, to: { pro: -0.028 } },
  ilrow: { from: { pro: 0.025 }, to: { pro: -0.028 } },
  c_tbar: { from: { pro: 0.022 }, to: { pro: -0.025 } },
  c_dbrow: { from: { pro: 0.03 }, to: { pro: -0.028 }, side: -1 },
  // 押す（寝て・座って）：寄せて下げたまま
  bench: { from: { pro: -0.015, elev: -0.005 }, to: { pro: -0.015, elev: -0.005 } },
  bench8: { from: { pro: -0.015, elev: -0.005 }, to: { pro: -0.015, elev: -0.005 } },
  c_cgbench: { from: { pro: -0.015, elev: -0.005 }, to: { pro: -0.015, elev: -0.005 } },
  c_inbench: { from: { pro: -0.015, elev: -0.005 }, to: { pro: -0.015, elev: -0.005 } },
  c_dbpress: { from: { pro: -0.015, elev: -0.005 }, to: { pro: -0.012, elev: -0.005 } },
  idpress: { from: { pro: -0.015, elev: -0.005 }, to: { pro: -0.012, elev: -0.005 } },
  c_chestpress: { from: { pro: -0.015 }, to: { pro: -0.005 } },
  c_dbfly: { from: { pro: -0.015 }, to: { pro: -0.008 } },
  // 腕立て伏せ：上で肩甲骨を開く。ディップス：下で少し上がる
  c_pushup: { from: { pro: -0.012 }, to: { pro: 0.02 } },
  dips: { from: { elev: 0.015 }, to: { elev: -0.005 } },
  // 頭上へ押す：上で肩甲骨が上がる
  ohp: { from: { elev: 0 }, to: { elev: 0.022 } },
  c_dbsp: { from: { elev: 0 }, to: { elev: 0.02 } },
  cspress: { from: { elev: 0 }, to: { elev: 0.02 } },
  // 横・前・後ろ
  c_uprow: { from: { elev: 0 }, to: { elev: 0.022 } },
  c_dblr: { from: { elev: 0 }, to: { elev: 0.01 } },
  latraise: { from: { elev: 0 }, to: { elev: 0.01 } },
  cablelr: { from: { elev: 0 }, to: { elev: 0.01 }, side: -1 },
  pecfly: { from: { pro: -0.012 }, to: { pro: 0.02 } },
  c_cablecross: { from: { pro: -0.012 }, to: { pro: 0.02 } },
  reardelt: { from: { pro: 0.015 }, to: { pro: -0.025 } },
  c_facepull: { from: { pro: 0.015 }, to: { pro: -0.025 } },
};

for (const id in SCAP_MOTION) {
  const def = EXERCISES[id], m = SCAP_MOTION[id];
  if (!def) continue;
  const pose = def.pose;
  def.pose = (t, fit) => {
    const P = pose(t, fit);
    if (P.scap) return P;
    const e = ease(t);
    const at = { elev: lerp(m.from.elev || 0, m.to.elev || 0, e), pro: lerp(m.from.pro || 0, m.to.pro || 0, e) };
    P.scap = m.side ? (sg) => (sg === m.side ? at : {}) : at;
    return P;
  };
}
