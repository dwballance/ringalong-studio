import Fraction from 'fraction.js';
import { type Song, type Section, type Note, type Binding } from './document';

const NATURAL: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const INTERVALS: Record<string, number[]> = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], dim: [0, 3, 6], sus2: [0, 2, 7], sus4: [0, 5, 7] };
export const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const COLORS = Array.from({ length: 12 }, (_, index) => `var(--pitch-${index})`);
export function noteName(name: string): string {
  if (!/^[A-G][#b]?\d*$/.test(name)) throw new Error(`Invalid note: ${name}`);
  return name.replace(/\d+$/, '');
}
export function bellPitch(name: string): number {
  return midi(/\d$/.test(name) ? name : `${name}4`);
}
export function bellLabel(song: Song, name: string): string {
  return song.ringMelody ? name : noteName(name);
}
export function playableBells(song: Song): string[] {
  if (song.ringMelody) return [...song.bells].sort((a, b) => bellPitch(a) - bellPitch(b));
  const classes = new Map<number, string>();
  for (const bell of [...song.bells].sort((a, b) => bellPitch(a) - bellPitch(b))) {
    const pitch = bellPitch(bell) % 12;
    if (!classes.has(pitch)) classes.set(pitch, noteName(bell));
  }
  return [...classes.values()];
}
// Finds the available bell that a typed note refers to. An octave is matched exactly in melody mode;
// without one, the note must match exactly one available bell.
export function resolveBell(song: Song, name: string): string | undefined {
  if (!/^[A-G][#b]?\d*$/.test(name)) return undefined;
  const bells = playableBells(song);
  const matches = /\d$/.test(name) && song.ringMelody ? bells.filter(bell => bellPitch(bell) === bellPitch(name)) : bells.filter(bell => pc(bell) === pc(name));
  return matches.length === 1 ? matches[0] : undefined;
}
// Resolved combined-note pairs, in the order they were chosen. Pairs that no longer resolve are skipped.
export function combinedPairs(song: Song): [string, string][] {
  return song.combined.flatMap(pair => {
    const [first, second] = pair.map(name => resolveBell(song, name));
    return first && second && first !== second ? [[first, second] as [string, string]] : [];
  });
}
export function midi(name: string): number {
  const match = /^([A-G])([#b]?)(\d+)$/.exec(name);
  if (!match) throw new Error(`Invalid pitch: ${name}`);
  return (Number(match[3]) + 1) * 12 + NATURAL[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
}
export function pc(name: string): number {
  return bellPitch(name) % 12;
}
export function nearest(name: string, bells: string[]): string {
  if (/^[A-G][#b]?$/.test(name)) {
    const matches = bells.filter(bell => midi(bell) % 12 === pc(name));
    if (matches.length !== 1) throw new Error(`Melody ${name} needs an octave or exactly one matching bell.`);
    return matches[0];
  }
  const target = midi(name);
  return [...bells].sort((left, right) => Math.abs(midi(left) - target) - Math.abs(midi(right) - target) || midi(left) - midi(right))[0];
}
export function chordTones(song: Song, chord: string): number[] {
  if (Object.hasOwn(song.chords, chord)) return song.chords[chord].map(pc);
  const match = /^([A-G][#b]?)(maj7|m7|dim|sus2|sus4|m|7)?$/.exec(chord);
  if (!match) throw new Error(`Define custom chord '${chord}' in Advanced settings.`);
  return INTERVALS[match[2] || ''].map(interval => (pc(match[1]) + interval) % 12);
}
export interface Event {
  slot: Note; binding: Binding; lyric: string; melody: string; chord: string; beats: number; line: number;
  start: Fraction; beat: number; boundaries: number[]; strike: string[]; damp: string[]; sounding: string[];
  full: boolean; mode: Note['policy']; ringMelody: boolean; breathAfter: boolean;
}
function effectiveMelody(song: Song, name: string, bells: string[]): string {
  const matches = bells.filter(bell => pc(bell) === pc(name));
  if (!song.ringMelody) return matches[0] || noteName(name);
  if (/\d$/.test(name)) return matches.find(bell => /\d$/.test(bell) && midi(bell) === midi(name)) || name;
  return matches.length === 1 ? matches[0] : name;
}
export function eventsFor(song: Song, section: Section): Event[] {
  const pattern = song.patterns.find(item => item.type === section.type);
  if (!pattern) throw new Error(`Missing pattern: ${section.type}`);
  const tokens = new Map(section.lines.flatMap(line => line.tokens.map(token => [token.id, token.text] as const)));
  const bells = playableBells(song);
  let time = new Fraction(song.pickup ? song.time[0] - song.pickup : 0);
  const events: Event[] = [];
  pattern.lines.forEach((line, lineIndex) => line.slots.forEach(slot => {
    const bindings = section.bindings[slot.id] || [];
    const firstPlayed = bindings.findIndex(binding => binding.kind === 'word' || binding.kind === 'continue');
    bindings.forEach((binding, child) => {
      const duration = new Fraction(String(binding.beats ?? slot.beats));
      const beats = duration.valueOf();
      const end = time.add(duration);
      const boundaries: number[] = [];
      let boundary = time.div(song.time[0]).floor().add(1).mul(song.time[0]);
      while (boundary.compare(end) <= 0 && boundaries.length < 512) {
        boundaries.push(boundary.sub(time).valueOf());
        boundary = boundary.add(song.time[0]);
      }
      // Bells strike only on sung words; notes without a word are always held.
      const policy = binding.kind === 'unused' || binding.kind === 'continue' ? 'hold' : binding.kind === 'rest' ? 'rest' :
        child !== firstPlayed && !['hold', 'rest'].includes(slot.policy) ? 'auto' : slot.policy;
      events.push({ slot, binding, lyric: binding.tokenId ? tokens.get(binding.tokenId) || '' : '',
        melody: effectiveMelody(song, binding.melody || slot.melody, bells), chord: binding.chord || slot.chord,
        beats, line: lineIndex, start: time, beat: time.floor().mod(song.time[0]).valueOf() + 1, boundaries,
        strike: [], damp: [], sounding: [], full: false,
        mode: !song.ringMelody && policy === 'melody' ? 'chord' : policy,
        ringMelody: song.ringMelody && (slot.ringMelody ?? true), breathAfter: slot.breath_after && child === bindings.length - 1 });
      time = end;
    });
  }));
  return events;
}

export function perform(song: Song, section: Section): Event[] {
  const events = eventsFor(song, section);
  const bells = playableBells(song);
  if (song.ringMelody && bells.some(bell => !/\d$/.test(bell))) throw new Error('Melody mode requires an octave for every available bell, for example C4 or C5.');
  let sounding = new Set<string>();
  for (const event of events) {
    if (event.mode === 'hold') {
      event.sounding = [...sounding];
      continue;
    }
    if (event.mode === 'rest') {
      event.damp = [...sounding]; sounding.clear();
      event.sounding = []; continue;
    }
    if (song.ringMelody && (event.ringMelody || event.mode === 'melody') && !bells.includes(event.melody)) {
      throw new Error(`Melody ${event.melody} is not an available octave-specific bell. Add that bell or choose another melody note.`);
    }
    const near = bells.indexOf(event.melody);
    const tones = chordTones(song, event.chord);
    const current = new Set<string>();
    for (const tone of tones) {
      const choices = bells.filter(bell => pc(bell) === tone);
      choices.sort((left, right) => Math.abs(bells.indexOf(left) - near) - Math.abs(bells.indexOf(right) - near));
      if (choices.length) current.add(choices[0]);
    }
    if (song.ringMelody && (event.ringMelody || tones.includes(pc(event.melody)))) current.add(event.melody);
    if (event.mode === 'melody') { current.clear(); current.add(event.melody); }
    for (const excluded of event.slot.exclude_notes) {
      for (const bell of current) if (song.ringMelody ? bellPitch(bell) === bellPitch(excluded) : pc(bell) === pc(excluded)) current.delete(bell);
    }
    // Auto notes strike the chord only on a selected ringing beat. Elsewhere they strike no new bells:
    // bells already ringing that the chord uses are held and the rest are damped, even if that is silence.
    event.full = event.start.mod(1).equals(0) && song.strong.includes(event.beat);
    if (event.mode === 'auto' && !event.full) {
      for (const bell of current) if (!sounding.has(bell) && !(event.ringMelody && bell === event.melody)) current.delete(bell);
    }
    const strike = event.full || event.mode === 'chord' || event.mode === 'melody' ? new Set(current) :
      new Set([...current].filter(bell => !sounding.has(bell)));
    if (event.ringMelody && current.has(event.melody)) strike.add(event.melody);
    event.strike = [...strike];
    event.damp = [...sounding].filter(bell => !current.has(bell));
    event.sounding = [...current]; sounding = current;
  }
  for (let index = events.length - 2; index >= 0; index--) {
    const event = events[index];
    if (!event.full && event.mode === 'auto') event.strike = event.strike.filter(bell =>
      !events[index + 1].strike.includes(bell) || (event.ringMelody && bell === event.melody));
  }
  return events;
}

export function problems(song: Song, completed = true): string[] {
  const errors: string[] = [];
  if (!song.title.trim()) errors.push('Enter a title.');
  if (!/^[A-G][#b]? (major|minor)$/.test(song.key)) errors.push('Choose a key signature.');
  const [top, bottom] = song.time;
  if (!Number.isInteger(top) || top < 1 || top > 32 || ![1, 2, 4, 8, 16, 32].includes(bottom)) errors.push('Enter a valid time signature (maximum 32 beats).');
  if (!Number.isFinite(song.pickup) || song.pickup < 0 || song.pickup >= top) errors.push('Pickup must be nonnegative and shorter than a measure.');
  if (song.strong.some(beat => beat < 1 || beat > top || !Number.isInteger(beat))) errors.push('Ringing beats must be within the measure.');
  if (!song.bells.length) errors.push('Choose at least one bell.');
  try {
    if (new Set(song.bells.map(bellPitch)).size !== song.bells.length) errors.push('Bell pitches must be unique, including enharmonic spellings.');
    if (song.ringMelody && song.bells.some(bell => !/\d$/.test(bell))) errors.push('Melody mode requires octave-qualified available bells.');
    Object.values(song.chords).forEach(tones => tones.forEach(pc));
    for (const [first, second] of song.combined) {
      const missing = [first, second].find(name => !resolveBell(song, name));
      if (missing) errors.push(`Combined notes: ${missing} is not an available bell.`);
      else if (resolveBell(song, first) === resolveBell(song, second)) errors.push(`Combined notes: ${first} and ${second} are the same bell.`);
    }
  } catch (error) { errors.push((error as Error).message); }
  if (completed && !song.sections.length) errors.push('Add at least one section.');
  const types = song.patterns.map(pattern => pattern.type);
  if (new Set(types).size !== types.length) errors.push('Each section type needs one shared pattern.');
  const ids = [...song.patterns.flatMap(pattern => [pattern.id, ...pattern.lines.flatMap(line => [line.id, ...line.slots.map(slot => slot.id)])]),
    ...song.sections.flatMap(section => [section.id, ...section.lines.flatMap(line => [line.id, ...line.tokens.map(token => token.id)]), ...Object.values(section.bindings).flat().map(binding => binding.id)])];
  if (new Set(ids).size !== ids.length) errors.push('Document identifiers must be unique.');
  for (const section of song.sections) {
    const label = section.name || `${section.type} ${section.number || song.sections.filter(item => item.type === section.type).indexOf(section) + 1}`;
    if (['lyrics', 'suggestions'].includes(section.stage)) {
      if (completed) errors.push(`${label}: lyrics have not been mapped to music. Open this section and choose Next${section.stage === 'suggestions' ? ', then confirm the syllable breaks' : ''}.`);
      continue;
    }
    const pattern = song.patterns.find(item => item.type === section.type);
    if (!pattern) { errors.push(`${label}: missing music.`); continue; }
    if (section.lines.length !== pattern.lines.length) errors.push(`${label}: lyric line count must match the shared pattern.`);
    const used: string[] = [];
    for (const line of pattern.lines) for (const slot of line.slots) {
      const bindings = section.bindings[slot.id] || [];
      if (!bindings.length) errors.push(`${label}: a note has no lyric mapping.`);
      const total = bindings.reduce((sum, item) => sum.add(String(item.beats ?? slot.beats)), new Fraction(0));
      if (total.compare(String(slot.beats)) !== 0) errors.push(`${label}: verse exceptions must total ${slot.beats} beats within their shared note.`);
      for (const binding of bindings) if (binding.kind === 'word') {
        if (!binding.tokenId) errors.push(`${label}: assign a word to each lyric-bearing note.`);
        else used.push(binding.tokenId);
      }
      try { slot.exclude_notes.forEach(bell => {
        if (!song.bells.some(available => song.ringMelody ? bellPitch(available) === bellPitch(bell) : pc(available) === pc(bell))) throw new Error(`${bellLabel(song, bell)} is excluded but is not an available bell.`);
      }); } catch (error) { errors.push(`${label}: ${(error as Error).message}`); }
    }
    const tokens = section.lines.flatMap(line => line.tokens.map(token => token.id));
    if (new Set(used).size !== used.length || used.length !== tokens.length || tokens.some(token => !used.includes(token)))
      errors.push(`${label}: each lyric token must be assigned exactly once.`);
    try { if (song.bells.length) perform(song, section); }
    catch (error) { errors.push(`${label}: ${(error as Error).message}`); }
  }
  return [...new Set(errors)];
}

export const DURATIONS = [
  { label: '\ud834\udd60', name: 'Eighth', whole: 1 / 8 }, { label: '\ud834\udd60\u00b7', name: 'Dotted eighth', whole: 3 / 16 },
  { label: '\ud834\udd5f', name: 'Quarter', whole: 1 / 4 }, { label: '\ud834\udd5f\u00b7', name: 'Dotted quarter', whole: 3 / 8 },
  { label: '\ud834\udd5e', name: 'Half', whole: 1 / 2 }, { label: '\ud834\udd5e\u00b7', name: 'Dotted half', whole: 3 / 4 },
  { label: '\ud834\udd5d', name: 'Whole', whole: 1 }, { label: '\ud834\udd5d\u00b7', name: 'Dotted whole', whole: 3 / 2 },
];
export function durationLabel(beats: number, denominator: number, measureBeats?: number, start = new Fraction(0)): string {
  const simple = (value: Fraction) => DURATIONS.find(duration => value.equals(new Fraction(duration.whole).mul(denominator)))?.label;
  if (beats < 5 || !measureBeats || !Number.isFinite(beats)) return DURATIONS.find(duration => Math.abs(duration.whole * denominator - beats) < 1e-9)?.label || `${beats} beats`;
  let remaining = new Fraction(String(beats));
  let capacity = new Fraction(measureBeats).sub(start.mod(measureBeats));
  const labels: string[] = [];
  const choices = [...DURATIONS].sort((left, right) => right.whole - left.whole);
  while (remaining.compare(0) > 0 && labels.length < 128) {
    const portion = remaining.compare(capacity) > 0 ? capacity : remaining;
    const exact = simple(portion);
    if (exact) labels.push(exact);
    else {
      let part = portion;
      while (part.compare(0) > 0 && labels.length < 128) {
        const note = choices.find(note => new Fraction(note.whole).mul(denominator).compare(part) <= 0);
        if (!note) { labels.push(`${part.toFraction()} beats`); break; }
        labels.push(note.label); part = part.sub(new Fraction(note.whole).mul(denominator));
      }
    }
    remaining = remaining.sub(portion); capacity = new Fraction(measureBeats);
  }
  if (remaining.compare(0) > 0) labels.push(`${remaining.toFraction()} beats`);
  return labels.join(' ‿ ');
}