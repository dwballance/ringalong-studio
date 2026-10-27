import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { additionalAttribution, importDocument, alignSection, breakLineHere, ensureSectionNames, id, newNote, newSection, newSong, normalizeAttribution, rememberHymnDefaults, removeUntextedNote, restoreHymnDefaults, sectionTitle, songSchema, type Section } from '../src/document';
import { eventsFor, perform, problems } from '../src/music';
import { exportHTML, readDocument } from '../src/files';

const root = resolve(import.meta.dirname, '../..');
const filenames = ['together_we_serve_2175.json', 'As_a_Fire_Is_Meant_for_Burning.json', 'love_the_lord_your_god_2168.json', 'Shine_Jesus_Shine_2173.json'];

describe('attribution', () => {
  it('starts blank songs with editable author lines', () => {
    expect(newSong().credit).toBe('Words: \nMusic: ');
  });
  it('keeps complete credit and clears only the cloned author entries', () => {
    const song = newSong(); song.wordsAuthor = 'Jane Author, 1820.'; song.musicAuthor = 'John Composer, 1850.';
    song.credit = 'Words: Jane Author, 1820.\nMusic: John Composer, 1850.  Setting: Traditional harmony.\ncopyright: public domain.\nSource: Original collection.';
    normalizeAttribution(song);
    expect(additionalAttribution(song)).toContain('Copyright: public domain.');
    expect(song.wordsAuthor).toBe(''); expect(song.musicAuthor).toBe('');
  });
  it('handles combined credit lines and preserves unrelated credit statements', () => {
    const song = newSong(); song.wordsAuthor = 'A. Writer (Jr.)'; song.musicAuthor = "'Tune' B. Composer";
    song.credit = "Words: A. Writer (Jr.) Music: 'Tune' B. Composer Setting: Original\nUsed with permission.";
    const credit = song.credit;
    const cleaned = normalizeAttribution(structuredClone(song));
    expect(cleaned.credit).toBe(credit); expect(cleaned.wordsAuthor).toBe(''); expect(cleaned.musicAuthor).toBe('');
    song.wordsAuthor = 'Another writer';
    normalizeAttribution(song);
    expect(additionalAttribution(song)).toContain('Words: A. Writer (Jr.)'); expect(song.wordsAuthor).toBe('');
  });
  it('cleans restored definitions without dropping unique licensing information', () => {
    const song = newSong(); song.title = 'Credit test'; song.key = 'C major'; song.wordsAuthor = 'Writer'; song.musicAuthor = 'Composer';
    song.credit = 'Words: Writer\nMusic: Composer\nLicense: retain this notice';
    const imported = importDocument(song);
    expect(imported.credit).toContain('Words: Writer\nMusic: Composer');
    expect(imported.wordsAuthor).toBe(''); expect(imported.musicAuthor).toBe('');
  });
  it('migrates author properties from legacy documents into attribution', () => {
    const imported = importDocument({ title: 'Legacy', key_signature: 'C major', words_author: 'Writer', music_author: 'Composer',
      credit: 'copyright: public domain', time_signature: [4, 4], pickup_beats: 0, strong_beats: [1], lyrics: [] });
    expect(imported.credit).toBe('Words: Writer\nMusic: Composer\nCopyright: public domain');
    expect(imported.wordsAuthor).toBe(''); expect(imported.musicAuthor).toBe('');
  });
});

describe('persistent section names', () => {
  it('does not renumber after deletion or reordering and adds above the highest remaining number', () => {
    const song = newSong();
    for (let index = 0; index < 4; index++) song.sections.push(newSection(song, 'verse'));
    const removed = song.sections.splice(1, 1)[0];
    song.sections.reverse(); ensureSectionNames(song);
    expect(song.sections.map(sectionTitle)).toEqual(['Verse 4', 'Verse 3', 'Verse 1']);
    expect(newSection(song, 'verse').name).toBe('Verse 5');
    expect(removed.name).toBe('Verse 2');
  });
  it('preserves custom names and independent numbering for each section type', () => {
    const song = newSong(); song.sections.push(newSection(song, 'verse'));
    song.sections[0].name = 'Opening invitation';
    song.sections.push(newSection(song, 'chorus'), newSection(song, 'verse'));
    expect(song.sections.map(sectionTitle)).toEqual(['Opening invitation', 'Chorus 1', 'Verse 2']);
  });
  it('assigns stable names to older documents and keeps them through JSON migration', () => {
    const song = newSong(); song.title = 'Old draft'; song.key = 'C major';
    song.sections = [1, 2, 3].map(() => ({ id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} }));
    const restored = importDocument(song); restored.sections.splice(1, 1);
    expect(importDocument(restored).sections.map(sectionTitle)).toEqual(['Verse 1', 'Verse 3']);
    expect(newSection(restored, 'verse').name).toBe('Verse 4');
  });
});

describe('removing untexted notes', () => {
  function fixture() {
    const song = newSong(); song.title = 'Timing preservation'; song.key = 'C major';
    const first: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
    const second: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
    song.sections.push(first, second); alignSection(song, first, 'one two\nthree four'); alignSection(song, second, 'five six\nseven eight');
    const line = song.patterns[0].lines[0], previous = line.slots[0], note = newNote(song);
    note.word = false; note.beats = 0.5; line.slots.splice(1, 0, note);
    for (const section of song.sections) section.bindings[note.id] = [{ id: id(), kind: 'continue' }];
    return { song, first, second, line, previous, note };
  }
  it('extends the preceding note in every verse without moving later note onsets or lyrics', () => {
    const { song, previous, note } = fixture();
    const before = song.sections.map(section => eventsFor(song, section).filter(event => ![note.id, previous.id].includes(event.slot.id)).map(event => [event.slot.id, event.start.toFraction(), event.lyric]));
    const words = song.sections.map(section => section.raw);
    removeUntextedNote(song, 'verse', note.id);
    expect(previous.beats).toBe(1.5);
    expect(song.sections.map(section => eventsFor(song, section).filter(event => event.slot.id !== previous.id).map(event => [event.slot.id, event.start.toFraction(), event.lyric]))).toEqual(before);
    expect(song.sections.map(section => section.raw)).toEqual(words);
    expect(problems(song, false)).toEqual([]);
  });
  it('adds duration to the previous final subdivision without changing its pitch/chord exceptions', () => {
    const { song, second, previous, note } = fixture();
    second.bindings[previous.id][0].beats = '1/3';
    second.bindings[previous.id].push({ id: id(), kind: 'continue', beats: '2/3', melody: 'D5', chord: 'F' });
    removeUntextedNote(song, 'verse', note.id);
    expect(second.bindings[previous.id].map(binding => binding.beats)).toEqual(['1/3', '7/6']);
    expect(second.bindings[previous.id][1]).toMatchObject({ melody: 'D5', chord: 'F' });
    expect(problems(song, false)).toEqual([]);
  });
  it('can transfer time across a line break and remove an empty musical line', () => {
    const { song, note } = fixture();
    removeUntextedNote(song, 'verse', note.id);
    const pattern = song.patterns[0], inserted = newNote(song); inserted.word = false; inserted.beats = 0.5;
    pattern.lines.splice(1, 0, { id: id(), slots: [inserted] });
    for (const section of song.sections) { section.lines.splice(1, 0, { id: id(), tokens: [] }); section.bindings[inserted.id] = [{ id: id(), kind: 'continue' }]; }
    const previous = pattern.lines[0].slots.at(-1)!;
    removeUntextedNote(song, 'verse', inserted.id);
    expect(previous.beats).toBe(1.5); expect(pattern.lines).toHaveLength(2);
    expect(song.sections.every(section => section.lines.length === 2)).toBe(true);
    expect(problems(song, false)).toEqual([]);
  });
  it('refuses lyric deletion or deletion without a preceding note before changing anything', () => {
    const { song, first, previous } = fixture();
    const before = JSON.stringify(song);
    expect(() => removeUntextedNote(song, 'verse', previous.id)).toThrow('lyrics');
    expect(JSON.stringify(song)).toBe(before);
    first.lines[0].tokens.shift();
    for (const section of song.sections) { delete section.bindings[previous.id][0].tokenId; section.bindings[previous.id][0].kind = 'continue'; }
    const untexted = JSON.stringify(song);
    expect(() => removeUntextedNote(song, 'verse', previous.id)).toThrow('no preceding note');
    expect(JSON.stringify(song)).toBe(untexted);
  });
});

describe('saved hymn defaults', () => {
  function fixture() {
    const song = newSong(); song.title = 'Original hymn'; song.key = 'C major';
    const section: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
    song.sections.push(section); alignSection(song, section, 'one two three four'); section.stage = 'done';
    song.extensions.webSource = { id: 'synthetic-source' };
    return song;
  }
  it('restores a deep original arrangement after note deletion, lyric and metadata edits', () => {
    const song = fixture(), original = structuredClone(song);
    rememberHymnDefaults(song);
    song.title = 'Edited'; song.time = [3, 4]; song.pickup = 1;
    song.sections[0].lines[0].tokens[0].text = 'changed';
    song.patterns[0].lines[0].slots.pop();
    const restored = restoreHymnDefaults(song)!;
    delete restored.extensions.hymnDefaults;
    expect(restored).toEqual(original);
    expect(song.title).toBe('Edited');
  });
  it('keeps defaults through export/import and allows repeated resets without nesting', () => {
    const song = rememberHymnDefaults(fixture());
    const imported = readDocument(exportHTML(song));
    const first = restoreHymnDefaults(imported)!;
    first.title = 'Changed again';
    const second = restoreHymnDefaults(first)!;
    expect(second.title).toBe('Original hymn');
    expect((second.extensions.hymnDefaults as ReturnType<typeof newSong>).extensions.hymnDefaults).toBeUndefined();
  });
  it('does not expose malformed defaults as a restorable arrangement', () => {
    const song = fixture();
    expect(restoreHymnDefaults(song)).toBeUndefined();
    song.extensions.hymnDefaults = { title: 'Incomplete' };
    expect(restoreHymnDefaults(song)).toBeUndefined();
  });
});

describe('line breaks', () => {
  function fixture() {
    const song = newSong(); song.title = 'Line break test'; song.key = 'Bb major'; song.pickup = 1;
    const first: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
    const second: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
    song.sections.push(first, second);
    alignSection(song, first, 'one two three four\nfive six');
    alignSection(song, second, 'alpha beta gam- ma delta\nomega');
    const pattern = song.patterns[0];
    const note = pattern.lines[0].slots[2];
    note.policy = 'chord'; note.breath_after = true; note.exclude_notes = ['F4'];
    second.bindings[note.id][0].melody = 'D5'; second.bindings[note.id][0].chord = 'Cm';
    return { song, first, second, pattern, note };
  }
  function performance(song: ReturnType<typeof newSong>) {
    return song.sections.filter(section => ['music', 'done'].includes(section.stage)).map(section => perform(song, section).map(event => ({
      slot: event.slot.id, binding: event.binding.id, lyric: event.lyric, start: event.start.toFraction(), beats: event.beats,
      melody: event.melody, chord: event.chord, mode: event.mode, ringMelody: event.ringMelody, breath: event.breathAfter,
      boundaries: event.boundaries, strike: event.strike, damp: event.damp, sounding: event.sounding,
    })));
  }
  it('moves complete notes and linked lyrics to the next line without changing performance', () => {
    const { song, first, second, pattern, note } = fixture();
    const before = performance(song), bindings = JSON.stringify(song.sections.map(section => section.bindings));
    const originalNotes = JSON.stringify(pattern.lines.flatMap(line => line.slots));
    const lineIds = pattern.lines.map(line => line.id);
    expect(breakLineHere(song, 'verse', note.id)).toBe(true);
    expect(pattern.lines.map(line => line.slots.length)).toEqual([2, 4]);
    expect(pattern.lines.map(line => line.id)).toEqual(lineIds);
    expect(first.lines.map(line => line.tokens.map(token => token.text))).toEqual([['one', 'two'], ['three', 'four', 'five', 'six']]);
    expect(second.lines.map(line => line.tokens.map(token => token.text))).toEqual([['alpha', 'beta'], ['gam-', 'ma', 'delta', 'omega']]);
    expect(first.raw).toBe('one two\nthree four five six');
    expect(JSON.stringify(pattern.lines.flatMap(line => line.slots))).toBe(originalNotes);
    expect(JSON.stringify(song.sections.map(section => section.bindings))).toBe(bindings);
    expect(performance(song)).toEqual(before);
    expect(problems(song, false)).toEqual([]);
    expect(() => songSchema.parse(song)).not.toThrow();
  });
  it('creates a new final line while retaining unused notes and verse subdivisions', () => {
    const { song, pattern } = fixture(); const before = performance(song);
    breakLineHere(song, 'verse', pattern.lines[1].slots[1].id);
    expect(pattern.lines.map(line => line.slots.length)).toEqual([4, 1, 1]);
    expect(song.sections.map(section => section.lines.length)).toEqual([3, 3]);
    expect(song.sections[1].lines[2].tokens).toEqual([]);
    expect(performance(song)).toEqual(before);
    expect(problems(song, false)).toEqual([]);
  });
  it('preserves unfinished drafts and unrelated section types', () => {
    const { song, note } = fixture();
    const draft: Section = { id: id(), type: 'verse', stage: 'suggestions', raw: 'unfinished lyrics', suggestion: 'un- finished lyrics', lines: [], bindings: {} };
    const chorus: Section = { id: id(), type: 'chorus', stage: 'lyrics', raw: '', lines: [], bindings: {} };
    song.sections.push(draft, chorus); alignSection(song, chorus, 'other words');
    const drafts = JSON.stringify(draft), other = JSON.stringify([chorus, song.patterns[1]]);
    breakLineHere(song, 'verse', note.id);
    expect(JSON.stringify(draft)).toBe(drafts);
    expect(JSON.stringify([chorus, song.patterns[1]])).toBe(other);
  });
  it('does nothing at an existing line start and rejects invalid moves before mutating', () => {
    const { song, first, pattern, note } = fixture();
    const before = JSON.stringify(song);
    expect(breakLineHere(song, 'verse', pattern.lines[0].slots[0].id)).toBe(false);
    expect(JSON.stringify(song)).toBe(before);
    expect(() => breakLineHere(song, 'verse', id())).toThrow('not found');
    expect(JSON.stringify(song)).toBe(before);
    first.lines.pop(); const invalid = JSON.stringify(song);
    expect(() => breakLineHere(song, 'verse', note.id)).toThrow('Align every musical verse');
    expect(JSON.stringify(song)).toBe(invalid);
  });
  it('retains the new line layout through standalone HTML export and import', () => {
    const { song, note } = fixture();
    song.sections.forEach(section => { section.stage = 'done'; });
    breakLineHere(song, 'verse', note.id);
    expect(readDocument(exportHTML(song))).toEqual(song);
  });
});

describe('legacy compatibility', () => {
  for (const filename of filenames) {
    it(`imports and round-trips ${filename}`, () => {
      const source = JSON.parse(readFileSync(resolve(root, filename), 'utf8'));
      const song = importDocument(source);
      expect(problems(song)).toEqual([]);
      expect(readDocument(exportHTML(song))).toEqual(song);
    });
  }
  it('matches Python beats and barlines for every supplied score', () => {
    const script = `import json,sys\nimport build_ring_along as b\npath=sys.argv[1]\ndata=b.load_music(path)\nlyrics=data['lyrics']\nblocks=lyrics if isinstance(lyrics[0],dict) else [{'type':'verse'}]\nresult=[]\nfor block in blocks:\n b.configure_music(path,block['type'],block.get('word_overrides'))\n result.append([{'strike':sorted(s),'damp':sorted(d),'sounding':sorted(c),'beat':beat,'bar':i in b.MEASURE_ENDS} for i,(s,d,c,beat) in enumerate(zip(b.STRIKE,b.DAMP,b.CSETS,b.BEAT))])\nprint(json.dumps(result))`;
    for (const filename of filenames) {
      const song = importDocument(JSON.parse(readFileSync(resolve(root, filename), 'utf8')));
      const reference = JSON.parse(execFileSync('python', ['-c', script, filename], { cwd: root, encoding: 'utf8' }));
      const source = JSON.parse(readFileSync(resolve(root, filename), 'utf8'));
      const sections = typeof source.lyrics[0] === 'string' ? song.sections.slice(0, 1) : song.sections;
      // Strikes and damping intentionally differ from the legacy Python rules (wordless notes hold; full chords only on ringing beats).
      expect(sections.map(section => perform(song, section).map(event => ({ beat: event.beat, bar: event.boundaries.length > 0 }))), filename)
        .toEqual(reference.map((section: { beat: number; bar: boolean }[]) => section.map(({ beat, bar }) => ({ beat, bar }))));
    }
  });
  it('fits extra verse syllables without changing shared timing', () => {
    const song = importDocument(JSON.parse(readFileSync(resolve(root, filenames[0]), 'utf8')));
    const section: Section = { id: id(), type: 'verse', raw: '', stage: 'lyrics', lines: [], bindings: {} };
    song.sections.push(section);
    const text = song.sections[0].raw.split('\n').map(line => `${line} extra`).join('\n');
    alignSection(song, section, text); section.stage = 'done';
    expect(problems(song)).toEqual([]);
    const original = perform(song, song.sections[0]), extra = perform(song, section);
    expect(extra.at(-1)!.start.add(String(extra.at(-1)!.beats)).valueOf()).toBeCloseTo(original.at(-1)!.start.add(String(original.at(-1)!.beats)).valueOf(), 10);
  });
});