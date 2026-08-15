"""Generate a synthetic dealer quote photograph for end-to-end testing.

Real farmer photos never become fixtures (spec.md). This makes a plausible
quote from nothing: invented dealership, invented salesperson, invented stock
number, and a deal whose arithmetic we control so the expected extraction is
known before the model ever sees it.

The "photograph" treatment matters. A clean render is not the test; the test is
paper on a truck seat under bad light, which is what actually arrives.

    python tests/fixtures/make-synthetic-quote.py out.jpg
"""

import sys
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# The deal. Chosen so the expected answer is known and lands on a band edge we
# can check: $84,500 quoted, $6,000 cash discount, 60 monthly of $1,408.33.
QUOTE = [
    ("VALLEY RIDGE EQUIPMENT CO.", 34, "bold"),
    ("1470 County Road 12  ·  Hastings, NE 68901", 18, None),
    ("", 10, None),
    ("PURCHASE QUOTATION", 26, "bold"),
    ("Quote #  Q-20418            Date:  08/11/2026", 20, None),
    ("Prepared by:  D. Weller           Valid until:  08/31/2026", 20, None),
    ("", 10, None),
    ("UNIT", 22, "bold"),
    ("2021 John Deere 6155M  MFWD Tractor", 22, None),
    ("Stock No. VR-88213        Hours: 1,240        Used", 20, None),
    ("", 14, None),
    ("PRICING", 22, "bold"),
    ("List price .......................... $ 91,200.00", 22, None),
    ("Quoted price ........................ $ 84,500.00", 22, None),
    ("Cash discount if paid in full ....... $  6,000.00", 22, None),
    ("Delivery & setup .................... $      0.00", 22, None),
    ("", 14, None),
    ("FINANCE OFFER", 22, "bold"),
    ("0.00% A.P.R. FOR 60 MONTHS  (W.A.C.)", 22, "bold"),
    ("Monthly payment ..................... $  1,408.33", 22, None),
    ("Number of payments .................. 60", 22, None),
    ("Due at signing ...................... $      0.00", 22, None),
    ("Trade allowance ..................... $      0.00", 22, None),
    ("", 14, None),
    ("Cash discount is forfeited if the finance offer is taken.", 18, None),
    ("Subject to credit approval. Taxes and title not included.", 18, None),
]


def font(size, weight=None):
    names = (
        ["arialbd.ttf", "Arialbd.ttf", "seguisb.ttf"]
        if weight == "bold"
        else ["arial.ttf", "Arial.ttf", "segoeui.ttf"]
    )
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def render(path):
    random.seed(20260815)
    width, height = 1240, 1750
    page = Image.new("RGB", (width, height), (250, 249, 244))
    draw = ImageDraw.Draw(page)

    y = 70
    for text, size, weight in QUOTE:
        if text:
            draw.text((90, y), text, font=font(size, weight), fill=(28, 26, 24))
        y += size + 12

    draw.line([(90, 250), (width - 90, 250)], fill=(120, 118, 112), width=2)
    draw.rectangle([(80, 60), (width - 80, y + 30)], outline=(150, 148, 142), width=3)

    # Photograph it rather than scan it: slight rotation, uneven warm light,
    # a soft focus falloff, and sensor grain.
    page = page.rotate(-1.4, expand=True, fillcolor=(235, 233, 226), resample=Image.BICUBIC)
    page = page.filter(ImageFilter.GaussianBlur(0.6))

    pixels = page.load()
    w, h = page.size
    for py in range(0, h, 2):
        for px in range(0, w, 2):
            # Light falls off toward the bottom right, the way a hand-held
            # phone shadows its own page.
            shade = 1.0 - 0.16 * ((px / w) * 0.5 + (py / h) * 0.5)
            grain = random.randint(-7, 7)
            r, g, b = pixels[px, py]
            pixels[px, py] = (
                max(0, min(255, int(r * shade) + grain)),
                max(0, min(255, int(g * shade) + grain)),
                max(0, min(255, int(b * shade * 0.995)) + grain),
            )

    page.save(path, "JPEG", quality=72)
    print(f"wrote {path} {page.size[0]}x{page.size[1]}")


if __name__ == "__main__":
    render(sys.argv[1] if len(sys.argv) > 1 else "synthetic-quote.jpg")
