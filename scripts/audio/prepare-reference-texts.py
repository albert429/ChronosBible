#!/usr/bin/env python3
"""Write all full reference drafts; never mark generated wording as reviewed."""
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from chronos_tools.audio_references import reference_record  # noqa: E402
from chronos_tools.books import usfm_by_name  # noqa: E402
from chronos_tools.paths import ROOT  # noqa: E402
if __name__ == '__main__':
    books = usfm_by_name()
    plan = json.loads((ROOT / 'data/plan.json').read_text())
    records = {record['id']: record for day in plan for p in day['passages']
               for record in [reference_record(books[p['book']], p)]}
    assert len(records) == 537
    assert sum(r['start'] == r['end'] for r in records.values()) == 6
    (ROOT / 'data/audio/reference-texts.json').write_text(json.dumps({'version': 1, 'reviewStatus': 'draft-needs-Arabic-pronunciation-review', 'references': list(records.values())}, ensure_ascii=False, indent=2) + '\n')
    print('Prepared 537 distinct full references (6 single verses); text review required')
