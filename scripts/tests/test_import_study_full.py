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

    def test_lexicon_names_entries_by_dstrong_not_linked_entries(self):
        lex = self.source['lexicon']
        # Exact source code points: Hebrew marks are not normalized.
        for key, lemma, meaning in [
            ('H3068G', '\u05d9\u05b0\u05d4\u05b9\u05d5\u05b8\u05d4', 'LORD'),
            ('H0136', '\u05d0\u05b2\u05d3\u05b9\u05e0\u05b8\u05d9', 'Lord'),
            ('H4872', '\u05de\u05b9\u05e9\u05c1\u05b6\u05d4', 'Moses'),
            ('H3478', '\u05d9\u05b4\u05e9\u05c2\u05b0\u05e8\u05b8\u05d0\u05b5\u05dc', 'Israel'),
            ('H0430G', '\u05d0\u05b1\u05dc\u05b9\u05d4\u05b4\u05d9\u05dd', 'God'),
            ('H9005', '/ל', 'to/for'),
            ('H9003', '/ב', 'in/on/with'),
            ('H9004', '/כ', 'like/as'),
        ]:
            self.assertEqual((lex[key]['l'], lex[key]['g']), (lemma, meaning), key)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'tbesh.txt'
            # An earlier entry that links to H3068G must not name it.
            path.write_text(
                'H0136\tH0136 = a Name of\tH3068G\tאֲדֹנָי\ta.do.nai\tH:N-M\tLord\t\n'
                'H3068\tH3068G =\tH3068G\tיְהֹוָה\tye.ho.vah\tH:N\tLORD\t\n'
                'H7121\tH7121H =\tH7121H\tקָרָא\tqa.ra\tH:V\tcall_by\t\n',
                encoding='utf-8',
            )
            parsed = study.hebrew_lexicon(path)
        self.assertEqual(parsed['H3068G']['g'], 'LORD')
        self.assertEqual(parsed['H3068']['g'], 'LORD')
        self.assertEqual(parsed['H0136']['g'], 'Lord')
        self.assertEqual(parsed['H7121H']['g'], 'call by')

    def test_greek_sourced_apparatus_words_are_excluded(self):
        ot = self.source['ot']
        # Gen 4:8 "let us go to the field" and 1 Sam 13:1 "thirty ... forty"
        # are BHS apparatus readings from the LXX, not the Leningrad text.
        self.assertNotIn('H1980G', [t[2] for t in ot['GEN.4.8']])
        self.assertEqual([t[2] for t in ot['GEN.4.8']].count('H7704G'), 1)
        self.assertNotIn('H7970', [t[2] for t in ot['1SA.13.1']])
        self.assertNotIn('H0705', [t[2] for t in ot['1SA.13.1']])
        self.assertEqual(len(ot['1SA.14.41']), 19)
        self.assertTrue(study.greek_sourced('#0501X'))
        self.assertTrue(study.greek_sourced('(7.67)#0502X'))
        self.assertFalse(study.greek_sourced('(7.67)#1401R'))
        self.assertFalse(study.greek_sourced('#05Q(K)'))

    def test_a_hebrew_word_appears_once_in_its_most_specific_row(self):
        ot = self.source['ot']
        # The source pairs קָרָא with both «لذلك» and «دُعِيَ».
        call = [t for t in ot['GEN.19.22'] if t[2] == 'H7121H']
        self.assertEqual(len(call), 1)
        self.assertEqual(self.text['GEN.19.22'].split(' ')[call[0][5]], 'دُعِيَ')
        self.assertEqual([t[2] for t in ot['NUM.22.34']].count('H3588A'), 2)
        self.assertEqual([t[2] for t in ot['LEV.24.16']].count('H7275'), 2)
        rows = [
            {'tokens': [['a'], ['b']], 'hebrew': [(0, '#01'), (1, '#02')]},
            {'tokens': [['b'], ['b']], 'hebrew': [(0, '#02'), (1, '#02')]},
        ]
        self.assertEqual(study.unique_words(rows), 2)
        self.assertEqual([row['tokens'] for row in rows], [[['a']], [['b']]])
        self.assertEqual(
            study.hebrew_words('H9001;{H6485J};H9033; {H5921A}', '#07; #08'),
            [(0, '#07'), (0, '#07'), (0, '#07'), (1, '#08')],
        )

    def test_glosses_have_no_source_word_joiners(self):
        self.assertFalse(any('_' in t[4] for tokens in self.source['ot'].values() for t in tokens))
        self.assertFalse(any('_' in entry['g'] for entry in self.source['lexicon'].values()))
        self.assertIn('country, planet', [t[4] for t in self.source['ot']['GEN.4.8']])

    def test_ambiguous_alignment_does_not_claim_partial_span(self):
        row = {'positions': [1, 2], 'arabic': 'خلق السماء', 'tokens': [['x', 'x', 'H0001', 'H', 'x', None, None, 'he']]}
        result, count = study.align_rows([row], 'خَلَقَ ٱلْأَرْضَ')
        self.assertEqual(result[0][5:7], [None, None])
        self.assertEqual(count, 1)


if __name__ == '__main__':
    unittest.main()
