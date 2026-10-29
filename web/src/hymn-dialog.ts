import { createIcons, Check, X } from 'lucide';
import { escape } from './render';
import { searchHymns, type HymnSource } from './hymns';

export interface HymnChoice { source: HymnSource; keepBells: boolean }

const MAX_RESULTS = 100;
const hymnLabel = (source: HymnSource) => source.number ? `${source.hymnal === 'TFWS2000' ? 'TFWS' : 'UMH'} ${source.number}` : 'Open Hymnal';

export function chooseHymn(sources: HymnSource[], keepBells = false): Promise<HymnChoice | undefined> {
  const dialog = document.createElement('dialog');
  dialog.className = 'hymn-dialog';
  dialog.setAttribute('aria-labelledby', 'hymn-dialog-title');
  dialog.innerHTML = `<form method="dialog"><header><div><span class="eyebrow">PUBLIC DOMAIN</span><h2 id="hymn-dialog-title">Find a public domain hymn</h2></div></header>
    <label class="field"><span>Search</span><input id="hymn-search" type="search" autocomplete="off" aria-label="Search hymns" placeholder="Title, first line or hymn number"></label>
    <p id="hymn-count" class="hymn-count" role="status"></p>
    <fieldset class="hymn-choices"><legend>Matching hymns</legend><div id="hymn-matches"></div></fieldset>
    <label class="check-field"><input name="keep-bells" type="checkbox" ${keepBells ? 'checked' : ''}> Keep my current bell set</label>
    <p class="hymn-source-note">A hymn number finds only hymns already registered to that number; search by title or first line to find the rest. Open Hymnal settings may differ from the hymnal printing. Harmony is inferred and needs review. Public-domain status is based on United States law.</p>
    <footer><button type="submit" value="cancel"><i data-lookup-icon="x" aria-hidden="true"></i>Cancel</button><button type="submit" value="load" id="hymn-load" class="primary" disabled><i data-lookup-icon="check" aria-hidden="true"></i>Load hymn</button></footer></form>`;
  const search = dialog.querySelector<HTMLInputElement>('#hymn-search')!;
  const options = dialog.querySelector<HTMLElement>('#hymn-matches')!;
  const count = dialog.querySelector<HTMLElement>('#hymn-count')!;
  const load = dialog.querySelector<HTMLButtonElement>('#hymn-load')!;
  let selected = '';
  const details = (source: HymnSource) => [
    source.firstLine && `<p><strong>First line:</strong> ${escape(source.firstLine)}</p>`,
    source.tune && `<p><strong>Tune:</strong> ${escape(source.tune)}</p>`,
    `<p><strong>Hymnal:</strong> ${escape(source.hymnalName)}${source.number ? ` · ${escape(source.number)}` : ''}</p>`,
    `<p><strong>Source:</strong> ${escape(source.sourceEdition)} · ${escape(source.rights)}</p>`,
  ].filter(Boolean).join('');
  const renderChoices = () => {
    const matches = searchHymns(sources, search.value);
    const shown = matches.slice(0, MAX_RESULTS);
    if (!shown.some(source => source.id === selected)) selected = '';
    count.textContent = !matches.length ? 'No matching hymns.' : matches.length > shown.length
      ? `Showing the first ${shown.length} of ${matches.length} matches. Type more to narrow the list.` : `${matches.length} matching hymn${matches.length === 1 ? '' : 's'}.`;
    options.innerHTML = shown.map(source => `<div class="hymn-choice-row"><label class="hymn-choice"><input type="radio" name="hymn-source" value="${escape(source.id)}" ${source.id === selected ? 'checked' : ''}><span><strong>${escape(source.title)}</strong><small>${[hymnLabel(source), source.tune].filter(Boolean).map(escape).join(' · ')}</small></span></label>
      <details class="hymn-details"><summary aria-label="Details for ${escape(source.title)}">Details</summary>${details(source)}</details></div>`).join('');
    load.disabled = !selected;
  };
  search.addEventListener('input', renderChoices);
  options.addEventListener('change', event => {
    selected = (event.target as HTMLInputElement).value;
    load.disabled = false;
  });
  // Enter in the search box should not submit the form with nothing chosen.
  search.addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
  renderChoices();
  document.body.append(dialog);
  createIcons({ icons: { Check, X }, nameAttr: 'data-lookup-icon' });
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const source = sources.find(item => item.id === selected);
      const preserve = dialog.querySelector<HTMLInputElement>('input[name="keep-bells"]')!.checked;
      const result = dialog.returnValue === 'load' && source ? { source, keepBells: preserve } : undefined;
      dialog.remove(); resolve(result);
    }, { once: true });
    dialog.showModal();
    search.focus();
  });
}
