"""Regression checks for full-Bible study reference and word normalization."""
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("full_study", ROOT / "scripts/import-study-full.py")
study = importlib.util.module_from_spec(spec)
spec.loader.exec_module(study)


class FullStudyImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = json.loads(gzip.decompress((ROOT / "data/study/canonical.json.gz").read_bytes()))
        cls.bible = json.loads(gzip.decompress((ROOT / "data/bible/source.json.gz").read_bytes()))
        cls.text = {f"{b['usfm']}.{c['chapter']}.{v['number']}": v['text'] for b in cls.bible['books'] for c in b['chapters'] for v in c['verses']}

    def test_genesis_meanings_and_strict_arabic_spans(self):
        tokens = self.source['ot']['GEN.1.1']
        self.assertTrue(any(t[2] == 'H1254A' and t[4] == 'to create' and t[5:7] == [2, 2] for t in tokens))
        self.assertTrue(any(t[2] == 'H9003' and t[4] == 'in' for t in tokens))
        row = {'positions': [1], 'arabic': 'خلق', 'tokens': [['בָּרָא', 'bara', 'H1254A', 'HVqp3ms', 'create', None, None, 'he']]}
        valid, count = study.align_rows([row], 'خَلَقَ')
        self.assertEqual(valid[0][5:7], [0, 0])
        self.assertEqual(count, 0)
        invalid, count = study.align_rows([row], 'قَالَ')
        self.assertEqual(invalid[0][5:7], [None, None])
        self.assertEqual(count, 1)

    def test_combined_blocks_are_split_not_duplicated(self):
        for left, right, first_word, last_word in [
            ('2KI.4.43', '2KI.4.44', 'H5414H', 'H3068G'),
            ('PSA.72.19', 'PSA.72.20', 'H3615G', 'H3448'),
        ]:
            before, after = self.source['ot'][left], self.source['ot'][right]
            self.assertNotEqual(before, after)
            self.assertIn(first_word, [t[2] for t in after])
            self.assertEqual(after[-1][2], last_word)
            self.assertTrue(all(t[5] is None or t[6] < len(self.text[right].split(' ')) for t in after))
        self.assertNotIn('H3448', [t[2] for t in self.source['ot']['PSA.72.19']])
        self.assertEqual(self.source['ot']['PSA.72.20'][0][5:7], [0, 0])

    def test_psalm_titles_are_not_in_verse_word_list(self):
        for key in ('PSA.3.1', 'PSA.18.1', 'PSA.51.1', 'PSA.73.1'):
            self.assertNotIn('H4210', [t[2] for t in self.source['ot'][key]])
            self.assertNotIn('H5329', [t[2] for t in self.source['ot'][key]])
        self.assertEqual(len([key for key in self.source['ot'] if key.startswith('PSA.119.')]), 176)

    def test_hebrew_aramaic_and_mixed_verses(self):
        self.assertEqual({t[7] for t in self.source['ot']['DAN.2.3']}, {'he'})
        self.assertEqual({t[7] for t in self.source['ot']['DAN.2.4']}, {'he', 'arc'})
        self.assertEqual({t[7] for t in self.source['ot']['DAN.2.5']}, {'arc'})
        self.assertEqual({t[7] for t in self.source['ot']['EZR.4.8']}, {'arc'})

    def test_source_surface_omissions_do_not_invent_words(self):
        self.assertNotIn('H3227B', [t[2] for t in self.source['ot']['1CH.27.12']])
        self.assertNotIn('H6555', [t[2] for t in self.source['ot']['NEH.2.13']])
        self.assertTrue(all(not entry['d'] for entry in self.source['lexicon'].values()))
        self.assertEqual(self.source['lexicon']['H5892I']['g'], 'city')

    def test_translation_bridge_and_kjv_versification(self):
        tr = self.source['translations']
        self.assertEqual(tr['ACT.15.25']['n'], tr['ACT.15.26']['n'])
        self.assertEqual(tr['ACT.15.25']['n']['b'], '25-26')
        self.assertNotIn('25', tr['ACT.15.24']['n'])
        self.assertEqual(tr['1TI.6.21']['e'], tr['1TI.6.22']['e'])
        self.assertEqual(tr['3JN.1.14']['e'], tr['3JN.1.15']['e'])
        self.assertEqual(tr['3JN.1.15']['e']['b'], '14-15')
        self.assertEqual(set(tr), set(self.text))

    def test_only_marker_bidi_characters_are_normalized(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'source.zip'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('01-GENarbnav.usfm', '\\c 1\n\\v 1\u200f-2 A\u200fB\n\\v 3 C\n')
            verses, bridges = study.translation(path, 'arbnav', ['GEN'])
            self.assertEqual(verses['GEN.1.1'], {'b': '1-2', 't': 'A\u200fB'})
            self.assertEqual(bridges, ['GEN.1.1', 'GEN.1.2'])

    def test_source_checksum_mismatch_is_rejected_before_import(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'ot.zip'
            path.write_bytes(b'replacement source')
            pins = {'stepCommit': study.STEP_COMMIT, 'sources': {'ot': {'sha256': '0' * 64}}, 'legacyNt': {}}
            with self.assertRaisesRegex(ValueError, 'Source checksum mismatch for ot'):
                study.verify_sources({'ot': path}, pins, Path(folder))

    def test_ambiguous_alignment_does_not_claim_partial_span(self):
        row = {'positions': [1, 2], 'arabic': 'خلق السماء', 'tokens': [['x', 'x', 'H0001', 'H', 'x', None, None, 'he']]}
        result, count = study.align_rows([row], 'خَلَقَ ٱلْأَرْضَ')
        self.assertEqual(result[0][5:7], [None, None])
        self.assertEqual(count, 1)


if __name__ == '__main__':
    unittest.main()
