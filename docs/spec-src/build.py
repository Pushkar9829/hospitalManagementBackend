"""Builds docs/Hospital_Management_System_Phase1_Specification.pdf.  Run: python3 docs/spec-src/build.py"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(__file__))
from reportlab.lib import colors
from reportlab.platypus import (BaseDocTemplate, Frame, NextPageTemplate, PageBreak,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)
from reportlab.platypus.tableofcontents import TableOfContents

from kit import *  # noqa
from kit import Anchor
import c1_overview, c1b_saas, c2_roles, c3_core, c4_patient_ops, c5_clinical, c6_diagnostics
import c7_business, c7b_support, c8_journeys, c9_arch, c10_data, c11_code, c12_api, c13_deploy

TITLE = "Hospital Management System - Phase 1 SaaS Product and Technical Specification"
VERSION = "1.3"
OUT = os.path.join(os.path.dirname(__file__), "..", "Hospital_Management_System_Phase1_Specification.pdf")


class Doc(BaseDocTemplate):
    def __init__(self, path):
        super().__init__(path, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
                         topMargin=MARGIN + 6, bottomMargin=MARGIN + 4, title=TITLE,
                         author="Product Team",
                         subject="Hospital Management System Phase 1 specification")
        frame = Frame(MARGIN, MARGIN + 4, TEXT_W, PAGE_H - 2 * MARGIN - 10, id="f",
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate("cover", [frame], onPage=cover_page),
                               PageTemplate("body", [frame], onPage=body_page)])

    def afterFlowable(self, f):
        if isinstance(f, Anchor):
            self.notify("TOCEntry", (f.level, f.text, self.page, f.key))


def cover_page(c, doc):
    c.saveState()
    c.setFillColor(NAVY)
    c.rect(0, PAGE_H - 300, PAGE_W, 300, fill=1, stroke=0)
    c.setFillColor(ORANGE)
    c.rect(0, PAGE_H - 306, PAGE_W, 6, fill=1, stroke=0)
    # decorative grid of dots
    c.setFillColor(colors.HexColor("#2C4A73"))
    for i in range(14):
        for j in range(6):
            c.circle(PAGE_W - 40 - i * 12, PAGE_H - 30 - j * 12, 1.4, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Body-Bold", 11)
    c.drawString(MARGIN, PAGE_H - 70, "PHASE 1  ·  CORE SYSTEM AND MVP PATIENT WORKFLOWS")
    c.setFont("Body-Bold", 34)
    c.drawString(MARGIN, PAGE_H - 125, "Hospital Management System")
    c.setFont("Body", 20)
    c.drawString(MARGIN, PAGE_H - 155, "Multi-tenant SaaS Platform")
    c.setFont("Body", 13.5)
    c.setFillColor(colors.HexColor("#C9D6E8"))
    c.drawString(MARGIN, PAGE_H - 195, "Product, User Flow and Technical Specification")
    c.drawString(MARGIN, PAGE_H - 214, "React  ·  Node.js  ·  MongoDB  ·  "
                                       "AWS S3 + CloudFront")
    c.setFont("Body", 10)
    c.setFillColor(colors.white)
    c.drawString(MARGIN, PAGE_H - 252, "Delivery: 1 month   ·   Price: INR 1,00,000 + GST")
    c.drawString(MARGIN, PAGE_H - 270, f"Version {VERSION}   ·   "
                                       f"{date.today().strftime('%d %B %Y')}")
    c.restoreState()


def body_page(c, doc):
    c.saveState()
    c.setStrokeColor(RULE)
    c.setLineWidth(0.5)
    c.line(MARGIN, PAGE_H - MARGIN + 2, PAGE_W - MARGIN, PAGE_H - MARGIN + 2)
    c.setFont("Body", 8)
    c.setFillColor(MUTED)
    c.drawString(MARGIN, PAGE_H - MARGIN + 6, "Hospital Management System  ·  Phase 1 Specification")
    c.drawRightString(PAGE_W - MARGIN, PAGE_H - MARGIN + 6, f"v{VERSION}")
    c.line(MARGIN, MARGIN - 4, PAGE_W - MARGIN, MARGIN - 4)
    c.drawString(MARGIN, MARGIN - 14, "Confidential. Prepared for the hospital product "
                                      "team and implementation partners.")
    c.drawRightString(PAGE_W - MARGIN, MARGIN - 14, f"Page {doc.page}")
    c.restoreState()


def cover_story():
    s = [Spacer(1, 300)]
    pillars = [
        ("Security and Foundations", "Roles and logins, maker-checker, Super Admin "
                                     "approvals, department registration"),
        ("Patient Operations", "Registration, OPD appointments, IPD admission and "
                               "discharge, real-time beds"),
        ("Clinical Workflows", "Nursing stations and notes, shift rosters, doctor "
                               "scheduling, staff directory"),
        ("Diagnostics and Core Departments", "Laboratory, radiology, pharmacy"),
        ("Billing and Reporting", "Cash, billing, printing, finance, inventory, HR, "
                                  "payroll"),
        ("Support Services, Quality and Engagement", "Medical records, diet and kitchen, "
                                                     "housekeeping and facility, quality, "
                                                     "patient portal, CRM, ABDM"),
    ]
    rows = [[Paragraph(f"<font color='#E2702A'><b>{i}</b></font>",
                       ParagraphStyle("n", parent=S["body"], fontSize=16, leading=18)),
             Paragraph(f"<b>{t}</b><br/><font color='#5B6470'>{d}</font>", S["body"])]
            for i, (t, d) in enumerate(pillars, 1)]
    t = Table(rows, colWidths=[22, TEXT_W - 22])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("LINEBELOW", (0, 0), (-1, -2), 0.5, RULE),
                           ("TOPPADDING", (0, 0), (-1, -1), 7),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    s.append(Paragraph("<b>What Phase 1 delivers</b>",
                       ParagraphStyle("x", parent=S["h2"], spaceBefore=0)))
    s.append(t)
    s.append(Spacer(1, 14))
    s += callout("One cloud product replaces separate billing, pharmacy, lab, HR, payroll, "
                 "inventory and accounting software. Hospitals sign up online, subscribe "
                 "module by module, and switch modules on as they grow. Nothing to "
                 "install.", "warn", "SaaS promise.")
    s.append(NextPageTemplate("body"))
    s.append(PageBreak())
    return s


def toc_story():
    toc = TableOfContents()
    toc.levelStyles = [S["toc1"], S["toc2"]]
    toc.dotsMinLevel = 0
    return [Paragraph("Contents", S["h1"]), Rule(ORANGE, 2.2, 46 * mm, after=10), toc,
            PageBreak()]


# One key per H1 chapter, in document order. Cross-references use kit.sec(key).
SECTION_KEYS = ["overview", "product", "saas", "roles", "core", "patient", "clinical", "diag",
                "business", "support", "journeys", "arch", "data", "code", "api", "deploy",
                "security", "quality", "plan"]


def main():
    chapters = [c1_overview, c1b_saas, c2_roles, c3_core, c4_patient_ops, c5_clinical, c6_diagnostics,
                c7_business, c7b_support, c8_journeys, c9_arch, c10_data, c11_code, c12_api, c13_deploy]
    import kit
    kit._counter.update(n=0, h1=0, h2=0)
    kit.SEC.update({k: i + 1 for i, k in enumerate(SECTION_KEYS)})
    story = cover_story() + toc_story()
    for i, ch in enumerate(chapters):
        story += ch.story()
        if i < len(chapters) - 1:
            story.append(PageBreak())
    assert kit._counter["h1"] == len(SECTION_KEYS), "SECTION_KEYS out of sync with chapters"
    doc = Doc(OUT)
    doc.multiBuild(story)
    print("wrote", os.path.abspath(OUT))


if __name__ == "__main__":
    main()
