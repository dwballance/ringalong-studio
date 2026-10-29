import { createIcons, Check, X } from 'lucide';
import { escape } from './render';

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Asks which kind of section should receive the notes after the split point. `options` are the
// standard types that are still unused; "Other" takes any new name that is not already in `used`.
export function chooseSplitTarget(from: string, options: string[], used: Set<string>): Promise<string | undefined> {
  const dialog = document.createElement('dialog');
  dialog.className = 'split-dialog';
  dialog.setAttribute('aria-labelledby', 'split-dialog-title');
  const choices = options.map(type => ({ value: type, label: capital(type) }));
  dialog.innerHTML = `<form method="dialog"><header><h2 id="split-dialog-title">Split ${escape(from)}</h2></header>
    <p class="split-help">This note and all following will be moved into a new section of the type specified below.</p>
    <fieldset class="split-choices">
      ${choices.map((choice, index) => `<label class="split-choice"><input type="radio" name="split-type" value="${escape(choice.value)}" ${index === 0 ? 'checked' : ''}><span>${escape(choice.label)}</span></label>`).join('')}
      <label class="split-choice split-choice-other"><input type="radio" name="split-type" value="" ${choices.length ? '' : 'checked'} aria-label="Other section type"><input id="split-other" type="text" placeholder="Other" aria-label="Other section name" maxlength="40" autocomplete="off"></label>
    </fieldset>
    <p id="split-error" class="split-error" role="alert" hidden></p>
    <footer><button type="submit" value="cancel" formnovalidate><i data-lookup-icon="x" aria-hidden="true"></i>Cancel</button><button type="submit" value="split" id="split-save" class="primary"><i data-lookup-icon="check" aria-hidden="true"></i>Split</button></footer></form>`;
  const other = dialog.querySelector<HTMLInputElement>('#split-other')!;
  const error = dialog.querySelector<HTMLElement>('#split-error')!;
  const chosen = () => dialog.querySelector<HTMLInputElement>('input[name="split-type"]:checked')!.value;
  const typeFor = () => (chosen() || other.value).trim().toLowerCase();
  const otherRadio = dialog.querySelector<HTMLInputElement>('input[name="split-type"][value=""]')!;
  const save = dialog.querySelector<HTMLButtonElement>('#split-save')!;
  // Split stays disabled while "Other" is chosen but unnamed.
  const refresh = () => {
    save.disabled = !chosen() && !other.value.trim(); error.hidden = true;
    if (save.disabled) save.title = 'Enter a name for the new song section to continue'; else save.removeAttribute('title');
  };
  // Choosing "Other" moves the cursor into its field, and clicking into the field chooses "Other".
  dialog.addEventListener('change', event => {
    if ((event.target as HTMLInputElement).name === 'split-type') { refresh(); if (otherRadio.checked) other.focus(); }
  });
  other.addEventListener('focus', () => { otherRadio.checked = true; refresh(); });
  other.addEventListener('input', refresh);
  other.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); if (!save.disabled) save.click(); } });
  refresh();
  dialog.addEventListener('submit', event => {
    if ((event.submitter as HTMLButtonElement | null)?.value !== 'split') return;
    const type = typeFor();
    const problem = !type ? 'Enter a name for the new section.' : used.has(type) ? `A ${type} section already exists. Choose a different type or name.` : '';
    error.textContent = problem; error.hidden = !problem;
    if (problem) event.preventDefault();
  });
  document.body.append(dialog);
  createIcons({ icons: { Check, X }, nameAttr: 'data-lookup-icon' });
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const result = dialog.returnValue === 'split' ? typeFor() : undefined;
      dialog.remove(); resolve(result || undefined);
    }, { once: true });
    dialog.showModal();
    if (otherRadio.checked) other.focus();
  });
}
