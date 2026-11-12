# Draws the desktop app's icon (desktop/assets/icon.png, 1024 px): the studio's mark, a
# pine in a vertical frame (src/ui/Mark.tsx), on an ink tile sized to the macOS icon grid.
# electron-builder makes the .icns and .ico from it. Run: python3 scripts/icon.py
from PIL import Image, ImageDraw

SIZE, SCALE = 1024, 4
INK_TOP, INK_BOTTOM = (42, 34, 29), (21, 18, 15)
SEAL, SHEET = (185, 52, 37), (253, 251, 248)

big = SIZE * SCALE
canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))

# The tile: 824 px with rounded corners, centred, as macOS draws app icons.
tile = Image.new("RGBA", (big, big), (0, 0, 0, 0))
gradient = Image.new("RGBA", (1, big))
for y in range(big):
    t = y / (big - 1)
    gradient.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(INK_TOP, INK_BOTTOM)) + (255,))
tile.paste(gradient.resize((big, big)))
mask = Image.new("L", (big, big), 0)
inset, side = 100 * SCALE, 824 * SCALE
ImageDraw.Draw(mask).rounded_rectangle((inset, inset, inset + side, inset + side), radius=185 * SCALE, fill=255)
canvas.paste(tile, (0, 0), mask)

# The mark, drawn from its 24-unit drawing, 520 px tall.
unit = 520 * SCALE / 22
def at(x, y):
    return (big / 2 + (x - 12) * unit, big / 2 + (y - 12) * unit)

draw = ImageDraw.Draw(canvas)
x0, y0 = at(5.25, 1)
x1, y1 = at(18.75, 23)
draw.rounded_rectangle((x0, y0, x1, y1), radius=2.2 * unit, fill=SEAL)
draw.polygon([at(12, 4.5), at(15.4, 16.6), at(8.6, 16.6)], fill=SHEET)
tx0, ty0 = at(11.2, 16.2)
tx1, ty1 = at(12.8, 19.4)
draw.rectangle((tx0, ty0, tx1, ty1), fill=SHEET)

canvas.resize((SIZE, SIZE), Image.LANCZOS).save("desktop/assets/icon.png")
print("desktop/assets/icon.png")
