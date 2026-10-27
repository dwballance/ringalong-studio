#!/usr/bin/env python3
"""
Offline builder: handbell ring-along sheets from a song JSON file.

Run entirely on your own machine (no internet, no Claude) once you have
permission to reproduce the lyrics (e.g. your church's OneLicense.net /
CCLI coverage, or direct permission from Hope Publishing Co.).

Usage:
    python build_ring_along.py [song.json] [-o output.html]
    python build_ring_along.py --input song.json

With no input, choose from an alphabetical numbered list of .json files in
the current folder. Output defaults to the input filename with .html instead
of .json. Each song file contains both music and lyrics.

Music settings
--------------
title: optional song title (defaults to the input filename without extension).
key_signature: optional key label, such as "Bb major" or "E major"; displayed
in parentheses after the title on individual and conductor scores.
credit: optional music attribution displayed in the footer.
lyrics: array of strings, one per lyric line; use "" between stanzas.
Alternatively use explicit blocks: {"type": "bridge", "lines": ["..."]}.
type may be any string and must exactly match a top-level note pattern
with that name (e.g. "bridge": [[{...}]]). Explicit blocks do not require
a verse or chorus pattern. All patterns share the song's key signature,
meter, and bell settings. Repeated blocks are numbered within each type.
Each explicit lyric block may include word_overrides, for example:
[{"line": 2, "note": 4, "word": false}]. Positions are 1-based within its
named pattern. Overrides apply only to that block.
Notes may set play_if_word: true (default false). If the effective word
value is false, that slot sustains the previous bells for its duration:
no strike, damp, or chord change. Timing and subsequent beat positions stay
unchanged. The conductor labels these slots "Sustain".
Notes may set exclude_notes: ["A4", "C5"] to omit specific bells from that
event, including its melody bell. Use octave-qualified available bell pitches;
enharmonic spellings match. Excluded sounding bells are damped, and may ring
again on later events. The default is []; lyrics and timing are unchanged.
Skipped play_if_word events still sustain previous bells without damping.
Each block must have one lyric line per entry in its selected pattern.
Legacy string-only lyrics use the verse pattern. Any positive number
of stanzas is supported. Whitespace separates word/syllable tokens.

time_signature: [beats per measure, beat-unit denominator], e.g. [3, 4].
For 3/2 use [3, 2]: beats and pickup_beats count half notes, so a half
note is 1 beat, a quarter note is 0.5, and a whole note is 2.
pickup_beats: length of the opening incomplete measure (0 for no pickup).
Conductor measure markers follow the note whose duration reaches or crosses
a measure boundary, even if the note extends into the next measure.
strong_beats: beat numbers that force a full-chord strike.
The bundled 3/4 arrangement re-rings on beats 1 and 3. The opening note
always plays the full chord, including when it is a lead-in.
bell_range: available bell pitches, such as D#4, Eb4, or C#5.
recommended_bells: optional octave-qualified bell list for the conductor's
score (defaults to bell_range). Player labels omit octave numbers.
Melody notes may omit the octave when their pitch class identifies exactly
one available bell; otherwise supply an octave to resolve the ambiguity.
Natural notes and single #/b accidentals are supported. Enharmonic spellings
match by sounding pitch; bell labels keep their configured spelling.
chord_tones: optional custom chord definitions, mapping names to pitch classes.
Undefined major, minor (m), dominant seventh (7), minor seventh (m7), and
major seventh (maj7) chords are derived automatically, e.g. F#m7 or Bbm.
Unavailable chord tones are omitted, with numbered console warnings listing
the missing tones. Song validation errors are collected before generation
and reported together as a numbered list; invalid songs do not overwrite output.
Each chord-name change forces the full new chord to strike and damps bells
from the previous chord that are not included, even within a measure.
The melody bell strikes on every played note, including repeated pitches,
unless explicitly excluded by exclude_notes.
Named patterns: lists of note lines, each note with melody, chord, beats,
and word fields.
Durations and pickup length are in time-signature beat units. word is a
boolean: true consumes the next lyric token; false plays without a word.
Unlabelled notes consume no lyric token but retain timing and chords.
Word indices are assigned internally in order across the stanza. Each line must have
at least one lyric token. Optional breath_after: true adds a breath mark
and forces the full chord to strike on the following note.
Line breaks in this file control the tablature lines; token counts are derived
from the word indices.

Hyphenate split syllables the way they're sung, e.g. "To-geth-er" as
three tokens "To-" "geth-" "er" (trailing hyphen = continues into the
next token with no strike-mark gap).

If you change word assignments, update the lyric lines to match the
resulting token counts.
Bell colors and strike/damp logic remain in this script.
"""
import argparse
import copy
import html as _html
import json
import math
import re
from fractions import Fraction
from pathlib import Path

# ---------------------------------------------------------------- bells ---
DEFAULT_BELL_RANGE = ['Eb4', 'F4', 'G4', 'A4', 'Bb4', 'C5', 'D5']
ORDER = list(DEFAULT_BELL_RANGE)
BELLS = [
    ('eb4', 'Eb4', '#0E7C86', '#FFFFFF'),
    ('f4',  'F4',  '#2563C9', '#FFFFFF'),
    ('g4',  'G4',  '#7040C8', '#FFFFFF'),
    ('a4',  'A4',  '#C0273F', '#FFFFFF'),
    ('bb4', 'Bb4', '#C2410C', '#FFFFFF'),
    ('c5',  'C5',  '#E3B505', '#241C00'),
    ('d5',  'D5',  '#2F8541', '#FFFFFF'),
]
BY = {b[1]: b for b in BELLS}
PITCHCLASS = {'Eb4': 'Eb', 'F4': 'F', 'G4': 'G', 'A4': 'A', 'Bb4': 'Bb', 'C5': 'C', 'D5': 'D'}
DEFAULT_MUSIC_PATH = Path(__file__).with_name('music.json')
NATURAL_SEMITONES = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
CHROMATIC_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
CHORD_INTERVALS = {'': (0, 4, 7), 'm': (0, 3, 7), '7': (0, 4, 7, 10),
                   'm7': (0, 3, 7, 10), 'maj7': (0, 4, 7, 11)}
PITCH_COLORS = [
    ('#E3B505', '#241C00'), ('#A68A12', '#FFFFFF'), ('#2F8541', '#FFFFFF'),
    ('#0E7C86', '#FFFFFF'), ('#147E6A', '#FFFFFF'), ('#2563C9', '#FFFFFF'),
    ('#4854BC', '#FFFFFF'), ('#7040C8', '#FFFFFF'), ('#9438A1', '#FFFFFF'),
    ('#C0273F', '#FFFFFF'), ('#C2410C', '#FFFFFF'), ('#95502A', '#FFFFFF'),
]


def pitch_class(name):
    if not isinstance(name, str) or not re.fullmatch(r'[A-G][#b]?', name):
        raise ValueError(f'Invalid pitch class: {name!r}')
    accidental = 1 if name.endswith('#') else -1 if name.endswith('b') else 0
    return (NATURAL_SEMITONES[name[0]] + accidental) % 12


def midi_number(note_name):
    if not isinstance(note_name, str) or not re.fullmatch(r'[A-G][#b]?\d+', note_name):
        raise ValueError(f'Invalid note name: {note_name!r}')
    match = re.fullmatch(r'([A-G])([#b]?)(\d+)', note_name)
    letter, accidental, octave = match.groups()
    offset = 1 if accidental == '#' else -1 if accidental == 'b' else 0
    return (int(octave) + 1) * 12 + NATURAL_SEMITONES[letter] + offset


def chord_tones(name):
    match = re.fullmatch(r'([A-G][#b]?)(maj7|m7|m|7)?', name)
    if not match:
        raise ValueError(f"Unsupported chord {name!r}; define it explicitly in chord_tones.")
    root, quality = match.groups()
    return [CHROMATIC_NAMES[(pitch_class(root) + interval) % 12]
            for interval in CHORD_INTERVALS[quality or '']]


def nearest_bell(note_name, bell_range):
    if note_name in bell_range:
        return note_name
    if isinstance(note_name, str) and re.fullmatch(r'[A-G][#b]?', note_name):
        matches = [bell for bell in bell_range
                   if midi_number(bell) % 12 == pitch_class(note_name)]
        if len(matches) != 1:
            raise ValueError(f"Melody {note_name!r} must match exactly one available bell; specify an octave.")
        return matches[0]
    target = midi_number(note_name)
    return min(bell_range, key=lambda bell: (abs(midi_number(bell) - target), midi_number(bell)))


def apply_word_overrides(lines, overrides, errors, label):
    result = copy.deepcopy(lines)
    if not isinstance(overrides, list):
        errors.append(f"{label}: word_overrides must be a list.")
        return result
    seen = set()
    for i, override in enumerate(overrides, 1):
        location = f"{label}, word_overrides entry {i}"
        if not isinstance(override, dict):
            errors.append(f"{location} must be an object.")
            continue
        li, ni, word = (override.get(key) for key in ('line', 'note', 'word'))
        if (type(li) is not int or type(ni) is not int or type(word) is not bool
                or not 1 <= li <= len(result) or not isinstance(result[li - 1], list)
                or not 1 <= ni <= len(result[li - 1])
                or not isinstance(result[li - 1][ni - 1], dict)):
            errors.append(f"{location} needs valid 1-based line/note positions and a boolean word.")
        elif (li, ni) in seen:
            errors.append(f"{location}: duplicate override for line {li}, note {ni}.")
        else:
            seen.add((li, ni))
            result[li - 1][ni - 1]['word'] = word
    return result


def validate_lyrics(lyrics, counts, errors, data):
    def check_block(lines, kind, label, expected=None):
        if (not isinstance(lines, list) or not lines
                or not all(isinstance(line, str) and '\n' not in line and '\r' not in line for line in lines)):
            errors.append(f"{label}: lyrics must be a non-empty array of single-line strings.")
            return
        expected = counts.get(kind) if expected is None else expected
        if expected is None:
            errors.append(f"{label}: {kind} must be a non-empty list.")
            return
        if len(lines) != len(expected):
            errors.append(f"{label}: expected {len(expected)} lines, found {len(lines)}.")
        for li, (text, count) in enumerate(zip(lines, expected), 1):
            if count is not None and len(text.split()) != count:
                errors.append(f"{label}, line {li}: expected {count} word-tokens, found {len(text.split())}.")

    if not isinstance(lyrics, list) or not lyrics:
        errors.append("lyrics must be a non-empty array.")
        return
    if any(isinstance(block, dict) for block in lyrics):
        for i, block in enumerate(lyrics, 1):
            if not isinstance(block, dict) or not isinstance(block.get('type'), str):
                errors.append(f"lyrics block {i} must contain a string type naming a note pattern and a lines array.")
                continue
            label = f"lyrics block {i} ({block['type']})"
            expected = None
            if 'word_overrides' in block and block['type'] in counts:
                effective = apply_word_overrides(data[block['type']], block['word_overrides'], errors, label)
                expected = [sum(note.get('word') is True for note in line)
                            if isinstance(line, list) and all(isinstance(note, dict) for note in line)
                            else None for line in effective]
            check_block(block.get('lines'), block['type'], label, expected)
    elif all(isinstance(line, str) and '\n' not in line and '\r' not in line for line in lyrics):
        blocks = []
        block = []
        for line in lyrics + ['']:
            if line.strip():
                block.append(line)
            elif block:
                blocks.append(block)
                block = []
        if not blocks:
            errors.append("lyrics must contain at least one non-blank line.")
        size = len(counts.get('verse', []))
        if len(blocks) == 1 and size and len(blocks[0]) > size:
            lines = blocks[0]
            blocks = [lines[i:i + size] for i in range(0, len(lines), size)]
        for i, lines in enumerate(blocks, 1):
            check_block(lines, 'verse', f"Stanza {i}")
    else:
        errors.append("lyrics must be an array of single-line strings or named-pattern objects.")


def lyric_pattern_names(data):
    lyrics = data.get('lyrics')
    if not isinstance(lyrics, list) or not any(isinstance(block, dict) for block in lyrics):
        return ['verse']
    return list(dict.fromkeys(block['type'] for block in lyrics
                             if isinstance(block, dict) and isinstance(block.get('type'), str)))


def load_music(path, section=None, diagnostics=None, validate_text=False):
    with open(path, encoding='utf-8') as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path}:\n1. Invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}") from exc
    errors = []
    warnings = []

    def require(condition, message):
        if not condition:
            errors.append(message)
        return bool(condition)

    def number(value):
        return type(value) in (int, float) and math.isfinite(value)

    if not isinstance(data, dict):
        raise ValueError(f"{path}:\n1. music settings must be a JSON object.")
    bell_range = data.get('bell_range', data.get('available_bells', DEFAULT_BELL_RANGE))
    if not require(isinstance(bell_range, list) and bool(bell_range),
                   "bell_range must be a non-empty list of bell names."):
        bell_range = []
    valid_bells = []
    for i, bell in enumerate(bell_range, 1):
        try:
            midi_number(bell)
            valid_bells.append(bell)
        except ValueError as exc:
            errors.append(f"bell_range entry {i}: {exc}")
    bell_range = valid_bells
    require(len({midi_number(bell) for bell in bell_range}) == len(bell_range),
            "bell_range must not contain duplicate or enharmonically equivalent bells.")
    bell_range = sorted(bell_range, key=midi_number)
    data['bell_range'] = bell_range
    recommended = data.get('recommended_bells', bell_range)
    if not require(isinstance(recommended, list) and bool(recommended),
                   "recommended_bells must be a non-empty list of notes with octaves."):
        recommended = []
    for bell in recommended:
        try:
            midi_number(bell)
        except ValueError as exc:
            errors.append(f"recommended_bells: {exc}")
    data['recommended_bells'] = recommended
    for field in ('title', 'credit', 'key_signature'):
        if field in data:
            require(isinstance(data[field], str) and (field != 'title' or bool(data[field].strip())),
                    f"{field} must be {'a non-empty string' if field == 'title' else 'a string'}.")
    signature = data.get('time_signature')
    valid_signature = require(isinstance(signature, list) and len(signature) == 2
                              and all(type(n) is int and n > 0 for n in signature),
                              "time_signature must contain two positive integers.")
    if valid_signature:
        require(signature[1] & (signature[1] - 1) == 0,
                "time_signature denominator must be a power of two.")
    pickup = data.get('pickup_beats')
    require(number(pickup) and pickup >= 0 and (not valid_signature or pickup < signature[0]),
            "pickup_beats must be non-negative and less than one measure.")
    strong = data.get('strong_beats')
    require(isinstance(strong, list)
            and all(type(n) is int and n >= 1 and (not valid_signature or n <= signature[0]) for n in strong),
            "strong_beats must list beat numbers within the measure.")
    chords = data.setdefault('chord_tones', {})
    if not require(isinstance(chords, dict), "chord_tones must be an object."):
        chords = {}
        data['chord_tones'] = chords
    valid_chords = set()
    for name, tones in chords.items():
        if require(bool(name) and isinstance(tones, list) and bool(tones)
                and all(isinstance(pc, str) and re.fullmatch(r'[A-G][#b]?', pc) for pc in tones),
                f"chord_tones.{name} must list valid pitch classes."):
            valid_chords.add(name)
    counts = {}
    used_chords = set()
    patterns = lyric_pattern_names(data)
    if section is not None:
        patterns.append(section)
    patterns.extend(name for name, value in data.items()
                    if isinstance(value, list) and value and isinstance(value[0], list))
    for pattern in dict.fromkeys(patterns):
        lines = data.get(pattern)
        if not require(isinstance(lines, list) and bool(lines), f"{pattern} must be a non-empty list."):
            continue
        counts[pattern] = []
        for li, line in enumerate(lines, 1):
            if not require(isinstance(line, list) and bool(line), f"{pattern} line {li} must contain notes."):
                counts[pattern].append(None)
                continue
            word_count = 0
            words_valid = True
            for ni, note in enumerate(line, 1):
                location = f"{pattern} line {li}, note {ni}"
                if not require(isinstance(note, dict), f"{location} must be an object."):
                    words_valid = False
                    continue
                if bell_range:
                    try:
                        note['melody'] = nearest_bell(note.get('melody'), bell_range)
                    except ValueError as exc:
                        errors.append(f"{location}: {exc}")
                else:
                    require(isinstance(note.get('melody'), str)
                            and bool(re.fullmatch(r'[A-G][#b]?\d*', note['melody'])),
                            f"{location}: invalid melody note.")
                chord = note.get('chord')
                if require(isinstance(chord, str), f"{location}: chord must be a string."):
                    if chord not in chords:
                        try:
                            chords[chord] = chord_tones(chord)
                            valid_chords.add(chord)
                        except ValueError as exc:
                            errors.append(f"{location}: {exc}")
                    if chord in valid_chords:
                        used_chords.add(chord)
                duration = note.get('beats')
                require(number(duration) and duration > 0,
                        f"{location}: beats must be a positive number.")
                if require(type(note.get('word')) is bool, f"{location}: word must be true or false."):
                    word_count += int(note['word'])
                else:
                    words_valid = False
                require(type(note.get('breath_after', False)) is bool,
                        f"{location}: breath_after must be true or false.")
                require(type(note.get('play_if_word', False)) is bool,
                        f"{location}: play_if_word must be true or false.")
                exclusions = note.get('exclude_notes', [])
                if require(isinstance(exclusions, list),
                           f"{location}: exclude_notes must be a list of bell pitches with octaves."):
                    normalized = []
                    available_bells = {midi_number(bell): bell for bell in bell_range}
                    for ei, excluded in enumerate(exclusions, 1):
                        try:
                            pitch = midi_number(excluded)
                        except ValueError as exc:
                            errors.append(f"{location}: exclude_notes entry {ei}: {exc}")
                            continue
                        if require(pitch in available_bells,
                                   f"{location}: exclude_notes entry {ei}: {excluded} is not an available bell."):
                            normalized.append(available_bells[pitch])
                    note['exclude_notes'] = normalized
            if words_valid:
                require(word_count > 0, f"{pattern} line {li} must have at least one lyric token.")
            counts[pattern].append(word_count if words_valid else None)
    available = {midi_number(bell) % 12 for bell in bell_range}
    for chord in sorted(used_chords):
        missing = [pc for pc in chords[chord] if pitch_class(pc) not in available]
        if missing:
            warnings.append(f"Chord {chord} is not playing {len(missing)} tone(s): {', '.join(missing)}.")
    if validate_text:
        validate_lyrics(data.get('lyrics'), counts, errors, data)
    if diagnostics is not None:
        diagnostics.extend(warnings)
    if errors:
        warning_text = ('\nWarnings:\n' + '\n'.join(f'{i}. {message}' for i, message in enumerate(warnings, 1))
                        if warnings else '')
        raise ValueError(f"{path}:\n" + '\n'.join(f'{i}. {message}' for i, message in enumerate(errors, 1)) + warning_text)
    return data


def configure_music(path, section=None, word_overrides=None):
    global CHORD_TONES, FLAT, LINE_BOUNDS, LINE_BREATH_AFTER, TOKEN_COUNTS
    global BEAT, STRONG, STRIKE, DAMP, CSETS, N, TIME_SIGNATURE, PICKUP_BEATS
    global MEASURE_ENDS
    global ORDER, BELLS, BY, PITCHCLASS, SKIPPED, EXCLUDED
    data = load_music(path, section)
    if section is None:
        patterns = lyric_pattern_names(data)
        if not patterns:
            raise ValueError("lyrics must contain a block with a string type naming a note pattern.")
        section = patterns[0]
    notes = data[section]
    if word_overrides is not None:
        errors = []
        notes = apply_word_overrides(notes, word_overrides, errors, section)
        if errors:
            raise ValueError('\n'.join(errors))
    ORDER = list(data['bell_range'])
    BELLS = [(bell.lower().replace('#', 's'), bell, *PITCH_COLORS[midi_number(bell) % 12])
             for bell in ORDER]
    BY = {b[1]: b for b in BELLS}
    PITCHCLASS = {bell: midi_number(bell) % 12 for bell in ORDER}
    CHORD_TONES = data['chord_tones']
    TIME_SIGNATURE = data['time_signature']
    PICKUP_BEATS = data['pickup_beats']
    STRONG = set(data['strong_beats'])
    FLAT, LINE_BOUNDS, TOKEN_COUNTS, BEAT = [], [], [], []
    LINE_BREATH_AFTER = set()
    MEASURE_ENDS = set()
    SKIPPED = set()
    EXCLUDED = []
    next_word = 1
    t = Fraction(TIME_SIGNATURE[0]) - Fraction(str(PICKUP_BEATS)) if PICKUP_BEATS else Fraction(0)
    for line in notes:
        lo = len(FLAT)
        for note in line:
            EXCLUDED.append(set(note.get('exclude_notes', [])))
            if note.get('play_if_word', False) and not note['word']:
                SKIPPED.add(len(FLAT))
            if note.get('breath_after', False):
                LINE_BREATH_AFTER.add(len(FLAT))
            word = next_word if note['word'] else None
            if note['word']:
                next_word += 1
            FLAT.append((note['melody'], note['chord'], note['beats'], word))
            BEAT.append(int(t) % TIME_SIGNATURE[0] + 1)
            end = t + Fraction(str(note['beats']))
            if end // TIME_SIGNATURE[0] > t // TIME_SIGNATURE[0]:
                MEASURE_ENDS.add(len(FLAT) - 1)
            t = end
        LINE_BOUNDS.append((lo, len(FLAT)))
        TOKEN_COUNTS.append(sum(note['word'] for note in line))
    STRIKE, DAMP, CSETS = simulate()
    N = len(FLAT)
    return data

def bell_for_pc(pc, near_idx):
    cands = [b for b in ORDER if PITCHCLASS[b] == pitch_class(pc)]
    if len(cands) == 1:
        return cands[0]
    return min(cands, key=lambda b: abs(ORDER.index(b) - near_idx))

def chord_set(melody, chord):
    near = ORDER.index(melody)
    s = {bell_for_pc(pc, near) for pc in CHORD_TONES[chord]
         if pitch_class(pc) in PITCHCLASS.values()}
    s.add(melody)
    return s

def simulate():
    n = len(FLAT)
    chordsets = []
    full_chord_slots = set()
    sounding = set()
    raw_strike = [None] * n
    raw_damp = [None] * n
    previous_chord = None
    breath_pending = False
    for i in range(n):
        if i in SKIPPED:
            chordsets.append(set(sounding))
            raw_strike[i], raw_damp[i] = set(), set()
            breath_pending = breath_pending or i in LINE_BREATH_AFTER
            continue
        cs = chord_set(FLAT[i][0], FLAT[i][1]) - EXCLUDED[i]
        chordsets.append(cs)
        if previous_chord is None or BEAT[i] in STRONG or breath_pending or FLAT[i][1] != previous_chord:
            full_chord_slots.add(i)
        if i in full_chord_slots:
            strike = set(cs)
            damp = sounding - cs
        else:
            new_entries = cs - sounding
            melody = FLAT[i][0]
            strike = set(new_entries)
            if melody in cs:
                strike.add(melody)
            damp = (sounding - cs) - strike
        raw_strike[i] = strike
        raw_damp[i] = damp
        sounding = set(cs)
        previous_chord = FLAT[i][1]
        breath_pending = i in LINE_BREATH_AFTER
    final_strike = list(raw_strike)
    for i in range(n - 2, -1, -1):
        if i not in full_chord_slots and i not in SKIPPED:
            melody_strike = {FLAT[i][0]} & chordsets[i]
            final_strike[i] = (final_strike[i] - final_strike[i + 1]) | melody_strike
    for i in range(n):
        assert not (final_strike[i] & raw_damp[i]), f"overlap at slot {i}"
    return final_strike, raw_damp, chordsets

# ------------------------------------------------------------- lyrics parsing ---
def parse_lyrics(lyric_lines):
    if (not isinstance(lyric_lines, list) or not lyric_lines
            or not all(isinstance(line, str) and '\n' not in line and '\r' not in line
                       for line in lyric_lines)):
        raise ValueError("lyrics must be a non-empty array of single-line strings.")
    blocks = []
    block = []
    for line in lyric_lines:
        if line.strip():
            block.append(line)
        elif block:
            blocks.append(block)
            block = []
    if block:
        blocks.append(block)
    if not blocks:
        raise ValueError("lyrics must contain at least one non-blank line.")
    line_count = len(TOKEN_COUNTS)
    if len(blocks) == 1 and len(blocks[0]) > line_count:
        lines = blocks[0]
        if len(lines) % line_count:
            raise ValueError(f"Expected a multiple of {line_count} lyric lines, found {len(lines)}.")
        blocks = [lines[i:i + line_count] for i in range(0, len(lines), line_count)]
    stanzas = []
    for si, block in enumerate(blocks, 1):
        block_lines = block
        if len(block_lines) != line_count:
            raise ValueError(f"Stanza {si}: expected {line_count} lines, found {len(block_lines)}.")
        tokens = []
        for li, (line, expected) in enumerate(zip(block_lines, TOKEN_COUNTS), 1):
            words = line.split()
            if len(words) != expected:
                raise ValueError(f"Stanza {si}, line {li}: expected {expected} word-tokens, found {len(words)}.\n"
                                 f"  line was: {line!r}")
            tokens.extend(words)
        stanzas.append(tokens)
    return stanzas

# ------------------------------------------------------------------- rendering ---
def word_display(stanza_tokens, w):
    if w is None:
        return ''
    return _html.escape(stanza_tokens[w - 1])

def render_line(stanza_tokens, bell, lo, hi):
    out = []
    for i in range(lo, hi):
        melody, chord, dur, w = FLAT[i]
        cls = 's'
        style = ''
        if w is not None:
            if bell in STRIKE[i]:
                cls += ' k'
                style = f' style="--bell:{BY[bell][2]}"'
            elif bell in DAMP[i]:
                cls += ' d'
        out.append(f'<span class="{cls}"{style}>{word_display(stanza_tokens, w)}</span>')
        if i in LINE_BREATH_AFTER:
            out.append('<span class="brth">‖</span>')
    return ' '.join(out)

def sheet_body(stanzas, bell, heading=None):
    parts = []
    for s, stanza_tokens in enumerate(stanzas, 1):
        parts.append(f'<section class="stz"><h4>{_html.escape(heading) if heading is not None else f"Stanza {s}"}</h4>')
        for (lo, hi) in LINE_BOUNDS:
            parts.append(f'<p class="ln">{render_line(stanza_tokens, bell, lo, hi)}</p>')
        parts.append('</section>')
    return ''.join(parts)

def count(bell):
    return sum(1 for i in range(N) if bell in STRIKE[i])

def plural(n):
    return '' if n == 1 else 's'

def first_cue(stanzas, bell):
    for i in range(N):
        if bell in STRIKE[i]:
            w = FLAT[i][3]
            return word_display(stanzas[0], w) if w is not None else 'a held note'
    return '—'

def nt_span(bell, filled):
    bg, fg = BY[bell][2], BY[bell][3]
    cls = 'nt' if filled else 'nt h'
    return f'<span class="{cls}" style="--nbg:{bg};--nfg:{fg}">{bell}</span>'

def conductor_rows(stanzas):
    rows = []
    for (lo, hi) in LINE_BOUNDS:
        cells = []
        for i in range(lo, hi):
            melody, chord, dur, w = FLAT[i]
            cs = CSETS[i]
            pills = ''.join(nt_span(b, b in STRIKE[i]) for b in sorted(cs, key=lambda x: ORDER.index(x), reverse=True))
            cellcls = 'cell bar' if i == 0 and not PICKUP_BEATS else 'cell'
            if i in MEASURE_ENDS:
                cellcls += ' bar-end'
            chord_label = 'Sustain' if i in SKIPPED else chord
            cells.append(f'<div class="{cellcls}"><span class="chord">{_html.escape(chord_label)}</span>'
                          f'<span class="syl">{word_display(stanzas[0], w)}</span>'
                          f'<div class="pills">{pills}</div></div>')
        rows.append(f'<div class="crow">{"".join(cells)}</div>')
    return ''.join(rows)

CSS = '''
:root{box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);
--bg:#F5F6F8;--surface:#FFFFFF;--ink:#151A21;--muted:#5F6977;--rule:#D9DEE5;--brass:#8A6D1F;--focus:#2563C9;
--serif:"Literata",Georgia,"Times New Roman",serif;--sans:"Instrument Sans",system-ui,-apple-system,"Segoe UI",sans-serif;}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0F1319;--surface:#171C24;--ink:#EDEFF3;--muted:#9EA8B6;--rule:#2B3440;--brass:#C9A54A;--focus:#7AA2F0;}}
:root[data-theme="dark"]{--bg:#0F1319;--surface:#171C24;--ink:#EDEFF3;--muted:#9EA8B6;--rule:#2B3440;--brass:#C9A54A;--focus:#7AA2F0;}
html{scroll-padding-top:env(safe-area-inset-top,0px);}
*,*::before,*::after{box-sizing:inherit;}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--serif);font-size:18px;line-height:1.5;-webkit-text-size-adjust:100%;}
.wrap{max-width:720px;margin:0 auto;padding:0 16px 48px;}
h1{font-weight:800;font-size:clamp(2rem,8vw,3rem);line-height:1.05;letter-spacing:-0.01em;margin:28px 0 8px;}
.sub{font-family:var(--sans);color:var(--muted);font-size:1rem;margin:0 0 20px;max-width:34em;}
.rule{height:3px;width:64px;background:var(--brass);border:0;margin:0 0 22px;}
h2{font-family:var(--sans);font-weight:600;font-size:1.05rem;margin:26px 0 8px;}
h4{font-family:var(--sans);font-weight:600;font-size:.95rem;color:var(--muted);margin:0 0 6px;}
.legend{background:var(--surface);border:1px solid var(--rule);border-radius:12px;padding:6px 16px;}
.legend dl{margin:0;display:grid;grid-template-columns:5.2rem 1fr;gap:0 14px;align-items:center;}
.legend dt,.legend dd{padding:12px 0;border-top:1px solid var(--rule);}
.legend dt{font-size:1.35rem;}
.legend dd{margin:0;font-family:var(--sans);font-size:.98rem;}
.legend dt:first-of-type,.legend dd:first-of-type{border-top:0;}
.setup{font-family:var(--sans);font-size:.98rem;padding-left:1.1rem;margin:0;}
.setup li{margin:6px 0;}
.s{color:inherit;font-weight:400;}
.s.k{border:2px solid currentColor;border-radius:5px;padding:0 .16em;margin:0 -.16em;}
.s.d{text-decoration:underline;text-decoration-thickness:.13em;text-underline-offset:.2em;text-decoration-skip-ink:none;}
.h{color:var(--muted);}
.brth{color:var(--brass);font-weight:700;margin:0 .1em;}
.nav{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;background:var(--bg);margin:0 -16px;padding:10px 16px;border-bottom:1px solid var(--rule);}
.tabs{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding:2px 0;}
.tabs::-webkit-scrollbar{display:none;}
.tab{flex:0 0 auto;min-height:44px;min-width:52px;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 14px;border-radius:22px;border:1px solid var(--rule);background:var(--surface);color:var(--ink);font:600 1rem var(--sans);cursor:pointer;}
.tab i{width:12px;height:12px;border-radius:50%;background:var(--bell);display:inline-block;}
.tab[aria-selected="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink);}
.tab:focus-visible{outline:3px solid var(--focus);outline-offset:2px;}
.panel{padding-top:22px;}
.js .panel{display:none;}
.js .panel.on{display:block;}
.bh{display:flex;gap:18px;align-items:center;margin-bottom:18px;}
.big{flex:0 0 auto;min-width:5.2rem;padding:6px 16px 10px;border-radius:14px;background:var(--bell,var(--ink));color:var(--bellfg,var(--bg));font-weight:800;font-size:3.2rem;line-height:1;letter-spacing:-0.02em;text-align:center;}
.big.small{font-size:1.6rem;padding:14px 18px;font-family:var(--sans);font-weight:600;letter-spacing:0;}
.meta p{margin:0;font-family:var(--sans);font-size:1rem;}
.meta p + p{color:var(--muted);}
.score-title{margin:0;font-size:clamp(1.5rem,4vw,2.25rem);line-height:1.2;}
.stz{background:var(--surface);border:1px solid var(--rule);border-radius:12px;padding:14px 16px 12px;margin:0 0 14px;break-inside:avoid;overflow-x:auto;}
.ln{margin:0 0 8px;font-size:clamp(1.25rem,5.4vw,1.5rem);line-height:1.95;white-space:nowrap;}
.ln:last-child{margin-bottom:0;}
.note{font-family:var(--sans);font-size:.98rem;color:var(--muted);margin:14px 0;max-width:36em;}
.cgrid{background:var(--surface);border:1px solid var(--rule);border-radius:12px;padding:12px 10px;overflow-x:auto;}
.crow{display:flex;gap:2px;margin:0 0 14px;min-width:20rem;align-items:flex-start;}
.crow:last-child{margin-bottom:0;}
.cell{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px;text-align:center;}
.cell.bar{border-left:1px solid var(--muted);padding-left:4px;}
.cell.bar-end{border-right:1px solid var(--muted);padding-right:4px;}
.chord{font:600 .82rem var(--sans);color:var(--muted);}
.syl{font-size:1rem;line-height:1.2;margin-bottom:2px;}
.pills{display:flex;flex-direction:column;gap:2px;align-items:center;}
.nt{font:600 .74rem var(--sans);background:var(--nbg);color:var(--nfg);padding:1px 6px;border-radius:9px;box-shadow:inset 0 0 0 1.5px var(--nbg);}
.nt.h{background:transparent;color:var(--ink);}
.roster{list-style:none;padding:0;margin:8px 0 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(11.5rem,1fr));gap:8px 14px;font-family:var(--sans);font-size:.98rem;}
.roster li{display:flex;align-items:center;gap:10px;}
.roster .nt{font-size:.9rem;padding:3px 10px;border-radius:11px;min-width:3rem;text-align:center;}
.foot{font-family:var(--sans);font-size:.88rem;color:var(--muted);margin-top:34px;border-top:1px solid var(--rule);padding-top:14px;}
@media print{:root{--bg:#fff;--surface:#fff;--ink:#000;--muted:#444;--rule:#bbb;}*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}body{font-size:13pt;}.nav{display:none !important;}.js .panel{display:block !important;}.panel{break-before:page;padding-top:0;}.stz{border:0;padding:4px 0;margin:0 0 6px;overflow:visible;}.ln{font-size:15pt;line-height:1.75;}.intro-panels{break-after:page;}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto !important;}}
'''

LEGEND = '''
<div class="legend"><dl>
<dt><span class="s k" style="--bell:#0E7C86">ring</span></dt><dd>Boxed: strike your bell on this word.</dd>
<dt><span class="s d">stop</span></dt><dd>Underlined: damp your bell on this word, because your note is not in the new chord.</dd>
<dt><span class="s">rest</span></dt><dd>No mark: do nothing. Your note isn&rsquo;t due to ring again yet.</dd>
</dl></div>
'''

SETUP = '''
<ul class="setup">
<li>You need bells {bells}, one per ringer.</li>
<li>{music_guidance}</li>
<li>Unlabelled held-note positions have no lyric or ring marker.</li>
<li>Each lyric block uses the musical pattern with the same name as its type.</li>
<li>Short on ringers? One person can ring two bells, one in each hand.</li>
<li>To print, use your browser&rsquo;s print command. Each bell gets its own page.</li>
</ul>
'''

def music_guidance():
    meter = f'{TIME_SIGNATURE[0]}/{TIME_SIGNATURE[1]}'
    opening = (f'Begin with a {PICKUP_BEATS:g}-beat pickup.' if PICKUP_BEATS
               else 'Begin on beat 1 of a full measure.')
    strong = ', '.join(str(beat) for beat in sorted(STRONG))
    strikes = (f'Beats {strong} force a full-chord strike.' if STRONG
               else 'No beats force a full-chord strike.')
    return (f'{opening} In {meter} time, {strikes[0].lower()}{strikes[1:]} '
            'Play the full chord on the opening note, including the lead-in. '
            'The first note after each breath also forces a full-chord strike. '
            'At every chord change, strike the full new chord and damp bells '
            'from the previous chord that are not included, even within a measure. '
            'The melody bell strikes on every played note, including repeated pitches, '
            'unless explicitly excluded. Per-note exclusions remove bells from the chord '
            'and damp them if already sounding. '
            'On other beats, other bells strike only if the same bell is not also due '
            'to strike on the very next beat.')


def render_song_blocks(music_path, data):
    lyrics = data.get('lyrics')
    explicit = isinstance(lyrics, list) and any(isinstance(block, dict) for block in lyrics)
    if not explicit:
        stanzas = parse_lyrics(lyrics)
        return ({bell: sheet_body(stanzas, bell) for bell in ORDER},
                conductor_rows(stanzas), {bell: count(bell) for bell in ORDER}, False)

    bodies = {bell: [] for bell in ORDER}
    grids = []
    counts = {bell: 0 for bell in ORDER}
    seen = set()
    occurrences = {}
    totals = {}
    for block in lyrics:
        if isinstance(block, dict) and isinstance(block.get('type'), str):
            kind = block['type']
            totals[kind] = totals.get(kind, 0) + 1
    for number, block in enumerate(lyrics, 1):
        if (not isinstance(block, dict) or not isinstance(block.get('type'), str)
                or not isinstance(block.get('lines'), list)):
            raise ValueError(f"lyrics block {number} must contain a string type naming a note pattern and a lines array.")
        kind = block['type']
        configure_music(music_path, kind, block.get('word_overrides'))
        stanzas = parse_lyrics(block['lines'])
        if len(stanzas) != 1:
            raise ValueError(f"lyrics block {number} must contain exactly one {kind}.")
        occurrences[kind] = occurrences.get(kind, 0) + 1
        heading = kind.title()
        if totals[kind] > 1:
            heading += f' {occurrences[kind]}'
        for bell in ORDER:
            bodies[bell].append(sheet_body(stanzas, bell, heading))
            counts[bell] += count(bell)
        pattern_id = (kind, tuple(note[3] is not None for note in FLAT))
        if pattern_id not in seen:
            grid_heading = heading if any(item[0] == kind for item in seen) else kind.title()
            grids.append(f'<h3>{_html.escape(grid_heading)}</h3>'
                         f'<div class="cgrid" role="group" aria-label="{_html.escape(kind)} chords, words and bells">'
                         f'{conductor_rows(stanzas)}</div>')
            seen.add(pattern_id)
    configure_music(music_path)
    return ({bell: ''.join(parts) for bell, parts in bodies.items()},
            ''.join(grids), counts, True)


def build(music_path, out_path):
    warnings = []
    load_music(music_path, diagnostics=warnings, validate_text=True)
    if warnings:
        print("Warnings:")
        for i, message in enumerate(warnings, 1):
            print(f"{i}. {message}")
    data = configure_music(music_path)
    bodies, grids, ring_counts, explicit_blocks = render_song_blocks(music_path, data)
    title = data.get('title', Path(music_path).stem)
    credit = data.get('credit', '')
    if not isinstance(title, str) or not title.strip() or not isinstance(credit, str):
        raise ValueError("title must be a non-empty string and credit must be a string.")
    title = _html.escape(title)
    key_signature = data.get('key_signature', '')
    if not isinstance(key_signature, str):
        raise ValueError("key_signature must be a string.")
    if key_signature.strip():
        title += f' ({_html.escape(key_signature.strip())})'
    credit = _html.escape(credit)
    guidance = music_guidance()
    bell_css = ''.join(f'.b-{key}{{--bell:{bg};--bellfg:{fg};}}\n'
                       for key, pitch, bg, fg in BELLS)
    tabs, panels = [], []
    for (key, pitch, bg, fg) in BELLS:
        label = re.sub(r'\d+$', '', pitch)
        tabs.append(f'<button class="tab b-{key}" role="tab" id="t-{key}" aria-controls="p-{key}" '
                     f'aria-selected="false" data-target="{key}"><i></i><span>{label}</span></button>')
        panels.append(
            f'<section class="panel b-{key}" role="tabpanel" id="p-{key}" aria-labelledby="t-{key}">'
            f'<header class="bh"><div class="big">{label}</div>'
            f'<h2 class="score-title">{title}</h2></header>'
            f'{bodies[pitch]}</section>'
        )
    tabs.append('<button class="tab tabc" role="tab" id="t-cond" aria-controls="p-cond" aria-selected="false" data-target="cond"><span>Conductor</span></button>')
    count_scope = 'in song order' if explicit_blocks else 'a stanza'
    roster = ''.join(f'<li>{nt_span(pitch, True)}<span>{ring_counts[pitch]} ring{plural(ring_counts[pitch])} {count_scope}</span></li>' for (key, pitch, bg, fg) in BELLS)
    conductor_intro = ('Named musical patterns in song order.' if explicit_blocks
                       else 'Stanza 1 with chords. Every stanza uses this same music.')
    conductor_grid = (grids if explicit_blocks else
                      f'<div class="cgrid" role="group" aria-label="Chords, words and bells for stanza 1">{grids}</div>')
    cond = (
        '<section class="panel" role="tabpanel" id="p-cond" aria-labelledby="t-cond">'
        '<header class="bh"><div class="big small">Conductor</div>'
        f'<div class="meta"><h2 class="score-title">{title}</h2>'
        f'<p>{conductor_intro}</p></div></header>'
        f'<p class="note"><strong>Recommended bells:</strong> {", ".join(data["recommended_bells"])}</p>'
        f'<p class="note">{guidance}</p>'
        f'{conductor_grid}'
        '<h4>Who rings how often</h4>'
        f'<ul class="roster">{roster}</ul></section>'
    )
    page = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}: handbell ring-along</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,400;7..72,600;7..72,800&family=Instrument+Sans:wght@500;600&display=swap">
<style>{CSS}{bell_css}</style>
</head>
<body>
<div class="wrap">
<h1>{title}</h1>
<p class="sub">Handbell ring-along cue sheets for {len(BELLS)} bells, {TIME_SIGNATURE[0]}/{TIME_SIGNATURE[1]} time. Built locally from your song file.</p>
<hr class="rule">
<div class="intro-panels">
<h2>Reading your sheet</h2>
{LEGEND}
<h2>Before you start</h2>
{SETUP.format(music_guidance=guidance, bells=', '.join(re.sub(r'\d+$', '', bell) for bell in ORDER))}
</div>
</div>
<div class="wrap" id="sheets" style="padding-top:0">
<nav class="nav" aria-label="Choose a bell"><div class="tabs" role="tablist">
{''.join(tabs)}
</div></nav>
{''.join(panels)}
{cond}
{'<p class="foot">' + credit + '</p>' if credit else ''}
</div>
<script>
(function(){{
var root=document.documentElement;root.classList.add('js');
var tabs=Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
var panels=Array.prototype.slice.call(document.querySelectorAll('[role="tabpanel"]'));
function show(id,focus,scroll){{
tabs.forEach(function(t){{var on=t.getAttribute('data-target')===id;t.setAttribute('aria-selected',on?'true':'false');t.tabIndex=on?0:-1;if(on&&focus)t.focus();}});
panels.forEach(function(p){{p.classList.toggle('on',p.id==='p-'+id);}});
if(scroll){{var top=document.getElementById('sheets').offsetTop;if(window.scrollY>top)window.scrollTo(0,top);}}
}}
tabs.forEach(function(t,i){{
t.addEventListener('click',function(){{show(t.getAttribute('data-target'),false,true);}});
t.addEventListener('keydown',function(e){{var n=null;if(e.key==='ArrowRight')n=tabs[(i+1)%tabs.length];if(e.key==='ArrowLeft')n=tabs[(i-1+tabs.length)%tabs.length];if(n){{e.preventDefault();show(n.getAttribute('data-target'),true,true);}}}});
}});
show(tabs[0].getAttribute('data-target'),false,false);
}})();
</script>
</body>
</html>
'''
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(page)
    print(f"Wrote {out_path} ({len(page)} bytes)")

def select_song(folder):
    files = sorted((path for path in Path(folder).iterdir()
                    if path.is_file() and path.suffix.lower() == '.json'),
                   key=lambda path: (path.name.casefold(), path.name))
    if not files:
        raise ValueError(f"No .json song files found in {folder}.")
    print("Available songs:")
    for number, path in enumerate(files, 1):
        print(f"  {number}. {path.name}")
    while True:
        try:
            choice = input(f"Choose a song (1-{len(files)}): ").strip()
        except EOFError as exc:
            raise ValueError("No song selected. Supply a song filename with --input.") from exc
        if choice.isdecimal() and 1 <= int(choice) <= len(files):
            return files[int(choice) - 1]
        print(f"Invalid selection. Enter a number from 1 to {len(files)}.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('song', nargs='?', type=Path, help='Song JSON file.')
    parser.add_argument('-i', '--input', '--music', type=Path, dest='input_file',
                        help='Song JSON file (alternative to the positional filename).')
    parser.add_argument('-o', '--output', type=Path,
                        help='Output HTML (default: input filename with .html extension).')
    args = parser.parse_args()
    if args.song and args.input_file:
        parser.error("Specify either a positional song file or --input, not both.")
    try:
        song = args.input_file or args.song or select_song(Path.cwd())
        output = args.output or song.with_suffix('.html')
        if song.resolve() == output.resolve():
            raise ValueError("Output must not overwrite the input song file.")
        build(song, output)
    except (OSError, ValueError) as exc:
        parser.exit(1, f"Error: {exc}\n")
    except KeyboardInterrupt:
        parser.exit(130, "\nCancelled.\n")


if __name__ == '__main__':
    main()
