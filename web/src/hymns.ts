import { z } from 'zod';
import { ensureSectionNames, rememberHymnDefaults, songSchema, type Song } from './document';
import { problems } from './music';

const sourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), hymnal: z.string().min(1), hymnalName: z.string().min(1),
  number: z.string().regex(/^(?:\d{1,4})?$/), title: z.string().min(1), tune: z.string().default(''), firstLine: z.string().default(''),
  file: z.string().regex(/^[a-z0-9-]+\.abc$/), source: z.url().refine(value => /^https?:\/\//.test(value)),
  rights: z.literal('Public domain (United States)'), sourceEdition: z.string().min(1), reference: z.string().min(1),
});
export type HymnSource = z.infer<typeof sourceSchema>;

export function hymnReference(value: string) {
  const match = /^(?:(UMH|TFWS|FWS)\s*)?(\d{1,4})$/i.exec(value.trim());
  const number = Number(match?.[2]);
  const isTFWS = match?.[1] ? match[1].toUpperCase() !== 'UMH' : number >= 2001;
  if (!match || !Number.isInteger(number) || (isTFWS ? number < 2001 || number > 2284 : number < 1 || number > 962)) {
    throw new Error('Enter a United Methodist Hymnal number (1-962) or The Faith We Sing number (2001-2284).');
  }
  return { number: String(number), hymnal: isTFWS ? 'TFWS2000' : 'UMH1989',
    name: isTFWS ? 'The Faith We Sing (2000)' : 'The United Methodist Hymnal (1989)',
    abbreviation: isTFWS ? 'TFWS' : 'UMH', explicit: Boolean(match[1]) };
}

export function hymnNumber(value: string): string {
  return hymnReference(value).number;
}

export function matchingHymns(catalog: HymnSource[], value: string): HymnSource[] {
  const reference = hymnReference(value);
  return catalog.filter(entry => entry.number === reference.number && (!reference.explicit || entry.hymnal === reference.hymnal));
}

// Number searches ("378", "UMH 218", "TFWS 2062") only find hymns already mapped to that number;
// anything else is a keyword search over the title, tune and first line.
export function searchHymns(catalog: HymnSource[], query: string): HymnSource[] {
  const text = query.trim().toLowerCase();
  const byTitle = (a: HymnSource, b: HymnSource) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
  if (!text) return [...catalog].sort(byTitle);
  if (/^(?:(?:umh|tfws|fws)\s*)?\d{1,4}$/.test(text)) {
    try { return matchingHymns(catalog, text).sort(byTitle); } catch { return []; }
  }
  const words = text.split(/\s+/);
  return catalog.filter(hymn => {
    const haystack = `${hymn.title} ${hymn.tune} ${hymn.firstLine}`.toLowerCase();
    return words.every(word => haystack.includes(word));
  }).sort(byTitle);
}

async function fetchText(url: URL, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal: signal || AbortSignal.timeout(15000), credentials: 'omit' });
  if (!response.ok) throw new Error(`Hymn download failed (${response.status}). Your arrangement has not been changed.`);
  if (Number(response.headers.get('content-length')) > 512 * 1024) throw new Error('Hymn source is too large.');
  const text = await response.text();
  if (text.length > 512 * 1024) throw new Error('Hymn source is too large.');
  return text;
}

export async function loadHymnCatalog(signal?: AbortSignal): Promise<HymnSource[]> {
  try {
    const text = await fetchText(new URL('hymns/catalog.json', document.baseURI), signal);
    return z.array(sourceSchema).max(2000).parse(JSON.parse(text));
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new Error('The public-domain hymn catalog could not be loaded. Check your connection and try again.');
  }
}

export async function loadHymn(source: HymnSource, bells?: string[], signal?: AbortSignal): Promise<Song> {
  const checked = sourceSchema.parse(source);
  const text = await fetchText(new URL(`hymns/${checked.file}`, document.baseURI), signal);
  const { importABC } = await import('./hymn-music');
  const song = songSchema.parse(importABC(text, checked, bells));
  const errors = problems(song, false);
  if (errors.length) throw new Error(errors.join('\n'));
  return rememberHymnDefaults(ensureSectionNames(song));
}