import { afterEach, describe, expect, it, vi } from 'vitest';
import { hymnNumber, hymnReference, loadHymnCatalog, matchingHymns, searchHymns, type HymnSource } from '../src/hymns';
import { importABC } from '../src/hymn-music';
import { problems, eventsFor } from '../src/music';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { abcEntryId, collectUnmappedCandidates, createHymnCatalogEntry, createUnnumberedCatalogEntry, firstLyricLine, hasExplicitPublicDomainNotice,
  isNumberedHymnMapping, parseAbcEntries, validateNumberedHymnMapping } from '../../scripts/hymn-catalog-lib.mjs';

describe('offline catalog refresh rules', () => {
  it('scans ABC entries and accepts only an explicit unambiguous public-domain notice', () => {
    const entries = parseAbcEntries('X:1\nT:Open\nC: copyright: public domain.\nK:C\nC|\n%%newpage\nX:2\nT:Restricted\nC: copyright: 2020 Publisher.\nK:C\nD|\nX:3\nT:Unknown\nK:C\nE|');
    expect(entries.map(abcEntryId)).toEqual(['1', '2', '3']);
    expect(entries.map(hasExplicitPublicDomainNotice)).toEqual([true, false, false]);
    expect(hasExplicitPublicDomainNotice('C: copyright: public domain.\nC: copyright: revised 2020.')).toBe(false);
  });
  it('generates catalog metadata from a verified number mapping and source edition', () => {
    expect(createHymnCatalogEntry({ hymnal: 'TFWS2000', number: '2212', reference: '1', title: 'Song', tune: 'TUNE',
      source: 'http://example.test/song.abc', sourceEdition: 'Open Hymnal, 2026' }, 'tfws-2212.abc', 'collection'))
      .toMatchObject({ id: 'tfws-2000-2212', hymnalName: 'The Faith We Sing (2000)', source: 'http://example.test/song.abc', rights: 'Public domain (United States)', sourceEdition: 'Open Hymnal, 2026' });
  });
  it('records unique public-domain candidates once and skips unmapped rows during catalog refresh', () => {
    const entries = parseAbcEntries('X:22\nT:Blessed Jesus at Thy Word\nC: copyright: public domain.\nK:C\nC|\nX:23\nT:Restricted\nC: copyright: 2020 Publisher.\nK:C\nD|\nX:24\nT:Ambiguous one\nC: copyright: public domain.\nK:C\nE|\nX:24\nT:Ambiguous two\nC: copyright: public domain.\nK:C\nF|');
    const mappings = [{ hymnal: 'UMH1989', number: '57', reference: '175' },
      { hymnal: 'unmapped', number: '', reference: '22', tune: '', title: 'Blessed Jesus at Thy Word' }];
    expect(collectUnmappedCandidates(entries, mappings)).toEqual([]);
    expect(isNumberedHymnMapping(mappings[1])).toBe(false);
    const found = collectUnmappedCandidates(entries, [{ hymnal: 'UMH1989', number: '57', reference: '175' }]);
    expect(found).toEqual([{ hymnal: 'unmapped', number: '', reference: '22', tune: '', title: 'Blessed Jesus at Thy Word' }]);
  });
  it('rejects numbered mappings missing fields required by the browser catalog', () => {
    expect(() => validateNumberedHymnMapping({ hymnal: 'UMH1989', number: '218', reference: '60',
      title: 'It Came Upon A Midnight Clear', tune: '' })).not.toThrow();
    expect(() => validateNumberedHymnMapping({ hymnal: 'UMH1989', number: '218', reference: '60',
      title: '', tune: 'CAROL' })).toThrow('missing hymn title');
    expect(createHymnCatalogEntry({ hymnal: 'UMH1989', number: '218', reference: '60', title: 'Song' }, 'umh-218.abc', 'collection').tune).toBe('');
    expect(() => validateNumberedHymnMapping({ hymnal: 'unmapped', number: '', reference: '60',
      title: 'Candidate', tune: '' })).not.toThrow();
  });
});

describe('hymn number lookup', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('accepts either hymnal with optional explicit book prefixes', () => {
    expect(hymnNumber(' 378 ')).toBe('378');
    expect(hymnNumber('UMH 057')).toBe('57');
    expect(hymnNumber('2175')).toBe('2175');
    expect(hymnNumber('TFWS 2175')).toBe('2175');
    expect(hymnNumber('FWS 2284')).toBe('2284');
    expect(hymnReference('2175')).toMatchObject({ hymnal: 'TFWS2000', abbreviation: 'TFWS' });
  });
  it('rejects invalid numbers and other hymnal identifiers', () => {
    for (const value of ['', '0', '963', '2000', '2285', 'UMH 2175', 'UMH 12<script>', 'TFWS 378', '378.5']) {
      expect(() => hymnNumber(value)).toThrow('United Methodist Hymnal');
    }
  });
  it('returns all matches so the user can choose the hymnal or setting', () => {
    const catalog = [{ number: '378', id: 'one' }, { number: '378', id: 'two' }, { number: '57', id: 'three' }] as HymnSource[];
    expect(matchingHymns(catalog, '378').map(entry => entry.id)).toEqual(['one', 'two']);
  });
  it('searches titles, tunes and first lines by keyword, and numbers only for registered hymns', () => {
    const catalog = [
      { id: 'a', number: '378', hymnal: 'UMH1989', title: 'Amazing Grace', tune: 'NEW BRITAIN', firstLine: 'Amazing grace! How sweet the sound' },
      { id: 'b', number: '', hymnal: 'OH', title: 'Come, Thou Fount', tune: '', firstLine: 'Come, thou fount of every blessing' },
      { id: 'c', number: '57', hymnal: 'UMH1989', title: 'O For a Thousand Tongues to Sing', tune: 'AZMON', firstLine: '' },
    ] as HymnSource[];
    expect(searchHymns(catalog, '').map(entry => entry.id)).toEqual(['a', 'b', 'c']);
    expect(searchHymns(catalog, 'fount blessing').map(entry => entry.id)).toEqual(['b']);
    expect(searchHymns(catalog, 'AZMON').map(entry => entry.id)).toEqual(['c']);
    expect(searchHymns(catalog, '378').map(entry => entry.id)).toEqual(['a']);
    expect(searchHymns(catalog, 'UMH 57').map(entry => entry.id)).toEqual(['c']);
    expect(searchHymns(catalog, '999')).toEqual([]);
    expect(searchHymns(catalog, '12')).toEqual([]);
  });
  it('rebuilds the first sung line from hyphenated ABC lyrics and lists unnumbered hymns by title', () => {
    expect(firstLyricLine('K:C\nw: 1.~A- maz- ing * grace! How sweet')).toBe('Amazing grace! How sweet');
    expect(firstLyricLine('K:C')).toBe('');
    expect(createUnnumberedCatalogEntry({ reference: '22', title: 'Blessed Jesus' }, 'w: Bless- ed Je- sus', 'oh-22.abc', 'http://example.test/all.abc'))
      .toMatchObject({ id: 'oh-22', hymnal: 'OH', number: '', tune: '', file: 'oh-22.abc', firstLine: 'Blessed Jesus' });
  });
  it('uses an explicit hymnal prefix to filter source choices', () => {
    const catalog = [{ number: '2175', id: 'tfws', hymnal: 'TFWS2000' }, { number: '2175', id: 'other', hymnal: 'OTHER' }] as HymnSource[];
    expect(matchingHymns(catalog, 'TFWS 2175').map(entry => entry.id)).toEqual(['tfws']);
  });
  it('rejects unsafe catalog paths and non-reviewed rights claims', async () => {
    const catalog = JSON.parse(readFileSync(resolve(import.meta.dirname, '../public/hymns/catalog.json'), 'utf8'));
    for (const invalid of [{ ...catalog[0], file: '../secret.abc' }, { ...catalog[0], rights: 'Unknown' }]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([invalid]))));
      await expect(loadHymnCatalog()).rejects.toThrow('catalog could not be loaded');
    }
  });
  it('fetches the catalog without sending browser cookies', async () => {
    const catalog = readFileSync(resolve(import.meta.dirname, '../public/hymns/catalog.json'), 'utf8');
    const fetcher = vi.fn(async () => new Response(catalog)); vi.stubGlobal('fetch', fetcher);
    await expect(loadHymnCatalog()).resolves.toHaveLength(JSON.parse(catalog).length);
    expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ credentials: 'omit' }));
  });
});

describe('reviewed public-domain music imports', () => {
  const folder = resolve(import.meta.dirname, '../public/hymns');
  const catalog: HymnSource[] = JSON.parse(readFileSync(resolve(folder, 'catalog.json'), 'utf8'));
  for (const source of catalog.filter(entry => entry.hymnal !== 'OH')) it(`loads ${source.hymnal} ${source.number} with real notes and aligned lyrics`, () => {
    const song = importABC(readFileSync(resolve(folder, source.file), 'utf8'), source);
    expect(song.title).toBe(source.title); expect(song.hymnNumber).toBe(source.number);
    expect(song.sections.length).toBeGreaterThan(0);
    expect(song.patterns[0].lines.flatMap(line => line.slots).length).toBeGreaterThan(10);
    expect(problems(song, false)).toEqual([]);
    expect(song.credit).toContain('public domain');
    expect(song.extensions.webSource).toMatchObject({ harmony: expect.stringContaining('inferred') });
  });
  it('imports most unnumbered Open Hymnal scores and fails the rest with a message instead of bad music', () => {
    const unnumbered = catalog.filter(entry => entry.hymnal === 'OH');
    let loaded = 0;
    for (const source of unnumbered) {
      try {
        const song = importABC(readFileSync(resolve(folder, source.file), 'utf8'), source);
        expect(problems(song, false)).toEqual([]);
        loaded++;
      } catch (error) { expect((error as Error).message).toBeTruthy(); }
    }
    expect(loaded).toBeGreaterThan(unnumbered.length * 0.9);
  });
  it('imports Amazing Grace in 3/4 with a one-beat pickup and source melody', () => {
    const source = catalog.find(entry => entry.number === '378')!;
    const song = importABC(readFileSync(resolve(folder, source.file), 'utf8'), source);
    expect(song.key).toBe('G major'); expect(song.time).toEqual([3, 4]); expect(song.pickup).toBe(1);
    expect(song.patterns[0].lines[0].slots.slice(0, 4).map(slot => slot.melody)).toEqual(['D4', 'G4', 'B4', 'G4']);
    expect(eventsFor(song, song.sections[0]).slice(0, 4).map(event => event.beats)).toEqual([1, 2, 0.5, 0.5]);
    expect(song.sections[0].raw).toMatch(/^A- maz- ing/);
    expect(song.sections.some(section => section.stage === 'lyrics')).toBe(true);
  });
  it('rejects sources without an explicit public-domain notice', () => {
    expect(() => importABC('X:1\nT:Unknown\nK:C\nC|', catalog[0])).toThrow('public-domain notice');
  });
});