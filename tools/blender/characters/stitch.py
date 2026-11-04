"""Stitch preview tiles into one contact sheet (system python3 + Pillow).
Usage: python3 stitch.py OUT.png COLS tile1.png tile2.png ..."""
import os
import sys

from PIL import Image, ImageDraw

out, cols, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
ims = [Image.open(f).convert('RGB') for f in files]
w, h = ims[0].size
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (w * cols, h * rows), (10, 12, 24))
d = ImageDraw.Draw(sheet)
for i, (im, f) in enumerate(zip(ims, files)):
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(im, (x, y))
    d.text((x + 8, y + 6), os.path.splitext(os.path.basename(f))[0], fill=(255, 255, 255))
sheet.save(out)
print('sheet', out, sheet.size)
