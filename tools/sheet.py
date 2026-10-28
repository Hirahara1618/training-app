"""画像を格子状に並べて1枚にする。使い方: sheet.py 出力 列数 画像1 見出し1 画像2 見出し2 …"""

import sys

from PIL import Image, ImageDraw


def main(out, cols, *pairs):
    cols = int(cols)
    items = [(pairs[i], pairs[i + 1]) for i in range(0, len(pairs), 2)]
    imgs = [Image.open(f).convert("RGB") for f, _ in items]
    w, h = imgs[0].size
    rows = (len(imgs) + cols - 1) // cols
    sheet = Image.new("RGB", (w * cols, h * rows), (20, 22, 26))
    d = ImageDraw.Draw(sheet)
    for k, (img, (_, label)) in enumerate(zip(imgs, items)):
        x, y = (k % cols) * w, (k // cols) * h
        sheet.paste(img, (x, y))
        d.text((x + 6, y + 4), label.encode("ascii", "replace").decode(), fill=(230, 230, 230))
    sheet.save(out)


if __name__ == "__main__":
    main(*sys.argv[1:])
