import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { alignSection, id, newSong, rememberHymnDefaults, type Section } from '../src/document';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  await page.context().route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) await route.continue();
    else { await route.abort('blockedbyclient'); throw new Error(`Routine UI tests must not contact external services: ${url.hostname}`); }
  });
});

async function newArrangement(page: Page) {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Chords + melody', exact: true }).check();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Morning bells');
  await page.getByLabel('Key signature').selectOption('Bb major');
  await page.getByRole('button', { name: 'Add verse', exact: true }).click();
  await page.getByRole('textbox', { name: 'Lyrics', exact: true }).fill('Ring the bells today\nShare a song with friends');
  await page.locator('#suggest-syllables').uncheck();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
}

test('compact hymn lookup is inline and the decorative badge is absent', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('.local-label')).toHaveCount(0);
  await expect(page.locator('.page-heading')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Ringalong editor', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Ringalong Studio', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Song details', exact: true })).toBeVisible();
  await expect(page.getByLabel('Attribution', { exact: true })).toHaveValue('Words: \nMusic: ');
  await expect(page.getByLabel('Words by', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Music by', { exact: true })).toHaveCount(0);
  const numerator = page.getByLabel('Beats per measure'), pickup = page.getByLabel('Pickup beats', { exact: true });
  const numeratorBox = await numerator.boundingBox(), pickupBox = await pickup.boundingBox();
  expect(Math.abs(numeratorBox!.y - pickupBox!.y)).toBeLessThanOrEqual(1);
  expect(await page.getByLabel('Beats per measure').evaluate(input => input.getBoundingClientRect().width)).toBeLessThan(60);
  expect(await page.getByLabel('Beat unit').evaluate(input => input.getBoundingClientRect().width)).toBeLessThan(60);
  const number = page.getByLabel('Hymn number', { exact: true });
  const lookup = page.getByRole('button', { name: 'Look up', exact: true });
  await expect(number).toHaveAttribute('placeholder', '378');
  await expect(lookup).toBeDisabled();
  await number.fill('378');
  await expect(lookup).toBeEnabled();
  const inputBox = await number.boundingBox(), buttonBox = await lookup.boundingBox();
  expect(inputBox!.width).toBeLessThanOrEqual(90);
  expect(buttonBox!.width).toBeLessThanOrEqual(100);
  expect(Math.abs(inputBox!.y - buttonBox!.y)).toBeLessThanOrEqual(1);
  expect(inputBox!.x + inputBox!.width).toBeLessThanOrEqual(buttonBox!.x);
  const previewTitle = page.getByRole('heading', { name: 'Score preview', exact: true });
  const previewButton = page.getByRole('button', { name: 'Preview', exact: true });
  expect(await previewTitle.evaluate(element => element.nextElementSibling?.getAttribute('data-action'))).toBe('preview');
  const titleBox = await previewTitle.boundingBox(), previewBox = await previewButton.boundingBox();
  expect(previewBox!.x - titleBox!.x - titleBox!.width).toBeCloseTo(12, 0);
  expect(Math.abs(titleBox!.y + titleBox!.height / 2 - previewBox!.y - previewBox!.height / 2)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('compact-lookup.png'), fullPage: true });
});

test('create, edit, share verses, preview, export offline and reimport', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await newArrangement(page);
  await page.getByLabel('Hymn number', { exact: true }).fill('378');
  await expect(page.getByRole('heading', { name: 'Verse 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Duration for Ring', exact: true }).click();
  await page.getByRole('button', { name: 'Dotted quarter', exact: true }).click();
  await page.getByRole('button', { name: 'Melody for Ring', exact: true }).click();
  await page.getByRole('button', { name: 'D5', exact: true }).click();
  await page.getByRole('button', { name: 'Ringing for Ring', exact: true }).click();
  await page.getByRole('button', { name: 'Melody only', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duration for Ring' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Verse', exact: true }).click();
  await page.getByRole('textbox', { name: 'Lyrics', exact: true }).fill('Hear the bells again\nJoin a song with friends');
  await page.locator('#suggest-syllables').uncheck();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Duration for Hear', exact: true })).toContainText('\ud834\udd5f\u00b7');
  await expect(page.getByRole('button', { name: 'Melody for Hear', exact: true })).toContainText('D5');
  await expect(page.getByRole('button', { name: 'Ringing for Hear', exact: true })).toContainText('melody');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Conductor', exact: true })).toHaveAttribute('aria-selected', 'true');
  const conductor = page.getByRole('tabpanel', { name: 'Conductor', exact: true });
  await expect(conductor.locator('.score-conductor-section')).toHaveCount(1);
  await expect(conductor.locator('.score-line')).toHaveCount(2);
  await expect(conductor.locator('.score-verse-row')).toHaveCount(4);
  await expect(conductor.locator('.score-duration, .score-melody, .score-damps')).toHaveCount(0);
  await expect(conductor.locator('.score-count-item')).toHaveCount(7);
  await page.getByRole('tab', { name: 'F4', exact: true }).click();
  const bellPreview = page.getByRole('tabpanel', { name: 'F4', exact: true });
  await expect(page.getByRole('tab', { name: 'F4', exact: true })).toHaveText('F4');
  await expect(bellPreview.locator('.score-player-note')).toHaveText('F4');
  await expect(bellPreview.locator('.score-player-title')).toHaveText('378 Morning bells (Bb major)');
  await expect(bellPreview.locator('.score-player-note')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(bellPreview.locator('.score-lyrics')).toHaveCount(4);
  // The dotted first note moves every later word off the ringing beats, so only the melody-only D5 strikes on a word.
  await page.getByRole('tab', { name: 'D5', exact: true }).click();
  const melodyPreview = page.getByRole('tabpanel', { name: 'D5', exact: true });
  await expect(melodyPreview.locator('.score-lyric-strike').first()).toBeVisible();
  await expect(melodyPreview.locator('.score-lyric-strike').first()).toHaveCSS('margin-left', '6px');
  await expect(melodyPreview.locator('.score-lyric-strike').first()).toHaveCSS('margin-right', '6px');
  await expect(bellPreview.locator('.score-cell, .score-duration, .score-chord, .score-crossing, .measure-end')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('bell-preview.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Conductor', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('editor.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Export', exact: true }).click();
  const download = await downloadPromise;
  const file = testInfo.outputPath('morning-bells.html'); await download.saveAs(file);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  const offline = await page.context().newPage();
  const remoteRequests: string[] = [];
  offline.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()); });
  offline.on('pageerror', error => errors.push(error.message));
  await offline.goto(pathToFileURL(file).href);
  await expect(offline.getByRole('tab', { name: 'Conductor', exact: true })).toHaveAttribute('aria-selected', 'true');
  await offline.getByRole('tab', { name: 'D5', exact: true }).click();
  await expect(offline.getByRole('tab', { name: 'D5', exact: true })).toHaveAttribute('aria-selected', 'true');
  const exportedBell = offline.getByRole('tabpanel', { name: 'D5', exact: true });
  await expect(exportedBell.locator('.score-player-note')).toHaveText('D5');
  await expect(exportedBell.locator('.score-player-title')).toHaveText('378 Morning bells (Bb major)');
  await expect(exportedBell.locator('.score-lyrics')).toHaveCount(4);
  await expect(exportedBell.locator('.score-lyric-strike').first()).toHaveCSS('margin-left', '6px');
  await expect(exportedBell.locator('.score-lyric-strike').first()).toHaveCSS('margin-right', '6px');
  await expect(exportedBell.locator('.score-cell, .score-duration, .score-chord, .score-crossing, .measure-end')).toHaveCount(0);
  const offlineConductor = offline.getByRole('tabpanel', { name: 'Conductor', exact: true, includeHidden: true });
  await expect(offlineConductor.locator('.score-conductor-section')).toHaveCount(1);
  await expect(offlineConductor.locator('.score-verse-row')).toHaveCount(4);
  await expect(offlineConductor.locator('.score-duration, .score-melody, .score-damps')).toHaveCount(0);
  await expect(offlineConductor.locator('.score-count-item')).toHaveCount(7);
  await offline.screenshot({ path: testInfo.outputPath('export.png'), fullPage: true });
  await offline.emulateMedia({ media: 'print' });
  await expect(exportedBell.locator('.score-player-note')).toHaveText('D5');
  await expect(exportedBell.locator('.score-player-note')).toHaveCSS('font-size', '44px');
  const printedBox = exportedBell.locator('.score-lyric-strike').first();
  await expect(printedBox).toHaveCSS('padding-left', '4.8px');
  await expect(printedBox).toHaveCSS('padding-right', '4.8px');
  await expect(printedBox).toHaveCSS('margin-left', '6px');
  await expect(printedBox).toHaveCSS('margin-right', '6px');
  await exportedBell.screenshot({ path: testInfo.outputPath('printed-bell-spacing.png') });
  expect(remoteRequests).toEqual([]);
  await offline.close();
  await page.locator('#import-file').setInputFiles(file);
  await expect(page.locator('#notice')).toContainText('Imported');
  expect(errors).toEqual([]);
});

test('export accepts another open music section and preserves restored attribution', async ({ page }, testInfo) => {
  const song = newSong(); song.title = 'Export readiness'; song.key = 'C major';
  song.wordsAuthor = 'Original writer'; song.musicAuthor = 'Original composer';
  song.credit = 'Words: Original writer\nMusic: Original composer\nLicense: retain this notice';
  const first: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
  const second: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
  song.sections.push(first, second); alignSection(song, first, 'one two'); alignSection(song, second, 'three four'); first.stage = 'done';
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await page.locator('#import-file').setInputFiles({ name: 'ready.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(song)) });
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(page.getByLabel('Words by', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Music by', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Attribution', { exact: true })).toHaveValue(song.credit);
  await expect(page.getByLabel('Attribution', { exact: true })).toHaveCount(1);
  const extra = `${song.credit}\nAdditional permission notice`;
  await page.getByLabel('Attribution', { exact: true }).fill(extra);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Export', exact: true }).click();
  const file = testInfo.outputPath('ready.html'); await (await pending).saveAs(file);
  await expect(page.locator('#notice')).toContainText('HTML exported');
  await page.locator('#import-file').setInputFiles(file);
  await expect(page.getByLabel('Attribution', { exact: true })).toHaveValue(extra);
  await page.getByRole('button', { name: 'Open Verse 2', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  const draft: Section = { id: id(), type: 'verse', number: 6, name: 'Verse 6', stage: 'lyrics', raw: 'Unmapped words', lines: [], bindings: {} };
  song.sections.push(draft);
  await page.locator('#import-file').setInputFiles({ name: 'draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(song)) });
  await page.getByRole('button', { name: 'Save / Export', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Verse 6: lyrics have not been mapped to music');
  await expect(page.locator('#notice')).not.toContainText('choose Done');
});

test('decimal and custom verse labels fit without stretching printed lyric rows', async ({ page }, testInfo) => {
  const song = newSong(); song.title = 'Printed labels'; song.key = 'C major';
  const names = ['Verse 1', 'Verse 3.5', 'Final blessing'];
  for (const [index, name] of names.entries()) {
    const section: Section = { id: id(), type: 'verse', name, number: index + 1, stage: 'lyrics', raw: '', lines: [], bindings: {} };
    song.sections.push(section); alignSection(song, section, 'one two three four'); section.stage = 'done';
  }
  await page.goto('/');
  await page.locator('#import-file').setInputFiles({ name: 'labels.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(song)) });
  const conductor = page.getByRole('tabpanel', { name: 'Conductor', exact: true });
  await expect(conductor.locator('.score-verse-number')).toHaveText(['1.', '3.5', 'Final blessing']);
  await page.emulateMedia({ media: 'print' });
  const metrics = await conductor.locator('.score-verse-number').evaluateAll(labels => labels.map(label => {
    const range = document.createRange(); range.selectNodeContents(label);
    return { lines: range.getClientRects().length, height: label.getBoundingClientRect().height, width: label.getBoundingClientRect().width };
  }));
  for (const label of metrics) { expect(label.lines).toBe(1); expect(label.height).toBeLessThan(30); expect(label.width).toBeGreaterThanOrEqual(90); }
  await expect(conductor.locator('.score-word').first()).toHaveCSS('padding-top', '0.75px');
  await expect(conductor.locator('.score-word').first()).toHaveCSS('padding-bottom', '0.75px');
  await conductor.screenshot({ path: testInfo.outputPath('print-labels.png') });
});

test('import legacy JSON and recover local work', async ({ page }, testInfo) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await page.locator('#import-file').setInputFiles(join(process.cwd(), 'together_we_serve_2175.json'));
  await expect(page.locator('#notice')).toContainText('Imported');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Together We Serve 2175');
  await expect(page.getByRole('tab', { name: 'Conductor', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'This verse only', exact: true }).click();
  await page.getByRole('button', { name: 'Melody for To-', exact: true }).click();
  await page.getByRole('button', { name: 'F4', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ringalong.draft.v1'))).not.toBeNull();
  await page.reload();
  await expect(page.locator('#notice')).toContainText('restored');
  await page.getByRole('button', { name: 'Clear draft', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('ringalong.draft.v1'))).toBeNull();
  await page.getByRole('checkbox', { name: 'Local recovery', exact: true }).uncheck();
  expect(await page.evaluate(() => localStorage.getItem('ringalong.recovery.enabled'))).toBe('false');
  await page.screenshot({ path: testInfo.outputPath('legacy-import.png'), fullPage: true });
});

test('syllable review preserves punctuation and supports split/join and extra notes', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await page.getByLabel('Title', { exact: true }).fill('Synthetic syllables');
  await page.getByLabel('Key signature').selectOption('C major');
  await page.getByRole('button', { name: 'Add verse', exact: true }).click();
  await page.getByRole('textbox', { name: 'Lyrics', exact: true }).fill('Beautiful music, ringing!');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Review syllable breaks' })).toContainText('mu- sic,');
  await page.getByRole('button', { name: 'Use these words', exact: true }).click();
  const firstWord = page.locator('.word-cell .lyric-value').first();
  await firstWord.click();
  const before = await page.locator('.word-cell').count();
  await page.getByRole('button', { name: 'Split note', exact: true }).click();
  await expect(page.locator('.word-cell')).toHaveCount(before + 1);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
});

test('verse-only pitch exceptions do not change the shared pattern', async ({ page }) => {
  await newArrangement(page);
  await page.getByRole('button', { name: 'This verse only', exact: true }).click();
  await page.getByRole('button', { name: 'Melody for Ring', exact: true }).click();
  await page.getByRole('button', { name: 'D5', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Verse', exact: true }).click();
  await page.getByRole('textbox', { name: 'Lyrics', exact: true }).fill('Hear the bright bells today\nShare a song with friends');
  await page.locator('#suggest-syllables').uncheck();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Melody for Hear', exact: true })).toContainText('Eb4');
  await expect(page.locator('.word-cell')).toHaveCount(10);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Open Verse 1', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Melody for Ring', exact: true })).toContainText('D5');
});

test('split and join lyric tokens without losing musical time', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept(dialog.message().startsWith('Separate syllables') ? 'Ri- ng' : undefined));
  await newArrangement(page);
  await page.getByRole('button', { name: 'Lyric mapping for Ring', exact: true }).click();
  await page.getByRole('button', { name: 'Split syllable', exact: true }).click();
  await expect(page.locator('.word-cell')).toHaveCount(10);
  await page.getByRole('button', { name: 'Lyric mapping for Ri-', exact: true }).click();
  await page.getByRole('button', { name: 'Join next', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lyric mapping for Ring', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
});

test('reset a lyric note to defaults without losing its word', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await newArrangement(page);
  await page.getByRole('button', { name: 'Duration for Ring', exact: true }).click();
  await page.getByRole('button', { name: 'Half', exact: true }).click();
  await page.getByRole('button', { name: 'Melody for Ring', exact: true }).click();
  await page.getByRole('button', { name: 'D5', exact: true }).click();
  await page.getByRole('button', { name: 'Ringing for Ring', exact: true }).click();
  await page.getByRole('button', { name: 'Rest', exact: true }).click();
  await page.getByRole('button', { name: 'Reset note', exact: true }).click();
  await expect(page.locator('.word-cell')).toHaveCount(9);
  await expect(page.getByRole('button', { name: 'Lyric mapping for Ring', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duration for Ring', exact: true })).toContainText('\ud834\udd5f');
  await expect(page.getByRole('button', { name: 'Melody for Ring', exact: true })).toContainText('Eb4');
  await expect(page.getByRole('button', { name: 'Chord for Ring', exact: true })).toContainText('Bb');
  await expect(page.getByRole('button', { name: 'Ringing for Ring', exact: true })).toContainText('Auto');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
});

test('add and remove an untexted note while keeping all lyrics', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await newArrangement(page);
  await page.getByRole('button', { name: 'Lyric mapping for Ring', exact: true }).click();
  await page.getByRole('button', { name: 'Add note here', exact: true }).click();
  await expect(page.locator('.word-cell')).toHaveCount(10);
  await page.getByRole('button', { name: 'Lyric mapping for untexted note', exact: true }).click();
  await page.getByRole('button', { name: 'Remove note', exact: true }).click();
  await expect(page.locator('.word-cell')).toHaveCount(9);
  await expect(page.getByRole('button', { name: 'Lyric mapping for Ring', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duration for Ring', exact: true })).toContainText('\ud834\udd5e');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
});

test('measure separators remain visible after deleting a fractional untexted note', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await newArrangement(page);
  await page.getByRole('button', { name: 'Duration for Ring', exact: true }).click();
  await page.getByRole('button', { name: 'Eighth', exact: true }).click();
  await page.getByRole('button', { name: 'Lyric mapping for Ring', exact: true }).click();
  await page.getByRole('button', { name: 'Add note here', exact: true }).click();
  expect(await page.locator('.word-cell.bar-end').count()).toBeGreaterThan(0);
  const before = await page.locator('.word-cell.bar-end .lyric-value').allTextContents();
  await page.getByRole('button', { name: 'Lyric mapping for untexted note', exact: true }).click();
  await page.getByRole('button', { name: 'Remove note', exact: true }).click();
  await expect(page.locator('.word-cell')).toHaveCount(9);
  expect(await page.locator('.word-cell.bar-end').count()).toBeGreaterThan(0);
  expect(await page.locator('.word-cell.bar-end .lyric-value').allTextContents()).toEqual(before);
  await expect(page.getByRole('button', { name: 'Duration for Ring', exact: true })).toContainText('\ud834\udd5f');
  const widths = await page.locator('.word-cell.bar-end').evaluateAll(cells => cells.map(cell => getComputedStyle(cell).borderRightWidth));
  expect(widths.every(width => width === '2px')).toBe(true);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  expect(await page.getByRole('tabpanel', { name: 'Conductor', exact: true }).locator('.measure-end').count()).toBeGreaterThan(0);
});

test('reset an imported hymn from saved defaults without fetching a source and undo the reset', async ({ page }) => {
  const original = newSong(); original.title = 'Original hymn'; original.key = 'C major';
  const section: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
  original.sections.push(section); alignSection(original, section, 'one two three four'); rememberHymnDefaults(original);
  let accept = false;
  page.on('dialog', dialog => accept ? dialog.accept() : dialog.dismiss());
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.includes('/hymns/')) requests.push(request.url()); });
  await page.goto('/');
  await page.locator('#import-file').setInputFiles({ name: 'synthetic-hymn.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)) });
  await expect(page.getByRole('button', { name: 'Reset hymn', exact: true })).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill('Edited hymn');
  await page.getByRole('button', { name: 'Duration for one', exact: true }).click();
  await page.getByRole('button', { name: 'Half', exact: true }).click();
  await page.getByRole('button', { name: 'Reset hymn', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Edited hymn');
  accept = true;
  await page.getByRole('button', { name: 'Reset hymn', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Original hymn');
  await expect(page.getByRole('button', { name: 'Duration for one', exact: true })).toContainText('\ud834\udd5f');
  await expect(page.locator('#notice')).toContainText('Original hymn restored');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Edited hymn');
  await expect(page.getByRole('button', { name: 'Duration for one', exact: true })).toContainText('\ud834\udd5e');
  expect(requests).toEqual([]);
});

test('reset extra lyric notes but only remove untexted subdivisions', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept(dialog.message().startsWith('Separate syllables') ? 'Ri- ng' : undefined));
  await newArrangement(page);
  await page.getByRole('button', { name: 'Lyric mapping for Ring', exact: true }).click();
  await page.getByRole('button', { name: 'Split syllable', exact: true }).click();
  await page.getByRole('button', { name: 'Lyric mapping for Ri-', exact: true }).click();
  await page.getByRole('button', { name: 'Reset extra note', exact: true }).click();
  await expect(page.locator('.word-cell')).toHaveCount(10);
  await expect(page.getByRole('button', { name: 'Lyric mapping for ng', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Lyric mapping for Ri-', exact: true }).click();
  await page.getByRole('button', { name: 'Split note', exact: true }).click();
  await expect(page.locator('.word-cell')).toHaveCount(11);
  await page.getByRole('button', { name: 'Lyric mapping for untexted note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Break line here', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Remove extra note', exact: true }).click();
  await expect(page.locator('.word-cell')).toHaveCount(10);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
});

test('protect a note used by another verse even when it is unused in the selected verse', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await newArrangement(page);
  await page.getByRole('button', { name: 'Melody for today', exact: true }).click();
  await page.getByRole('button', { name: 'D5', exact: true }).click();
  await page.getByRole('button', { name: 'Verse', exact: true }).click();
  await page.getByRole('textbox', { name: 'Lyrics', exact: true }).fill('Hear bells again\nShare a song with friends');
  await page.locator('#suggest-syllables').uncheck();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Lyric mapping for untexted note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove note', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset note', exact: true }).click();
  await expect(page.locator('.word-cell')).toHaveCount(9);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Open Verse 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lyric mapping for today', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Melody for today', exact: true })).toContainText('Eb4');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
});

test('break a line without losing music, move linked lyrics, and undo the change', async ({ page }) => {
  await newArrangement(page);
  await page.getByRole('button', { name: 'Melody for bells', exact: true }).click();
  await page.getByRole('button', { name: 'D5', exact: true }).click();
  await page.getByRole('button', { name: 'Verse', exact: true }).click();
  await page.getByRole('textbox', { name: 'Lyrics', exact: true }).fill('Hear the notes again\nJoin a song with friends');
  await page.locator('#suggest-syllables').uncheck();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Lyric mapping for notes', exact: true }).click();
  await page.getByRole('button', { name: 'Break line here', exact: true }).click();
  await expect(page.locator('.music-line').nth(0).locator('.lyric-value')).toHaveText(['Hear', 'the']);
  await expect(page.locator('.music-line').nth(1).locator('.lyric-value')).toHaveText(['notes', 'again', 'Join', 'a', 'song', 'with', 'friends']);
  await expect(page.getByRole('button', { name: 'Melody for notes', exact: true })).toContainText('D5');
  await expect(page.getByRole('button', { name: 'Break line here', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.music-line').first().locator('.lyric-value')).toHaveText(['Hear', 'the', 'notes', 'again']);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.music-line').first().locator('.lyric-value')).toHaveText(['Hear', 'the']);
  await page.getByRole('button', { name: 'Open Verse 1', exact: true }).click();
  await expect(page.locator('.music-line').nth(0).locator('.lyric-value')).toHaveText(['Ring', 'the']);
  await expect(page.locator('.music-line').nth(1).locator('.lyric-value')).toHaveText(['bells', 'today', 'Share', 'a', 'song', 'with', 'friends']);
  await expect(page.getByRole('button', { name: 'Melody for bells', exact: true })).toContainText('D5');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
});

test('break the final line into a new line and keep the result through export', async ({ page }, testInfo) => {
  await newArrangement(page);
  await page.getByRole('button', { name: 'Lyric mapping for Ring', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Break line here', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Lyric mapping for with', exact: true }).click();
  await page.getByRole('button', { name: 'Break line here', exact: true }).click();
  await expect(page.locator('.music-line')).toHaveCount(3);
  await expect(page.locator('.music-line').nth(1).locator('.lyric-value')).toHaveText(['Share', 'a', 'song']);
  await expect(page.locator('.music-line').nth(2).locator('.lyric-value')).toHaveText(['with', 'friends']);
  await page.screenshot({ path: testInfo.outputPath('line-break.png'), fullPage: true });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Conductor', exact: true }).locator('.score-line')).toHaveCount(3);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Export', exact: true }).click();
  const download = await pending, file = testInfo.outputPath('line-break.html'); await download.saveAs(file);
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#import-file').setInputFiles(file);
  await expect(page.locator('#notice')).toContainText('Imported');
  await expect(page.getByRole('tabpanel', { name: 'Conductor', exact: true }).locator('.score-line')).toHaveCount(3);
});

test('note panel follows the edited line with actions along its right edge', async ({ page }, testInfo) => {
  await newArrangement(page);
  await page.getByRole('button', { name: 'Duration for Share', exact: true }).click();
  const panel = page.locator('.palette');
  await expect(page.locator('.music-line').nth(0).locator('.palette')).toHaveCount(0);
  await expect(page.locator('.music-line').nth(1).locator('.palette')).toBeVisible();
  expect(await panel.evaluate(element => element.nextElementSibling?.classList.contains('word-track'))).toBe(true);
  const actions = page.getByRole('group', { name: 'Note actions', exact: true });
  await expect(actions.getByRole('button', { name: 'Add note here', exact: true })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Break line here', exact: true })).toBeDisabled();
  await expect(actions.getByRole('button', { name: 'Reset note', exact: true })).toBeVisible();
  const contentBox = await page.locator('.palette-content').boundingBox();
  const actionBox = await actions.boundingBox();
  const panelBox = await panel.boundingBox();
  const trackBox = await page.locator('.music-line').nth(1).locator('.word-track').boundingBox();
  expect(contentBox!.x + contentBox!.width).toBeLessThanOrEqual(actionBox!.x);
  expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width);
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(trackBox!.y);
  await page.screenshot({ path: testInfo.outputPath('line-note-panel.png'), fullPage: true });
  await page.getByRole('button', { name: 'Duration for Ring', exact: true }).click();
  await expect(page.locator('.music-line').nth(0).locator('.palette')).toBeVisible();
  await expect(page.locator('.music-line').nth(1).locator('.palette')).toHaveCount(0);
  await page.getByRole('button', { name: 'Duration for today', exact: true }).click();
  await page.getByRole('button', { name: 'Quarter', exact: true }).click();
  await expect(page.locator('.music-line').nth(0).locator('.palette')).toHaveCount(0);
  await expect(page.locator('.music-line').nth(1).locator('.palette')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(actions.getByRole('button', { name: 'Add note here', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('narrow-note-panel.png'), fullPage: true });
  }
});

test('long durations display tied notes across measures without changing the note', async ({ page }, testInfo) => {
  const song = newSong(); song.title = 'Long note display'; song.key = 'G major'; song.time = [3, 4];
  const section: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
  song.sections.push(section); alignSection(song, section, 'one two closing');
  song.patterns[0].lines[0].slots[1].beats = 2;
  song.patterns[0].lines[0].slots[2].beats = 5;
  await page.goto('/');
  await page.locator('#import-file').setInputFiles({ name: 'long-note.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(song)) });
  const duration = page.getByRole('button', { name: 'Duration for closing', exact: true });
  await expect(duration).toHaveText('\ud834\udd5e\u00b7 \u203f \ud834\udd5e');
  await expect(page.locator('.word-cell')).toHaveCount(3);
  await duration.click();
  await expect(page.getByRole('spinbutton', { name: 'Exact duration in beats', exact: true })).toHaveValue('5');
  await page.evaluate(() => document.fonts.ready);
  expect(await duration.evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('long-note-symbols.png'), fullPage: true });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.read-value.duration-value').last()).toHaveText('\ud834\udd5e\u00b7 \u203f \ud834\udd5e');
});

test('calculated bell strikes update live below each ringing control without preview', async ({ page }, testInfo) => {
  await newArrangement(page);
  const first = page.getByRole('group', { name: 'Calculated strikes for Ring', exact: true });
  const next = page.getByRole('group', { name: 'Calculated strikes for the', exact: true });
  await expect(first.locator('span')).toHaveText(['Eb4', 'F4', 'Bb4', 'D5']);
  await expect(next.locator('.calculated-strike')).toHaveText(['Eb4']);
  await expect(next.locator('.calculated-held')).toHaveText(['F4', 'Bb4', 'D5']);
  await expect(next.locator('.calculated-held').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.getByRole('button', { name: 'Ringing for the', exact: true }).click();
  await page.getByRole('button', { name: 'Hold', exact: true }).click();
  await expect(next.locator('.calculated-strike')).toHaveCount(0);
  await expect(next.locator('.calculated-held')).toHaveText(['Eb4', 'F4', 'Bb4', 'D5']);
  await expect(next).not.toContainText('No strikes');
  await page.getByRole('button', { name: 'Auto', exact: true }).click();
  expect(await first.evaluate(element => element.previousElementSibling?.classList.contains('ring-value'))).toBe(true);
  await expect(first.locator('button, input, select, [contenteditable="true"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Chord for Ring', exact: true }).click();
  await page.getByRole('button', { name: 'F', exact: true }).click();
  await expect(first.locator('span')).toHaveText(['Eb4', 'F4', 'A4', 'C5']);
  await expect(next.locator('span')).toHaveText(['Eb4', 'F4']);
  await page.getByRole('button', { name: 'Melody for Ring', exact: true }).click();
  await page.getByRole('button', { name: 'D5', exact: true }).click();
  await page.getByRole('button', { name: 'Ringing for Ring', exact: true }).click();
  await page.getByRole('button', { name: 'Melody only', exact: true }).click();
  await expect(first.locator('span')).toHaveText(['D5']);
  await page.getByRole('checkbox', { name: 'D5', exact: true }).check();
  await expect(first).toHaveText('No strikes');
  await expect(page.locator('.score-root')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('live-calculated-strikes.png'), fullPage: true });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(first).toHaveText('No strikes');
});

test('one bell set and melody mode control octave labels, pages and custom chords', async ({ page }) => {
  const song = newSong(); song.title = 'Mode test'; song.key = 'C major'; song.ringMelody = false;
  song.wordsAuthor = 'Word author'; song.musicAuthor = 'Composer'; song.credit = 'Source license retained';
  song.bells = ['C4', 'C5', 'D4', 'D5', 'E4', 'F4', 'G4']; song.recommended = [...song.bells];
  const section: Section = { id: id(), type: 'verse', stage: 'lyrics', raw: '', lines: [], bindings: {} };
  song.sections.push(section); alignSection(song, section, 'one two');
  song.patterns[0].lines[0].slots.forEach(note => { note.melody = 'D5'; note.chord = 'C'; });
  await page.goto('/');
  await page.locator('#import-file').setInputFiles({ name: 'modes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(song)) });
  await expect(page.locator('.advanced')).toHaveAttribute('open', '');
  await expect(page.locator('.song-detail-actions .quiet')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Chords', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Chords + melody', exact: true })).toBeVisible();
  await expect(page.locator('.bell-field')).toHaveCSS('max-width', '270px');
  const controlLayout = await page.locator('.advanced-grid').evaluate(grid => [...grid.children].map(element => ({
    className: element.className.trim().split(/\s+/).join(' '), y: element.getBoundingClientRect().y,
  })));
  expect(controlLayout.map(item => item.className)).toEqual(['ring-mode', 'field bell-field', 'field combined-notes', 'ring-beats', 'field custom-chords']);
  if ((await page.evaluate(() => innerWidth)) > 1050) {
    expect(new Set(controlLayout.map(item => item.y)).size).toBe(1);
    await page.setViewportSize({ width: 900, height: 1000 });
    const tabletRows = await page.locator('.advanced-grid').evaluate(grid => [...grid.children].map(element => element.getBoundingClientRect().y));
    expect(new Set(tabletRows).size).toBe(1);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await expect(page.getByLabel('Bells', { exact: true })).toHaveValue('C D E F G');
  await expect(page.getByLabel('Recommended bells', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Attribution', { exact: true })).toHaveValue('Words: Word author\nMusic: Composer\nSource license retained');
  await expect(page.getByLabel('Words by', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Music by', { exact: true })).toHaveCount(0);
  await expect(page.locator('.score-credit')).toContainText('Words: Word author');
  await expect(page.locator('.score-credit')).toContainText('Music: Composer');
  await expect(page.locator('.score-credit')).toContainText('Source license retained');
  await expect(page.getByRole('button', { name: 'Melody for one', exact: true })).toContainText('D');
  await expect(page.getByRole('button', { name: 'Melody for one', exact: true })).not.toContainText('D5');
  await expect(page.getByRole('tab', { name: 'C', exact: true })).toHaveCount(1);
  await expect(page.getByRole('tab', { name: 'C5', exact: true })).toHaveCount(0);
  const first = page.getByRole('group', { name: 'Calculated strikes for one', exact: true });
  await expect(first.locator('.calculated-strike')).toHaveText(['C', 'E', 'G']);
  await page.getByRole('textbox', { name: /^Custom chords/ }).fill('{"Csus4":"C5 F5 G5"}');
  await page.getByRole('textbox', { name: /^Custom chords/ }).blur();
  await page.getByRole('button', { name: 'Chord for one', exact: true }).click();
  await page.getByRole('button', { name: 'sus4', exact: true }).click();
  await expect(first.locator('.calculated-strike')).toHaveText(['C', 'F', 'G']);
  await page.getByRole('radio', { name: 'Chords + melody', exact: true }).check();
  await expect(page.getByLabel('Bells', { exact: true })).toHaveValue('C4 D4 E4 F4 G4 C5 D5');
  await expect(first.locator('.calculated-strike')).toHaveText(['F4', 'G4', 'C5', 'D5']);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'C4', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'C5', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'C5', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'C5', exact: true }).locator('.score-player-note')).toHaveText('C5');
});

test('section names remain stable after deletion and reordering and allow custom labels', async ({ page }, testInfo) => {
  page.on('dialog', dialog => dialog.accept(dialog.message() === 'Section name' ? 'Final blessing' : undefined));
  await page.goto('/');
  await page.getByLabel('Title', { exact: true }).fill('Stable verses');
  await page.getByLabel('Key signature').selectOption('C major');
  for (let verse = 1; verse <= 4; verse++) {
    await page.getByRole('button', { name: verse === 1 ? 'Add verse' : 'Verse', exact: true }).click();
    await page.getByRole('textbox', { name: 'Lyrics', exact: true }).fill('one two');
    await page.locator('#suggest-syllables').uncheck();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  }
  await expect(page.getByLabel('Select verse', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Move Verse 1 up', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move Verse 4 down', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Delete Verse 2', exact: true }).click();
  await expect(page.locator('#editor-title')).toHaveText('Verse 4');
  await expect(page.locator('.section-link span:nth-child(2)')).toHaveText(['Verse 1', 'Verse 3', 'Verse 4']);
  await page.getByRole('button', { name: 'Move Verse 3 down', exact: true }).click();
  await expect(page.locator('#editor-title')).toHaveText('Verse 4');
  await expect(page.locator('.section-link span:nth-child(2)')).toHaveText(['Verse 1', 'Verse 4', 'Verse 3']);
  await page.getByRole('button', { name: 'Verse', exact: true }).click();
  await expect(page.locator('#editor-title')).toHaveText('Verse 5');
  expect(await page.locator('#editor-title').evaluate(title => title.nextElementSibling?.getAttribute('data-action'))).toBe('rename-section');
  await expect(page.locator('.editor-heading [data-action="move-up"], .editor-heading [data-action="move-down"], .editor-heading [data-action="delete-section"]')).toHaveCount(0);
  await expect(page.locator('.section-nav-actions')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Move Verse 3 up', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Move Verse 5 down', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Rename section', exact: true }).click();
  await expect(page.locator('#editor-title')).toHaveText('Final blessing');
  await page.getByRole('textbox', { name: 'Lyrics', exact: true }).fill('one two');
  await page.locator('#suggest-syllables').uncheck();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Conductor', exact: true }).locator('.score-verse-number')).toHaveText(['1.', '4.', '3.', 'Final blessing']);
  await page.getByRole('tab', { name: 'Eb', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Eb', exact: true }).locator('.score-section h4')).toHaveText(['Verse 1', 'Verse 4', 'Verse 3', 'Final blessing']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.locator('.workspace').screenshot({ path: testInfo.outputPath('section-navigation.png') });
});

test('all note durations use consistently large notation glyphs', async ({ page }, testInfo) => {
  await newArrangement(page);
  for (const [word, duration] of [['Ring', 'Eighth'], ['the', 'Quarter'], ['bells', 'Half'], ['today', 'Whole'],
    ['Share', 'Dotted eighth'], ['a', 'Dotted quarter'], ['song', 'Dotted half'], ['with', 'Dotted whole']]) {
    await page.getByRole('button', { name: `Duration for ${word}`, exact: true }).click();
    await page.getByRole('button', { name: duration, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Duration for Ring', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  for (const symbol of await page.locator('.duration-value, .music-symbol').all()) {
    await expect(symbol).toHaveCSS('font-size', '32px');
    expect(await symbol.evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
  }
  const noteText = await page.locator('.music-line').first().locator('.duration-value').allTextContents();
  expect(noteText).toEqual(['\ud834\udd60', '\ud834\udd5f', '\ud834\udd5e', '\ud834\udd5d']);
  expect(await page.evaluate(() => document.fonts.check('32px "Noto Music"', '\ud834\udd60\ud834\udd5f\ud834\udd5e\ud834\udd5d'))).toBe(true);
  await page.getByRole('button', { name: 'Toggle dark mode', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('large-notes.png'), fullPage: true });
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('.score-duration')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('conductor stacks three verses, shows hollow sustains, and lists play counts', async ({ page }, testInfo) => {
  await newArrangement(page);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  for (const lyrics of ['Hear the notes again\nJoin a song with friends', 'Play the notes today\nBring a song to friends']) {
    await page.getByRole('button', { name: 'Verse', exact: true }).click();
    await page.getByRole('textbox', { name: 'Lyrics', exact: true }).fill(lyrics);
    await page.locator('#suggest-syllables').uncheck();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Chorus', exact: true }).click();
  await page.getByRole('textbox', { name: 'Lyrics', exact: true }).fill('Ring once more');
  await page.locator('#suggest-syllables').uncheck();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const conductor = page.getByRole('tabpanel', { name: 'Conductor', exact: true });
  await expect(conductor.locator('.score-section h4')).toHaveText(['verse', 'chorus']);
  const verse = conductor.locator('.score-conductor-section').first();
  await expect(verse.locator('.score-line')).toHaveCount(2);
  const firstLine = verse.locator('.score-line').first();
  await expect(firstLine.locator('.score-verse-number')).toHaveText(['1.', '2.', '3.']);
  await expect(verse.locator('.score-line').nth(1).locator('.score-verse-number')).toHaveText(['', '', '']);
  await expect(firstLine.locator('.score-verse-row').nth(0).locator('.score-word')).toHaveText(['Ring', 'the', 'bells', 'today']);
  await expect(firstLine.locator('.score-verse-row').nth(1).locator('.score-word')).toHaveText(['Hear', 'the', 'notes', 'again']);
  await expect(firstLine.locator('.score-verse-row').nth(2).locator('.score-word')).toHaveText(['Play', 'the', 'notes', 'today']);
  const lyricCell = firstLine.locator('.score-word').first();
  await expect(lyricCell).toHaveCSS('font-size', '14px');
  await expect(lyricCell).toHaveCSS('border-bottom-width', '0px');
  await expect(lyricCell).toHaveCSS('padding-top', '3px');
  await expect(lyricCell).toHaveCSS('padding-bottom', '3px');
  const sustained = conductor.locator('.score-bell-sustain').first();
  await expect(sustained).toBeVisible();
  await expect(sustained).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(sustained).toHaveCSS('border-top-style', 'solid');
  await expect(conductor.locator('.score-bell-strike').first()).toBeVisible();
  await expect(conductor.locator('.score-duration, .score-melody, .score-damps')).toHaveCount(0);
  await expect(conductor.locator('.score-count-item')).toHaveCount(7);
  await expect(conductor.locator('table.score-play-counts')).toHaveCount(0);
  for (const count of await conductor.locator('.score-play-count-label').allTextContents()) expect(count).toMatch(/^\d+ plays?$/);
  const countPositions = await conductor.locator('.score-count-item').evaluateAll(items => items.map(item => {
    const box = item.getBoundingClientRect(); return { x: box.x, y: box.y };
  }));
  for (let index = 1; index < countPositions.length; index++) {
    expect(countPositions[index].x).toBeGreaterThan(countPositions[index - 1].x);
    expect(countPositions[index].y).toBeCloseTo(countPositions[0].y, 0);
  }
  const countNote = conductor.locator('.score-count-note').first();
  await expect(countNote).toHaveCSS('width', '32px');
  await expect(countNote).toHaveCSS('height', '32px');
  const rowBoxes = await firstLine.locator('tr').evaluateAll(rows => rows.map(row => {
    const box = row.getBoundingClientRect(); return { top: box.top, bottom: box.bottom };
  }));
  for (let index = 1; index < rowBoxes.length; index++) expect(rowBoxes[index].top).toBeGreaterThanOrEqual(rowBoxes[index - 1].bottom - 1);
  await page.locator('.score-root').screenshot({ path: testInfo.outputPath('conductor-stacked-light.png') });
  await page.getByRole('button', { name: 'Toggle dark mode', exact: true }).click();
  await page.locator('.score-root').screenshot({ path: testInfo.outputPath('conductor-stacked-dark.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.emulateMedia({ media: 'print' });
  await expect(conductor.locator('.score-conductor-table').first()).toHaveCSS('min-width', '0px');
  await expect(lyricCell).toHaveCSS('font-size', '11px');
  await expect(lyricCell).toHaveCSS('border-bottom-width', '0px');
  await expect(lyricCell).toHaveCSS('padding-top', '0.75px');
  await expect(lyricCell).toHaveCSS('padding-bottom', '0.75px');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  const printWidths = await conductor.locator('.score-conductor-table').evaluateAll(tables => tables.map(table => ({
    width: table.getBoundingClientRect().width, parent: table.parentElement!.getBoundingClientRect().width,
  })));
  for (const table of printWidths) expect(table.width).toBeLessThanOrEqual(table.parent + 1);
});

test('theme toggle preserves editing, remembers a cookie, and prints in light mode', async ({ page, context }, testInfo) => {
  page.on('dialog', dialog => dialog.accept());
  await page.emulateMedia({ colorScheme: 'light' });
  await newArrangement(page);
  await page.getByRole('button', { name: 'Duration for Ring', exact: true }).click();
  const toggle = page.getByRole('button', { name: 'Toggle dark mode', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveAttribute('title', 'Switch to light mode');
  await expect(page.locator('.palette')).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Morning bells');
  await expect(page.locator('.editor-column')).toHaveCSS('background-color', 'rgb(29, 37, 33)');
  const cookie = (await context.cookies()).find(cookie => cookie.name === 'ringalong-theme');
  expect(cookie?.value).toBe('dark');
  expect(cookie?.sameSite).toBe('Lax');
  expect(cookie!.expires).toBeGreaterThan(Date.now() / 1000 + 300 * 86400);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('.score-root')).toHaveCSS('background-color', 'rgb(29, 37, 33)');
  await page.screenshot({ path: testInfo.outputPath('dark-conductor.png'), fullPage: true });
  await page.getByRole('tab', { name: 'F4', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('dark-bell.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await page.emulateMedia({ media: 'screen' });
  await toggle.click();
  expect((await context.cookies()).find(cookie => cookie.name === 'ringalong-theme')?.value).toBe('light');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.editor-column')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const brand = await page.locator('.brand').boundingBox(), toolbar = await page.locator('.app-header nav').boundingBox();
  expect(brand!.x + brand!.width).toBeLessThanOrEqual(toolbar!.x + 1);
  await page.screenshot({ path: testInfo.outputPath('light-narrow.png'), fullPage: true });
});

test('system theme is the default until an explicit cookie preference exists', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect((await context.cookies()).some(cookie => cookie.name === 'ringalong-theme')).toBe(false);
  await page.getByRole('button', { name: 'Toggle dark mode', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('combined notes are chosen from dropdown pairs that can be added and removed', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: /^Pair 1/ })).toHaveCount(0);
  const add = page.getByRole('button', { name: 'Add pair', exact: true });
  await add.click();
  const first = page.getByRole('combobox', { name: 'Pair 1, first note' }), second = page.getByRole('combobox', { name: 'Pair 1, second note' });
  await expect(first.locator('option')).toHaveText(['–', 'Eb', 'F', 'G', 'A', 'Bb', 'C', 'D']);
  expect((await add.boundingBox())!.y).toBeGreaterThan((await first.boundingBox())!.y);
  await first.selectOption('F'); await second.selectOption('F');
  await expect(page.locator('#notice')).toContainText('choose two different bells');
  await second.selectOption('A');
  await expect(page.locator('#notice')).toBeHidden();
  await expect(first).toHaveValue('F'); await expect(second).toHaveValue('A');
  await add.click();
  await page.getByRole('combobox', { name: 'Pair 2, first note' }).selectOption('A');
  await page.getByRole('combobox', { name: 'Pair 2, second note' }).selectOption('F');
  await expect(page.locator('#notice')).toContainText('already listed');
  await page.getByRole('combobox', { name: 'Pair 2, second note' }).selectOption('G');
  await page.getByRole('button', { name: 'Remove pair 1', exact: true }).click();
  await expect(page.getByRole('combobox', { name: /^Pair 2/ })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Pair 1, first note' })).toHaveValue('A');
  await expect(page.getByRole('combobox', { name: 'Pair 1, second note' })).toHaveValue('G');
  await page.getByRole('button', { name: 'Remove pair 1', exact: true }).click();
  await expect(page.getByRole('combobox', { name: /^Pair 1/ })).toHaveCount(0);
});
