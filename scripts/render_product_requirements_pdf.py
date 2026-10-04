#!/usr/bin/env python3
"""Render the wedding product requirements Markdown as a styled PDF."""

from __future__ import annotations

import argparse
import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


INK = colors.HexColor("#2F2B31")
MUTED = colors.HexColor("#777178")
ACCENT = colors.HexColor("#B44668")
ACCENT_LIGHT = colors.HexColor("#F7EAF0")
LINE = colors.HexColor("#DED4D8")
SOFT = colors.HexColor("#F8F6F7")
WHITE = colors.white


def register_fonts() -> None:
    font_dir = Path("/System/Library/Fonts/Supplemental")
    pdfmetrics.registerFont(TTFont("WeddingSans", font_dir / "Arial.ttf"))
    pdfmetrics.registerFont(TTFont("WeddingSans-Bold", font_dir / "Arial Bold.ttf"))
    pdfmetrics.registerFont(TTFont("WeddingSans-Italic", font_dir / "Arial Italic.ttf"))
    pdfmetrics.registerFontFamily(
        "WeddingSans",
        normal="WeddingSans",
        bold="WeddingSans-Bold",
        italic="WeddingSans-Italic",
        boldItalic="WeddingSans-Bold",
    )


def inline_markup(value: str) -> str:
    text = html.escape(value.strip(), quote=False)
    text = re.sub(r"`([^`]+)`", r'<font name="WeddingSans">\1</font>', text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    return text


def styles():
    base = getSampleStyleSheet()
    body = ParagraphStyle(
        "Body",
        parent=base["BodyText"],
        fontName="WeddingSans",
        fontSize=9.2,
        leading=13.1,
        textColor=INK,
        spaceAfter=5.5,
        allowWidows=0,
        allowOrphans=0,
    )
    return {
        "body": body,
        "h2": ParagraphStyle(
            "H2",
            parent=body,
            fontName="WeddingSans-Bold",
            fontSize=16.5,
            leading=20,
            textColor=INK,
            spaceBefore=13,
            spaceAfter=7,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "H3",
            parent=body,
            fontName="WeddingSans-Bold",
            fontSize=12.2,
            leading=15.5,
            textColor=ACCENT,
            spaceBefore=9,
            spaceAfter=5,
            keepWithNext=True,
        ),
        "h4": ParagraphStyle(
            "H4",
            parent=body,
            fontName="WeddingSans-Bold",
            fontSize=10.2,
            leading=13.5,
            textColor=INK,
            spaceBefore=7,
            spaceAfter=4,
            keepWithNext=True,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=body,
            leftIndent=14,
            firstLineIndent=-12,
            bulletIndent=0,
            bulletFontName="WeddingSans",
            bulletFontSize=8.5,
            bulletColor=ACCENT,
            spaceAfter=2.5,
        ),
        "cell": ParagraphStyle(
            "Cell",
            parent=body,
            fontSize=7.35,
            leading=9.25,
            spaceAfter=0,
        ),
        "cell_head": ParagraphStyle(
            "CellHead",
            parent=body,
            fontName="WeddingSans-Bold",
            fontSize=7.55,
            leading=9.5,
            textColor=WHITE,
            spaceAfter=0,
        ),
        "cover_brand": ParagraphStyle(
            "CoverBrand",
            parent=body,
            fontName="WeddingSans-Bold",
            fontSize=11,
            leading=14,
            textColor=ACCENT,
            spaceAfter=0,
        ),
        "cover_title": ParagraphStyle(
            "CoverTitle",
            parent=body,
            fontName="WeddingSans-Bold",
            fontSize=27,
            leading=32,
            textColor=INK,
            spaceAfter=0,
        ),
        "cover_meta": ParagraphStyle(
            "CoverMeta",
            parent=body,
            fontSize=11,
            leading=18,
            textColor=INK,
            spaceAfter=0,
        ),
        "cover_strap": ParagraphStyle(
            "CoverStrap",
            parent=body,
            fontSize=9.5,
            leading=13,
            textColor=MUTED,
            spaceAfter=0,
        ),
    }


def split_table_row(line: str) -> list[str]:
    return [part.strip() for part in line.strip().strip("|").split("|")]


def is_separator(line: str) -> bool:
    cells = split_table_row(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


def table_widths(columns: int, width: float) -> list[float]:
    if columns == 2:
        ratios = [0.28, 0.72]
    elif columns == 3:
        ratios = [0.24, 0.30, 0.46]
    elif columns == 4:
        ratios = [0.20, 0.25, 0.25, 0.30]
    else:
        ratios = [1 / columns] * columns
    return [width * ratio for ratio in ratios]


def make_table(rows: list[list[str]], page_width: float, style_map) -> Table:
    columns = max(len(row) for row in rows)
    padded = [row + [""] * (columns - len(row)) for row in rows]
    content = []
    for row_index, row in enumerate(padded):
        paragraph_style = style_map["cell_head"] if row_index == 0 else style_map["cell"]
        content.append([Paragraph(inline_markup(cell), paragraph_style) for cell in row])
    table = Table(
        content,
        colWidths=table_widths(columns, page_width),
        repeatRows=1,
        hAlign="LEFT",
        splitByRow=1,
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
                ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5.2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5.2),
                ("TOPPADDING", (0, 0), (-1, -1), 4.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
                ("GRID", (0, 0), (-1, -1), 0.35, LINE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, SOFT]),
            ]
        )
    )
    return table


def parse_markdown(path: Path, page_width: float, style_map) -> list:
    lines = path.read_text(encoding="utf-8").splitlines()
    story: list = []
    paragraph: list[str] = []
    list_items: list[str] = []
    list_ordered = False

    def flush_paragraph() -> None:
        nonlocal paragraph
        if paragraph:
            story.append(Paragraph(inline_markup(" ".join(part.strip() for part in paragraph)), style_map["body"]))
            paragraph = []

    def flush_list() -> None:
        nonlocal list_items, list_ordered
        if not list_items:
            return
        for item_index, item in enumerate(list_items, start=1):
            marker = f"{item_index}." if list_ordered else "•"
            story.append(Paragraph(inline_markup(item), style_map["bullet"], bulletText=marker))
        story.append(Spacer(1, 3))
        list_items = []
        list_ordered = False

    index = 0
    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        if index == 0 and stripped.startswith("# "):
            index += 1
            continue
        if index <= 7 and (
            stripped.startswith("Версия документа:")
            or stripped.startswith("Дата:")
            or stripped.startswith("Статус:")
        ):
            index += 1
            continue
        if stripped.startswith("|") and index + 1 < len(lines) and is_separator(lines[index + 1]):
            flush_paragraph()
            flush_list()
            rows = [split_table_row(line)]
            index += 2
            while index < len(lines) and lines[index].strip().startswith("|"):
                rows.append(split_table_row(lines[index]))
                index += 1
            story.extend([make_table(rows, page_width, style_map), Spacer(1, 7)])
            continue
        heading = re.match(r"^(#{2,4})\s+(.+)$", stripped)
        if heading:
            flush_paragraph()
            flush_list()
            level = len(heading.group(1))
            title = inline_markup(heading.group(2))
            block = [Paragraph(title, style_map[f"h{level}"])]
            if level == 2:
                block.append(HRFlowable(width="100%", thickness=0.7, color=ACCENT_LIGHT, spaceAfter=2))
            story.append(KeepTogether(block))
            index += 1
            continue
        bullet = re.match(r"^-\s+(.+)$", stripped)
        numbered = re.match(r"^\d+\.\s+(.+)$", stripped)
        if bullet or numbered:
            flush_paragraph()
            ordered = bool(numbered)
            if list_items and list_ordered != ordered:
                flush_list()
            list_ordered = ordered
            list_items.append((numbered or bullet).group(1))
            index += 1
            continue
        if not stripped:
            flush_paragraph()
            flush_list()
        else:
            if list_items:
                flush_list()
            paragraph.append(stripped)
        index += 1
    flush_paragraph()
    flush_list()
    return story


class ProductRequirementsDoc(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=18 * mm,
            rightMargin=18 * mm,
            topMargin=19 * mm,
            bottomMargin=19 * mm,
            title="Пользовательские требования wedding — версия 1.6",
            author="wedding",
            subject="Пользовательские требования опубликованной версии wedding.cabinpxrn.ru",
            creator="wedding documentation",
        )
        frame = Frame(
            self.leftMargin,
            self.bottomMargin + 7 * mm,
            self.width,
            self.height - 10 * mm,
            id="main",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        self.addPageTemplates([PageTemplate(id="document", frames=[frame], onPage=self.draw_page)])

    def draw_page(self, canvas, doc) -> None:
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.45)
        canvas.line(self.leftMargin, 13 * mm, A4[0] - self.rightMargin, 13 * mm)
        canvas.setFont("WeddingSans", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(self.leftMargin, 7.5 * mm, "29 сентября 2026 года")
        canvas.drawRightString(A4[0] - self.rightMargin, 7.5 * mm, f"Страница {doc.page}")
        if doc.page > 1:
            canvas.setFont("WeddingSans-Bold", 7.2)
            canvas.setFillColor(ACCENT)
            canvas.drawString(self.leftMargin, A4[1] - 11.5 * mm, "WEDDING")
            canvas.setFont("WeddingSans", 7.2)
            canvas.setFillColor(MUTED)
            canvas.drawRightString(A4[0] - self.rightMargin, A4[1] - 11.5 * mm, "Пользовательские требования · версия 1.6")
        canvas.restoreState()


def cover(style_map) -> list:
    return [
        Spacer(1, 34 * mm),
        Paragraph("WEDDING", style_map["cover_brand"]),
        Spacer(1, 31 * mm),
        Paragraph("Пользовательские требования<br/>wedding", style_map["cover_title"]),
        Spacer(1, 11 * mm),
        HRFlowable(width="100%", thickness=1.1, color=ACCENT),
        Spacer(1, 8 * mm),
        Paragraph(
            "Версия документа: 1.6<br/>"
            "Дата: 29 сентября 2026 года<br/>"
            "Статус: актуальные требования для wedding.cabinpxrn.ru",
            style_map["cover_meta"],
        ),
        Spacer(1, 48 * mm),
        Paragraph("Назначение · функции · роли · ожидаемое поведение", style_map["cover_strap"]),
        PageBreak(),
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    register_fonts()
    style_map = styles()
    document = ProductRequirementsDoc(str(args.output))
    story = cover(style_map)
    story.extend(parse_markdown(args.source, document.width, style_map))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    document.build(story)


if __name__ == "__main__":
    main()
