# 加工済み BodyParts3D メッシュ

BodyParts3D, Copyright© The Database Center for Life Science licensed by CC Attribution-Share Alike 2.1 Japan.

- 元データ: BodyParts3D 3.0（`BodyParts3D_3.0_obj_99.zip`、https://dbarchive.biosciencedbc.jp/data/bodyparts3d/20110915/）
- このフォルダのデータは元データを加工（パーツの選択・間引き・形式の変換）したもので、元と同じ
  **CC BY-SA 2.1 JP**（https://creativecommons.org/licenses/by-sa/2.1/jp/）で公開する。
- 作り方: `py -3.13 -I tools/mesh/build_mesh.py data/raw/BodyParts3D_3.0_obj_99.zip`

| ファイル | 中身 |
|---|---|
| `body.bin` / `manifest.json` | 通常版（格子 約3.2mm） |
| `body-mobile.bin` / `manifest-mobile.json` | スマホ版（筋5.5mm・骨6mm・手と顔3.5mm） |
| `joints.json` | 関節位置（mm、右側） |

座標は OBJ のまま（mm、x は左右で右が負、−y が前、z が上）。`body*.bin` はパーツごとに
int16 頂点（0.5mm単位、xyz）→ uint16 三角形インデックスを連結したもの。manifest の各パーツは
`{id, c: m|b|t, r: 役割, m: 左に反転して複製するか, o: バイト位置, nv, nf}`。
