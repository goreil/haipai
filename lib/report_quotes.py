"""Recover plain-text user reports explicitly attributed in old thanks messages."""

import re
from html.parser import HTMLParser


class _ReportQuotes(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.attribution_depth = 0
        self.parts = []
        self.attribution = []
        self.quotes = {}

    def handle_starttag(self, tag, attrs):
        if tag == 'blockquote':
            if self.depth == 0:
                self.parts = []
                self.attribution = []
                self.attribution_depth = 0
            self.depth += 1
        elif self.depth and tag == 'span':
            if self.attribution_depth or 'quote-attr' in (dict(attrs).get('class') or '').split():
                self.attribution_depth += 1
        elif self.depth and tag in ('br', 'p') and not self.attribution_depth:
            self.parts.append('\n')

    def handle_data(self, data):
        if self.depth:
            (self.attribution if self.attribution_depth else self.parts).append(data)

    def handle_endtag(self, tag):
        if tag == 'span' and self.attribution_depth:
            self.attribution_depth -= 1
        if tag != 'blockquote' or not self.depth:
            return
        self.depth -= 1
        if self.depth:
            return
        match = re.fullmatch(r'\s*[—–-]\s*your report on mistake #(\d+)\b.*',
                             ''.join(self.attribution), re.DOTALL)
        if match:
            self.quotes[int(match[1])] = ''.join(self.parts).strip()


def quoted_report(body, mistake_id):
    parser = _ReportQuotes()
    parser.feed(body or '')
    parser.close()
    return parser.quotes.get(mistake_id)
