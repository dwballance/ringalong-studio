import { createIcons, Check, X } from 'lucide';
import { escape } from './render';
import type { HymnSource } from './hymns';

export interface HymnChoice { source: HymnSource; keepBells: boolean }

export function chooseHymn(sources: HymnSource[], keepBells = false): Promise<HymnChoice | undefined> {
  if (!sources.length) return Promise.resolve(undefined);
  const books = [...new Map(sources.map(source => [source.hymnal, source.hymnalName])).entries()];
  const dialog = document.createElement('dialog');
  dialog.className = 'hymn-dialog';
  dialog.setAttribute('aria-labelledby', 'hymn-dialog-title');
  dialog.innerHTML = `<form method="dialog"><header><div><span class="eyebrow">WEB IMPORT</span><h2 id="hymn-dialog-title">Choose a hymn source</h2></div></header>
    <label class="field"><span>Hymnal</span><select id="hymn-book" name="hymnal" aria-label="Hymnal">${books.map(([key, title]) => `<option value="${escape(key)}">${escape(title)}</option>`).join('')}</select></label>
    <fieldset class="hymn-choices"><legend>Hymn and tune</legend><div id="hymn-matches"></div></fieldset>
    <label class="check-field"><input name="keep-bells" type="checkbox" ${keepBells ? 'checked' : ''}> Keep my current bell set</label>
    <p class="hymn-source-note">Open Hymnal settings may differ from the selected hymnal printing. Harmony is inferred and needs review. Public-domain status is based on United States law.</p>
    <footer><button type="submit" value="cancel"><i data-lookup-icon="x" aria-hidden="true"></i>Cancel</button><button type="submit" value="load" class="primary"><i data-lookup-icon="check" aria-hidden="true"></i>Load hymn</button></footer></form>`;
  const book = dialog.querySelector<HTMLSelectElement>('#hymn-book')!;
  const options = dialog.querySelector<HTMLElement>('#hymn-matches')!;
  const renderChoices = () => {
    options.innerHTML = sources.filter(source => source.hymnal === book.value).map((source, index) => `<label class="hymn-choice"><input type="radio" name="hymn-source" value="${escape(source.id)}" ${index === 0 ? 'checked' : ''} required><span><strong>${escape(source.number)} · ${escape(source.title)}</strong><small>${escape(source.tune)} · ${escape(source.sourceEdition)}</small><small>${escape(source.rights)}</small></span></label>`).join('');
  };
  book.addEventListener('change', renderChoices);
  renderChoices();
  document.body.append(dialog);
  createIcons({ icons: { Check, X }, nameAttr: 'data-lookup-icon' });
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const selected = dialog.querySelector<HTMLInputElement>('input[name="hymn-source"]:checked')?.value;
      const source = sources.find(source => source.id === selected && source.hymnal === book.value);
      const preserve = dialog.querySelector<HTMLInputElement>('input[name="keep-bells"]')!.checked;
      const result = dialog.returnValue === 'load' && source ? { source, keepBells: preserve } : undefined;
      dialog.remove(); resolve(result);
    }, { once: true });
    dialog.showModal();
  });
}