import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

test.beforeEach(async ({ context }) => {
  await context.route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) await route.continue();
    else { await route.abort('blockedbyclient'); throw new Error(`Hymn tests use local fixtures, not external services: ${url.hostname}`); }
  });
});

const catalog = () => JSON.parse(readFileSync(join(process.cwd(), 'web/public/hymns/catalog.json'), 'utf8'));

async function openFinder(page: Page) {
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Find a public domain hymn', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Find a public domain hymn' });
  await expect(popup).toBeVisible();
  return popup;
}

test('the Import button offers loading from a file or finding a public domain hymn', async ({ page }) => {
  await page.goto('/');
  const menu = page.getByRole('menu', { name: 'Import' });
  await expect(menu).toBeHidden();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(menu.getByRole('menuitem')).toHaveText(['Load from file', 'Find a public domain hymn']);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Load from file', exact: true }).click();
  await chooser;
  await expect(menu).toBeHidden();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('heading', { name: 'Song details' }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByLabel('Hymn number', { exact: true })).not.toHaveAttribute('placeholder', /.+/);
  await expect(page.getByRole('button', { name: 'Look up', exact: true })).toHaveCount(0);
});

test('search by title, review details, and load a public-domain hymn', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const popup = await openFinder(page);
  const load = popup.getByRole('button', { name: 'Load hymn', exact: true });
  await expect(load).toBeDisabled();
  await popup.getByLabel('Search hymns').fill('amazing');
  const choice = popup.getByRole('radio', { name: /Amazing Grace/ });
  await expect(popup.getByRole('radio')).toHaveCount(1);
  await popup.getByText('Details', { exact: true }).click();
  await expect(popup.getByText('Tune:')).toBeVisible();
  await expect(choice).not.toBeChecked();
  await expect(load).toBeDisabled();
  await expect(popup).toContainText('Public domain (United States)');
  await page.screenshot({ path: testInfo.outputPath('hymn-search.png'), fullPage: true });
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel(/^Title/)).toBeEmpty();
  await openFinder(page);
  await popup.getByLabel('Search hymns').fill('amazing');
  await choice.check();
  await expect(load).toBeEnabled();
  await load.click();
  await expect(page.locator('#notice')).toContainText('Loaded UMH 378: Amazing Grace');
  await expect(page.getByLabel(/^Title/)).toHaveValue('Amazing Grace');
  await expect(page.getByLabel('Hymn number', { exact: true })).toHaveValue('378');
  await expect(page.getByLabel('Key signature')).toHaveValue('G major');
  await expect(page.getByLabel('Beats per measure')).toHaveValue('3');
  await expect(page.getByLabel('Pickup beats')).toHaveValue('1');
  await expect(page.getByRole('tab', { name: 'Conductor', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});

test('a hymn number finds only registered hymns, with or without a hymnal prefix', async ({ page }) => {
  await page.goto('/');
  const popup = await openFinder(page);
  const search = popup.getByLabel('Search hymns');
  const size = async () => (await popup.boundingBox())!;
  const everything = await size();
  await search.fill('378');
  await expect(popup.getByRole('radio')).toHaveCount(1);
  expect(await size()).toEqual(everything);
  await search.fill('zzzz');
  await expect(popup.getByRole('radio')).toHaveCount(0);
  expect(await size()).toEqual(everything);
  await search.fill('378');
  await expect(popup.getByRole('radio', { name: /Amazing Grace/ })).toBeVisible();
  await search.fill('UMH 218');
  await expect(popup.getByRole('radio', { name: /It Came Upon A Midnight Clear/ })).toBeVisible();
  await search.fill('TFWS 2212');
  await expect(popup.getByRole('radio', { name: /My Life Flows On/ })).toBeVisible();
  await search.fill('962');
  await expect(popup.getByRole('radio')).toHaveCount(0);
  await expect(popup).toContainText('No matching hymns.');
  await expect(popup.getByRole('button', { name: 'Load hymn', exact: true })).toBeDisabled();
});

test('search matches the first line and loads hymns that have no hymnal number', async ({ page }) => {
  const entries = catalog();
  const base = entries.find((entry: { number: string }) => entry.number === '57');
  const unnumbered = { ...base, id: 'oh-175', hymnal: 'OH', hymnalName: 'Open Hymnal (no hymnal number)', number: '', title: 'Unnumbered Tongues', tune: '', firstLine: 'Oh for a thousand tongues to sing' };
  await page.route('**/hymns/catalog.json', route => route.fulfill({ json: [...entries, unnumbered] }));
  await page.goto('/');
  const popup = await openFinder(page);
  await popup.getByLabel('Search hymns').fill('thousand tongues');
  await expect(popup.getByRole('radio')).toHaveCount(2);
  await popup.getByRole('radio', { name: /Unnumbered Tongues/ }).check();
  await popup.getByRole('button', { name: 'Load hymn', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Loaded Open Hymnal: Unnumbered Tongues');
  await expect(page.getByLabel(/^Title/)).toHaveValue('Unnumbered Tongues');
  await expect(page.getByLabel('Hymn number', { exact: true })).toHaveValue('');
  await expect(page.locator('.word-cell').first()).toBeVisible();
});

test('replacing a meaningful arrangement asks first, and cancelling keeps it', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const messages: string[] = [];
  let accept = false;
  page.on('dialog', dialog => { messages.push(dialog.message()); void (accept ? dialog.accept() : dialog.dismiss()); });
  await page.goto('/');
  await page.getByLabel(/^Title/).fill('Existing arrangement');
  let popup = await openFinder(page);
  await popup.getByLabel('Search hymns').fill('midnight');
  await expect(popup.getByLabel('Keep my current bell set', { exact: true })).not.toBeChecked();
  await popup.getByRole('radio', { name: /It Came Upon A Midnight Clear/ }).check();
  await popup.getByRole('button', { name: 'Load hymn', exact: true }).click();
  await expect.poll(() => messages.length).toBe(1);
  await expect(page.getByLabel(/^Title/)).toHaveValue('Existing arrangement');
  accept = true;
  popup = await openFinder(page);
  await popup.getByLabel('Search hymns').fill('midnight');
  await popup.getByRole('radio', { name: /It Came Upon A Midnight Clear/ }).check();
  await popup.getByRole('button', { name: 'Load hymn', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Loaded UMH 218: It Came Upon A Midnight Clear');
  await expect(page.getByLabel(/^Title/)).toHaveValue('It Came Upon A Midnight Clear');
  expect(errors).toEqual([]);
});

for (const hymn of [
  { input: '2062', number: '2062', title: 'The Lily of the Valley' },
  { input: 'TFWS 2212', number: '2212', title: 'My Life Flows On (How Can I Keep from Singing)' },
]) test(`load The Faith We Sing ${hymn.number} with reviewed lyrics and music`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const popup = await openFinder(page);
  await popup.getByLabel('Search hymns').fill(hymn.input);
  await popup.getByRole('radio', { name: new RegExp(`TFWS ${hymn.number}`) }).check();
  await popup.getByRole('button', { name: 'Load hymn', exact: true }).click();
  await expect(page.locator('#notice')).toContainText(`Loaded TFWS ${hymn.number}`);
  await expect(page.getByLabel(/^Title/)).toHaveValue(hymn.title);
  await expect(page.getByLabel('Hymn number', { exact: true })).toHaveValue(hymn.number);
  await expect(page.locator('.word-cell').first()).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Conductor', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Attribution', { exact: true })).toContainText('public domain');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});

test('download errors preserve the arrangement', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel(/^Title/).fill('Keep my arrangement');
  await page.route('**/hymns/*.abc', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  const popup = await openFinder(page);
  await popup.getByLabel('Search hymns').fill('holy holy');
  await popup.getByRole('radio').first().check();
  await popup.getByRole('button', { name: 'Load hymn', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Hymn download failed (503)');
  await expect(page.getByLabel(/^Title/)).toHaveValue('Keep my arrangement');
});
