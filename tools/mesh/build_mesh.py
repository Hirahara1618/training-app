"""BodyParts3D 3.0 の OBJ から、模型用の軽いメッシュを作る（CLAUDE.md 5章）。

使い方: py -3.13 -I tools/mesh/build_mesh.py data/raw/BodyParts3D_3.0_obj_99.zip
出力 (data/bodyparts3d/):
  body.bin, manifest.json                 通常版（格子 約3.2mm）
  body-mobile.bin, manifest-mobile.json   スマホ版（筋5.5mm・骨6mm・手と顔3.5mm）

座標は OBJ のまま（mm、x は左右で右が負、−y が前、z が上）。右側のパーツだけを持ち、
manifest の m=1 のパーツはブラウザで x を反転した左側も描く。
body.bin はパーツごとに int16 頂点（0.5mm単位, xyz）→ uint16 三角形インデックス を連結したもの。
"""

import json
import sys
import zipfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parts import HAND_BONES, parts  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "bodyparts3d"
UNIT = 0.5  # mm

VERSIONS = {
    "": lambda p: 3.2,
    "-mobile": lambda p: 3.5 if (p["r"] in ("hand", "face") or p["id"] in HAND_BONES) else (5.5 if p["c"] == "m" else 6.0),
}


def read_obj(z, pid):
    text = z.read(f"BodyParts3D_3.0_obj_99/{pid}.obj").decode("ascii", "replace")
    vs, fs = [], []
    for line in text.splitlines():
        if line.startswith("v "):
            vs.append(line[2:].split())
        elif line.startswith("f "):
            idx = [int(t.split("/")[0]) - 1 for t in line[2:].split()]
            for k in range(1, len(idx) - 1):  # 多角形は扇形に三角形分割
                fs.append((idx[0], idx[k], idx[k + 1]))
    return np.array(vs, dtype=np.float64), np.array(fs, dtype=np.int64)


def cluster(V, F, cell):
    """頂点クラスタリング：格子に丸めて平均。退化・重複三角形を除く"""
    key = np.floor(V / cell).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.ravel()
    n = inv.max() + 1
    NV = np.zeros((n, 3))
    np.add.at(NV, inv, V)
    NV /= np.bincount(inv, minlength=n)[:, None]
    NF = inv[F]
    NF = NF[(NF[:, 0] != NF[:, 1]) & (NF[:, 1] != NF[:, 2]) & (NF[:, 0] != NF[:, 2])]
    # 同じ3頂点の三角形は1つに（向きは最初のものを残す）
    _, first = np.unique(np.sort(NF, axis=1), axis=0, return_index=True)
    NF = NF[np.sort(first)]
    # 使われなくなった頂点を詰める
    used = np.unique(NF)
    remap = np.full(n, -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    return NV[used], remap[NF]


def main(zip_path):
    z = zipfile.ZipFile(zip_path)
    plist = parts()
    raw = {}
    zmin = np.inf
    for p in plist:
        V, F = read_obj(z, p["id"])
        raw[p["id"]] = (V, F)
        zmin = min(zmin, V[:, 2].min())
        mx = V[:, 0].mean()
        # 右側（x<0）のパーツのはず。正中のパーツは x≈0
        if not p["mid"] and mx > 5:
            print(f"  注意: {p['id']} は左側にあります（平均x={mx:.1f}）")
    OUT.mkdir(parents=True, exist_ok=True)

    for suffix, cell_of in VERSIONS.items():
        chunks, entries, off = [], [], 0
        tv = tf = 0
        for p in plist:
            V, F = raw[p["id"]]
            NV, NF = cluster(V, F, cell_of(p))
            if len(NV) >= 65536:
                raise SystemExit(f"{p['id']}: 頂点が多すぎます（{len(NV)}）")
            q = np.round(NV / UNIT).astype(np.int16)
            vb = q.astype("<i2").tobytes()
            fb = NF.astype("<u2").tobytes()
            entries.append({"id": p["id"], "c": p["c"], "r": p["r"], "m": 0 if p["mid"] else 1,
                            "o": off, "nv": len(NV), "nf": len(NF)})
            chunks += [vb, fb]
            off += len(vb) + len(fb)
            tv += len(NV) * (1 if p["mid"] else 2)
            tf += len(NF) * (1 if p["mid"] else 2)
        data = b"".join(chunks)
        (OUT / f"body{suffix}.bin").write_bytes(data)
        manifest = {"format": 1, "unit": UNIT, "zMin": round(float(zmin), 1), "bytes": len(data), "parts": entries}
        (OUT / f"manifest{suffix}.json").write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
        name = f"body{suffix}.bin"
        print(f"{name:18} 左右込み {tv:>7,} 頂点 / {tf:>7,} 三角形   {len(data) / 1e6:.2f} MB（base64 {len(data) * 4 / 3 / 1e6:.2f} MB）")


if __name__ == "__main__":
    main(sys.argv[1])
