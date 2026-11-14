"""Listening acceptance must bind to the final file and include neighbouring verses."""
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from _support import ROOT
from chronos_tools.audio_alignments import (alignment_paths, listening_results,
    review_requirements, unresolved_verses)
from chronos_tools.fingerprints import digest


class Listening(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.path = self.folder / 'GEN-1.json'
        self.path.write_text('{"final":true}')
        self.alignments = {'GEN-1': {'chapter': 1, 'verses': [
            {'verse': n, 'score': .1 if n == 2 else .9} for n in range(1, 6)]}}
        self.row = {'chapter': 'GEN-1', 'alignmentHash': digest(self.path.read_bytes()),
                    'from': 1, 'to': 3, 'reviewer': 'Test reviewer', 'date': date.today().isoformat(),
                    'notes': 'Test evidence only', 'result': 'accepted', 'maxStartErrorSeconds': .5,
                    'drift': False, 'clippedScripture': False}

    def results(self, rows):
        ledger = self.folder / 'listening.json'
        ledger.write_text(json.dumps({'version': 1, 'acceptanceSeconds': .5, 'reviews': rows}))
        return listening_results(ledger, {'GEN-1': self.path}, self.alignments)

    def test_listening_resolves_low_score_without_changing_it(self):
        accepted, errors = self.results([self.row])
        self.assertEqual(errors, [])
        self.assertEqual(unresolved_verses(self.alignments, {'GEN-1': {2}}, accepted), {})
        self.assertEqual(self.alignments['GEN-1']['verses'][1]['score'], .1)

    def test_stale_failed_incomplete_and_outside_target_never_resolve(self):
        for update in ({'alignmentHash': '0' * 64}, {'maxStartErrorSeconds': .501},
                       {'result': 'rejected'}, {'drift': True}, {'clippedScripture': True}, {'reviewer': ''}):
            accepted, errors = self.results([{**self.row, **update}])
            self.assertTrue(errors)
            self.assertEqual(unresolved_verses(self.alignments, {}, accepted), {'GEN-1': {2}})
        accepted, errors = self.results([{**self.row, 'from': 2, 'to': 2}])
        self.assertFalse(errors)
        self.assertEqual(unresolved_verses(self.alignments, {}, accepted), {'GEN-1': {2}})

    def test_failed_overlap_overrides_acceptance(self):
        accepted, errors = self.results([self.row, {**self.row, 'result': 'rejected'}])
        self.assertTrue(errors)
        self.assertFalse(accepted['GEN-1'])

    def test_sample_queue_includes_flags_book_samples_and_clip_boundaries(self):
        rows = review_requirements(self.alignments, {'GEN-1': {2}},
            [{'book': 'GEN', 'chapter': 1, 'from': 2, 'to': 4}])
        reasons = {reason for row in rows for reason in row['reasons']}
        self.assertTrue({'book opening', 'book midpoint', 'book ending', 'representative chapter',
                         'affected clip start', 'affected clip end'} <= reasons)


class Discovery(unittest.TestCase):
    def test_defaults_find_all_chapters_and_duplicate_conflicts_fail(self):
        folders = [ROOT / 'data/audio/alignments', ROOT / 'data/audio/alignments/ot']
        self.assertEqual(len(alignment_paths(folders)), 1189)
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / 'GEN-1.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'Conflicting'):
                alignment_paths([*folders, folder])


if __name__ == '__main__':
    unittest.main()
