import { describe, expect, it } from 'vitest';
import { alignSection, newSection, newSong, splitSection, type Song } from '../src/document';
import { problems } from '../src/music';

// Verse 1 sings the verse and the chorus; verse 2 sings only the verse.
function angels(): Song {
  const song = newSong();
  Object.assign(song, { title: 'Angels', key: 'C major' });
  const first = newSection(song, 'verse'); song.sections.push(first);
  alignSection(song, first, 'Angels we have heard\nGlo ri a in ex cel sis De o');
  const second = newSection(song, 'verse'); song.sections.push(second);
  alignSection(song, second, 'Shepherds why this jubilee');
  return song;
}

describe('splitSection', () => {
  it('moves the notes after the split into a new section type and drops them from other verses', () => {
    const song = angels();
    const pattern = song.patterns[0];
    const noteId = pattern.lines[1].slots[0].id;
    const moved = pattern.lines[1].slots.map(note => note.id);
    const created = splitSection(song, 'verse', noteId, 'chorus', song.sections[0].id);
    expect(created.map(section => section.name)).toEqual(['Chorus 1']);
    expect(song.sections.map(section => section.name)).toEqual(['Verse 1', 'Chorus 1', 'Verse 2']);
    expect(song.patterns.map(item => [item.type, item.lines.length])).toEqual([['verse', 1], ['chorus', 1]]);
    expect(song.patterns[1].lines[0].slots.map(note => note.id)).toEqual(moved);
    expect(song.sections[0].raw).toBe('Angels we have heard');
    expect(song.sections[1].raw).toBe('Glo ri a in ex cel sis De o');
    expect(Object.keys(song.sections[1].bindings)).toEqual(moved);
    for (const id of moved) expect(song.sections[2].bindings[id]).toBeUndefined();
    expect(song.sections[2].raw).toBe('Shepherds why this jubilee');
    expect(problems(song, false)).toEqual([]);
  });

  it('can split in the middle of a line', () => {
    const song = angels();
    const slots = song.patterns[0].lines[0].slots;
    const created = splitSection(song, 'verse', slots[2].id, 'bridge', song.sections[0].id);
    expect(created[0].raw).toBe('have heard\nGlo ri a in ex cel sis De o');
    expect(song.sections[0].raw).toBe('Angels we');
    expect(song.patterns.map(item => [item.type, item.lines.map(line => line.slots.length)])).toEqual([['verse', [2]], ['bridge', [2, 9]]]);
    expect(problems(song, false)).toEqual([]);
  });

  it('refuses to split at the first note or into a section type that already exists', () => {
    const song = angels();
    expect(() => splitSection(song, 'verse', song.patterns[0].lines[0].slots[0].id, 'chorus', song.sections[0].id)).toThrow('nothing behind');
    expect(() => splitSection(song, 'verse', song.patterns[0].lines[1].slots[0].id, 'verse', song.sections[0].id)).toThrow('already exists');
    expect(song.patterns).toHaveLength(1);
    expect(song.sections).toHaveLength(2);
  });
});
