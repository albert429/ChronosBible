"""Deterministic Arabic reference drafts. Human text/voice review remains required."""
from audio_text import compact, digest

MASC = ['', 'الْأَوَّل', 'الثَّانِي', 'الثَّالِث', 'الرَّابِع', 'الْخَامِس', 'السَّادِس', 'السَّابِع', 'الثَّامِن', 'التَّاسِع', 'الْعَاشِر']
FEM = ['', 'الْأُولَى', 'الثَّانِيَة', 'الثَّالِثَة', 'الرَّابِعَة', 'الْخَامِسَة', 'السَّادِسَة', 'السَّابِعَة', 'الثَّامِنَة', 'التَّاسِعَة', 'الْعَاشِرَة']
TENS = {20: 'الْعِشْر', 30: 'الثَّلَاث', 40: 'الْأَرْبَع', 50: 'الْخَمْس', 60: 'السِّتّ', 70: 'السَّبْع', 80: 'الثَّمَان', 90: 'التِّسْع'}
BOOKS = {
    'MAT': 'إِنْجِيل مَتَّى', 'MRK': 'إِنْجِيل مَرْقُس', 'LUK': 'إِنْجِيل لُوقَا', 'JHN': 'إِنْجِيل يُوحَنَّا',
    'ACT': 'سِفْر أَعْمَال الرُّسُل', 'ROM': 'الرِّسَالَة إِلَى أَهْل رُومِيَة',
    '1CO': 'الرِّسَالَة الْأُولَى إِلَى أَهْل كُورِنْثُوس', '2CO': 'الرِّسَالَة الثَّانِيَة إِلَى أَهْل كُورِنْثُوس',
    'GAL': 'الرِّسَالَة إِلَى أَهْل غَلَاطِيَة', 'EPH': 'الرِّسَالَة إِلَى أَهْل أَفَسُس',
    'PHP': 'الرِّسَالَة إِلَى أَهْل فِيلِبِّي', 'COL': 'الرِّسَالَة إِلَى أَهْل كُولُوسِّي',
    '1TH': 'الرِّسَالَة الْأُولَى إِلَى أَهْل تَسَالُونِيكِي', '2TH': 'الرِّسَالَة الثَّانِيَة إِلَى أَهْل تَسَالُونِيكِي',
    '1TI': 'الرِّسَالَة الْأُولَى إِلَى تِيمُوثَاوُس', '2TI': 'الرِّسَالَة الثَّانِيَة إِلَى تِيمُوثَاوُس',
    'TIT': 'الرِّسَالَة إِلَى تِيطُس', 'PHM': 'الرِّسَالَة إِلَى فِلِيمُون', 'HEB': 'الرِّسَالَة إِلَى الْعِبْرَانِيِّين',
    'JAS': 'رِسَالَة يَعْقُوب', '1PE': 'رِسَالَة بُطْرُس الْأُولَى', '2PE': 'رِسَالَة بُطْرُس الثَّانِيَة',
    '1JN': 'رِسَالَة يُوحَنَّا الْأُولَى', '2JN': 'رِسَالَة يُوحَنَّا الثَّانِيَة', '3JN': 'رِسَالَة يُوحَنَّا الثَّالِثَة',
    'JUD': 'رِسَالَة يَهُوذَا', 'REV': 'سِفْر رُؤْيَا يُوحَنَّا',
}
ONE_CHAPTER = {'OBA', 'PHM', '2JN', '3JN', 'JUD'}


def ordinal(number, feminine=False, oblique=False):
    if not 1 <= number <= 199:
        raise ValueError(f'Unsupported spoken ordinal: {number}')
    table = FEM if feminine else MASC
    if number <= 10:
        return table[number]
    if number < 20:
        first = ('الْحَادِيَة' if feminine else 'الْحَادِي') if number == 11 else ('الثَّانِيَة' if feminine else 'الثَّانِي') if number == 12 else table[number - 10]
        return first + (' عَشْرَة' if feminine else ' عَشَر')
    if number < 100:
        ten, unit = divmod(number, 10)
        suffix = 'ِين' if oblique else 'ُون'
        tens = TENS[ten * 10] + suffix
        first = ('الْحَادِيَة' if feminine else 'الْحَادِي') if unit == 1 else table[unit]
        return tens if not unit else first + ' وَ' + tens
    if number == 100:
        return 'الْمِئَة'
    return 'الْمِئَة وَ' + ordinal(number - 100, feminine, oblique)


def reference_id(code, passage):
    return f"{code}-{passage['chapter']}-{passage['start']}-{passage['end']}"


def spoken_reference(code, passage):
    title = BOOKS.get(code, 'سِفْر ' + passage['book'])
    if code == 'PSA':
        chapter = 'الْمَزْمُور ' + ordinal(passage['chapter'])
        title = chapter
    elif code not in ONE_CHAPTER:
        title += '، الْإِصْحَاح ' + ordinal(passage['chapter'])
    start = ordinal(passage['start'], feminine=True, oblique=True)
    if passage['start'] == passage['end']:
        return title + '، الْآيَة ' + start + '.'
    return title + '، مِنَ الْآيَة ' + start + ' إِلَى ' + ordinal(passage['end'], feminine=True, oblique=True) + '.'


def reference_record(code, passage):
    text = spoken_reference(code, passage)
    return {'id': reference_id(code, passage), 'book': code, 'chapter': passage['chapter'],
            'start': passage['start'], 'end': passage['end'], 'text': text,
            'textHash': digest(text.encode()), 'reviewed': False}
