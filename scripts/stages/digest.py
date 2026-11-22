"""Short reading digests of guidelines still to be assessed.

    python3 -I scripts/stages/digest.py .cache/guidelines <ids.txt> [count]

Prints, for each id in the file (one per line) that no stages/*.jsonl records
yet: the title, the document that was downloaded, EMA's page summary and the
scope, summary, purpose and introduction sections of the document's text.
Read the full text in text/<id>.txt when the digest is not enough.
"""
import glob, json, os, re, sys

base, ids_file = sys.argv[1], sys.argv[2]
count = int(sys.argv[3]) if len(sys.argv) > 3 else 10**9
manifest = json.load(open(os.path.join(base, 'manifest.json')))
by_id = {e['id']: (url, e) for url, e in manifest.items()}
done = set()
for f in glob.glob(os.path.join(base, 'stages', '*.jsonl')):
    for l in open(f):
        try:
            done.add(json.loads(l)['id'])
        except ValueError:
            pass  # blank, or a line another batch is still writing
ids = [l.strip() for l in open(ids_file) if l.strip() and l.strip() not in done][:count]

HEAD = re.compile(r'^\s*(?:\d+(?:\.\d+)*\.?\s+|[IVX]+\.\s+)?(executive summary|summary|scope(?: of (?:the|this) (?:guideline|document))?|introduction(?: and background)?|background|purpose|objectives?|aims?|general considerations)\s*:?\s*$', re.I)
ANYHEAD = re.compile(r'^\s*(?:\d+(?:\.\d+)*\.?\s+[A-Z][^.]{2,70}|[A-Z][A-Z ,/&()-]{4,70})\s*$')
LIMIT = {'executive summary': 650, 'summary': 650, 'scope': 900, 'introduction': 650, 'background': 500,
         'purpose': 500, 'objective': 500, 'aim': 400, 'general considerations': 400}


def clean(s):
    # Draft PDFs carry runs of line numbers; drop them.
    return re.sub(r'\s+', ' ', re.sub(r'(?:(?<=\s)|^)(?:\d{1,4}\s+){3,}', ' ', s)).strip()


def sections(text):
    lines = [l for l in text.splitlines() if '.....' not in l]  # contents lines
    out = {}
    for i, l in enumerate(lines):
        m = HEAD.match(l)
        if not m:
            continue
        key = m.group(1).lower()
        key = 'scope' if key.startswith('scope') else 'introduction' if key.startswith('introduction') else key.rstrip('s') if key in ('objectives', 'aims') else key
        if key in out:
            continue
        body = []
        for l2 in lines[i + 1:i + 80]:
            if (HEAD.match(l2) or ANYHEAD.match(l2)) and body:
                break
            body.append(l2)
        b = clean(' '.join(body))
        b = re.sub(r'\b(?:EMA|EMEA|CPMP|CHMP|CVMP)/[^ ]+ Page \d+/\d+', '', b)
        b = re.sub(r'Page \d+/\d+', '', b)
        if len(b) > 60:
            out[key] = b[:LIMIT.get(key, 500)]
    return out


for gid in ids:
    url, e = by_id[gid]
    print(f'### {gid} | {e["title"]} | {e.get("category")}')
    c = e.get('chosen') or {}
    print(f'doc: {c.get("title")} | {c.get("status")} | published {c.get("published")}')
    if e.get('summary'):
        print('page:', clean(e['summary'])[:400])
    if e.get('error'):
        print('no text:', e['error'])
    path = os.path.join(base, e['text']) if e.get('text') else None
    if path and os.path.exists(path):
        t = open(path, encoding='utf-8', errors='replace').read()
        words = len(t.split())
        if words < 150:
            print(f'(document text is only {words} words; probably a scan or a short note)')
        s = sections(t)
        budget = 1100
        for k in ('scope', 'executive summary', 'summary', 'purpose', 'objective', 'introduction', 'background', 'aim'):
            if k in s and budget > 120:
                part = s[k][:budget]
                budget -= len(part)
                print(f'{k}: {part}')
        if not s:
            t2 = '\n'.join(l for l in t.splitlines() if '.....' not in l)
            body = clean(t2[1200:3200]) if len(t2) > 3200 else clean(t2[:1800])
            print('text:', body[:1000])
    elif not e.get('error'):
        print('no text: the page lists no document')
    print()
