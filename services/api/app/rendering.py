"""Deterministic A4 handwriting-style and typed companion PDF renderers."""

from __future__ import annotations

import hashlib
import io
import math
import random
import threading
from dataclasses import dataclass
from pathlib import Path

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfdoc import PDFString
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from .errors import InkError
from .models import PaperStyle, Persona, PersonaId, ProjectDocument


@dataclass(frozen=True, slots=True)
class PersonaParameters:
    id: PersonaId
    name: str
    description: str
    filename: str
    font_size: float
    tracking: float
    baseline_jitter: float
    rotation_jitter: float
    size_jitter: float


PERSONA_PARAMETERS: dict[PersonaId, PersonaParameters] = {
    PersonaId.SCHOLAR: PersonaParameters(
        id=PersonaId.SCHOLAR,
        name="Scholar",
        description="Measured cursive with steady spacing for formal study notes.",
        filename="Caveat-Regular.ttf",
        font_size=13.2,
        tracking=0.12,
        baseline_jitter=0.30,
        rotation_jitter=0.30,
        size_jitter=0.16,
    ),
    PersonaId.CASUAL: PersonaParameters(
        id=PersonaId.CASUAL,
        name="Casual",
        description="Relaxed rounded writing with visibly organic variation.",
        filename="PatrickHand-Regular.ttf",
        font_size=12.0,
        tracking=0.20,
        baseline_jitter=0.55,
        rotation_jitter=0.70,
        size_jitter=0.24,
    ),
    PersonaId.COMPACT: PersonaParameters(
        id=PersonaId.COMPACT,
        name="Compact",
        description="Dense, tidy handwriting designed for information-rich pages.",
        filename="Kalam-Regular.ttf",
        font_size=10.4,
        tracking=0.04,
        baseline_jitter=0.22,
        rotation_jitter=0.25,
        size_jitter=0.12,
    ),
}

_FONT_LOCK = threading.Lock()
_REGISTERED: dict[PersonaId, str] = {}
_TYPED_FONT = "InkTyped"
_LICENSE = "SIL Open Font License 1.1 (bundled font asset)"


def personas() -> list[Persona]:
    return [
        Persona(
            id=parameters.id,
            name=parameters.name,
            description=parameters.description,
            license=(
                _LICENSE
                if _font_asset_path(parameters.filename).is_file()
                else "Bitstream Vera License (runtime fallback; primary asset missing)"
            ),
        )
        for parameters in PERSONA_PARAMETERS.values()
    ]


def _font_asset_path(filename: str) -> Path:
    module = Path(__file__).resolve()
    candidates = (
        module.parents[3] / "assets" / "fonts" / filename,  # source checkout
        module.parents[1] / "assets" / "fonts" / filename,  # container wheel layout
    )
    return next((candidate for candidate in candidates if candidate.is_file()), candidates[0])


def _fallback_font_path(italic: bool = False) -> Path:
    import reportlab

    filename = "VeraIt.ttf" if italic else "Vera.ttf"
    return Path(reportlab.__file__).resolve().parent / "fonts" / filename


def _font_for_persona(persona_id: PersonaId) -> str:
    with _FONT_LOCK:
        if persona_id in _REGISTERED:
            return _REGISTERED[persona_id]
        parameters = PERSONA_PARAMETERS[persona_id]
        font_name = f"InkPersona-{persona_id.value}"
        font_path = _font_asset_path(parameters.filename)
        if not font_path.is_file():
            font_path = _fallback_font_path(italic=True)
        if not font_path.is_file():
            raise InkError(
                "RENDER_FONT_UNAVAILABLE",
                "The licensed renderer font asset is missing.",
                status_code=503,
                details={"personaId": persona_id.value},
            )
        pdfmetrics.registerFont(TTFont(font_name, str(font_path)))
        _REGISTERED[persona_id] = font_name
        return font_name


def _typed_font() -> str:
    with _FONT_LOCK:
        if _TYPED_FONT not in pdfmetrics.getRegisteredFontNames():
            path = _fallback_font_path()
            if not path.is_file():
                return "Helvetica"
            pdfmetrics.registerFont(TTFont(_TYPED_FONT, str(path)))
        return _TYPED_FONT


def _font_supports(font_name: str, character: str) -> bool:
    if character.isspace():
        return True
    face = getattr(pdfmetrics.getFont(font_name), "face", None)
    character_map = getattr(face, "charToGlyph", {})
    return ord(character) in character_map


def _validate_glyphs(project: ProjectDocument, font_names: tuple[str, ...]) -> None:
    unsupported = {
        character
        for page in project.pages
        for block in page.blocks
        for character in block.text
        if not any(_font_supports(font_name, character) for font_name in font_names)
    }
    if unsupported:
        code_points = [f"U+{ord(character):04X}" for character in sorted(unsupported)[:20]]
        raise InkError(
            "UNSUPPORTED_RENDER_GLYPHS",
            "The selected PDF fonts cannot represent every reviewed character.",
            status_code=422,
            details={
                "codePoints": code_points,
                "companionTextAvailable": True,
                "action": "Use companion.txt or install a future licensed persona for this script.",
            },
        )


def _seed(project: ProjectDocument, label: str) -> int:
    material = (
        f"{project.id}:{project.revision}:{project.settings.seed}:"
        f"{project.settings.persona_id.value}:{label}"
    ).encode()
    return int.from_bytes(hashlib.sha256(material).digest()[:8], "big")


def _new_canvas(buffer: io.BytesIO, project: ProjectDocument) -> canvas.Canvas:
    pdf = canvas.Canvas(
        buffer,
        pagesize=A4,
        pageCompression=1,
        invariant=1,
        initialFontName=_typed_font(),
        initialFontSize=10,
        initialLeading=12,
        lang="en",
    )
    pdf.setTitle(f"Homeworker - {project.filename}")
    pdf.setAuthor("Homeworker")
    pdf.setSubject(
        f"Faithful document revision {project.revision}; source SHA-256 {project.sha256}"
    )
    pdf.setCreator("Homeworker local renderer")
    pdf._doc.Catalog.Lang = PDFString("en")
    return pdf


def _draw_paper(pdf: canvas.Canvas, project: ProjectDocument) -> None:
    width, height = A4
    pdf.setFillColor(Color(0.995, 0.992, 0.975))
    pdf.rect(0, 0, width, height, fill=1, stroke=0)
    style = project.settings.paper_style
    if style == PaperStyle.PLAIN:
        return
    spacing = 7 * mm
    pdf.setLineWidth(0.28)
    pdf.setStrokeColor(Color(0.66, 0.78, 0.88, alpha=0.60))
    y = project.settings.margin_mm * mm
    while y < height - project.settings.margin_mm * mm:
        pdf.line(project.settings.margin_mm * mm, y, width - project.settings.margin_mm * mm, y)
        y += spacing
    if style == PaperStyle.GRID:
        x = project.settings.margin_mm * mm
        while x < width - project.settings.margin_mm * mm:
            pdf.line(
                x, project.settings.margin_mm * mm, x, height - project.settings.margin_mm * mm
            )
            x += spacing


def _draw_draft_watermark(pdf: canvas.Canvas, project: ProjectDocument) -> None:
    if project.status.value == "ready":
        return
    width, height = A4
    pdf.saveState()
    pdf.setFillColor(Color(0.67, 0.25, 0.25, alpha=0.13))
    if hasattr(pdf, "setFillAlpha"):
        pdf.setFillAlpha(0.13)
    pdf.translate(width / 2, height / 2)
    pdf.rotate(34)
    pdf.setFont(_typed_font(), 27)
    pdf.drawCentredString(0, 0, "DRAFT - REVIEW REQUIRED")
    pdf.restoreState()


def _split_lines(
    text: str,
    font_name: str,
    fallback_font_name: str,
    font_size: float,
    max_width: float,
    tracking: float,
    *,
    size_jitter: float | None = None,
) -> list[str]:
    if text == "":
        return [""]
    output: list[str] = []
    for paragraph in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if paragraph == "":
            output.append("")
            continue
        current = ""
        last_space = -1
        for character in paragraph:
            candidate = current + character
            measured_size = (
                font_size if size_jitter is None else font_size + size_jitter * 0.55 + 0.85
            )
            width = sum(
                pdfmetrics.stringWidth(
                    glyph,
                    font_name if _font_supports(font_name, glyph) else fallback_font_name,
                    measured_size,
                )
                + tracking
                + (tracking * 2.4 if size_jitter is not None and glyph.isspace() else 0)
                for glyph in candidate
            )
            if width <= max_width or not current:
                current = candidate
                if character.isspace():
                    last_space = len(current) - 1
                continue
            if last_space >= 0:
                output.append(current[:last_space].rstrip())
                current = current[last_space + 1 :] + character
            else:
                output.append(current)
                current = character
            last_space = max(
                (index for index, char in enumerate(current) if char.isspace()), default=-1
            )
        output.append(current.rstrip())
    return output


def _draw_hand_line(
    pdf: canvas.Canvas,
    line: str,
    *,
    x: float,
    y: float,
    font_name: str,
    fallback_font_name: str,
    parameters: PersonaParameters,
    base_size: float,
    rng: random.Random,
) -> None:
    """Correlated irregularity: line slant, baseline wave, slow size drift — not per-glyph noise."""
    if not line:
        return
    cursor = x
    n = max(len(line), 1)
    slant = rng.uniform(-1.05, 1.05)
    wave_amp = parameters.baseline_jitter * 0.9
    wave_phase = rng.uniform(0, math.pi)
    size_walk = rng.uniform(-parameters.size_jitter * 0.35, parameters.size_jitter * 0.35)
    for index, character in enumerate(line):
        t = index / n
        character_font = font_name if _font_supports(font_name, character) else fallback_font_name
        size = base_size + size_walk + math.sin(t * math.pi) * parameters.size_jitter * 0.2
        if rng.random() < 0.035:
            size += rng.choice((-0.7, 0.85))
        width = pdfmetrics.stringWidth(character, character_font, size)
        extra_gap = 0.0
        if character.isspace():
            extra_gap = rng.uniform(0.0, parameters.tracking * 2.4)
        else:
            pdf.saveState()
            lift = math.sin(wave_phase + t * math.pi * 1.35) * wave_amp
            pdf.translate(cursor, y + lift + t * slant)
            pdf.rotate(slant * 0.35)
            pdf.setFont(character_font, size)
            pdf.drawString(0, 0, character)
            pdf.restoreState()
        cursor += width + parameters.tracking + extra_gap


def render_handwritten(project: ProjectDocument) -> bytes:
    buffer = io.BytesIO()
    pdf = _new_canvas(buffer, project)
    parameters = PERSONA_PARAMETERS[project.settings.persona_id]
    font_name = _font_for_persona(parameters.id)
    fallback_font_name = _typed_font()
    _validate_glyphs(project, (font_name, fallback_font_name))
    rng = random.Random(_seed(project, "handwritten"))
    page_width, page_height = A4
    margin = project.settings.margin_mm * mm
    max_width = page_width - 2 * margin
    persona_size = parameters.font_size
    if project.settings.font_size_pt > 0:
        persona_size = project.settings.font_size_pt
    line_height = persona_size * 1.42 * project.settings.line_spacing
    ink = HexColor(project.settings.ink_color)
    current_sheet = 0
    y = 0.0

    def begin_sheet(source_page: int) -> float:
        nonlocal current_sheet
        if current_sheet:
            pdf.showPage()
        current_sheet += 1
        _draw_paper(pdf, project)
        _draw_draft_watermark(pdf, project)
        pdf.setFillColor(Color(0.35, 0.38, 0.42))
        pdf.setFont(_typed_font(), 7)
        pdf.drawRightString(
            page_width - margin, 7 * mm, f"Source p.{source_page} · rev {project.revision}"
        )
        pdf.setFillColor(ink)
        return float(page_height - margin - persona_size)

    for source_page in project.pages:
        if current_sheet == 0:
            y = begin_sheet(source_page.number)
        else:
            y -= line_height * 0.55
        for block in source_page.blocks:
            font_size = persona_size * (1.17 if block.kind.value == "heading" else 1.0)
            lines = _split_lines(
                block.text,
                font_name,
                fallback_font_name,
                font_size,
                max_width,
                parameters.tracking,
                size_jitter=parameters.size_jitter,
            )
            for line in lines:
                if y < margin + line_height:
                    y = begin_sheet(source_page.number)
                _draw_hand_line(
                    pdf,
                    line,
                    x=margin,
                    y=y,
                    font_name=font_name,
                    fallback_font_name=fallback_font_name,
                    parameters=parameters,
                    base_size=font_size,
                    rng=rng,
                )
                y -= line_height
            y -= line_height * 0.34

    if current_sheet == 0:
        begin_sheet(1)
    pdf.save()
    return buffer.getvalue()


def render_companion(project: ProjectDocument) -> bytes:
    """Render a selectable-text, reading-order companion with source labels."""
    buffer = io.BytesIO()
    pdf = _new_canvas(buffer, project)
    font_name = _typed_font()
    _validate_glyphs(project, (font_name,))
    page_width, page_height = A4
    margin = max(14 * mm, project.settings.margin_mm * mm)
    font_size = 10.5
    line_height = 14.5
    max_width = page_width - 2 * margin
    sheet_number = 0
    y = 0.0

    def begin_sheet() -> float:
        nonlocal sheet_number
        if sheet_number:
            pdf.showPage()
        sheet_number += 1
        pdf.setFillColor(Color(1, 1, 1))
        pdf.rect(0, 0, page_width, page_height, fill=1, stroke=0)
        pdf.setFillColor(Color(0.12, 0.14, 0.17))
        pdf.setFont(font_name, 8)
        pdf.drawString(margin, 9 * mm, f"Homeworker typed companion · revision {project.revision}")
        pdf.drawRightString(page_width - margin, 9 * mm, f"Page {sheet_number}")
        return float(page_height - margin)

    y = begin_sheet()
    for source_page in project.pages:
        if y < margin + line_height * 3:
            y = begin_sheet()
        pdf.setFillColor(Color(0.22, 0.31, 0.45))
        pdf.setFont(font_name, 12)
        pdf.drawString(margin, y, f"Source page {source_page.number}")
        y -= line_height * 1.35
        for block in source_page.blocks:
            size = 11.5 if block.kind.value == "heading" else font_size
            lines = _split_lines(block.text, font_name, font_name, size, max_width, 0)
            pdf.setFillColor(Color(0.08, 0.09, 0.11))
            pdf.setFont(font_name, size)
            for line in lines:
                if y < margin + line_height:
                    y = begin_sheet()
                    pdf.setFont(font_name, size)
                pdf.drawString(margin, y, line)
                y -= line_height
            y -= line_height * 0.45
    pdf.save()
    return buffer.getvalue()


def render_companion_text(project: ProjectDocument) -> bytes:
    """UTF-8 companion that preserves reviewed text without font/glyph dependence."""
    lines = [
        f"Homeworker typed companion — {project.filename}",
        f"Revision: {project.revision}",
        f"Source SHA-256: {project.sha256}",
        "",
    ]
    for page in project.pages:
        lines.extend((f"Source page {page.number}", ""))
        for block in page.blocks:
            lines.extend((block.text, ""))
    return ("\n".join(lines).rstrip() + "\n").encode("utf-8")


def render_handwritten_page_png(
    project: ProjectDocument, page_number: int, *, max_width: int = 900
) -> bytes:
    import fitz
    from PIL import Image

    pdf_bytes = render_handwritten(project)
    with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
        if page_number < 1 or page_number > document.page_count:
            raise InkError(
                "PAGE_NOT_FOUND",
                "That handwritten sheet does not exist.",
                status_code=404,
                details={"pageNumber": page_number, "pageCount": document.page_count},
            )
        page = document[page_number - 1]
        scale = min(2.0, max_width / max(page.rect.width, 1))
        pixmap = page.get_pixmap(
            matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB, alpha=False
        )
        image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG", optimize=True)
        return buffer.getvalue()
