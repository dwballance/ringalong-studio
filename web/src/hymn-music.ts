import { parseOnly } from 'abcjs';
import Fraction from 'fraction.js';
import { id, newSong, noteSchema, type Song, type Section } from './document';
import { midi } from './music';
import type { HymnSource } from './hymns';

interface Pitch { pitch: number; accidental?: string; startTie?: unknown; endTie?: boolean }
interface Element {
  el_type: string; type?: string; duration?: number; pitches?: Pitch[]; rest?: { type: string };
  lyric?: { syllable: string; divider: string }[]; decoration?: string[];
}
interface Key { root: string; acc: string; mode: string; accidentals?: { note: string; acc: string }[] }
interface ParsedTune {
  lines: { staff?: { voices: Element[][]; key: Key }[] }[];
  getMeterFraction(): { num: number; den: number };
  getPickupLength(): number;
  getKeySignature(): Key;
}
interface TimedNote {
  element: Element; pitches: string[]; start: Fraction; end: Fraction; line: number;
}
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const OFFSETS: Record<string, number> = { sharp: 1, flat: -1, natural: 0, dblsharp: 2, dblflat: -2 };
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function pitchName(pitch: Pitch, key: Key, accidentals: Map<number, number>): string {
  const letter = LETTERS[((pitch.pitch % 7) + 7) % 7];
  const octave = 4 + Math.floor(pitch.pitch / 7);
  if (pitch.accidental) {
    const offset = OFFSETS[pitch.accidental];
    if (offset === undefined) throw new Error('Microtonal hymn sources are not supported.');
    accidentals.set(pitch.pitch, offset);
  }
  const keyAccidental = key.accidentals?.find(item => item.note.toUpperCase() === letter);
  const offset = accidentals.get(pitch.pitch) ?? (keyAccidental ? OFFSETS[keyAccidental.acc] : 0) ?? 0;
  if (Math.abs(offset) <= 1) return `${letter}${offset === 1 ? '#' : offset === -1 ? 'b' : ''}${octave}`;
  const value = midi(`${letter}${octave}`) + offset;
  return `${SHARPS[((value % 12) + 12) % 12]}${Math.floor(value / 12) - 1}`;
}

function voicesFor(tune: ParsedTune): Map<string, TimedNote[]> {
  const voices = new Map<string, TimedNote[]>();
  const accidentals = new Map<string, Map<number, number>>();
  const clocks = new Map<string, Fraction>();
  tune.lines.forEach((line, lineIndex) => line.staff?.forEach((staff, staffIndex) => staff.voices.forEach((elements, voiceIndex) => {
    const name = `${staffIndex}:${voiceIndex}`;
    const notes = voices.get(name) || [];
    let clock = clocks.get(name) || new Fraction(0);
    const active = accidentals.get(name) || new Map<number, number>();
    for (const element of elements) {
      if (element.el_type === 'bar') {
        active.clear();
        if (element.type?.includes('repeat')) throw new Error('This source contains repeats that need an explicitly expanded arrangement.');
      } else if (['key', 'meter', 'tempo'].includes(element.el_type)) {
        if (element.el_type !== 'tempo') throw new Error('This source changes key or meter and needs manual preparation.');
      } else if (element.el_type === 'note' && element.duration) {
        const end = clock.add(new Fraction(element.duration));
        notes.push({ element, start: clock, end, line: lineIndex,
          pitches: (element.pitches || []).map(pitch => pitchName(pitch, staff.key, active)) });
        clock = end;
      }
    }
    voices.set(name, notes); clocks.set(name, clock); accidentals.set(name, active);
  })));
  return voices;
}

function inferredChord(pitches: string[], names: string[], tonic: number): string {
  const tones = new Set(pitches.map(pitch => midi(pitch) % 12));
  if (!tones.size) return names[tonic];
  const bass = midi([...pitches].sort((a, b) => midi(a) - midi(b))[0]) % 12;
  const qualities: [string, number[]][] = [['', [0, 4, 7]], ['m', [0, 3, 7]], ['7', [0, 4, 7, 10]],
    ['m7', [0, 3, 7, 10]], ['maj7', [0, 4, 7, 11]], ['dim', [0, 3, 6]]];
  let best = names[tonic], bestScore = -Infinity;
  for (let root = 0; root < 12; root++) for (const [quality, intervals] of qualities) {
    const candidate = new Set(intervals.map(interval => (root + interval) % 12));
    const matches = [...tones].filter(tone => candidate.has(tone)).length;
    const score = matches * 3 - (tones.size - matches) * 2 - (candidate.size - matches) * 1.5 +
      (root === bass ? 0.4 : 0) + (root === tonic ? 0.1 : 0);
    if (score > bestScore) { best = names[root] + quality; bestScore = score; }
  }
  return best;
}

function lyricText(syllable: string, divider: string): string {
  return syllable.replace(/^\s*\d+\.[\s~]*/, '').replace(/~/g, ' ').trim() + (divider === '-' ? '-' : '');
}

export function importABC(text: string, source: HymnSource, bells?: string[]): Song {
  if (!/^C:\s*copyright:\s*public domain\./mi.test(text)) throw new Error('The source does not include the reviewed public-domain notice.');
  const tunes = parseOnly(text) as unknown as ParsedTune[];
  if (tunes.length !== 1) throw new Error('Select one hymn source at a time.');
  const tune = tunes[0];
  const meter = tune.getMeterFraction();
  if (!meter.num || !meter.den) throw new Error('This source has no supported time signature.');
  const key = tune.getKeySignature();
  if (!['', 'm'].includes(key.mode) || !/^[A-G]$/.test(key.root)) throw new Error('This source needs a supported major or minor key.');
  const song = newSong();
  song.title = source.title; song.hymnNumber = source.number;
  song.time = [Number(meter.num), Number(meter.den)]; song.key = `${key.root}${key.acc} ${key.mode === 'm' ? 'minor' : 'major'}`;
  song.pickup = new Fraction(tune.getPickupLength()).mul(song.time[1]).valueOf();
  song.strong = song.time[0] === 4 ? [1, 3] : [1];
  const credits = [...text.matchAll(/^C:\s*(.+)$/gm)].map(match => match[1]);
  song.credit = `${credits.join('\n')}\nSource: ${source.sourceEdition}; ${source.source}\n${source.rights}. Harmony inferred at melody onsets; review the arrangement.`;
  song.extensions.webSource = { ...source, harmony: 'inferred from source voices at melody onsets', importedAt: new Date().toISOString() };
  const voices = voicesFor(tune);
  const melody = [...voices.values()].find(notes => notes.some(note => note.element.lyric?.length));
  if (!melody?.length) throw new Error('No melody with aligned lyrics was found in the source.');
  const allNotes = [...voices.values()].flat();
  const names = key.acc === 'b' || key.root === 'F' ? FLATS : SHARPS;
  const tonic = midi(`${key.root}${key.acc}4`) % 12;
  const melodyPitches = melody.flatMap(note => note.pitches);
  if (!melodyPitches.length) throw new Error('The source melody contains no pitches.');
  if (bells) song.bells = [...bells];
  else {
    const minimum = Math.min(...melodyPitches.map(midi));
    const maximum = Math.max(...melodyPitches.map(midi));
    const classes = new Set(allNotes.flatMap(note => note.pitches).map(pitch => midi(pitch) % 12));
    song.bells = [...new Set(melodyPitches)];
    for (let value = minimum; value <= Math.max(minimum + 11, maximum); value++) {
      if (classes.has(value % 12)) {
        const pitch = `${names[value % 12]}${Math.floor(value / 12) - 1}`;
        if (!song.bells.some(bell => midi(bell) === value)) song.bells.push(pitch);
      }
    }
  }
  song.bells.sort((a, b) => midi(a) - midi(b)); song.recommended = [...song.bells];
  const sourceLines = [...new Set(melody.map(note => note.line))];
  const pattern = { id: id(), type: 'verse', lines: sourceLines.map(() => ({ id: id(), slots: [] as ReturnType<typeof noteSchema.parse>[] })) };
  const verseCount = Math.max(...melody.map(note => note.element.lyric?.length || 0));
  const sections: Section[] = Array.from({ length: verseCount }, () => ({ id: id(), type: 'verse', stage: 'music', raw: '',
    lines: sourceLines.map(() => ({ id: id(), tokens: [] })), bindings: {} }));
  for (const note of melody) {
    const line = sourceLines.indexOf(note.line);
    const pitch = [...note.pitches].sort((a, b) => midi(b) - midi(a))[0] || melodyPitches[0];
    const sounding = allNotes.filter(item => item.start.compare(note.start) <= 0 && item.end.compare(note.start) > 0).flatMap(item => item.pitches);
    const firstLyric = note.element.lyric?.[0];
    const slot = noteSchema.parse({ id: id(), melody: pitch, beats: note.end.sub(note.start).mul(song.time[1]).valueOf(),
      chord: inferredChord(sounding, names, tonic), word: Boolean(firstLyric?.syllable.trim()),
      breath_after: note.element.decoration?.includes('breath') || false,
      policy: note.element.rest ? 'rest' : note.element.pitches?.some(pitch => pitch.endTie) ? 'hold' : 'auto' });
    pattern.lines[line].slots.push(slot);
    sections.forEach((section, verse) => {
      const lyric = note.element.lyric?.[verse];
      const word = lyric ? lyricText(lyric.syllable, lyric.divider) : '';
      const token = word ? { id: id(), text: word } : undefined;
      if (token) section.lines[line].tokens.push(token);
      section.bindings[slot.id] = [{ id: id(), kind: note.element.rest ? 'rest' : token ? 'word' : 'continue', tokenId: token?.id }];
    });
  }
  sections.forEach(section => { section.raw = section.lines.map(line => line.tokens.map(token => token.text).join(' ')).join('\n'); });
  song.patterns = [pattern]; song.sections = sections;
  const unaligned = text.split(/\r?\n/).filter(line => /^W:/.test(line)).map(line => line.slice(2).trim()).join('\n').trim();
  if (unaligned) {
    const groups = unaligned.split(/\n\s*\n/).filter(Boolean);
    for (const group of groups) song.sections.push({ id: id(), type: 'verse', stage: 'lyrics', raw: group.replace(/^\d+\.\s*/, ''), lines: [], bindings: {} });
  }
  return song;
}