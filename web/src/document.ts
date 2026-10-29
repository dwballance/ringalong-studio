import { z } from 'zod';
import Fraction from 'fraction.js';
import { nearest } from './music';

export const id = () => crypto.randomUUID();
export const DEFAULT_BELLS = ['Eb4', 'F4', 'G4', 'A4', 'Bb4', 'C5', 'D5'];
const idSchema = z.string().uuid();
export const pitchSchema = z.string().regex(/^[A-G][#b]?\d+$/);
export const bellSchema = z.string().regex(/^[A-G][#b]?\d*$/);
export const chordDefinitionsSchema = z.record(z.string().min(1), z.union([
  z.string().trim().min(1).transform(value => value.split(/[\s,]+/)), z.array(bellSchema).min(1),
]).pipe(z.array(bellSchema).min(1)));
export const policySchema = z.enum(['auto', 'chord', 'melody', 'hold', 'rest']);
export const noteSchema = z.object({
  id: idSchema, melody: z.string(), chord: z.string().min(1), beats: z.number().finite().positive(),
  word: z.boolean().default(true), breath_after: z.boolean().default(false),
  play_if_word: z.boolean().default(false), exclude_notes: z.array(bellSchema).default([]),
  policy: policySchema.default('auto'), ringMelody: z.boolean().nullable().default(null),
}).passthrough();
const bindingSchema = z.object({
  id: idSchema, tokenId: idSchema.optional(), kind: z.enum(['word', 'continue', 'unused', 'rest']),
  beats: z.union([z.number().finite().positive(), z.string().max(80).regex(/^[1-9]\d*(?:\/[1-9]\d*)?$/)]).optional(),
  melody: z.string().optional(), chord: z.string().optional(),
});
export const sectionSchema = z.object({
  id: idSchema, type: z.string().min(1), stage: z.enum(['lyrics', 'suggestions', 'music', 'done']),
  name: z.string().trim().min(1).optional(), number: z.number().int().positive().optional(),
  raw: z.string(), suggestion: z.string().optional(), lines: z.array(z.object({ id: idSchema, tokens: z.array(z.object({ id: idSchema, text: z.string() })) })),
  bindings: z.record(idSchema, z.array(bindingSchema)),
});
export const songSchema = z.object({
  format: z.literal('ringalong'), version: z.literal(1), title: z.string(), hymnNumber: z.string(),
  key: z.string(), time: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  pickup: z.number().finite().nonnegative(), musicAuthor: z.string(), wordsAuthor: z.string(), credit: z.string(),
  bells: z.array(bellSchema).min(1), recommended: z.array(bellSchema).default([]), strong: z.array(z.number().int().positive()),
  ringMelody: z.boolean(), chords: chordDefinitionsSchema, combined: z.array(z.tuple([bellSchema, bellSchema])).default([]),
  patterns: z.array(z.object({ id: idSchema, type: z.string(), lines: z.array(z.object({ id: idSchema, slots: z.array(noteSchema) })) })),
  sections: z.array(sectionSchema), extensions: z.record(z.string(), z.unknown()).default({}),
});
export type Song = z.infer<typeof songSchema>;
export type Note = z.infer<typeof noteSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Binding = z.infer<typeof bindingSchema>;
export type Pattern = Song['patterns'][number];

export function additionalAttribution(song: Song): string {
  return song.credit;
}

export function normalizeAttribution(song: Song): Song {
  const lines = song.credit.replace(/\bcopyright\s*:/gi, 'Copyright:').split(/\r?\n/);
  const authorLines: string[] = [];
  for (const [label, field] of [['Words', 'wordsAuthor'], ['Music', 'musicAuthor']] as const) {
    const author = song[field].trim();
    if (!author) continue;
    const literal = author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const duplicate = new RegExp(`\\b${label}:\\s*${literal}(?=\\s*(?:$|(?:Words|Music|Setting|Copyright|Source):))`, 'im');
    if (!duplicate.test(lines.join('\n'))) {
      const emptyLine = lines.findIndex(line => new RegExp(`^\\s*${label}:\\s*$`, 'i').test(line));
      if (emptyLine >= 0) lines[emptyLine] = `${label}: ${author}`;
      else authorLines.push(`${label}: ${author}`);
    }
    song[field] = '';
  }
  lines.unshift(...authorLines);
  song.credit = lines.join('\n');
  return song;
}

export function sectionTitle(section: Section): string {
  return section.name || `${section.type.charAt(0).toUpperCase() + section.type.slice(1)} ${section.number || 1}`;
}

export function ensureSectionNames(song: Song): Song {
  const numbers = new Map<string, number>();
  for (const section of song.sections) {
    section.number ??= Number(/(\d+)\s*$/.exec(section.name || '')?.[1]) || (numbers.get(section.type) || 0) + 1;
    numbers.set(section.type, Math.max(numbers.get(section.type) || 0, section.number));
    section.name ||= `${section.type.charAt(0).toUpperCase() + section.type.slice(1)} ${section.number}`;
  }
  return song;
}

export function newSection(song: Song, type: string): Section {
  ensureSectionNames(song);
  const number = Math.max(0, ...song.sections.filter(section => section.type === type).map(section => section.number || 0)) + 1;
  return { id: id(), type, number, name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${number}`, stage: 'lyrics', raw: '', lines: [], bindings: {} };
}

export function newSong(): Song {
  return { format: 'ringalong', version: 1, title: '', hymnNumber: '', key: '', time: [4, 4], pickup: 0,
    musicAuthor: '', wordsAuthor: '', credit: 'Words: \nMusic: ', bells: [...DEFAULT_BELLS], recommended: [...DEFAULT_BELLS],
    strong: [1, 3], ringMelody: false, chords: {}, combined: [], patterns: [], sections: [], extensions: {} };
}

export function newNote(song: Song): Note {
  return noteSchema.parse({ id: id(), melody: song.bells[0], chord: (song.key.split(' ')[0] || 'C') + (song.key.endsWith(' minor') ? 'm' : ''),
    beats: song.time[1] / 4, word: true });
}

export function rememberHymnDefaults(song: Song): Song {
  normalizeAttribution(song);
  const baseline = structuredClone(song);
  delete baseline.extensions.hymnDefaults;
  song.extensions.hymnDefaults = baseline;
  return song;
}

export function restoreHymnDefaults(song: Song): Song | undefined {
  const parsed = songSchema.safeParse(song.extensions.hymnDefaults);
  if (!parsed.success) return;
  return rememberHymnDefaults(structuredClone(parsed.data));
}

export function removeUntextedNote(song: Song, type: string, noteId: string): void {
  const pattern = song.patterns.find(pattern => pattern.type === type);
  if (!pattern) throw new Error('The shared music pattern was not found.');
  const notes = pattern.lines.flatMap(line => line.slots);
  const index = notes.findIndex(note => note.id === noteId);
  if (index < 0) throw new Error('The selected note was not found.');
  const sections = song.sections.filter(section => section.type === type);
  if (sections.some(section => (section.bindings[noteId] || []).some(binding => binding.tokenId))) throw new Error('Notes containing lyrics must be reset, not removed.');
  if (index === 0) throw new Error('This note has no preceding note to receive its duration.');
  const note = notes[index], previous = notes[index - 1];
  const lineIndex = pattern.lines.findIndex(line => line.slots.includes(note));
  const line = pattern.lines[lineIndex];
  const updates = sections.filter(section => ['music', 'done'].includes(section.stage)).map(section => {
    const bindings = section.bindings[previous.id];
    const removed = section.bindings[note.id];
    if (!bindings?.length || !removed?.length) throw new Error('Align every musical verse before removing this note.');
    if (line.slots.length === 1 && section.lines[lineIndex]?.tokens.length) throw new Error('Resolve this line’s lyric mapping before removing its last note.');
    const last = bindings[bindings.length - 1];
    const duration = removed.reduce((total, binding) => total.add(String(binding.beats ?? note.beats)), new Fraction(0));
    return { last, beats: new Fraction(String(last.beats ?? previous.beats)).add(duration).toFraction() };
  });
  previous.beats = new Fraction(String(previous.beats)).add(String(note.beats)).valueOf();
  for (const update of updates) update.last.beats = update.beats;
  line.slots.splice(line.slots.indexOf(note), 1);
  for (const section of sections) delete section.bindings[note.id];
  if (!line.slots.length) {
    pattern.lines.splice(lineIndex, 1);
    for (const section of sections.filter(section => ['music', 'done'].includes(section.stage))) {
      section.lines.splice(lineIndex, 1);
      section.raw = section.lines.map(line => line.tokens.map(token => token.text).join(' ')).join('\n');
    }
  }
}

export function tokenize(text: string): Section['lines'] {
  return text.replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim()).map(line => ({
    id: id(), tokens: line.trim().split(/\s+/).map(text => ({ id: id(), text })),
  }));
}

export function alignSection(song: Song, section: Section, text: string) {
  ensureSectionNames(song);
  section.raw = text;
  delete section.suggestion;
  section.lines = tokenize(text);
  let pattern = song.patterns.find(item => item.type === section.type);
  if (!pattern) {
    pattern = { id: id(), type: section.type, lines: section.lines.map(line => ({
      id: id(), slots: line.tokens.map(() => newNote(song)),
    })) };
    song.patterns.push(pattern);
  }
  section.bindings = {};
  pattern.lines.forEach((line, lineIndex) => {
    const tokens = section.lines[lineIndex]?.tokens || [];
    let cursor = 0;
    const lastWordSlot = line.slots.reduce((last, slot, index) => slot.word ? index : last, -1);
    line.slots.forEach((slot, slotIndex) => {
      if (!slot.word) {
        section.bindings[slot.id] = [{ id: id(), kind: slot.play_if_word ? 'unused' : 'continue' }];
        return;
      }
      const bindings: Binding[] = [];
      const count = slotIndex === lastWordSlot ? Math.max(1, tokens.length - cursor) : 1;
      for (let child = 0; child < count; child++) {
        const token = tokens[cursor++];
        bindings.push({ id: id(), kind: token ? 'word' : 'unused', tokenId: token?.id,
          ...(count > 1 ? { beats: new Fraction(String(slot.beats)).div(count).toFraction() } : {}) });
      }
      section.bindings[slot.id] = bindings;
    });
  });
  section.stage = 'music';
}

export function breakLineHere(song: Song, type: string, noteId: string): boolean {
  const pattern = song.patterns.find(pattern => pattern.type === type);
  if (!pattern) throw new Error('The shared music pattern was not found.');
  const lineIndex = pattern.lines.findIndex(line => line.slots.some(note => note.id === noteId));
  if (lineIndex < 0) throw new Error('The selected note was not found.');
  const line = pattern.lines[lineIndex];
  const noteIndex = line.slots.findIndex(note => note.id === noteId);
  if (noteIndex === 0) return false;
  const moving = line.slots.slice(noteIndex);
  const changes = song.sections.filter(section => section.type === type && ['music', 'done'].includes(section.stage)).map(section => {
    if (section.lines.length !== pattern.lines.length) throw new Error('Align every musical verse with the shared pattern before changing line breaks.');
    const lyricLine = section.lines[lineIndex];
    const movingTokens = new Set(moving.flatMap(note => (section.bindings[note.id] || []).flatMap(binding => binding.tokenId ? [binding.tokenId] : [])));
    const tokens = lyricLine.tokens.filter(token => movingTokens.has(token.id));
    if (tokens.length !== movingTokens.size) throw new Error('Resolve this verse’s lyric mapping before changing line breaks.');
    return { section, lyricLine, tokens, remaining: lyricLine.tokens.filter(token => !movingTokens.has(token.id)) };
  });
  line.slots.splice(noteIndex);
  const next = pattern.lines[lineIndex + 1];
  if (next) next.slots.unshift(...moving);
  else pattern.lines.push({ id: id(), slots: moving });
  for (const { section, lyricLine, tokens, remaining } of changes) {
    lyricLine.tokens = remaining;
    const nextLyrics = section.lines[lineIndex + 1];
    if (nextLyrics) nextLyrics.tokens.unshift(...tokens);
    else section.lines.push({ id: id(), tokens });
    section.raw = section.lines.map(line => line.tokens.map(token => token.text).join(' ')).join('\n');
  }
  return true;
}

// Moves the selected note and everything after it out of a section type's shared pattern into a new
// pattern of `targetType`. Every musical section that sings words on the moved notes gets a new section
// of the target type holding those words; sections that sing nothing there simply lose the notes.
export function splitSection(song: Song, type: string, noteId: string, targetType: string, sectionId: string): Section[] {
  const target = targetType.trim().toLowerCase();
  if (!target) throw new Error('Choose a section type for the split.');
  if (song.patterns.some(pattern => pattern.type === target)) throw new Error(`A ${target} section already exists. Choose an unused type.`);
  const pattern = song.patterns.find(item => item.type === type);
  if (!pattern) throw new Error('The shared music pattern was not found.');
  const lineIndex = pattern.lines.findIndex(line => line.slots.some(note => note.id === noteId));
  if (lineIndex < 0) throw new Error('The selected note was not found.');
  const line = pattern.lines[lineIndex];
  const noteIndex = line.slots.findIndex(note => note.id === noteId);
  if (lineIndex === 0 && noteIndex === 0) throw new Error('Select a note after the first one; splitting at the first note would leave nothing behind.');
  const movingLines = [{ id: noteIndex === 0 ? line.id : id(), slots: line.slots.slice(noteIndex) }, ...pattern.lines.slice(lineIndex + 1)];
  const movingNotes = movingLines.flatMap(item => item.slots);
  const sections = song.sections.filter(section => section.type === type && ['music', 'done'].includes(section.stage));
  const plans = sections.map(section => {
    // A later verse may sing fewer lines than the shared pattern; the missing lines are simply empty.
    if (section.lines.length > pattern.lines.length) throw new Error('Align every musical verse with the shared pattern before splitting.');
    const movingTokens = new Set(movingNotes.flatMap(note => (section.bindings[note.id] || []).flatMap(binding => binding.tokenId ? [binding.tokenId] : [])));
    const moved = movingLines.map((_, offset) => (section.lines[lineIndex + offset]?.tokens ?? []).filter(token => movingTokens.has(token.id)));
    if (moved.flat().length !== movingTokens.size || section.lines.slice(lineIndex + 1).some((item, offset) => item.tokens.length !== moved[offset + 1].length))
      throw new Error('Resolve this verse’s lyric mapping before splitting.');
    return { section, moved, words: movingTokens.size > 0 };
  });
  if (!plans.some(plan => plan.words)) {
    const own = plans.find(plan => plan.section.id === sectionId);
    if (own) own.words = true;
  }
  const created: Section[] = [];
  song.patterns.push({ id: id(), type: target, lines: movingLines });
  pattern.lines.splice(lineIndex + 1);
  if (noteIndex === 0) pattern.lines.pop(); else line.slots.splice(noteIndex);
  for (const { section, moved, words } of plans) {
    if (words) {
      const added = newSection(song, target);
      added.stage = section.stage;
      added.lines = moved.map(tokens => ({ id: id(), tokens }));
      added.raw = added.lines.map(item => item.tokens.map(token => token.text).join(' ')).join('\n');
      for (const note of movingNotes) added.bindings[note.id] = section.bindings[note.id] || [{ id: id(), kind: 'unused' }];
      song.sections.splice(song.sections.indexOf(section) + 1, 0, added);
      created.push(added);
    }
    for (const note of movingNotes) delete section.bindings[note.id];
    const keep = new Set(moved.flat().map(token => token.id));
    if (noteIndex === 0) section.lines.splice(lineIndex);
    else { if (section.lines[lineIndex]) section.lines[lineIndex].tokens = section.lines[lineIndex].tokens.filter(token => !keep.has(token.id)); section.lines.splice(lineIndex + 1); }
    section.raw = section.lines.map(item => item.tokens.map(token => token.text).join(' ')).join('\n');
  }
  return created;
}

const legacyNote = noteSchema.omit({ id: true, policy: true, ringMelody: true });
const legacySchema = z.object({
  title: z.string().optional(), key_signature: z.string().optional(), credit: z.string().optional(),
  wordsAuthor: z.string().optional(), musicAuthor: z.string().optional(),
  words_author: z.string().optional(), music_author: z.string().optional(),
  time_signature: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  pickup_beats: z.number().finite().nonnegative(), strong_beats: z.array(z.number().int().positive()),
  bell_range: z.array(pitchSchema).optional(), available_bells: z.array(pitchSchema).optional(),
  recommended_bells: z.array(pitchSchema).optional(), chord_tones: z.record(z.string(), z.array(z.string()).min(1)).optional(),
  lyrics: z.array(z.union([z.string(), z.object({ type: z.string(), lines: z.array(z.string()),
    word_overrides: z.array(z.object({ line: z.number().int().positive(), note: z.number().int().positive(), word: z.boolean() })).optional(),
  }).passthrough()])),
}).passthrough();

export function importDocument(input: unknown): Song {
  if (input && typeof input === 'object' && ('version' in input || 'format' in input)) {
    const song = songSchema.parse(input);
    song.recommended = [...song.bells];
    return normalizeAttribution(ensureSectionNames(song));
  }
  const source = legacySchema.parse(input);
  const song = newSong();
  Object.assign(song, { title: source.title || 'Untitled ringalong', key: source.key_signature || 'C major',
    wordsAuthor: source.wordsAuthor || source.words_author || '', musicAuthor: source.musicAuthor || source.music_author || '',
    credit: source.credit || song.credit, time: source.time_signature, pickup: source.pickup_beats, strong: source.strong_beats,
    bells: source.bell_range || source.available_bells || DEFAULT_BELLS,
    recommended: source.bell_range || source.available_bells || DEFAULT_BELLS,
    chords: source.chord_tones || {}, ringMelody: true, extensions: source });
  for (const [type, value] of Object.entries(source)) {
    if (Array.isArray(value) && value.length && Array.isArray(value[0])) {
      const lines = z.array(z.array(legacyNote).min(1)).min(1).parse(value);
      song.patterns.push({ id: id(), type, lines: lines.map(slots => ({ id: id(), slots: slots.map(note =>
        noteSchema.parse({ ...note, melody: nearest(note.melody, song.bells), id: id() })) })) });
    }
  }
  let blocks: { type: string; lines: string[]; word_overrides?: { line: number; note: number; word: boolean }[] }[];
  if (source.lyrics.every(line => typeof line === 'string')) {
    const texts = source.lyrics as string[];
    const groups = texts.join('\n').trim().split(/\n\s*\n/).filter(Boolean).map(text => text.split('\n'));
    const size = song.patterns.find(pattern => pattern.type === 'verse')?.lines.length || 1;
    blocks = groups.flatMap(lines => {
      const result = [];
      for (let start = 0; start < lines.length; start += size) result.push({ type: 'verse', lines: lines.slice(start, start + size) });
      return result;
    });
  } else {
    if (source.lyrics.some(line => typeof line === 'string')) throw new Error('Do not mix lyric strings and section objects.');
    blocks = source.lyrics as typeof blocks;
  }
  for (const block of blocks) {
    const pattern = song.patterns.find(item => item.type === block.type);
    if (!pattern) throw new Error(`Missing pattern: ${block.type}`);
    const section: Section = { id: id(), type: block.type, stage: 'done', raw: block.lines.join('\n'), lines: tokenize(block.lines.join('\n')), bindings: {} };
    const overrides = new Map<string, boolean>();
    for (const override of block.word_overrides || []) {
      const slot = pattern.lines[override.line - 1]?.slots[override.note - 1];
      if (!slot || overrides.has(slot.id)) throw new Error('Invalid or duplicate word override.');
      overrides.set(slot.id, override.word);
    }
    if (section.lines.length !== pattern.lines.length) throw new Error(`${block.type}: lyric line count does not match music.`);
    pattern.lines.forEach((line, lineIndex) => {
      let cursor = 0;
      for (const slot of line.slots) {
        const word = overrides.get(slot.id) ?? slot.word;
        const token = word ? section.lines[lineIndex].tokens[cursor++] : undefined;
        if (word && !token) throw new Error(`${block.type}, line ${lineIndex + 1}: not enough lyric tokens.`);
        section.bindings[slot.id] = [{ id: id(), tokenId: token?.id, kind: word ? 'word' : slot.play_if_word ? 'unused' : 'continue' }];
      }
      if (cursor !== section.lines[lineIndex].tokens.length) throw new Error(`${block.type}, line ${lineIndex + 1}: too many lyric tokens.`);
    });
    song.sections.push(section);
  }
  return normalizeAttribution(ensureSectionNames(songSchema.parse(song)));
}