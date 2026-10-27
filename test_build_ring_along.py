import copy
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import build_ring_along as builder

SONG_PATH = Path(__file__).with_name('together_we_serve_2175.json')

class MusicSettingsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.data = json.loads(SONG_PATH.read_text(encoding='utf-8'))
        self.music = self.folder / 'music.json'
        self.output = self.folder / 'score.html'
        next_word = 1
        lyric_lines = []
        for line in self.data['verse']:
            words = []
            for note in line:
                if note['word']:
                    words.append(f'word{next_word}')
                    next_word += 1
            lyric_lines.append(' '.join(words))
        stanza = '\n'.join(lyric_lines)
        self.data['lyrics'] = '\n\n'.join([stanza] * 4).splitlines()

    def write_music(self):
        self.music.write_text(json.dumps(self.data), encoding='utf-8')

    def test_bundled_score_alignment_and_ordering(self):
        builder.configure_music(SONG_PATH)
        self.assertEqual(builder.TOKEN_COUNTS, [
            sum(note['word'] for note in line) for line in self.data['verse']
        ])
        self.assertEqual(builder.BEAT[:5], [3, 1, 2, 3, 1])
        self.assertEqual(builder.LINE_BREATH_AFTER, {20})
        self.assertEqual(builder.FLAT[-1][3], 42)
        self.assertEqual(builder.FLAT[-1], ('Bb4', 'Bb', 1, 42))
        stanzas = builder.parse_lyrics(self.data['lyrics'])
        conductor = builder.conductor_rows(stanzas)
        self.assertLess(conductor.index('>D5</span>'), conductor.index('>Bb4</span>'))
        self.assertLess(conductor.index('>Bb4</span>'), conductor.index('>F4</span>'))
        for bell in builder.ORDER:
            line = builder.render_line(stanzas[0], bell, *builder.LINE_BOUNDS[-1])
            self.assertTrue(line.endswith('word42</span>'))
            self.assertNotRegex(line, r'<span class="s k"[^>]*></span>')
        for note, strike in zip(builder.FLAT, builder.STRIKE):
            self.assertIn(note[0], strike)

    def test_edited_chords_and_measures_drive_score(self):
        self.data['time_signature'] = [4, 4]
        self.data['pickup_beats'] = 0
        self.data['strong_beats'] = [1, 3]
        self.data['verse'][0][0]['chord'] = 'F'
        self.data['verse'][0][0]['beats'] = 2
        self.data['chord_tones']['F'] = ['F', 'A']
        self.write_music()
        builder.build(self.music, self.output)
        self.assertEqual(builder.BEAT[:3], [1, 3, 4])
        self.assertEqual(builder.CSETS[0], {'F4', 'A4'})
        page = self.output.read_text(encoding='utf-8')
        self.assertIn('In 4/4 time, beats 1, 3 force a full-chord strike.', page)
        self.assertEqual(page.count('In 4/4 time,'), 2)
        self.assertIn('white-space:nowrap', page)

    def test_measure_markers_follow_notes_that_reach_or_cross_boundaries(self):
        cases = [
            ('exact boundary', [4, 4], 0, [[3, 1, 1]], {1}),
            ('overrun', [4, 4], 0, [[3, 2, 1]], {1}),
            ('fractional start', [4, 4], 0, [[0.5, 3, 1, 0.5]], {2}),
            ('pickup overrun', [3, 2], 1, [[1.5, 0.5, 1]], {0}),
            ('line break and final note', [4, 4], 0, [[3, 2], [3]], {1, 2}),
            ('multiple boundaries in one note', [4, 4], 0, [[9, 1]], {0}),
        ]
        for label, meter, pickup, durations, expected in cases:
            with self.subTest(label=label):
                self.data['time_signature'] = meter
                self.data['pickup_beats'] = pickup
                self.data['strong_beats'] = []
                self.data['verse'] = [
                    [{'melody': 'F4', 'chord': 'Bb', 'beats': beats, 'word': True}
                     for beats in line] for line in durations
                ]
                self.write_music()
                builder.configure_music(self.music)
                words = [f'word{i}' for i in range(len(builder.FLAT))]
                grid = builder.conductor_rows([words])
                cells = [cell.split('">', 1)[0] for cell in grid.split('<div class="')[1:]
                         if cell.startswith('cell')]
                self.assertEqual({i for i, cls in enumerate(cells) if 'bar-end' in cls},
                                 expected)
                self.assertEqual(grid.count('<span class="chord">'), len(words))

    def test_word_counts_and_breath_marks_follow_data(self):
        expected_counts = [sum(note['word'] for note in line)
                           for line in self.data['verse']]
        expected_counts[0] -= 1
        expected_counts[1] += 1
        self.data['verse'][1].insert(0, self.data['verse'][0].pop())
        self.data['verse'][0][0]['breath_after'] = True
        self.write_music()
        builder.configure_music(self.music)
        self.assertEqual(builder.TOKEN_COUNTS, expected_counts)
        self.assertIn(0, builder.LINE_BREATH_AFTER)

    def test_full_chord_after_breath_survives_next_note_suppression(self):
        for strong_beats in ([], [3]):
            with self.subTest(strong_beats=strong_beats):
                self.data['pickup_beats'] = 0
                self.data['strong_beats'] = strong_beats
                self.data['verse'] = [[
                    {'melody': 'F4', 'chord': 'Bb', 'beats': 1, 'word': True,
                     'breath_after': True},
                    {'melody': 'F4', 'chord': 'Bb', 'beats': 1, 'word': True},
                    {'melody': 'F4', 'chord': 'Bb', 'beats': 1, 'word': True},
                ]]
                self.write_music()
                builder.configure_music(self.music)
                self.assertNotIn(builder.BEAT[1], builder.STRONG)
                self.assertEqual(builder.STRIKE[1], builder.CSETS[1])
                self.assertFalse(builder.STRIKE[1] & builder.DAMP[1])
                stanzas = [['one', 'two', 'three']] * 4
                for bell in builder.CSETS[1]:
                    line = builder.render_line(stanzas[0], bell, 0, 3)
                    self.assertRegex(line, r'<span class="s k"[^>]*>two</span>')
                self.assertIn('>two</span>', builder.conductor_rows(stanzas))
                self.data['verse'][0][0]['breath_after'] = False
                self.write_music()
                builder.configure_music(self.music)
                self.assertNotEqual(builder.STRIKE[1], builder.CSETS[1])

    def test_chord_changes_within_measure_ring_full_chord_and_damp_old_notes(self):
        self.data['pickup_beats'] = 0
        self.data['strong_beats'] = [1]
        self.data['verse'] = [[
            {'melody': 'F4', 'chord': chord, 'beats': 1, 'word': True}
            for i, chord in enumerate(['Bb', 'F', 'Dm'], 1)
        ]]
        self.write_music()
        builder.configure_music(self.music)
        self.assertEqual(builder.BEAT, [1, 2, 3])
        self.assertEqual(builder.CSETS, [
            {'Bb4', 'D5', 'F4'}, {'F4', 'A4', 'C5'}, {'D5', 'F4', 'A4'},
        ])
        self.assertEqual(builder.STRIKE, builder.CSETS)
        self.assertEqual(builder.DAMP, [set(), {'Bb4', 'D5'}, {'C5'}])
        for strike, damp in zip(builder.STRIKE, builder.DAMP):
            self.assertFalse(strike & damp)
        for bell in builder.CSETS[1]:
            line = builder.render_line(['one', 'two', 'three'], bell, 0, 3)
            self.assertRegex(line, r'<span class="s k"[^>]*>two</span>')
        for bell in builder.DAMP[1]:
            line = builder.render_line(['one', 'two', 'three'], bell, 0, 3)
            self.assertIn('<span class="s d">two</span>', line)

    def test_melody_rings_on_every_note_including_repeated_pitches(self):
        self.data['pickup_beats'] = 0
        self.data['strong_beats'] = []
        self.data['verse'] = [[
            {'melody': melody, 'chord': 'Bb', 'beats': 1, 'word': True}
            for i, melody in enumerate(['F4', 'F4', 'D5', 'D5'], 1)
        ]]
        self.write_music()
        builder.configure_music(self.music)
        for note, strike, damp in zip(builder.FLAT, builder.STRIKE, builder.DAMP):
            self.assertIn(note[0], strike)
            self.assertFalse(strike & damp)
        self.assertEqual(builder.STRIKE[1], {'F4'})
        self.assertEqual(builder.STRIKE[2], {'D5'})
        self.assertEqual(builder.STRIKE[3], {'D5'})
        words = ['one', 'two', 'three', 'four']
        for bell, word in [('F4', 'two'), ('D5', 'three'), ('D5', 'four')]:
            line = builder.render_line(words, bell, 0, 4)
            self.assertRegex(line, rf'<span class="s k"[^>]*>{word}</span>')

    def test_excluded_bells_override_chords_and_melody_and_can_return(self):
        self.data['pickup_beats'] = 0
        self.data['strong_beats'] = []
        self.data['verse'] = [[
            {'melody': 'F4', 'chord': 'Bb', 'beats': 1, 'word': True},
            {'melody': 'F4', 'chord': 'Bb', 'beats': 1, 'word': True,
             'exclude_notes': ['F4', 'A#4']},
            {'melody': 'F4', 'chord': 'Bb', 'beats': 1, 'word': True},
            {'melody': 'F4', 'chord': 'Bb', 'beats': 1, 'word': True,
             'exclude_notes': ['F4', 'Bb4', 'D5']},
        ]]
        self.data['lyrics'] = ['one two three four']
        self.write_music()
        builder.configure_music(self.music)
        self.assertEqual(builder.CSETS[1], {'D5'})
        self.assertFalse(builder.STRIKE[1] & {'F4', 'Bb4'})
        self.assertEqual(builder.DAMP[1], {'F4', 'Bb4'})
        self.assertTrue({'F4', 'Bb4'} <= builder.STRIKE[2])
        self.assertFalse(builder.CSETS[3])
        self.assertFalse(builder.STRIKE[3])
        self.assertEqual(builder.DAMP[3], builder.CSETS[2])
        builder.build(self.music, self.output)
        page = self.output.read_text(encoding='utf-8')
        self.assertIn('<span class="s d">two</span>', page)
        self.assertEqual(builder.count('F4'), 2)

    def test_exclusions_apply_to_full_chords_but_not_skipped_events(self):
        self.data['pickup_beats'] = 0
        self.data['strong_beats'] = [1, 3]
        self.data['verse'] = [[
            {'melody': 'F4', 'chord': 'Bb', 'beats': 1, 'word': True,
             'exclude_notes': ['F4']},
            {'melody': 'F4', 'chord': 'Bb', 'beats': 1, 'word': False,
             'play_if_word': True, 'exclude_notes': ['D5']},
            {'melody': 'F4', 'chord': 'Bb', 'beats': 1, 'word': True,
             'exclude_notes': ['D5']},
        ]]
        self.write_music()
        builder.configure_music(self.music)
        self.assertEqual(builder.STRIKE[0], {'Bb4', 'D5'})
        self.assertEqual(builder.CSETS[1], builder.CSETS[0])
        self.assertFalse(builder.DAMP[1])
        self.assertEqual(builder.STRIKE[2], {'F4', 'Bb4'})
        self.assertEqual(builder.DAMP[2], {'D5'})

    def test_invalid_exclusions_are_collected_without_overwriting_output(self):
        self.data['verse'] = [[
            {'melody': 'F4', 'chord': 'Bb', 'beats': 1, 'word': True,
             'exclude_notes': value}
            for value in ('F4', None, ['X4', 'F', 'F5', 5])
        ]]
        self.data['lyrics'] = ['one two three']
        self.write_music()
        self.output.write_text('existing', encoding='utf-8')
        with self.assertRaises(ValueError) as caught:
            builder.build(self.music, self.output)
        message = str(caught.exception)
        for text in ('note 1', 'note 2', 'entry 1', 'entry 2', 'entry 3', 'entry 4'):
            self.assertIn(text, message)
        self.assertIn('exclude_notes', message)
        self.assertEqual(self.output.read_text(encoding='utf-8'), 'existing')

    def test_three_four_rerings_full_chord_on_beats_one_and_three(self):
        self.assertEqual(self.data['time_signature'], [3, 4])
        self.assertEqual(self.data['strong_beats'], [1, 3])
        self.data['verse'] = [[
            {'melody': 'F4', 'chord': 'Bb', 'beats': 1, 'word': True}
            for i in range(1, 6)
        ]]
        self.write_music()
        builder.configure_music(self.music)
        self.assertEqual(builder.BEAT, [3, 1, 2, 3, 1])
        for i in (0, 1, 3, 4):
            self.assertEqual(builder.STRIKE[i], builder.CSETS[i])
        self.assertEqual(builder.STRIKE[2], {'F4'})

    def test_lead_in_forces_full_chord_even_on_unaccented_beat(self):
        self.data['pickup_beats'] = 2
        self.data['strong_beats'] = [3]
        self.data['verse'] = [[
            {'melody': 'F4', 'chord': 'Bb', 'beats': 1, 'word': True}
            for i in range(1, 4)
        ]]
        self.write_music()
        builder.configure_music(self.music)
        self.assertEqual(builder.BEAT, [2, 3, 1])
        self.assertEqual(builder.STRIKE[0], builder.CSETS[0])
        self.assertEqual(builder.STRIKE[1], builder.CSETS[1])

    def test_invalid_settings_fail_before_output(self):
        original = copy.deepcopy(self.data)
        cases = [
            ('time_signature', [0, 4], 'time_signature'),
            ('time_signature', [3, 3], 'denominator'),
            ('pickup_beats', 3, 'pickup_beats'),
            ('pickup_beats', True, 'pickup_beats'),
            ('strong_beats', [4], 'strong_beats'),
            ('chord_tones', {'Bb': ['X']}, 'pitch classes'),
            ('verse', [], 'verse'),
        ]
        for field, value, message in cases:
            with self.subTest(field=field, value=value):
                self.data = copy.deepcopy(original)
                self.data[field] = value
                self.write_music()
                with self.assertRaisesRegex(ValueError, message):
                    builder.build(self.music, self.output)
                self.assertFalse(self.output.exists())

    def test_word_overrides_skip_chord_without_changing_timing(self):
        self.data['verse'] = [[
            {'melody': 'F', 'chord': 'Bb', 'beats': 1, 'word': True,
             'breath_after': True},
            {'melody': 'A', 'chord': 'F', 'beats': 1, 'word': True,
             'play_if_word': True},
            {'melody': 'A', 'chord': 'F', 'beats': 1, 'word': True,
             'play_if_word': True},
            {'melody': 'D', 'chord': 'Dm', 'beats': 1, 'word': True},
        ]]
        overrides = [{'line': 1, 'note': i, 'word': False} for i in (2, 3)]
        self.data['lyrics'] = [
            {'type': 'verse', 'lines': ['one two three four']},
            {'type': 'verse', 'lines': ['first last'], 'word_overrides': overrides},
            {'type': 'verse', 'lines': ['one two three four']},
        ]
        self.write_music()
        builder.configure_music(self.music)
        original_beats = list(builder.BEAT)
        builder.configure_music(self.music, word_overrides=overrides)
        self.assertEqual(builder.BEAT, original_beats)
        self.assertEqual(builder.TOKEN_COUNTS, [2])
        for i in (1, 2):
            self.assertEqual(builder.STRIKE[i], set())
            self.assertEqual(builder.DAMP[i], set())
            self.assertEqual(builder.CSETS[i], builder.CSETS[0])
        self.assertEqual(builder.STRIKE[3], builder.CSETS[3])
        self.assertEqual(builder.DAMP[3], {'Bb4'})
        self.assertEqual(builder.FLAT[3][3], 2)
        self.assertEqual(builder.conductor_rows([['first', 'last']]).count('>Sustain</span>'), 2)
        builder.build(self.music, self.output)
        page = self.output.read_text(encoding='utf-8')
        self.assertIn('<h3>Verse 2</h3>', page)
        self.assertEqual(page.count('>Sustain</span>'), 2)
        self.assertEqual(builder.TOKEN_COUNTS, [4])
        self.assertTrue(json.loads(self.music.read_text(encoding='utf-8'))['verse'][0][1]['word'])

    def test_play_if_word_at_start_and_unconditional_wordless_notes(self):
        self.data['verse'] = [[
            {'melody': 'A', 'chord': 'F', 'beats': 1, 'word': False,
             'play_if_word': True},
            {'melody': 'F', 'chord': 'Bb', 'beats': 1, 'word': True},
            {'melody': 'A', 'chord': 'F', 'beats': 1, 'word': False},
        ]]
        self.write_music()
        builder.configure_music(self.music)
        self.assertFalse(builder.CSETS[0])
        self.assertFalse(builder.STRIKE[0])
        self.assertEqual(builder.STRIKE[1], builder.CSETS[1])
        self.assertEqual(builder.STRIKE[2], builder.CSETS[2])
        self.assertEqual(builder.DAMP[2], {'Bb4', 'D5'})

    def test_invalid_word_overrides_and_play_if_word_are_aggregated(self):
        self.data['verse'][0][0]['play_if_word'] = 'yes'
        self.data['lyrics'] = [{
            'type': 'verse', 'lines': ['bad'],
            'word_overrides': [
                {'line': 0, 'note': 1, 'word': False},
                {'line': 1, 'note': 999, 'word': True},
                {'line': 1, 'note': 1, 'word': False},
                {'line': 1, 'note': 1, 'word': True},
                {'line': True, 'note': 1, 'word': False},
            ],
        }]
        self.write_music()
        with self.assertRaises(ValueError) as caught:
            builder.build(self.music, self.output)
        message = str(caught.exception)
        for text in ('play_if_word', 'entry 1', 'entry 2', 'duplicate override', 'entry 5', 'word-tokens'):
            self.assertIn(text, message)
        self.assertFalse(self.output.exists())

    def test_explicit_verse_chorus_patterns_and_repeated_blocks(self):
        self.data['verse'] = [[
            {'melody': 'F', 'chord': 'Bb', 'beats': 1, 'word': True}
        ]]
        self.data['chorus'] = [[
            {'melody': 'A', 'chord': 'F', 'beats': 1, 'word': False},
            {'melody': 'A', 'chord': 'F', 'beats': 1, 'word': True},
            {'melody': 'C', 'chord': 'F', 'beats': 1, 'word': True},
        ]]
        self.data['lyrics'] = [
            {'type': 'verse', 'lines': ['verseone']},
            {'type': 'chorus', 'lines': ['chorusone chorustwo']},
            {'type': 'verse', 'lines': ['versetwo']},
            {'type': 'chorus', 'lines': ['chorusone chorustwo']},
        ]
        self.write_music()
        builder.build(self.music, self.output)
        page = self.output.read_text(encoding='utf-8')
        player = page.split('id="p-a4"', 1)[1].split('</section></section>', 1)[0]
        self.assertIn('<h4>Verse 1</h4>', player)
        self.assertIn('<h4>Verse 2</h4>', player)
        self.assertIn('<h4>Chorus 1</h4>', player)
        self.assertIn('<h4>Chorus 2</h4>', player)
        self.assertRegex(player, r'<span class="s k"[^>]*>chorusone</span>')
        self.assertIn('<span class="s">verseone</span>', player)
        conductor = page.split('id="p-cond"', 1)[1]
        self.assertEqual(conductor.count('<h3>Chorus</h3>'), 1)
        self.assertIn('<h3>Verse</h3>', conductor)
        self.assertIn('in song order', conductor)
        self.assertEqual(builder.TOKEN_COUNTS, [1])

    def test_arbitrary_pattern_names_without_verse_or_chorus(self):
        self.data.pop('verse')
        self.data['opening'] = [[
            {'melody': 'F', 'chord': 'Bb', 'beats': 1, 'word': True}
        ]]
        name = 'bridge & <ending> "repeat"'
        self.data[name] = [[
            {'melody': 'A', 'chord': 'F', 'beats': 1, 'word': True},
            {'melody': 'C', 'chord': 'F', 'beats': 1, 'word': True,
             'play_if_word': True},
        ]]
        self.data['lyrics'] = [
            {'type': 'opening', 'lines': ['start']},
            {'type': name, 'lines': ['middle end']},
            {'type': name, 'lines': ['held'], 'word_overrides': [
                {'line': 1, 'note': 2, 'word': False}
            ]},
        ]
        self.write_music()
        builder.build(self.music, self.output)
        page = self.output.read_text(encoding='utf-8')
        self.assertIn('<h4>Opening</h4>', page)
        self.assertIn('Bridge &amp; &lt;Ending&gt; &quot;Repeat&quot; 2</h3>', page)
        self.assertNotIn('<ending>', page)
        self.assertIn('>Sustain</span>', page)
        self.assertEqual(builder.TOKEN_COUNTS, [1])
        builder.configure_music(self.music, name)
        self.assertEqual(builder.TOKEN_COUNTS, [2])

    def test_named_patterns_validate_missing_malformed_and_nonstring_types(self):
        self.data.pop('verse')
        self.data['broken'] = [[
            {'melody': 'X', 'chord': 'Bb', 'beats': 0, 'word': True}
        ]]
        self.data['empty'] = {}
        self.data['lyrics'] = [
            {'type': 'missing', 'lines': ['one']},
            {'type': 'broken', 'lines': ['one two']},
            {'type': 'empty', 'lines': ['one']},
            {'type': ['bad'], 'lines': ['one']},
        ]
        self.write_music()
        self.output.write_text('existing', encoding='utf-8')
        with self.assertRaises(ValueError) as caught:
            builder.build(self.music, self.output)
        message = str(caught.exception)
        for text in ('missing must', 'broken line 1, note 1', 'beats',
                     'empty must', 'lyrics block 4', 'word-tokens'):
            self.assertIn(text, message)
        self.assertNotIn('verse must', message)
        self.assertEqual(self.output.read_text(encoding='utf-8'), 'existing')

    def test_invalid_chorus_blocks_report_errors_before_output(self):
        self.data['lyrics'] = [{'type': 'chorus', 'lines': ['one']}]
        self.write_music()
        with self.assertRaisesRegex(ValueError, 'chorus must'):
            builder.build(self.music, self.output)
        self.data['chorus'] = [[
            {'melody': 'F', 'chord': 'Bb', 'beats': 1, 'word': True}
        ]]
        for block, message in [
            ({'type': 'bridge', 'lines': ['one']}, 'lyrics block'),
            ({'type': 'chorus', 'lines': ['one two']}, 'word-tokens'),
            ({'type': 'chorus', 'lines': ['one', '', 'two']}, 'expected 1 lines'),
        ]:
            self.data['lyrics'] = [block]
            self.write_music()
            with self.subTest(block=block):
                with self.assertRaisesRegex(ValueError, message):
                    builder.build(self.music, self.output)
                self.assertFalse(self.output.exists())

    def test_three_two_uses_half_note_beats_and_fractional_pickup(self):
        self.data['time_signature'] = [3, 2]
        self.data['pickup_beats'] = 0.5
        self.data['strong_beats'] = [1, 3]
        self.data['verse'] = [[
            {'melody': 'F', 'chord': 'Bb', 'beats': duration, 'word': True}
            for i, duration in enumerate([0.5, 1, 1, 1, 6, 0.5], 1)
        ]]
        self.data['lyrics'] = ['one two three four five six']
        self.write_music()
        builder.build(self.music, self.output)
        self.assertEqual(builder.BEAT, [3, 1, 2, 3, 1, 1])
        for i in (0, 1, 3, 4, 5):
            self.assertEqual(builder.STRIKE[i], builder.CSETS[i])
        self.assertEqual(builder.STRIKE[2], {'F4'})
        page = self.output.read_text(encoding='utf-8')
        self.assertIn('In 3/2 time, beats 1, 3 force a full-chord strike.', page)
        self.assertIn('0.5-beat pickup', page)

    def test_accidentals_minor_chords_and_dynamic_bell_styling(self):
        self.data['bell_range'] = ['D#4', 'E4', 'F#4', 'G#4', 'A4', 'B4', 'C#5']
        self.data['chord_tones'] = {}
        names = ['E', 'B', 'A', 'F#m7', 'G#m7', 'C#m7', 'Emaj7', 'B7']
        self.data['verse'] = [[
            {'melody': 'Gb4', 'chord': chord, 'beats': 1, 'word': True}
            for i, chord in enumerate(names, 1)
        ]]
        self.data['lyrics'] = ['one two three four five six seven eight']
        self.write_music()
        builder.build(self.music, self.output)
        self.assertTrue(all(note[0] == 'F#4' for note in builder.FLAT))
        self.assertEqual(builder.CSETS[3], {'F#4', 'A4', 'C#5', 'E4'})
        self.assertEqual(builder.CSETS[4], {'G#4', 'B4', 'D#4', 'F#4'})
        page = self.output.read_text(encoding='utf-8')
        self.assertIn('.b-fs4{--bell:', page)
        self.assertIn('id="t-fs4"', page)
        self.assertIn('>F#m7</span>', page)
        self.assertEqual(builder.chord_tones('Bbm'), ['Bb', 'Db', 'F'])
        self.assertEqual(builder.chord_tones('F#m'), ['Gb', 'A', 'Db'])
        self.assertEqual(builder.midi_number('B#4'), builder.midi_number('C5'))
        self.assertEqual(builder.midi_number('Cb5'), builder.midi_number('B4'))

    def test_flat_bells_and_enharmonic_custom_chord_tones(self):
        self.data['bell_range'] = ['Db4', 'E4', 'Ab4']
        self.data['chord_tones'] = {'custom': ['C#', 'E', 'G#']}
        self.data['verse'] = [[
            {'melody': 'C#4', 'chord': 'custom', 'beats': 1, 'word': True}
        ]]
        self.write_music()
        builder.configure_music(self.music)
        self.assertEqual(builder.CSETS[0], {'Db4', 'E4', 'Ab4'})
        self.assertEqual(builder.FLAT[0][0], 'Db4')

    def test_unavailable_chord_tones_and_duplicate_bells_report_errors(self):
        self.data['verse'][0][0]['chord'] = 'F#m'
        self.write_music()
        diagnostics = []
        builder.load_music(self.music, diagnostics=diagnostics)
        self.assertEqual(diagnostics, ['Chord F#m is not playing 2 tone(s): Gb, Db.'])
        builder.configure_music(self.music)
        self.assertEqual(builder.CSETS[0], {'F4', 'A4'})
        self.data['bell_range'] = ['D#4', 'Eb4']
        self.write_music()
        with self.assertRaisesRegex(ValueError, 'enharmonically equivalent'):
            builder.load_music(self.music)

    def test_false_words_do_not_consume_lyrics(self):
        self.data['verse'] = [[
            {'melody': 'F4', 'chord': 'Bb', 'beats': 1, 'word': word}
            for word in (False, True, False, False, True, False)
        ]]
        self.data['verse'][0][2]['chord'] = 'F'
        self.data['lyrics'] = ['first last']
        self.write_music()
        original = self.music.read_text(encoding='utf-8')
        builder.build(self.music, self.output)
        self.assertEqual(builder.TOKEN_COUNTS, [2])
        self.assertEqual([note[3] for note in builder.FLAT],
                         [None, 1, None, None, 2, None])
        self.assertEqual(builder.BEAT, [3, 1, 2, 3, 1, 2])
        self.assertEqual(builder.STRIKE[2], builder.CSETS[2])
        self.assertEqual(builder.parse_lyrics(self.data['lyrics']), [['first', 'last']])
        self.assertEqual(builder.first_cue([['first', 'last']], 'F4'), 'a held note')
        for bell in builder.ORDER:
            line = builder.render_line(['first', 'last'], bell, 0, 6)
            self.assertEqual(line.count('>first</span>'), 1)
            self.assertEqual(line.count('>last</span>'), 1)
            self.assertNotRegex(line, r'<span class="s k"[^>]*></span>')
        self.assertEqual(self.music.read_text(encoding='utf-8'), original)

    def test_invalid_notes_report_their_location(self):
        original = copy.deepcopy(self.data)
        for field, value in [('chord', 'unknown'), ('melody', 'X5'),
                             ('beats', 0), ('beats', float('nan')),
                             ('word', 2), ('word', 0), ('word', None),
                             ('word', 'true'),
                             ('breath_after', 'yes')]:
            with self.subTest(field=field, value=value):
                self.data = copy.deepcopy(original)
                self.data['verse'][0][0][field] = value
                self.write_music()
                with self.assertRaisesRegex(ValueError, 'line 1, note 1'):
                    builder.load_music(self.music)

    def test_errors_across_settings_patterns_and_lyrics_are_numbered(self):
        self.data['time_signature'] = [0, 4]
        self.data['pickup_beats'] = -1
        self.data['title'] = 5
        self.data['verse'] = [[
            {'melody': 'X', 'chord': 'unknown', 'beats': 0, 'word': True},
            {'melody': 'F', 'chord': 'Bb', 'beats': -1, 'word': 'yes'},
        ]]
        self.data['chorus'] = [[
            {'melody': 'X5', 'chord': 'Bb', 'beats': 0, 'word': True}
        ]]
        self.data['lyrics'] = [
            {'type': 'verse', 'lines': ['one two']},
            {'type': 'chorus', 'lines': ['one two']},
            {'type': 'bridge', 'lines': ['one']},
        ]
        self.write_music()
        self.output.write_text('existing output', encoding='utf-8')
        result = subprocess.run(
            [sys.executable, str(Path(builder.__file__).resolve()), str(self.music),
             '-o', str(self.output)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        for message in ('time_signature', 'pickup_beats', 'title',
                        'verse line 1, note 1', 'verse line 1, note 2',
                        'chorus line 1, note 1', 'lyrics block 2', 'lyrics block 3'):
            self.assertIn(message, result.stderr)
        numbered = [line for line in result.stderr.splitlines()
                    if line.partition('. ')[0].isdigit()]
        self.assertGreaterEqual(len(numbered), 10)
        self.assertEqual([int(line.partition('.')[0]) for line in numbered],
                         list(range(1, len(numbered) + 1)))
        self.assertNotIn('Traceback', result.stderr)
        self.assertEqual(self.output.read_text(encoding='utf-8'), 'existing output')

    def test_multiple_lyric_errors_are_collected(self):
        for i, line in enumerate(self.data['lyrics']):
            if line:
                self.data['lyrics'][i] = 'bad'
        self.write_music()
        with self.assertRaises(ValueError) as caught:
            builder.build(self.music, self.output)
        self.assertIn('Stanza 1, line 1', str(caught.exception))
        self.assertIn('Stanza 4, line 4', str(caught.exception))
        self.assertFalse(self.output.exists())

    def test_partial_chords_generate_with_deduplicated_warnings(self):
        self.data['bell_range'] = ['F4', 'A4']
        self.data['recommended_bells'] = ['F4', 'A4']
        self.data['verse'] = [[
            {'melody': 'F', 'chord': 'F#m7', 'beats': 1, 'word': True},
            {'melody': 'A', 'chord': 'F#m7', 'beats': 1, 'word': True},
            {'melody': 'F', 'chord': 'Db', 'beats': 1, 'word': True},
        ]]
        self.data['lyrics'] = ['one two three']
        self.write_music()
        console = io.StringIO()
        with redirect_stdout(console):
            builder.build(self.music, self.output)
        self.assertEqual(builder.CSETS, [{'F4', 'A4'}, {'A4'}, {'F4'}])
        self.assertIn('1. Chord Db is not playing 2 tone(s): Db, Ab.', console.getvalue())
        self.assertIn('2. Chord F#m7 is not playing 3 tone(s): Gb, Db, E.', console.getvalue())
        self.assertEqual(console.getvalue().count('Chord F#m7'), 1)
        self.assertIn('>F#m7</span>', self.output.read_text(encoding='utf-8'))

    def test_malformed_collections_collect_errors_without_traceback(self):
        self.data.update(bell_range=[None, 'X4'], recommended_bells='bad',
                         time_signature=None, strong_beats='bad', chord_tones=[],
                         verse=[None, [5]], chorus='bad',
                         lyrics=[{'type': 'verse', 'lines': ['bad']},
                                 {'type': 'chorus', 'lines': ['bad']}, 5])
        self.write_music()
        with self.assertRaises(ValueError) as caught:
            builder.build(self.music, self.output)
        for field in ('bell_range', 'recommended_bells', 'time_signature',
                      'strong_beats', 'chord_tones', 'verse', 'chorus', 'lyrics'):
            self.assertIn(field, str(caught.exception))

    def test_cli_explicit_song_and_default_output(self):
        self.write_music()
        result = subprocess.run(
            [sys.executable, str(Path(builder.__file__).resolve()),
             str(self.music)],
            cwd=self.folder, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.music.with_suffix('.html').exists())

    def test_cli_custom_file_and_explicit_errors(self):
        self.data['time_signature'] = [4, 4]
        self.write_music()
        command = [sys.executable, str(Path(builder.__file__).resolve()),
                   '--input', str(self.music), '--output', str(self.output)]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('4/4 time', self.output.read_text(encoding='utf-8'))
        self.output.write_text('existing output', encoding='utf-8')
        for content in ['{', '{"lines": []}']:
            self.music.write_text(content, encoding='utf-8')
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Error:', result.stderr)
            self.assertEqual(self.output.read_text(encoding='utf-8'), 'existing output')
        self.music.unlink()
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Error:', result.stderr)

    def test_lyrics_tokenization_and_variable_stanza_count(self):
        builder.configure_music(SONG_PATH)
        expected = [f'word{i}' for i in range(1, 43)]
        stanza = self.data['lyrics'][:len(builder.TOKEN_COUNTS)]
        self.assertEqual(builder.parse_lyrics(stanza), [expected])
        self.assertEqual(builder.parse_lyrics(stanza + [' ', ''] + stanza),
                         [expected, expected])
        self.assertEqual(builder.parse_lyrics(stanza * 3), [expected] * 3)
        stanza[0] = ' \t '.join(stanza[0].split())
        self.assertEqual(builder.parse_lyrics(stanza), [expected])

    def test_invalid_lyrics_do_not_overwrite_output(self):
        original = self.data['lyrics']
        for lyrics in (None, [], [5], [''], ['word\nword'],
                       original[:1], ['bad'] + original[1:]):
            with self.subTest(lyrics=lyrics):
                self.data['lyrics'] = lyrics
                self.write_music()
                self.output.write_text('existing', encoding='utf-8')
                with self.assertRaises(ValueError):
                    builder.build(self.music, self.output)
                self.assertEqual(self.output.read_text(encoding='utf-8'), 'existing')

    def test_interactive_list_sorted_and_selection_retried(self):
        for name in ('zulu.json', 'Alpha.json', 'beta.JSON'):
            (self.folder / name).write_text(json.dumps(self.data), encoding='utf-8')
        (self.folder / 'directory.json').mkdir()
        result = subprocess.run(
            [sys.executable, str(Path(builder.__file__).resolve())],
            cwd=self.folder, input='bad\n0\n4\n2\n', capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('1. Alpha.json', result.stdout)
        self.assertIn('2. beta.JSON', result.stdout)
        self.assertIn('3. zulu.json', result.stdout)
        self.assertEqual(result.stdout.count('Invalid selection.'), 3)
        self.assertNotIn('directory.json', result.stdout)
        self.assertTrue((self.folder / 'beta.html').exists())

    def test_interactive_empty_folder_and_eof(self):
        command = [sys.executable, str(Path(builder.__file__).resolve())]
        result = subprocess.run(command, cwd=self.folder, input='',
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('No .json song files', result.stderr)
        self.write_music()
        result = subprocess.run(command, cwd=self.folder, input='',
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('No song selected', result.stderr)

    def test_title_credit_and_bells_are_song_specific_and_escaped(self):
        self.data.pop('key_signature', None)
        self.data['title'] = 'A <different> song'
        self.data['credit'] = 'Composer & author'
        self.write_music()
        builder.build(self.music, self.output)
        page = self.output.read_text(encoding='utf-8')
        self.assertIn('<h1>A &lt;different&gt; song</h1>', page)
        self.assertIn('Composer &amp; author', page)
        self.assertIn('You need bells Eb, F, G, A, Bb, C, D', page)
        self.assertNotIn('Together We Serve', page)
        del self.data['title']
        del self.data['credit']
        self.write_music()
        builder.build(self.music, self.output)
        self.assertIn('<h1>music</h1>', self.output.read_text(encoding='utf-8'))

    def test_cli_rejects_overwriting_song_and_duplicate_input(self):
        self.write_music()
        original = self.music.read_text(encoding='utf-8')
        command = [sys.executable, str(Path(builder.__file__).resolve()), str(self.music)]
        for extra in (['-o', str(self.music)], ['--input', str(self.music)]):
            result = subprocess.run(command + extra, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(self.music.read_text(encoding='utf-8'), original)

    def test_score_titles_replace_player_counts_and_include_key(self):
        self.data['title'] = 'Test & Song'
        self.data['key_signature'] = 'F# minor'
        self.write_music()
        builder.build(self.music, self.output)
        page = self.output.read_text(encoding='utf-8')
        players, conductor = page.split('<section class="panel" role="tabpanel" id="p-cond"', 1)
        heading = '<h2 class="score-title">Test &amp; Song (F# minor)</h2>'
        self.assertEqual(players.count(heading), len(builder.BELLS))
        self.assertNotIn('Your first ring', players)
        self.assertNotIn('in every stanza.</p>', players)
        self.assertIn(heading, conductor)
        self.assertIn('Who rings how often', conductor)
        self.assertIn('<h1>Test &amp; Song (F# minor)</h1>', page)
        self.data['key_signature'] = '<major>'
        self.write_music()
        builder.build(self.music, self.output)
        self.assertIn('(&lt;major&gt;)', self.output.read_text(encoding='utf-8'))
        self.data['key_signature'] = []
        self.write_music()
        with self.assertRaisesRegex(ValueError, 'key_signature'):
            builder.build(self.music, self.output)

    def test_octave_free_melody_and_player_labels_with_conductor_recommendations(self):
        self.data['verse'] = [[
            {'melody': note, 'chord': 'Bb', 'beats': 1, 'word': True}
            for i, note in enumerate(['F', 'D5', 'Bb', 'D#'], 1)
        ]]
        self.data['lyrics'] = ['one two three four']
        self.data['recommended_bells'] = ['F4', 'Bb4', 'D5', 'Eb4']
        self.write_music()
        builder.build(self.music, self.output)
        self.assertEqual([note[0] for note in builder.FLAT], ['F4', 'D5', 'Bb4', 'Eb4'])
        page = self.output.read_text(encoding='utf-8')
        players, conductor = page.split('<section class="panel" role="tabpanel" id="p-cond"', 1)
        self.assertIn('<div class="big">F</div>', players)
        self.assertNotIn('<div class="big">F4</div>', players)
        self.assertIn('<i></i><span>Eb</span>', players)
        self.assertIn('<strong>Recommended bells:</strong> F4, Bb4, D5, Eb4', conductor)
        del self.data['recommended_bells']
        self.write_music()
        builder.build(self.music, self.output)
        self.assertIn('<strong>Recommended bells:</strong> Eb4, F4, G4, A4, Bb4, C5, D5',
                      self.output.read_text(encoding='utf-8'))

    def test_octave_free_ambiguity_and_invalid_recommendations(self):
        self.data['bell_range'].append('F5')
        self.data['verse'][0][0]['melody'] = 'F'
        self.write_music()
        with self.assertRaisesRegex(ValueError, 'specify an octave'):
            builder.load_music(self.music)
        self.data['verse'][0][0]['melody'] = 'F4'
        for recommended in ([], ['F'], ['X4'], 'F4'):
            self.data['recommended_bells'] = recommended
            self.write_music()
            with self.subTest(recommended=recommended):
                with self.assertRaisesRegex(ValueError, 'recommended_bells'):
                    builder.load_music(self.music)


if __name__ == '__main__':
    unittest.main()
