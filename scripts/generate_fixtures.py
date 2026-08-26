from __future__ import annotations

import os
from pathlib import Path
import random
import tempfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures"
FONTS = ROOT / "assets" / "fonts"


LINES = [
    "Physics revision: Newton's laws",
    "1. An object stays at rest unless a net force acts on it.",
    "2. Force equals mass times acceleration: F = m x a.",
    "3. Every action has an equal and opposite reaction.",
    "Check units before substituting values into an equation.",
]


def make_typed_pdf() -> None:
    path = OUT / "sample-typed.pdf"
    with tempfile.NamedTemporaryFile(dir=OUT, suffix=".pdf", delete=False) as temporary:
        temporary_path = Path(temporary.name)
    try:
        pdf = canvas.Canvas(
            str(temporary_path),
            pagesize=A4,
            pageCompression=1,
            invariant=1,
        )
        width, height = A4
        pdf.setTitle("Homeworker typed extraction fixture")
        pdf.setFont("Helvetica-Bold", 18)
        pdf.drawString(54, height - 70, LINES[0])
        pdf.setFont("Helvetica", 11)
        y = height - 110
        for line in LINES[1:]:
            pdf.drawString(54, y, line)
            y -= 24
        pdf.setStrokeColorRGB(0.78, 0.83, 0.9)
        pdf.line(54, y - 8, width - 54, y - 8)
        pdf.setFont("Helvetica-Oblique", 9)
        pdf.drawString(54, 36, "Rights-cleared synthetic fixture for Homeworker tests.")
        pdf.showPage()
        pdf.save()
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def make_handwritten_image() -> None:
    rng = random.Random(42)
    width, height = 1240, 1754
    image = Image.new("RGB", (width, height), "#fffef9")
    draw = ImageDraw.Draw(image)

    for y in range(150, height - 100, 66):
        draw.line((85, y, width - 75, y), fill="#bfd5ef", width=2)
    draw.line((150, 70, 150, height - 80), fill="#efb6b6", width=2)

    title_font = ImageFont.truetype(str(FONTS / "PatrickHand-Regular.ttf"), 52)
    body_font = ImageFont.truetype(str(FONTS / "PatrickHand-Regular.ttf"), 38)
    y = 104
    for index, line in enumerate(LINES):
        font = title_font if index == 0 else body_font
        x = 175 + rng.randint(-3, 4)
        draw.text((x, y + rng.randint(-2, 2)), line, font=font, fill="#173a68")
        y += 72 if index == 0 else 66

    image = image.filter(ImageFilter.GaussianBlur(radius=0.25))
    path = OUT / "sample-handwritten.png"
    with tempfile.NamedTemporaryFile(dir=OUT, suffix=".png", delete=False) as temporary:
        temporary_path = Path(temporary.name)
    try:
        image.save(temporary_path, format="PNG", optimize=True)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    make_typed_pdf()
    make_handwritten_image()
    print(OUT)


if __name__ == "__main__":
    main()
