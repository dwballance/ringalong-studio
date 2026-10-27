import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { abcEntryId, createHymnCatalogEntry, hasExplicitPublicDomainNotice, isNumberedHymnMapping, OPEN_HYMNAL_COLLECTION_URL, parseAbcEntries, validateNumberedHymnMapping } from './hymn-catalog-lib.mjs';

const mappingsURL = new URL('./hymn-number-mappings.json', import.meta.url);
const mappings = JSON.parse(await readFile(mappingsURL, 'utf8'));
for (const mapping of mappings) validateNumberedHymnMapping(mapping);
const response = await fetch(OPEN_HYMNAL_COLLECTION_URL, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Open Hymnal download failed: ${response.status}`);
const text = new TextDecoder('windows-1252').decode(await response.arrayBuffer());
const entries = parseAbcEntries(text);
const scoresById = new Map();
for (const entry of entries) {
  const id = abcEntryId(entry);
  scoresById.set(id, [...(scoresById.get(id) || []), entry]);
}
const output = fileURLToPath(new URL('../web/public/hymns/', import.meta.url));
const catalog = [];
const files = [];
const excluded = [];
const pdCandidates = entries.filter(hasExplicitPublicDomainNotice);
for (const mapping of mappings) {
  if (!isNumberedHymnMapping(mapping)) continue;
  let entry;
  let source = OPEN_HYMNAL_COLLECTION_URL;
  if (mapping.source) {
    const sourceResponse = await fetch(mapping.source, { signal: AbortSignal.timeout(30000) });
    if (!sourceResponse.ok) throw new Error(`Open Hymnal download failed: ${sourceResponse.status}`);
    entry = new TextDecoder('windows-1252').decode(await sourceResponse.arrayBuffer());
    source = mapping.source;
  } else {
    const matches = scoresById.get(String(mapping.reference)) || [];
    if (matches.length > 1) throw new Error(`Mapped source X:${mapping.reference} is ambiguous for ${mapping.hymnal} ${mapping.number}`);
    entry = matches[0];
  }
  if (!entry) throw new Error(`Missing mapped source X:${mapping.reference} for ${mapping.hymnal} ${mapping.number}`);
  const abc = entry.split(/\r?\n%%newpage/)[0].trim() + '\n';
  if (!hasExplicitPublicDomainNotice(abc)) {
    excluded.push(`${mapping.hymnal} ${mapping.number}: no unambiguous public-domain notice`);
    continue;
  }
  const prefix = mapping.hymnal === 'TFWS2000' ? 'tfws' : 'umh';
  const file = `${prefix}-${mapping.number}.abc`;
  files.push({ file, abc });
  catalog.push(createHymnCatalogEntry(mapping, file, source));
}

let previousCatalog = [];
try { previousCatalog = JSON.parse(await readFile(resolve(output, 'catalog.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!Array.isArray(previousCatalog)) throw new Error('Existing hymn catalog is invalid; refusing to replace it.');
const currentFiles = new Set(files.map(item => item.file));
const staleFiles = previousCatalog.map(entry => entry?.file).filter(file =>
  typeof file === 'string' && /^(?:umh|tfws)-\d{1,4}\.abc$/.test(file) && !currentFiles.has(file));
const unmappedMappings = mappings.filter(mapping => mapping.hymnal === 'unmapped' && mapping.number === '');

await mkdir(output, { recursive: true });
for (const { file, abc } of files) await writeFile(resolve(output, file), abc, 'utf8');
for (const file of staleFiles) await unlink(resolve(output, file)).catch(error => { if (error.code !== 'ENOENT') throw error; });
await writeFile(resolve(output, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n', 'utf8');
console.log(`Scanned ${entries.length} source scores (${pdCandidates.length} explicitly public domain).`);
console.log(`Catalog includes ${catalog.length} mapped entries; excluded ${excluded.length} without clear public-domain notices.`);
console.log(`Skipped ${unmappedMappings.length} unmapped candidate rows.`);
for (const reason of excluded) console.log(`Excluded: ${reason}`);
console.log('Catalog and source files refreshed. Review the checked-in changes before deployment.');