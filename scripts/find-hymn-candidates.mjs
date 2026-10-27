import { readFile, writeFile } from 'node:fs/promises';
import { abcEntryId, collectUnmappedCandidates, OPEN_HYMNAL_COLLECTION_URL, parseAbcEntries } from './hymn-catalog-lib.mjs';

const mappingsURL = new URL('./hymn-number-mappings.json', import.meta.url);
const mappings = JSON.parse(await readFile(mappingsURL, 'utf8'));
let backfilledTunes = 0;
for (const mapping of mappings) {
  if (mapping.hymnal === 'unmapped' && mapping.number === '' && !Object.hasOwn(mapping, 'tune')) {
    mapping.tune = '';
    backfilledTunes++;
  }
}
const response = await fetch(OPEN_HYMNAL_COLLECTION_URL, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Open Hymnal download failed: ${response.status}`);
const text = new TextDecoder('windows-1252').decode(await response.arrayBuffer());
const entries = parseAbcEntries(text);
const candidates = collectUnmappedCandidates(entries, mappings);

if (candidates.length || backfilledTunes) {
  mappings.push(...candidates);
  await writeFile(mappingsURL, JSON.stringify(mappings, null, 2) + '\n', 'utf8');
}
console.log(`Found ${candidates.length} new, unique public-domain candidates.`);
for (const candidate of candidates) console.log(`Unmapped X:${abcEntryId(entries.find(entry => abcEntryId(entry) === candidate.reference))}\t${candidate.title}`);
console.log(`Added ${candidates.length} rows and backfilled ${backfilledTunes} blank tune values in scripts/hymn-number-mappings.json. The catalog was not refreshed.`);