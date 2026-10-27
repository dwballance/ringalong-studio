export interface HymnNumberMapping {
  hymnal: 'UMH1989' | 'TFWS2000';
  number: string;
  reference: string;
  title: string;
  tune: string;
  source?: string;
  sourceEdition?: string;
}

export const OPEN_HYMNAL_COLLECTION_URL: string;
export function parseAbcEntries(text: string): string[];
export function abcEntryId(entry: string): string | undefined;
export function hasExplicitPublicDomainNotice(entry: string): boolean;
export function isNumberedHymnMapping(mapping: { hymnal: string; number: string }): boolean;
export function validateNumberedHymnMapping(mapping: {
  hymnal: string;
  number: string;
  reference: string;
  title: string;
  tune: string;
}): void;
export function collectUnmappedCandidates(entries: string[], mappings: { hymnal: string; number: string; reference: string; source?: string }[]): {
  hymnal: 'unmapped';
  number: '';
  reference: string;
  tune: string;
  title: string;
}[];
export function createHymnCatalogEntry(
  mapping: HymnNumberMapping,
  file: string,
  source: string,
): {
  id: string;
  hymnal: HymnNumberMapping['hymnal'];
  hymnalName: string;
  number: string;
  title: string;
  tune: string;
  file: string;
  source: string;
  rights: string;
  sourceEdition: string;
  reference: string;
};