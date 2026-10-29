export const OPEN_HYMNAL_COLLECTION_URL = 'http://openhymnal.org/OpenHymnal2014.06.abc';

export function parseAbcEntries(text) {
  return text.split(/\r?\n(?=X:\s*\S)/).map(entry => entry.split(/\r?\n%%newpage/)[0].trim() + '\n')
    .filter(entry => /^X:\s*\S+/m.test(entry));
}

export function abcEntryId(entry) {
  return /^X:\s*(\S+)/m.exec(entry)?.[1];
}

export function hasExplicitPublicDomainNotice(entry) {
  const notices = [...entry.matchAll(/^C:\s*copyright:\s*(.+)$/gim)].map(match => match[1].trim());
  return notices.length > 0 && notices.every(notice => /^public domain\b/i.test(notice));
}

export function isNumberedHymnMapping(mapping) {
  return mapping.hymnal !== 'unmapped' && typeof mapping.number === 'string' && mapping.number.trim() !== '';
}

export function validateNumberedHymnMapping(mapping) {
  if (mapping.hymnal === 'unmapped' && mapping.number === '') return;
  const label = `${mapping.hymnal || 'unknown'} ${mapping.number || '(missing number)'}`;
  if (!['UMH1989', 'TFWS2000'].includes(mapping.hymnal)) throw new Error(`${label}: unsupported hymnal.`);
  if (typeof mapping.number !== 'string' || !/^\d{1,4}$/.test(mapping.number)) throw new Error(`${label}: invalid hymn number.`);
  if (typeof mapping.reference !== 'string' || !/^\d+$/.test(mapping.reference)) throw new Error(`${label}: invalid Open Hymnal source reference.`);
  if (typeof mapping.title !== 'string' || !mapping.title.trim()) throw new Error(`${label}: missing hymn title.`);
  // The tune is only a display label in the picker, so a blank one is allowed.
  if (mapping.tune !== undefined && typeof mapping.tune !== 'string') throw new Error(`${label}: invalid tune.`);
}

export function collectUnmappedCandidates(entries, mappings) {
  const knownReferences = new Set(mappings.filter(mapping => !mapping.source).map(mapping => String(mapping.reference)));
  const entriesById = new Map();
  for (const entry of entries) {
    const id = abcEntryId(entry);
    entriesById.set(id, [...(entriesById.get(id) || []), entry]);
  }
  return [...entriesById].flatMap(([id, matches]) => {
    if (knownReferences.has(id) || matches.length !== 1 || !hasExplicitPublicDomainNotice(matches[0])) return [];
    return [{ hymnal: 'unmapped', number: '', reference: id, tune: '',
      title: /^T:\s*(.+)$/m.exec(matches[0])?.[1]?.trim() || `Open Hymnal score ${id}` }];
  });
}

// First sung line of the first verse, rejoined from the hyphenated ABC syllables.
export function firstLyricLine(abc) {
  const line = /^w:\s*(.+)$/m.exec(abc)?.[1] ?? '';
  return line.replace(/^\s*\d+\.[\s~]*/, '').replace(/[-_]\s+/g, '').replace(/[*|~]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function createUnnumberedCatalogEntry(mapping, abc, file, source) {
  return {
    id: `oh-${mapping.reference}`,
    hymnal: 'OH',
    hymnalName: 'Open Hymnal (no hymnal number)',
    number: '',
    title: mapping.title,
    tune: mapping.tune ?? '',
    file,
    source,
    rights: 'Public domain (United States)',
    sourceEdition: 'Open Hymnal, June 2014',
    reference: String(mapping.reference),
    firstLine: firstLyricLine(abc),
  };
}

export function createHymnCatalogEntry(mapping, file, source, abc = '') {
  const tfws = mapping.hymnal === 'TFWS2000';
  return {
    id: `${tfws ? 'tfws-2000' : 'umh-1989'}-${mapping.number}`,
    hymnal: mapping.hymnal,
    hymnalName: tfws ? 'The Faith We Sing (2000)' : 'The United Methodist Hymnal (1989)',
    number: mapping.number,
    title: mapping.title,
    tune: mapping.tune ?? '',
    file,
    source: mapping.source || source,
    rights: 'Public domain (United States)',
    sourceEdition: mapping.sourceEdition || 'Open Hymnal, June 2014',
    reference: mapping.reference,
    firstLine: firstLyricLine(abc),
  };
}