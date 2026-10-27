import { describe, expect, it } from 'vitest';
import { alignSection, chordDefinitionsSchema, id, newSong, type Section } from '../src/document';
import Fraction from 'fraction.js';
import { bellLabel, chordTones, durationLabel, eventsFor, playableBells, perform, problems } from '../src/music';

function fixture() {
  const song = newSong(); song.title = 'Synthetic song'; song.key = 'Bb major'; song.time = [3, 4]; song.pickup = 1;
  const section: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
  song.sections.push(section); alignSection(song, section, 'one two three four'); section.stage = 'done';
  const slots = song.patterns[0].lines[0].slots;
  slots.forEach(slot => { slot.melody = 'D5'; slot.chord = 'Bb'; });
  return { song, section, slots };
}
describe('bell modes and custom chords', () => {
  it('keeps octave-specific bells in melody mode and collapses octave duplicates in chord mode', () => {
    const song = newSong(); song.bells = ['D4', 'G4', 'D5'];
    expect(playableBells(song)).toEqual(['D4', 'G4', 'D5']);
    expect(bellLabel(song, 'D5')).toBe('D5');
    song.ringMelody = false;
    expect(playableBells(song)).toEqual(['D', 'G']);
    expect(bellLabel(song, 'D5')).toBe('D');
    song.bells = ['C', 'F', 'G'];
    expect(playableBells(song)).toEqual(['C', 'F', 'G']);
  });
  it('accepts custom chord strings and arrays with or without octave numbers', () => {
    const song = newSong();
    song.chords = chordDefinitionsSchema.parse({ Csus4: 'C5 F5 G5', Dm: ['D', 'F', 'A'] });
    expect(chordTones(song, 'Csus4')).toEqual([0, 5, 7]);
    expect(chordTones(song, 'Dm')).toEqual([2, 5, 9]);
    expect(() => chordDefinitionsSchema.parse({ broken: 'C5 H5' })).toThrow();
  });
  it('plays only chord pitch classes in chord mode, without adding an out-of-chord melody', () => {
    const { song, section, slots } = fixture(); song.ringMelody = false;
    song.bells = ['C4', 'C5', 'E4', 'G4', 'D4']; song.recommended = [...song.bells];
    slots.forEach(slot => { slot.chord = 'C'; slot.melody = 'D5'; });
    const first = perform(song, section)[0];
    expect([...first.strike].sort()).toEqual(['C', 'E', 'G']);
    expect(first.sounding).not.toContain('D');
    expect(first.melody).toBe('D');
    expect(problems(song)).toEqual([]);
  });
  it('accepts octave-free available bells only when melody mode is off', () => {
    const { song, section, slots } = fixture(); song.ringMelody = false;
    song.bells = ['C', 'E', 'G']; song.recommended = [...song.bells];
    slots.forEach(slot => { slot.chord = 'C'; slot.melody = 'C5'; });
    expect(problems(song)).toEqual([]);
    expect(perform(song, section)[0].strike).toEqual(['C', 'E', 'G']);
    song.ringMelody = true;
    expect(problems(song).join(' ')).toContain('octave');
  });
  it('keeps exact melody octaves separate and refuses a missing melody bell', () => {
    const { song, section, slots } = fixture(); song.bells = ['C4', 'C5', 'E4', 'G4']; song.recommended = [...song.bells];
    slots.forEach(slot => { slot.chord = 'C'; slot.melody = 'C5'; });
    expect(perform(song, section)[0].strike).toContain('C5');
    song.bells = ['C4', 'E4', 'G4'];
    expect(() => perform(song, section)).toThrow('C5 is not an available');
    expect(eventsFor(song, section)[0].melody).toBe('C5');
  });
});

describe('long-note notation', () => {
  it('shows five beats in 3/4 as dotted half tied to half', () => {
    expect(durationLabel(5, 4, 3)).toBe('\ud834\udd5e\u00b7 \u203f \ud834\udd5e');
  });
  it('uses the remaining time in the first measure, including fractional starts', () => {
    expect(durationLabel(5, 4, 3, new Fraction(1))).toBe('\ud834\udd5e \u203f \ud834\udd5e\u00b7');
    expect(durationLabel(5, 4, 3, new Fraction('1.5'))).toBe('\ud834\udd5f\u00b7 \u203f \ud834\udd5e\u00b7 \u203f \ud834\udd60');
  });
  it('handles additional measures and different beat units', () => {
    expect(durationLabel(8, 4, 3)).toBe('\ud834\udd5e\u00b7 \u203f \ud834\udd5e\u00b7 \u203f \ud834\udd5e');
    expect(durationLabel(5, 4, 4)).toBe('\ud834\udd5d \u203f \ud834\udd5f');
    expect(durationLabel(5, 8, 3)).toBe('\ud834\udd5f\u00b7 \u203f \ud834\udd5f');
    expect(durationLabel(5, 2, 3)).toBe('\ud834\udd5d\u00b7 \u203f \ud834\udd5d');
  });
  it('keeps shorter note displays unchanged and does not add a trailing dash', () => {
    expect(durationLabel(4, 4, 3)).toBe('\ud834\udd5d');
    expect(durationLabel(3, 4, 3)).toBe('\ud834\udd5e\u00b7');
    expect(durationLabel(1 + Number.EPSILON, 4, 3)).toBe('\ud834\udd5f');
    expect(durationLabel(6, 4, 3)).toBe('\ud834\udd5e\u00b7 \u203f \ud834\udd5e\u00b7');
  });
});

describe('musical engine', () => {
  it('respects pickups and measure markers', () => {
    const { song, section } = fixture();
    const events = eventsFor(song, section);
    expect(events.map(event => event.beat)).toEqual([3, 1, 2, 3]);
    expect(events.map(event => event.boundaries)).toEqual([[1], [], [], [1]]);
    expect(problems(song)).toEqual([]);
  });
  it('excludes melody bells when explicitly requested', () => {
    const { song, section, slots } = fixture(); slots[0].exclude_notes = ['D5'];
    expect(perform(song, section)[0].strike).not.toContain('D5');
    expect(perform(song, section)[1].strike).toContain('D5');
  });
  it('keeps time and sounding bells for unused slots', () => {
    const { song, section, slots } = fixture();
    section.lines[0].tokens.splice(1, 1);
    section.bindings[slots[1].id][0] = { id: id(), kind: 'unused' };
    const events = perform(song, section);
    expect(events[1].strike).toEqual([]); expect(events[1].damp).toEqual([]);
    expect(events[1].sounding).toEqual(events[0].sounding); expect(events[2].beat).toBe(2);
  });
  it('handles denominator-beats exactly in 6/8', () => {
    const { song, section, slots } = fixture(); song.time = [6, 8]; song.pickup = 0;
    slots.forEach(slot => { slot.beats = 1.5; });
    expect(eventsFor(song, section).at(-1)?.boundaries).toEqual([1.5]);
  });
  it('applies shared ring overrides to each verse', () => {
    const { song, section, slots } = fixture();
    const second: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
    song.sections.push(second); alignSection(song, second, 'five six seven eight'); slots[0].policy = 'rest';
    expect(perform(song, section)[0].strike).toEqual([]); expect(perform(song, second)[0].strike).toEqual([]);
  });
  it('preserves wordless musical slots when aligning another verse', () => {
    const { song, slots } = fixture(); slots[1].word = false;
    const second: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
    song.sections.push(second); alignSection(song, second, 'five six seven');
    expect(second.bindings[slots[1].id][0].kind).toBe('continue');
    expect(eventsFor(song, second).map(event => event.lyric)).toEqual(['five', '', 'six', 'seven']);
  });
  it('places a subdivided breath only after its final note', () => {
    const { song, section, slots } = fixture();
    slots[0].breath_after = true;
    section.bindings[slots[0].id][0].beats = 0.5;
    section.bindings[slots[0].id].push({ id: id(), kind: 'continue', beats: 0.5 });
    expect(eventsFor(song, section).slice(0, 2).map(event => event.breathAfter)).toEqual([false, true]);
  });
  it('applies a shared ringing override to the first played subdivision', () => {
    const { song, section, slots } = fixture(); slots[0].policy = 'melody';
    section.bindings[slots[0].id][0].beats = 0.5;
    section.bindings[slots[0].id].unshift({ id: id(), kind: 'unused', beats: 0.5 });
    expect(perform(song, section).slice(0, 2).map(event => event.mode)).toEqual(['hold', 'melody']);
    expect(perform(song, section)[1].strike).toEqual(['D5']);
  });
  it('holds wordless continuation notes in both chord and melody mode', () => {
    const { song, section, slots } = fixture();
    section.bindings[slots[1].id][0] = { id: id(), kind: 'continue' };
    for (const ringMelody of [false, true]) {
      song.ringMelody = ringMelody;
      expect(eventsFor(song, section)[1].mode).toBe('hold');
    }
  });
  it('re-strikes the full chord only on selected beats, carrying and damping without new bells on a mid-measure chord change', () => {
    const { song, section, slots } = fixture(); song.ringMelody = false; song.strong = [1];
    song.bells = ['Bb', 'D', 'Eb', 'F', 'G']; song.recommended = [...song.bells];
    slots[1].chord = 'Bb'; slots[2].chord = 'Eb';
    const [, onBeat, offBeat] = perform(song, section);
    expect([onBeat.beat, onBeat.full, [...onBeat.strike].sort()]).toEqual([1, true, ['Bb', 'D', 'F']]);
    expect([offBeat.beat, offBeat.full]).toEqual([2, false]);
    expect(offBeat.strike).toEqual([]);
    expect([...offBeat.damp].sort()).toEqual(['D', 'F']);
    expect(offBeat.sounding).toEqual(['Bb']);
  });
  it('lands three equal subdivisions exactly on a barline', () => {
    const { song } = fixture();
    const section: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
    song.sections.push(section); alignSection(song, section, 'one two three four five six'); section.stage = 'done';
    const events = eventsFor(song, section);
    expect(events.at(-1)!.boundaries).toEqual([1 / 3]);
    expect(problems(song)).toEqual([]);
  });
});