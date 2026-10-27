import { importDocument, type Song } from './document';
import { problems } from './music';
import { escape, scoreCSS, scoreMarkup, scoreRuntime, scoreLicense } from './render';

export const MAX_FILE_SIZE = 8 * 1024 * 1024;
export function readDocument(text: string): Song {
  if (new Blob([text]).size > MAX_FILE_SIZE) throw new Error('File exceeds the 8 MB size limit.');
  let json = text.trim().replace(/^\uFEFF/, '');
  if (!json.startsWith('{')) {
    const document = new DOMParser().parseFromString(text, 'text/html');
    const data = document.querySelectorAll('script#ringalong-data[type="application/json"]');
    if (data.length !== 1) throw new Error('This HTML does not contain one Ringalong source definition. Import its original JSON instead.');
    json = data[0].textContent || '';
  }
  let value: unknown;
  try { value = JSON.parse(json); }
  catch { throw new Error('The source definition is not valid JSON.'); }
  const song = importDocument(value);
  const errors = problems(song, false);
  if (errors.length) throw new Error(errors.join('\n'));
  return song;
}

export function exportHTML(song: Song): string {
  const errors = problems(song);
  if (errors.length) throw new Error(errors.join('\n'));
  const json = JSON.stringify(song).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${escape(song.title)} - Ringalong</title>
<style>body{margin:0 auto;padding:16px 24px;max-width:1400px;background:var(--surface);color:var(--ink)}button:focus-visible{outline:2px solid var(--focus);outline-offset:3px}${scoreCSS}</style></head>
<body>${scoreMarkup(song)}<template id="ringalong-font-license"><pre>${escape(scoreLicense)}</pre></template><script id="ringalong-data" type="application/json">${json}</script><script>${scoreRuntime}</script></body></html>`;
}

type SaveWindow = Window & { showSaveFilePicker?: (options: {
  suggestedName: string; types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }> };

export async function downloadSong(song: Song): Promise<boolean> {
  const html = exportHTML(song);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const filename = `${song.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 100) || 'ringalong'}.html`;
  const picker = (window as SaveWindow).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker.call(window, { suggestedName: filename, types: [{ description: 'Ringalong HTML', accept: { 'text/html': ['.html'] } }] });
      const writable = await handle.createWritable(); await writable.write(blob); await writable.close(); return true;
    } catch (error) {
      if ((error as Error).name === 'AbortError') return false;
      throw error;
    }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}