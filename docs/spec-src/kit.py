"""Shared styles, fonts and flowables for the Phase 1 specification PDF."""
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (Flowable, KeepTogether, Paragraph, Preformatted,
                                Spacer, Table, TableStyle, CondPageBreak)

FONT_DIR = "/usr/share/fonts/truetype"
pdfmetrics.registerFont(TTFont("Body", f"{FONT_DIR}/crosextra/Carlito-Regular.ttf"))
pdfmetrics.registerFont(TTFont("Body-Bold", f"{FONT_DIR}/crosextra/Carlito-Bold.ttf"))
pdfmetrics.registerFont(TTFont("Body-Italic", f"{FONT_DIR}/crosextra/Carlito-Italic.ttf"))
pdfmetrics.registerFont(TTFont("Body-BoldItalic", f"{FONT_DIR}/crosextra/Carlito-BoldItalic.ttf"))
pdfmetrics.registerFont(TTFont("Mono", f"{FONT_DIR}/dejavu/DejaVuSansMono.ttf"))
pdfmetrics.registerFont(TTFont("Mono-Bold", f"{FONT_DIR}/dejavu/DejaVuSansMono-Bold.ttf"))
pdfmetrics.registerFont(TTFont("Sym", f"{FONT_DIR}/dejavu/DejaVuSans.ttf"))
pdfmetrics.registerFontFamily("Body", normal="Body", bold="Body-Bold",
                              italic="Body-Italic", boldItalic="Body-BoldItalic")
pdfmetrics.registerFontFamily("Mono", normal="Mono", bold="Mono-Bold",
                              italic="Mono", boldItalic="Mono-Bold")

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm
TEXT_W = PAGE_W - 2 * MARGIN

# Palette: orange = Phase 1 accent (matches roadmap), navy = structure.
ORANGE = colors.HexColor("#E2702A")
ORANGE_LT = colors.HexColor("#FCEBDD")
NAVY = colors.HexColor("#1D3557")
NAVY_LT = colors.HexColor("#E7EDF5")
INK = colors.HexColor("#1F2328")
MUTED = colors.HexColor("#5B6470")
RULE = colors.HexColor("#D5DAE1")
CODE_BG = colors.HexColor("#F5F7FA")
GREEN = colors.HexColor("#2E7D4F")
GREEN_LT = colors.HexColor("#E3F2E9")
RED_LT = colors.HexColor("#FBE7E7")

S = {}
S["body"] = ParagraphStyle("body", fontName="Body", fontSize=10, leading=14,
                           textColor=INK, spaceAfter=5)
S["small"] = ParagraphStyle("small", parent=S["body"], fontSize=8.6, leading=11.2,
                            spaceAfter=0)
S["cell"] = ParagraphStyle("cell", parent=S["body"], fontSize=8.8, leading=11.4,
                           spaceAfter=0)
S["cellb"] = ParagraphStyle("cellb", parent=S["cell"], fontName="Body-Bold")
S["cellh"] = ParagraphStyle("cellh", parent=S["cell"], fontName="Body-Bold",
                            textColor=colors.white)
S["cellmono"] = ParagraphStyle("cellmono", parent=S["cell"], fontName="Mono",
                               fontSize=7.6, leading=10)
S["h1"] = ParagraphStyle("h1", fontName="Body-Bold", fontSize=21, leading=25,
                         textColor=NAVY, spaceBefore=0, spaceAfter=4)
S["h1num"] = ParagraphStyle("h1num", fontName="Body-Bold", fontSize=11, leading=13,
                            textColor=ORANGE, spaceAfter=2)
S["h2"] = ParagraphStyle("h2", fontName="Body-Bold", fontSize=14, leading=18,
                         textColor=NAVY, spaceBefore=12, spaceAfter=5)
S["h3"] = ParagraphStyle("h3", fontName="Body-Bold", fontSize=11.2, leading=14,
                         textColor=ORANGE, spaceBefore=8, spaceAfter=3)
S["bullet"] = ParagraphStyle("bullet", parent=S["body"], leftIndent=13,
                             bulletIndent=3, spaceAfter=2.5)
S["bullet2"] = ParagraphStyle("bullet2", parent=S["bullet"], leftIndent=26,
                              bulletIndent=16, fontSize=9.5, leading=13)
S["code"] = ParagraphStyle("code", fontName="Mono", fontSize=7.3, leading=9.4,
                           textColor=INK, backColor=CODE_BG, borderPadding=(5, 6, 5, 6),
                           leftIndent=6, rightIndent=6, spaceBefore=4, spaceAfter=10)
S["codecap"] = ParagraphStyle("codecap", fontName="Mono-Bold", fontSize=7.6, leading=10,
                              textColor=NAVY, spaceBefore=6, spaceAfter=4)
S["note"] = ParagraphStyle("note", parent=S["body"], fontSize=9.4, leading=13,
                           spaceAfter=0)
S["toc1"] = ParagraphStyle("toc1", fontName="Body-Bold", fontSize=10.5, leading=15,
                           textColor=NAVY, leftIndent=0)
S["toc2"] = ParagraphStyle("toc2", fontName="Body", fontSize=9.4, leading=12.5,
                           textColor=INK, leftIndent=16)

CODE_MAX_COLS = 104

# Filled by build.py before stories are generated: key -> section number.
SEC = {}


def sec(key):
    return SEC[key]



class Anchor(Flowable):
    """Zero-size flowable that registers a TOC entry + PDF outline/bookmark."""

    def __init__(self, level, text, key):
        super().__init__()
        self.level, self.text, self.key = level, text, key
        self.width = self.height = 0

    def wrap(self, *a):
        return 0, 0

    def draw(self):
        self.canv.bookmarkPage(self.key)
        self.canv.addOutlineEntry(self.text, self.key, level=self.level, closed=self.level > 0)
        self.canv._doctemplate_toc_entry = (self.level, self.text, self.key)


_counter = {"n": 0, "h1": 0, "h2": 0}


def _key():
    _counter["n"] += 1
    return f"k{_counter['n']}"


def H1(text):
    """Chapter heading: always starts a new page (caller adds PageBreak)."""
    _counter["h1"] += 1
    _counter["h2"] = 0
    n = _counter["h1"]
    k = _key()
    label = f"{n}. {text}"
    return [Anchor(0, label, k),
            Paragraph(f"SECTION {n:02d}", S["h1num"]),
            Paragraph(text, S["h1"]),
            Rule(ORANGE, 2.2, 46 * mm, after=10)]


def H2(text, toc=True):
    _counter["h2"] += 1
    label = f"{_counter['h1']}.{_counter['h2']} {text}"
    out = [CondPageBreak(42 * mm)]
    if toc:
        out.append(Anchor(1, label, _key()))
    out.append(Paragraph(label, S["h2"]))
    return out


def H3(text):
    return [CondPageBreak(28 * mm), Paragraph(text, S["h3"])]


def P(text, style="body"):
    return Paragraph(text, S[style])


def bullets(items, style="bullet"):
    out = []
    for it in items:
        if isinstance(it, (list, tuple)):
            out.extend(bullets(it, "bullet2"))
        else:
            out.append(Paragraph(it, S[style], bulletText="•"))
    return out


def numbered(items):
    return [Paragraph(it, S["bullet"], bulletText=f"{i}.") for i, it in enumerate(items, 1)]


def _cell(v, style):
    if isinstance(v, Flowable):
        return v
    return Paragraph(str(v), S[style])


def table(rows, widths=None, header=True, zebra=True, first_col_bold=False,
          mono_cols=(), head_bg=NAVY, font_size=None):
    """rows: list of lists of strings (inline markup allowed). widths: fractions."""
    if widths is None:
        widths = [1.0 / len(rows[0])] * len(rows[0])
    colw = [TEXT_W * w for w in widths]
    data = []
    for r_i, row in enumerate(rows):
        line = []
        for c_i, v in enumerate(row):
            if header and r_i == 0:
                st = "cellh"
            elif c_i in mono_cols:
                st = "cellmono"
            elif first_col_bold and c_i == 0:
                st = "cellb"
            else:
                st = "cell"
            line.append(_cell(v, st))
        data.append(line)
    t = Table(data, colWidths=colw, repeatRows=1 if header else 0, hAlign="LEFT")
    cmds = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 3.2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE),
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
    ]
    if header:
        cmds.append(("BACKGROUND", (0, 0), (-1, 0), head_bg))
    if zebra:
        for i in range(1 if header else 0, len(data)):
            if i % 2 == 0:
                cmds.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#F7F9FB")))
    t.setStyle(TableStyle(cmds))
    return [Spacer(1, 3), t, Spacer(1, 8)]


def kv(rows, widths=(0.26, 0.74)):
    """Two-column definition table, no header."""
    return table(rows, widths=list(widths), header=False, first_col_bold=True)


def code(src, caption=None):
    src = src.strip("\n")
    for i, line in enumerate(src.split("\n"), 1):
        if len(line) > CODE_MAX_COLS:
            raise ValueError(f"code line too long ({len(line)}) in {caption}: line {i}: {line}")
    out = []
    if caption:
        out.append(Paragraph(caption, S["codecap"]))
    out.append(Preformatted(src, S["code"]))
    return out


def callout(text, kind="note", title=None):
    bg, bar = {"note": (NAVY_LT, NAVY), "tip": (GREEN_LT, GREEN),
               "warn": (ORANGE_LT, ORANGE), "risk": (RED_LT, colors.HexColor("#B42318"))}[kind]
    body = f"<b>{title}</b>  {text}" if title else text
    t = Table([[Paragraph(body, S["note"])]], colWidths=[TEXT_W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LINEBEFORE", (0, 0), (0, -1), 3, bar),
        ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return [Spacer(1, 3), t, Spacer(1, 8)]


class Rule(Flowable):
    def __init__(self, color=RULE, thickness=0.6, width=None, after=6):
        super().__init__()
        self.color, self.t, self.w, self.after = color, thickness, width, after

    def wrap(self, aw, ah):
        self._aw = aw
        return aw, self.t + self.after

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.t)
        self.canv.line(0, self.after, self.w or self._aw, self.after)


def _wrap_text(canv, text, font, size, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if canv.stringWidth(trial, font, size) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def _arrow(c, x1, y1, x2, y2, color=MUTED, w=1.0):
    import math
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(w)
    c.line(x1, y1, x2, y2)
    ang = math.atan2(y2 - y1, x2 - x1)
    L = 4.6
    p = c.beginPath()
    p.moveTo(x2, y2)
    p.lineTo(x2 - L * math.cos(ang - 0.42), y2 - L * math.sin(ang - 0.42))
    p.lineTo(x2 - L * math.cos(ang + 0.42), y2 - L * math.sin(ang + 0.42))
    p.close()
    c.drawPath(p, fill=1, stroke=0)


class FlowDiagram(Flowable):
    """Snake-layout process flow. steps: list of (actor, action) tuples."""

    def __init__(self, steps, cols=4, title=None, box_h=50):
        super().__init__()
        self.steps, self.cols, self.title, self.box_h = steps, cols, title, box_h
        self.gap_x, self.gap_y = 16, 20
        self.rows = (len(steps) + cols - 1) // cols

    def wrap(self, aw, ah):
        self.aw = aw
        self.bw = (aw - (self.cols - 1) * self.gap_x) / self.cols
        th = 16 if self.title else 0
        self.h = th + self.rows * self.box_h + (self.rows - 1) * self.gap_y + 6
        return aw, self.h

    def _pos(self, i):
        r, c = divmod(i, self.cols)
        if r % 2 == 1:
            c = self.cols - 1 - c
        x = c * (self.bw + self.gap_x)
        top = self.h - (16 if self.title else 0) - r * (self.box_h + self.gap_y)
        return x, top - self.box_h

    def draw(self):
        c = self.canv
        if self.title:
            c.setFont("Body-Bold", 9)
            c.setFillColor(NAVY)
            c.drawString(0, self.h - 10, self.title)
        for i, (actor, action) in enumerate(self.steps):
            x, y = self._pos(i)
            c.setFillColor(colors.white)
            c.setStrokeColor(RULE)
            c.setLineWidth(0.8)
            c.roundRect(x, y, self.bw, self.box_h, 5, fill=1, stroke=1)
            c.setFillColor(ORANGE if i % 2 == 0 else NAVY)
            c.roundRect(x, y + self.box_h - 13, self.bw, 13, 5, fill=1, stroke=0)
            c.rect(x, y + self.box_h - 13, self.bw, 6, fill=1, stroke=0)
            c.setFillColor(colors.white)
            c.setFont("Body-Bold", 7.4)
            c.drawString(x + 5, y + self.box_h - 9.6, f"{i + 1}  {actor}"[:48])
            c.setFillColor(INK)
            c.setFont("Body", 7.8)
            lines = _wrap_text(c, action, "Body", 7.8, self.bw - 10)[:4]
            ty = y + self.box_h - 23
            for ln in lines:
                c.drawString(x + 5, ty, ln)
                ty -= 9
            if i + 1 < len(self.steps):
                nx, ny = self._pos(i + 1)
                if abs(ny - y) < 1:  # same row
                    if nx > x:
                        _arrow(c, x + self.bw + 1, y + self.box_h / 2, nx - 1, ny + self.box_h / 2)
                    else:
                        _arrow(c, x - 1, y + self.box_h / 2, nx + self.bw + 1, ny + self.box_h / 2)
                else:
                    _arrow(c, x + self.bw / 2, y - 1, nx + self.bw / 2, ny + self.box_h + 1)


def flow(steps, title=None, cols=4, box_h=50):
    return [Spacer(1, 4), FlowDiagram(steps, cols=cols, title=title, box_h=box_h), Spacer(1, 10)]


class StateDiagram(Flowable):
    """Linear state machine with optional side branch states."""

    def __init__(self, states, branches=None, title=None):
        super().__init__()
        self.states = states
        self.branches = branches or []  # list of (from_index, label)
        self.title = title

    def wrap(self, aw, ah):
        self.aw = aw
        self.h = (16 if self.title else 0) + 34 + (40 if self.branches else 0)
        return aw, self.h

    def draw(self):
        c = self.canv
        n = len(self.states)
        gap = 14
        bw = (self.aw - (n - 1) * gap) / n
        ytop = self.h - (16 if self.title else 0)
        if self.title:
            c.setFont("Body-Bold", 9)
            c.setFillColor(NAVY)
            c.drawString(0, self.h - 10, self.title)
        y = ytop - 26
        for i, s in enumerate(self.states):
            x = i * (bw + gap)
            c.setFillColor(NAVY_LT if i < n - 1 else GREEN_LT)
            c.setStrokeColor(NAVY if i < n - 1 else GREEN)
            c.setLineWidth(0.8)
            c.roundRect(x, y, bw, 22, 11, fill=1, stroke=1)
            c.setFillColor(INK)
            c.setFont("Body-Bold", 7.6)
            c.drawCentredString(x + bw / 2, y + 8, s)
            if i < n - 1:
                _arrow(c, x + bw + 1, y + 11, x + bw + gap - 1, y + 11)
        for idx, label in self.branches:
            x = idx * (bw + gap)
            by = y - 36
            c.setFillColor(RED_LT)
            c.setStrokeColor(colors.HexColor("#B42318"))
            c.roundRect(x, by, bw, 20, 10, fill=1, stroke=1)
            c.setFillColor(INK)
            c.setFont("Body-Bold", 7.4)
            c.drawCentredString(x + bw / 2, by + 7, label)
            _arrow(c, x + bw / 2, y - 1, x + bw / 2, by + 21, colors.HexColor("#B42318"))


def states(st, branches=None, title=None):
    return [Spacer(1, 4), StateDiagram(st, branches, title), Spacer(1, 10)]


def module_card(code_, name, tier, depends, users, summary):
    rows = [
        [Paragraph(f"<font color='#E2702A'><b>{code_}</b></font>  <b>{name}</b>",
                   ParagraphStyle("mc", parent=S["body"], fontSize=12.5, leading=15,
                                  spaceAfter=0)), ""],
        [Paragraph("<b>Subscription</b>", S["cell"]), Paragraph(tier, S["cell"])],
        [Paragraph("<b>Depends on</b>", S["cell"]), Paragraph(depends, S["cell"])],
        [Paragraph("<b>Primary users</b>", S["cell"]), Paragraph(users, S["cell"])],
        [Paragraph("<b>Purpose</b>", S["cell"]), Paragraph(summary, S["cell"])],
    ]
    t = Table(rows, colWidths=[TEXT_W * 0.2, TEXT_W * 0.8])
    t.setStyle(TableStyle([
        ("SPAN", (0, 0), (-1, 0)),
        ("BACKGROUND", (0, 0), (-1, 0), ORANGE_LT),
        ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#FFFCF9")),
        ("BOX", (0, 0), (-1, -1), 0.8, ORANGE),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, ORANGE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, 0), 7), ("BOTTOMPADDING", (0, 0), (-1, 0), 7),
    ]))
    return [CondPageBreak(130), Spacer(1, 2), t, Spacer(1, 8)]


def tick(yes=True):
    return "<font name='Sym' color='#2E7D4F'>✓</font>" if yes else \
        "<font color='#9AA3AE'>–</font>"


__all__ = [n for n in dir() if not n.startswith("_")]
