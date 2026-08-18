#!/usr/bin/env python3
"""Cut the favicon out of the wordmark.

design.md section 7: the mark is the wordmark and nothing else, so the icon is
a square crop of it — the initials HK in the same face at the same weight and
the same -0.02em tracking, paper on ink. No letter is re-set or re-spaced for
the square, which is why the letterforms come out of the shipped font file
rather than being drawn again here.

Run after any change to the wordmark font or the brand card:

    python ops/make-icons.py

Writes public/favicon.svg (outlines, so no font has to load), public/favicon.ico
(legacy tab), public/apple-touch-icon.png (iOS home screen), and the two PWA
sizes the manifest names. The SVG and the PNGs share one set of numbers below,
so they cannot drift apart.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
WOFF2 = ROOT / 'public' / 'fonts' / 'libre-franklin-latin-900-normal.woff2'
OUT = ROOT / 'public'

PAPER = '#F7F5EF'
INK = '#191813'
LETTERS = 'HK'
TRACKING = -0.02          # design.md section 7, and .wm on the brand card
TYPE_RATIO = 54 / 128     # brand card: 54px type in the 128px favicon square
RADIUS_RATIO = 2 / 128    # brand card: 2px radius on the 128px square
SIZE = 512


def layout(font: TTFont) -> tuple[float, list[tuple[str, float]], tuple[float, float]]:
    """Pen positions for the letters, and the center of the ink they make."""
    upem = font['head'].unitsPerEm
    glyphs = font.getGlyphSet()
    names = [font.getBestCmap()[ord(c)] for c in LETTERS]
    pen_x, placed, box = 0.0, [], []
    for char, name in zip(LETTERS, names):
        bounds = BoundsPen(glyphs)
        glyphs[name].draw(bounds)
        assert bounds.bounds is not None, f'{char} has no outline in {WOFF2.name}'
        x_min, y_min, x_max, y_max = bounds.bounds
        placed.append((name, pen_x))
        box.append((pen_x + x_min, y_min, pen_x + x_max, y_max))
        pen_x += glyphs[name].width + TRACKING * upem
    ink = (
        min(b[0] for b in box), min(b[1] for b in box),
        max(b[2] for b in box), max(b[3] for b in box),
    )
    center = ((ink[0] + ink[2]) / 2, (ink[1] + ink[3]) / 2)
    return upem, placed, center


def write_svg(font: TTFont, upem: float, placed, center) -> None:
    glyphs = font.getGlyphSet()
    scale = SIZE * TYPE_RATIO / upem
    paths = []
    for name, pen_x in placed:
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(pen)
        paths.append(f'<path transform="translate({pen_x:.0f} 0)" d="{pen.getCommands()}"/>')
    # scale(s,-s) because font units run up the page and SVG units run down it.
    move = f'translate({SIZE / 2 - scale * center[0]:.2f} {SIZE / 2 + scale * center[1]:.2f}) scale({scale:.5f} -{scale:.5f})'
    (OUT / 'favicon.svg').write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">'
        f'<rect width="{SIZE}" height="{SIZE}" rx="{SIZE * RADIUS_RATIO:.0f}" fill="{INK}"/>'
        f'<g fill="{PAPER}" transform="{move}">{"".join(paths)}</g></svg>\n',
        encoding='utf8',
    )


def render(ttf: Path, upem: float, placed, center, size: int) -> Image.Image:
    scale = size * TYPE_RATIO / upem
    face = ImageFont.truetype(str(ttf), size=size * TYPE_RATIO)
    image = Image.new('RGB', (size, size), INK)
    draw = ImageDraw.Draw(image)
    left = size / 2 - scale * center[0]
    baseline = size / 2 + scale * center[1]
    for (_, pen_x), char in zip(placed, LETTERS):
        draw.text((left + scale * pen_x, baseline), char, font=face, fill=PAPER, anchor='ls')
    return image


def main() -> None:
    font = TTFont(WOFF2)
    upem, placed, center = layout(font)
    write_svg(font, upem, placed, center)

    # Pillow rasterizes from a file, and it does not read woff2.
    ttf = OUT / 'favicon-source.ttf'
    font.flavor = None
    font.save(ttf)
    try:
        render(ttf, upem, placed, center, 512).save(OUT / 'icon-512.png')
        render(ttf, upem, placed, center, 192).save(OUT / 'icon-192.png')
        render(ttf, upem, placed, center, 180).save(OUT / 'apple-touch-icon.png')
        render(ttf, upem, placed, center, 48).save(
            OUT / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)]
        )
    finally:
        ttf.unlink()
    for path in sorted(OUT.glob('*.png')) + [OUT / 'favicon.svg', OUT / 'favicon.ico']:
        print(f'{path.name}: {path.stat().st_size} bytes')


if __name__ == '__main__':
    main()
