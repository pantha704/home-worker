"""Generate rights-clear local test documents; no network access required."""

from pathlib import Path

from PIL import Image, ImageDraw
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent

pdf = canvas.Canvas(str(ROOT / "sample-native.pdf"), invariant=1)
pdf.setTitle("Homeworker local fixture")
pdf.drawString(72, 760, "Physics Notes")
pdf.drawString(72, 735, "Force equals mass multiplied by acceleration.")
pdf.drawString(72, 710, "F = m a")
pdf.save()

image = Image.new("RGB", (1200, 700), "white")
draw = ImageDraw.Draw(image)
draw.text((80, 100), "Biology Notes", fill="black")
draw.text((80, 180), "Cells are the basic unit of life.", fill="black")
image.save(ROOT / "sample-ocr.png")

print("Generated sample-native.pdf and sample-ocr.png")
