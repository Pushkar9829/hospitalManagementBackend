"""Tiny helpers that emit canvas diagram markup: positioned cards and straight arrow segments."""
import html
FONT = "<link href=\"https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&amp;family=IBM+Plex+Mono:wght@400;500&amp;display=swap\" rel=\"stylesheet\">"
STROKE = '#5B6878'

class D:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.bands, self.arrows, self.cards, self.labels = [], [], [], []
        self.mid = 0
    # --- arrows -------------------------------------------------------
    def _svg(self, left, top, w, h, path, head, color):
        self.mid += 1
        mid = 'dc-arrow-head-filled-%d' % self.mid
        defs = ('<defs><marker id="%s" orient="auto" markerWidth="5" markerHeight="5" refX="2" refY="2" overflow="visible">'
                '<path d="M0 0 L4 2 L0 4 Z" fill="%s" stroke="none" style="stroke: none; fill: %s; fill: context-stroke"/></marker></defs>' % (mid, color, color)) if head else ''
        me = ' marker-end="url(#%s)"' % mid if head else ''
        self.arrows.append('<svg width="%d" height="%d" viewBox="0 0 %d %d" preserveAspectRatio="none" style="position: absolute; left: %dpx; top: %dpx; width: %dpx; height: %dpx; overflow: visible; fill: none; stroke: %s; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round">%s<path d="%s"%s></path></svg>'
                           % (w, h, w, h, left, top, w, h, color, defs, path, me))
    def hl(self, x1, y, x2, head=True, color=STROKE):
        """Horizontal segment from x1 to x2 (tip at x2)."""
        n = abs(x2 - x1); hh = 4 if head else 0
        if x2 >= x1: self._svg(x1, y - 4, n, 8, 'M 0 4 L %d 4' % (n - hh), head, color)
        else: self._svg(x2, y - 4, n, 8, 'M %d 4 L %d 4' % (n, hh), head, color)
    def vl(self, x, y1, y2, head=True, color=STROKE):
        n = abs(y2 - y1); hh = 4 if head else 0
        if y2 >= y1: self._svg(x - 4, y1, 8, n, 'M 4 0 L 4 %d' % (n - hh), head, color)
        else: self._svg(x - 4, y2, 8, n, 'M 4 %d L 4 %d' % (n, hh), head, color)
    # --- shapes --------------------------------------------------------
    def card(self, x, y, w, h, inner, bg='#FFFFFF', border='#C9D1DB', fs=14, radius=10, color='#142130', extra=''):
        self.cards.append('<div style="position: absolute; left: %dpx; top: %dpx; width: %dpx; height: %dpx; box-sizing: border-box; padding: 8px 10px; display: flex; align-items: center; justify-content: center; text-align: center; background: %s; border: 1px solid %s; border-radius: %dpx; font-size: %dpx; line-height: 1.3; color: %s%s"><span>%s</span></div>'
                          % (x, y, w, h, bg, border, radius, fs, color, extra, inner))
    def band(self, x, y, w, h, bg):
        self.bands.append('<div style="position: absolute; left: %dpx; top: %dpx; width: %dpx; height: %dpx; background: %s; border-radius: 8px"></div>' % (x, y, w, h, bg))
    def label(self, x, y, w, text, fs=13, weight=400, color='#5B6878', align='left', lh=None):
        lh = lh or int(fs * 1.35)
        self.labels.append('<div style="position: absolute; left: %dpx; top: %dpx; width: %dpx; font-size: %dpx; line-height: %dpx; font-weight: %d; color: %s; text-align: %s">%s</div>' % (x, y, w, fs, lh, weight, color, align, text))
    def raw(self, s):
        self.labels.append(s)
    def render(self, title_tag):
        return ('<div style="position: relative; width: %dpx; height: %dpx; background: #FFFFFF; font-family: \'IBM Plex Sans\', system-ui, sans-serif; color: #142130">\n' % (self.w, self.h)
                + '\n'.join(self.bands + self.arrows + self.cards + self.labels) + '\n</div>')

def page(title, body, w, h, script='  renderVals() { return {}; }'):
    return ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>%s</title>\n<script src="./support.js"></script>\n</head>\n<body>\n<x-dc>\n<helmet>\n%s\n<style>\nbody{margin:0;font-family:\'IBM Plex Sans\',system-ui,sans-serif;color:#142130}\na{color:#1F5FAD}a:hover{color:#163F73}\n</style>\n</helmet>\n%s\n</x-dc>\n<script type="text/x-dc" data-dc-script data-props=\'{"$preview":{"width":%d,"height":%d}}\'>\nclass Component extends DCLogic {\n%s\n}\n</script>\n</body>\n</html>\n'
            % (html.escape(title), FONT, body, w, h, script))
