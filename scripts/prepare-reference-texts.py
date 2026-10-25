#!/usr/bin/env python3
"""Write all full reference drafts; never mark generated wording as reviewed."""
import json
from pathlib import Path
from audio_references import reference_record
ROOT = Path(__file__).resolve().parents[1]
if __name__ == '__main__':
    books = {row[3]: row[0] for row in json.loads((ROOT / 'data/books.json').read_text())}
    plan = json.loads((ROOT / 'data/plan.json').read_text())
    records = {record['id']: record for day in plan for p in day['passages']
               for record in [reference_record(books[p['book']], p)]}
    assert len(records) == 537
    assert sum(r['start'] == r['end'] for r in records.values()) == 6
    (ROOT / 'data/audio/reference-texts.json').write_text(json.dumps({'version': 1, 'reviewStatus': 'draft-needs-Arabic-pronunciation-review', 'references': list(records.values())}, ensure_ascii=False, indent=2) + '\n')
    print('Prepared 537 distinct full references (6 single verses); text review required')
