"""Render the GrantSentinel logo (sentinel shield + treasury vault prism).

Generates a 512x512 PNG with Pillow and writes it to frontend/public/logo.png
and docs/logo.png. Deterministic, no external assets.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SIZE = 512
SS = 4  # supersample factor for crisp edges

CHARCOAL = (18, 22, 30)
NAVY = (28, 42, 74)
TEAL_DEEP = (14, 84, 92)
TEAL = (34, 158, 168)
TEAL_LIGHT = (96, 210, 214)
GOLD = (214, 178, 92)
PRISM_A = (52, 120, 180)
PRISM_B = (120, 84, 176)
PRISM_C = (210, 120, 150)
WHITE = (240, 244, 250)


def scaled(points):
    return [(x * SS, y * SS) for (x, y) in points]


def draw():
    img = Image.new("RGB", (SIZE * SS, SIZE * SS), CHARCOAL)
    d = ImageDraw.Draw(img)

    cx = SIZE // 2

    # Shield body (heraldic rounded-top, pointed-bottom).
    shield = [
        (cx - 150, 70),
        (cx + 150, 70),
        (cx + 150, 250),
        (cx + 118, 356),
        (cx, 448),
        (cx - 118, 356),
        (cx - 150, 250),
    ]
    # Outer navy plate.
    d.polygon(scaled(shield), fill=NAVY)

    # Inner teal gradient bands (simple stacked polygons).
    for step in range(14):
        t = step / 13
        col = tuple(int(TEAL_DEEP[i] + (TEAL[i] - TEAL_DEEP[i]) * t) for i in range(3))
        inset = step * 7
        band = [
            (cx - 150 + inset, 70 + inset),
            (cx + 150 - inset, 70 + inset),
            (cx + 150 - inset, 250),
            (cx + 118 - inset, 356 - inset),
            (cx, 448 - inset),
            (cx - 118 + inset, 356 - inset),
            (cx - 150 + inset, 250),
        ]
        d.polygon(scaled(band), outline=col, width=SS * 2)

    # Shield rim highlight.
    d.polygon(scaled(shield), outline=TEAL_LIGHT, width=SS * 3)

    # Gold circuit lines radiating from center (audit trace motif).
    for ang, length in [(-90, 150), (-35, 120), (35, 120), (-145, 120), (145, 120)]:
        import math
        rad = math.radians(ang)
        x0 = cx + 40 * math.cos(rad)
        y0 = 250 + 40 * math.sin(rad)
        x1 = cx + length * math.cos(rad)
        y1 = 250 + length * math.sin(rad)
        d.line(scaled([(x0, y0), (x1, y1)]), fill=GOLD, width=SS * 2)
        d.ellipse(scaled([(x1 - 5, y1 - 5), (x1 + 5, y1 + 5)]), fill=GOLD)

    # Treasury vault prism: a faceted gem at the center.
    top = (cx, 182)
    left = (cx - 62, 250)
    right = (cx + 62, 250)
    bottom = (cx, 330)
    mid = (cx, 250)

    d.polygon(scaled([top, left, mid]), fill=PRISM_A)
    d.polygon(scaled([top, right, mid]), fill=PRISM_B)
    d.polygon(scaled([left, bottom, mid]), fill=PRISM_C)
    d.polygon(scaled([right, bottom, mid]), fill=TEAL_LIGHT)

    # Prism edges.
    gem = [top, right, bottom, left]
    d.line(scaled(gem + [top]), fill=WHITE, width=SS * 2)
    d.line(scaled([left, mid, right]), fill=WHITE, width=SS * 2)
    d.line(scaled([top, mid, bottom]), fill=WHITE, width=SS * 2)

    # Audit aperture (diamond iris) at the prism core.
    iris = [(cx, 226), (cx + 20, 250), (cx, 274), (cx - 20, 250)]
    d.polygon(scaled(iris), fill=NAVY, outline=GOLD, width=SS * 2)
    d.ellipse(scaled([(cx - 7, 243), (cx + 7, 257)]), fill=GOLD)

    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    return img


def main():
    img = draw()
    targets = [ROOT / "frontend" / "public" / "logo.png", ROOT / "docs" / "logo.png"]
    for path in targets:
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path, format="PNG", optimize=True)
        print(f"wrote {path} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
