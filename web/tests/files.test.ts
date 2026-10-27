import { afterEach, describe, expect, it, vi } from 'vitest';
import { alignSection, id, newSong, type Section } from '../src/document';
import { downloadSong, exportHTML, readDocument } from '../src/files';
import { bindScore, scoreMarkup } from '../src/render';
import { combinedPairs, perform, problems, resolveBell } from '../src/music';

function fixture() {
  const song = newSong(); song.title = 'Round trip'; song.key = 'C major';
  const section: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
  song.sections.push(section); alignSection(song, section, 'Test words here now'); section.stage = 'done';
  return song;
}
describe('standalone files', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('round-trips the entire source document', () => {
    const song = fixture(); expect(readDocument(exportHTML(song))).toEqual(song);
  });
  it('exports valid music while its editor is open, without requiring Done on every section', () => {
    const song = fixture();
    const second: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
    song.sections.push(second); alignSection(song, second, 'Other words here now');
    expect(second.stage).toBe('music');
    expect(readDocument(exportHTML(song))).toEqual(song);
    expect(second.stage).toBe('music');
  });
  it('identifies the specific unmapped verse rather than blaming a completed verse', () => {
    const song = fixture();
    const draft: Section = { id: id(), type: 'verse', number: 6, name: 'Verse 6', stage: 'lyrics', raw: 'Unmapped words', lines: [], bindings: {} };
    song.sections.push(draft);
    expect(() => exportHTML(song)).toThrow('Verse 6: lyrics have not been mapped to music.');
    expect(() => exportHTML(song)).not.toThrow('choose Done');
    expect(song.sections[0].stage).toBe('done');
    draft.stage = 'suggestions';
    expect(() => exportHTML(song)).toThrow('confirm the syllable breaks');
  });
  it('escapes hostile titles, lyrics, and script endings', () => {
    const song = fixture(); song.title = '</script><img src=x onerror=alert(1)>';
    song.sections[0].lines[0].tokens[0].text = '<script>alert(1)</script>';
    const html = exportHTML(song);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('script')).toHaveLength(2); expect(doc.querySelector('img')).toBeNull();
    expect(readDocument(html)).toEqual(song);
  });
  it('selects conductor first and switches parts', () => {
    document.body.innerHTML = exportHTML(fixture()).split('<body>')[1].split('<script')[0];
    const root = document.querySelector<HTMLElement>('.score-root')!; bindScore(root);
    expect(root.querySelector('[aria-selected=true]')?.textContent).toBe('Conductor');
    root.querySelector<HTMLButtonElement>('[data-score-tab="1"]')!.click();
    expect(root.querySelector<HTMLElement>('[data-score-panel="1"]')!.hidden).toBe(false);
  });
  it('renders bell parts as boxed and underlined lyrics without conductor notation', () => {
    const song = fixture();
    song.patterns[0].lines[0].slots.forEach((slot, index) => {
      slot.melody = index % 2 ? 'Eb4' : 'F4'; slot.chord = index % 2 ? 'Eb' : 'F';
    });
    const doc = new DOMParser().parseFromString(scoreMarkup(song), 'text/html');
    const player = doc.querySelector(`[data-score-panel="${song.bells.indexOf('F4') + 1}"]`)!;
    expect([...player.querySelectorAll('.score-lyric-strike')].map(word => word.textContent)).toEqual(['Test', 'here']);
    expect([...player.querySelectorAll('.score-lyric-damp')].map(word => word.textContent)).toEqual(['words', 'now']);
    expect(player.querySelectorAll('.score-lyrics')).toHaveLength(1);
    expect(player.querySelector('.score-cell, .measure-end, .score-crossing, .score-duration, .score-chord, .score-melody, .score-action')).toBeNull();
    const inactive = doc.querySelector(`[data-score-panel="${song.bells.indexOf('D5') + 1}"]`)!;
    expect(inactive.querySelectorAll('.score-lyric')).toHaveLength(4);
    expect(inactive.querySelector('.score-lyric-strike, .score-lyric-damp')).toBeNull();
    const conductor = doc.querySelector('[data-score-panel="0"]')!;
    expect(conductor.querySelectorAll('.score-verse-row .score-word')).toHaveLength(4);
    expect(conductor.querySelector('.score-chord')).not.toBeNull();
    expect(conductor.querySelector('.score-duration, .score-melody, .score-damps')).toBeNull();
    expect(conductor.querySelector('.measure-end')).not.toBeNull();
  });
  it('uses large pitch-only player headings with hymn number, title and parenthesized key', () => {
    const song = fixture(); song.hymnNumber = '378'; song.title = 'Amazing Grace'; song.key = 'G major';
    const doc = new DOMParser().parseFromString(scoreMarkup(song), 'text/html');
    const player = doc.querySelector('[data-score-panel="1"]')!;
    expect(player.querySelector('.score-player-note')?.textContent).toBe('Eb4');
    expect(player.querySelector('.score-player-title')?.textContent).toBe('378 Amazing Grace (G major)');
    expect(player.textContent).toContain('Eb4');
    const tab = doc.querySelector('[data-score-tab="1"]')!;
    expect(tab.textContent).toBe('Eb4'); expect(tab.getAttribute('aria-label')).toBe('Eb4');
    expect(player.querySelector('.score-player-note')?.getAttribute('style')).toContain('var(--pitch-3)');
    expect(doc.querySelector('[data-score-panel="0"] .score-bell')?.textContent).toMatch(/\d/);
  });
  it('escapes player-heading metadata and keeps optional hymn numbers out when absent', () => {
    const song = fixture(); song.title = '<img src=x onerror=alert(1)>';
    const doc = new DOMParser().parseFromString(scoreMarkup(song), 'text/html');
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.querySelector('.score-player-title')?.textContent).toBe('<img src=x onerror=alert(1)> (C major)');
  });
  it('combines octave duplicates in chord-mode sheets and includes exact octaves in melody-mode sheets', () => {
    const song = fixture(); song.bells = ['C4', 'C5', 'E4', 'G4']; song.recommended = [...song.bells];
    song.patterns[0].lines[0].slots.forEach(note => { note.melody = 'C5'; note.chord = 'C'; });
    song.ringMelody = false;
    let doc = new DOMParser().parseFromString(exportHTML(song), 'text/html');
    expect(doc.querySelectorAll('.score-panel')).toHaveLength(4);
    expect([...doc.querySelectorAll('.score-player-note')].map(note => note.textContent)).toEqual(['C', 'E', 'G']);
    for (const note of doc.querySelectorAll('.score-player-note, .score-bell, .score-count-note, .score-tabs button')) expect(note.textContent).not.toMatch(/[A-G][#b]?\d/);
    song.ringMelody = true;
    doc = new DOMParser().parseFromString(exportHTML(song), 'text/html');
    expect(doc.querySelectorAll('.score-panel')).toHaveLength(5);
    expect([...doc.querySelectorAll('.score-player-note')].map(note => note.textContent)).toEqual(['C4', 'E4', 'G4', 'C5']);
  });
  it('uses filled strike markers and hollow sustained bell markers without damping or note icons', () => {
    const song = fixture(); song.strong = [1];
    song.patterns[0].lines[0].slots.forEach(slot => { slot.melody = 'F4'; slot.chord = 'F'; });
    const doc = new DOMParser().parseFromString(scoreMarkup(song), 'text/html');
    const conductor = doc.querySelector('[data-score-panel="0"]')!;
    expect(conductor.querySelectorAll('.score-bell-strike').length).toBeGreaterThan(0);
    expect(conductor.querySelectorAll('.score-bell-sustain').length).toBeGreaterThan(0);
    expect(conductor.querySelector('.score-duration, .score-melody, .score-damps')).toBeNull();
    expect(conductor.textContent).not.toMatch(/[\u{1d15d}-\u{1d160}\u2669\u266a]/u);
    const markers = conductor.querySelectorAll('.score-bell-row td')[2];
    expect(markers.querySelector('[aria-label="F4: strike"]')).not.toBeNull();
    expect(markers.querySelector('[aria-label="A4: sustain"]')).not.toBeNull();
  });
  it('resolves combined bells, keeping the chosen order and rejecting unavailable bells', () => {
    const song = fixture();
    expect(resolveBell(song, 'A4')).toBe('A4');
    expect(resolveBell(song, 'A')).toBe('A4');
    expect(resolveBell(song, 'A5')).toBeUndefined();
    song.combined = [['A4', 'F4']];
    expect(combinedPairs(song)).toEqual([['A4', 'F4']]);
    expect(problems(song)).toEqual([]);
    song.combined = [['F4', 'B4']];
    expect(problems(song).join(' ')).toContain('B4 is not an available bell');
    expect(readDocument(exportHTML({ ...song, combined: [['F4', 'A4']] })).combined).toEqual([['F4', 'A4']]);
  });
  it('keeps the chosen bell order on a combined sheet, even when the first bell is higher', () => {
    const song = fixture(); song.strong = [1]; song.combined = [['A4', 'F4']];
    song.patterns[0].lines[0].slots.forEach(slot => { slot.melody = 'F4'; slot.chord = 'F'; });
    const sheet = [...new DOMParser().parseFromString(scoreMarkup(song), 'text/html').querySelectorAll('.score-panel')].pop()!;
    expect(sheet.getAttribute('aria-label')).toBe('A4 + F4');
    expect([...sheet.querySelectorAll('.score-player-heading .score-player-note')].map(note => note.textContent)).toEqual(['A4', 'F4']);
    const item = sheet.querySelector('.score-combo-item')!;
    expect([...item.querySelectorAll('.score-combo-names small')].map(name => name.textContent)).toEqual(['A4', 'F4']);
    expect([...item.querySelectorAll('.score-combo-box')].map(box => box.getAttribute('style'))).toEqual(['--mark:var(--pitch-9)', '--mark:var(--pitch-5)']);
  });
  it('adds one sheet per combined pair with nested strike boxes and stacked damp marks', () => {
    const song = fixture(); song.strong = [1]; song.combined = [['F4', 'A4']];
    const slots = song.patterns[0].lines[0].slots;
    slots.forEach(slot => { slot.melody = 'F4'; slot.chord = 'F'; });
    slots[1].chord = 'G'; slots[1].melody = 'G4';
    const doc = new DOMParser().parseFromString(scoreMarkup(song), 'text/html');
    const panels = doc.querySelectorAll('.score-panel');
    expect(panels).toHaveLength(1 + song.bells.length + 1);
    const sheet = panels[panels.length - 1];
    expect(sheet.getAttribute('aria-label')).toBe('F4 + A4');
    expect([...sheet.querySelectorAll('.score-player-heading .score-player-note')].map(note => note.textContent)).toEqual(['F4', 'A4']);
    const [first, second] = sheet.querySelectorAll('.score-combo-item');
    expect([...first.querySelectorAll('.score-combo-names small')].map(name => name.textContent)).toEqual(['F4', 'A4']);
    const [outer, inner] = first.querySelectorAll('.score-combo-box');
    expect([outer.getAttribute('style'), inner.getAttribute('style')]).toEqual(['--mark:var(--pitch-5)', '--mark:var(--pitch-9)']);
    expect(outer.contains(inner)).toBe(true);
    expect(first.querySelectorAll('.score-combo-damps i')).toHaveLength(0);
    expect([...second.querySelectorAll('.score-combo-damps i')].map(mark => mark.getAttribute('style'))).toEqual(['--mark:var(--pitch-9)', '--mark:var(--pitch-5)']);
    expect(second.querySelectorAll('.score-combo-names small')).toHaveLength(0);
  });
  it('combines section types into stacked lyric rows and counts every performed strike', () => {
    const song = fixture(); song.patterns = [];
    alignSection(song, song.sections[0], 'Test words\nhere now'); song.sections[0].stage = 'done';
    const second: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
    const chorus: Section = { id: id(), type: 'chorus', stage: 'lyrics', raw: '', lines: [], bindings: {} };
    song.sections.push(chorus, second);
    alignSection(song, chorus, 'Chorus words'); chorus.stage = 'done';
    alignSection(song, second, 'More text\nother ending'); second.stage = 'done';
    const doc = new DOMParser().parseFromString(scoreMarkup(song), 'text/html');
    const conductor = doc.querySelector('[data-score-panel="0"]')!;
    expect([...conductor.querySelectorAll('.score-section h4')].map(heading => heading.textContent)).toEqual(['verse', 'chorus']);
    const lines = conductor.querySelector('.score-conductor-section')!.querySelectorAll('.score-line');
    expect(lines).toHaveLength(2);
    expect([...lines[0].querySelectorAll('.score-verse-row')].map(row => row.textContent)).toEqual(['1.Testwords', '2.Moretext']);
    expect([...lines[1].querySelectorAll('.score-verse-row')].map(row => row.textContent)).toEqual(['herenow', 'otherending']);
    expect([...lines[0].querySelectorAll('tr')].map(row => row.className)).toEqual(['score-chord-row', 'score-verse-row', 'score-verse-row', 'score-bell-row']);
    expect(conductor.querySelector('.score-recommended')).toBeNull();
    expect(conductor.textContent).not.toContain('Bells:');
    expect(conductor.querySelectorAll('.score-count-item')).toHaveLength(song.bells.length);
    for (const bell of song.bells) {
      const expected = song.sections.flatMap(section => perform(song, section)).filter(event => event.strike.includes(bell)).length;
      expect(conductor.querySelector(`.score-count-item[data-bell="${bell}"] .score-play-count-label`)?.textContent).toBe(`${expected} ${expected === 1 ? 'play' : 'plays'}`);
      expect(conductor.querySelector(`.score-count-item[data-bell="${bell}"] .score-count-note`)?.textContent).toBe(bell);
    }
    const player = doc.querySelector('[data-score-panel="1"]')!;
    expect([...player.querySelectorAll('.score-section h4')].map(heading => heading.textContent)).toEqual(['Verse 1', 'Chorus 1', 'Verse 2']);
  });
  it('aligns verse subdivisions and labels differing music within the same combined block', () => {
    const song = fixture();
    const second: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
    song.sections.push(second); alignSection(song, second, 'More words here extra syllables'); second.stage = 'done';
    const last = song.patterns[0].lines[0].slots.at(-1)!;
    second.bindings[last.id][0].chord = 'F';
    const doc = new DOMParser().parseFromString(scoreMarkup(song), 'text/html');
    const conductor = doc.querySelector('[data-score-panel="0"]')!;
    expect(conductor.querySelectorAll('.score-conductor-section')).toHaveLength(1);
    expect(conductor.querySelector('.score-verse-row .score-word[colspan="2"]')).not.toBeNull();
    expect(conductor.querySelectorAll('.score-variant-number').length).toBeGreaterThan(0);
    expect(conductor.querySelectorAll('.score-verse-row')).toHaveLength(2);
    expect(readDocument(exportHTML(song))).toEqual(song);
  });
  it('keeps decimal verse labels compact and reserves space for custom labels in print', () => {
    const song = fixture();
    song.sections[0].name = 'Verse 3.5';
    const second: Section = { id: id(), type: 'verse', number: 4, name: 'Final blessing', stage: 'lyrics', raw: '', lines: [], bindings: {} };
    song.sections.push(second); alignSection(song, second, 'Other words here now'); second.stage = 'done';
    const doc = new DOMParser().parseFromString(exportHTML(song), 'text/html');
    const conductor = doc.querySelector('[data-score-panel="0"]')!;
    expect([...conductor.querySelectorAll('.score-verse-number')].map(label => label.textContent)).toEqual(['3.5', 'Final blessing']);
    expect(conductor.querySelector('.score-number-column')?.getAttribute('style')).toBe('width:94px');
  });
  it('aligns thirds exactly and does not create spurious columns at shared note endings', () => {
    const song = fixture();
    const second: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
    song.sections.push(second); alignSection(song, second, 'More words here three extra syllables'); second.stage = 'done';
    const doc = new DOMParser().parseFromString(scoreMarkup(song), 'text/html');
    const conductor = doc.querySelector('[data-score-panel="0"]')!;
    expect(conductor.querySelectorAll('.score-chord-row td')).toHaveLength(7);
    expect(conductor.querySelector('.score-verse-row .score-word[colspan="3"]')?.textContent).toBe('now');
  });
  it('shows a held bell hollow after a crossed measure without counting an extra strike', () => {
    const song = fixture(); song.patterns[0].lines[0].slots[0].beats = 5;
    const doc = new DOMParser().parseFromString(scoreMarkup(song), 'text/html');
    const conductor = doc.querySelector('[data-score-panel="0"]')!;
    const cells = conductor.querySelectorAll('.score-bell-cell');
    expect(cells[0].querySelector('.score-bell-strike')).not.toBeNull();
    expect(cells[1].querySelector('.score-bell-strike')).toBeNull();
    expect(cells[1].querySelector('.score-bell-sustain')).not.toBeNull();
    expect(conductor.querySelector('.score-chord-row .measure-end')).not.toBeNull();
    for (const bell of song.bells) {
      const expected = perform(song, song.sections[0]).filter(event => event.strike.includes(bell)).length;
      expect(conductor.querySelector(`.score-count-item[data-bell="${bell}"] .score-play-count-label`)?.textContent).toBe(`${expected} ${expected === 1 ? 'play' : 'plays'}`);
    }
  });
  it('keeps player lyric lines and breath marks without boxing wordless notes', () => {
    const song = fixture();
    song.patterns = [];
    alignSection(song, song.sections[0], 'Test words\nhere now'); song.sections[0].stage = 'done';
    const slot = song.patterns[0].lines[0].slots[1]; slot.breath_after = true;
    const binding = song.sections[0].bindings[slot.id][0]; delete binding.tokenId; binding.kind = 'continue';
    song.sections[0].lines[0].tokens.pop();
    const doc = new DOMParser().parseFromString(scoreMarkup(song), 'text/html');
    const player = doc.querySelector('[data-score-panel="1"]')!;
    expect(player.querySelectorAll('.score-lyrics')).toHaveLength(2);
    expect(player.querySelector('.score-breath')?.textContent).toBe('\u2016');
    expect([...player.querySelectorAll('.score-lyric-strike')].every(word => Boolean(word.textContent))).toBe(true);
  });
  it('rejects old HTML and invalid future schemas without executing them', () => {
    expect(() => readDocument('<script>throw 1</script>')).toThrow('source definition');
    expect(() => readDocument(JSON.stringify({ ...fixture(), version: 99 }))).toThrow();
  });
  it('rejects attribute injection through imported identifiers', () => {
    const song = fixture(); song.sections[0].id = '\" onclick=\"alert(1)';
    expect(() => readDocument(JSON.stringify(song))).toThrow();
  });
  it('saves through the native picker when available', async () => {
    const write = vi.fn(), close = vi.fn();
    const picker = vi.fn(async () => ({ createWritable: async () => ({ write, close }) }));
    vi.stubGlobal('showSaveFilePicker', picker);
    expect(await downloadSong(fixture())).toBe(true);
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'Round trip.html' }));
    expect(write).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  });
  it('leaves editing untouched when the native save dialog is cancelled', async () => {
    vi.stubGlobal('showSaveFilePicker', async () => { throw new DOMException('Cancelled', 'AbortError'); });
    expect(await downloadSong(fixture())).toBe(false);
  });
});