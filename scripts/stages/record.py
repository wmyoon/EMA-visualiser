"""Checks assessments and appends them to a batch file.

    python3 -I scripts/stages/record.py .cache/guidelines <out.jsonl> <<'END'
    {"id": "...", "stage": "CD", "secondary": "MA", "confidence": "high", "confidence_reason": null,
     "food_chain": false, "reasoning": "...", "evidence": "..."}
    END

One JSON object per line; see RULES.md. A line that fails a check is not
recorded and the reason is printed, so it can be fixed and sent again. The
evidence must appear word for word (ignoring case, punctuation and bare
numbers) in the document text or, failing that, in EMA's page summary.
"""
import glob, json, os, re, sys

base, out = sys.argv[1], sys.argv[2]
STAGES = {'NC', 'CD', 'QM', 'MA', 'PA', 'XC'}
REASONS = {'spans-stages', 'outside-framework', 'policy-paper', 'limited-source'}
manifest = json.load(open(os.path.join(base, 'manifest.json')))
by_id = {e['id']: (url, e) for url, e in manifest.items()}
done = {}
for f in glob.glob(os.path.join(base, 'stages', '*.jsonl')):
    for l in open(f):
        try:
            done[json.loads(l)['id']] = os.path.basename(f)
        except ValueError:
            pass  # blank, or a line another batch is still writing


def norm(s):
    s = s.replace('­', '')
    return ' '.join(t for t in re.sub(r'[^a-z0-9]+', ' ', s.lower()).split() if not t.isdigit())


texts = {}
ok = bad = 0
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
with open(out, 'a') as f:
    for n, line in enumerate(sys.stdin, 1):
        if not line.strip():
            continue
        try:
            a = json.loads(line)
            gid = a['id']
            problems = []
            if gid not in by_id:
                raise ValueError(f'unknown id {gid}')
            if gid in done:
                raise ValueError(f'{gid} is already recorded in {done[gid]}')
            if a.get('stage') not in STAGES:
                problems.append(f'stage must be one of {sorted(STAGES)}')
            if a.get('secondary') is not None and (a['secondary'] not in STAGES or a['secondary'] == a.get('stage')):
                problems.append('secondary must be null or a different stage code')
            if a.get('confidence') not in ('high', 'medium', 'low'):
                problems.append('confidence must be high, medium or low')
            if a.get('confidence') == 'high' and a.get('confidence_reason') is not None:
                problems.append('confidence_reason must be null when confidence is high')
            if a.get('confidence') in ('medium', 'low') and a.get('confidence_reason') not in REASONS:
                problems.append(f'confidence_reason must be one of {sorted(REASONS)}')
            if not isinstance(a.get('food_chain'), bool):
                problems.append('food_chain must be true or false')
            r = (a.get('reasoning') or '').strip()
            if not 30 <= len(r) <= 700:
                problems.append('reasoning must be one to three sentences (30 to 700 characters)')
            ev = (a.get('evidence') or '').strip()
            if not 6 <= len(ev.split()) <= 60:
                problems.append('evidence must be 6 to 60 words')
            url, e = by_id[gid]
            if gid not in texts:
                t = ''
                if e.get('text') and os.path.exists(os.path.join(base, e['text'])):
                    t = open(os.path.join(base, e['text']), encoding='utf-8', errors='replace').read()
                texts[gid] = (norm(t), norm(e.get('summary') or ''))
            doc, page = texts[gid]
            q = norm(ev)
            source = 'document' if q and q in doc else 'page summary' if q and q in page else None
            if ev and not source:
                problems.append('evidence was not found word for word in the document text or page summary')
            if problems:
                raise ValueError(f'{gid}: ' + '; '.join(problems))
            c = e.get('chosen') or {}
            rec = {
                'id': gid, 'url': url, 'title': e['title'], 'category': e.get('category'),
                'document': c.get('title'), 'document_status': c.get('status'), 'document_url': c.get('href'),
                'stage': a['stage'], 'secondary': a.get('secondary'), 'confidence': a['confidence'],
                'confidence_reason': a.get('confidence_reason'), 'food_chain': a['food_chain'],
                'reasoning': r, 'evidence': ev, 'evidence_source': source,
            }
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
            f.flush()  # whole lines only, as other batches read these files
            done[gid] = os.path.basename(out)
            ok += 1
        except (ValueError, KeyError, json.JSONDecodeError) as err:
            bad += 1
            print(f'line {n} NOT recorded: {err}')
print(f'recorded {ok}, rejected {bad}; {len(done)} guidelines assessed in all')
