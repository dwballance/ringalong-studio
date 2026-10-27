import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

test.beforeEach(async ({ context }) => {
  await context.route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) await route.continue();
    else { await route.abort('blockedbyclient'); throw new Error(`Hymn tests use local fixtures, not external services: ${url.hostname}`); }
  });
});

test('load a public-domain UMH hymn from its number and review the imported music', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const number = page.getByLabel('Hymn number', { exact: true });
  const load = page.getByRole('button', { name: 'Look up', exact: true });
  await expect(load).toBeDisabled();
  expect(await page.evaluate(() => Boolean(document.querySelector('[name="hymnNumber"]')!.compareDocumentPosition(document.querySelector('[name="title"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await number.fill('378');
  await load.click();
  const popup = page.getByRole('dialog', { name: 'Choose a hymn source' });
  await expect(popup).toBeVisible();
  await expect(popup.getByLabel('Hymnal', { exact: true })).toHaveValue('UMH1989');
  await expect(popup.getByRole('radio', { name: /Amazing Grace/ })).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('hymn-chooser.png'), fullPage: true });
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toBeEmpty();
  await load.click();
  await popup.getByRole('button', { name: 'Load hymn', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Loaded UMH 378: Amazing Grace');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Amazing Grace');
  await expect(page.getByLabel('Key signature')).toHaveValue('G major');
  await expect(page.getByLabel('Beats per measure')).toHaveValue('3');
  await expect(page.getByLabel('Pickup beats')).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Melody for A-', exact: true })).toContainText('D4');
  await expect(page.getByRole('tab', { name: 'Conductor', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('hymn-loaded.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('load UMH 218 from its reviewed mapping', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await page.getByLabel('Title', { exact: true }).fill('Existing arrangement');
  await page.getByLabel('Hymn number', { exact: true }).fill('UMH 218');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Choose a hymn source' });
  await expect(popup.getByRole('radio', { name: /It Came Upon A Midnight Clear/ })).toBeChecked();
  await expect(popup.getByLabel('Keep my current bell set', { exact: true })).not.toBeChecked();
  await popup.getByRole('button', { name: 'Load hymn', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Loaded UMH 218: It Came Upon A Midnight Clear');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('It Came Upon A Midnight Clear');
  await expect(page.locator('.word-cell').first()).toBeVisible();
  expect(errors).toEqual([]);
});

for (const hymn of [
  { input: '2062', number: '2062', title: 'The Lily of the Valley' },
  { input: 'TFWS 2212', number: '2212', title: 'My Life Flows On (How Can I Keep from Singing)' },
]) test(`load The Faith We Sing ${hymn.number} with reviewed lyrics and music`, async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Hymn number', { exact: true }).fill(hymn.input);
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Choose a hymn source' });
  await expect(popup.getByLabel('Hymnal', { exact: true })).toHaveValue('TFWS2000');
  await expect(popup.getByRole('radio', { name: new RegExp(hymn.number) })).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('tfws-source.png'), fullPage: true });
  await popup.getByRole('button', { name: 'Load hymn', exact: true }).click();
  await expect(page.locator('#notice')).toContainText(`Loaded TFWS ${hymn.number}`);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(hymn.title);
  await expect(page.getByLabel('Hymn number', { exact: true })).toHaveValue(hymn.number);
  await expect(page.locator('.word-cell').first()).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Conductor', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Attribution', { exact: true })).toContainText('public domain');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});

test('unsupported TFWS numbers offer an external reference without modifying or uploading the arrangement', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Title', { exact: true }).fill('Keep this song');
  await page.getByLabel('Hymn number', { exact: true }).fill('FWS 2175');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('No reviewed public-domain music is available for TFWS 2175');
  await expect(page.locator('#notice')).toContainText('See the catalog refresh instructions in the project README');
  await expect(page.locator('#notice')).not.toContainText('Supported TFWS numbers:');
  const reference = page.getByRole('link', { name: 'View TFWS 2175 reference' });
  await expect(reference).toHaveAttribute('href', 'https://hymnary.org/hymn/FWS/2175');
  await expect(reference).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Keep this song');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('choose the appropriate hymnal when a number has multiple matches', async ({ page }) => {
  const catalog = JSON.parse(readFileSync(join(process.cwd(), 'web/public/hymns/catalog.json'), 'utf8'));
  const first = catalog.find((entry: { number: string }) => entry.number === '378');
  const alternate = { ...first, id: 'alternate-378', hymnal: 'ALTERNATE', hymnalName: 'Another hymnal edition', title: 'Alternate source title' };
  await page.route('**/hymns/catalog.json', route => route.fulfill({ json: [first, alternate] }));
  await page.goto('/');
  await page.getByLabel('Hymn number', { exact: true }).fill('378');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  const popup = page.getByRole('dialog');
  await popup.getByLabel('Hymnal', { exact: true }).selectOption('ALTERNATE');
  await expect(popup.getByRole('radio', { name: /Alternate source title/ })).toBeChecked();
  await popup.getByRole('button', { name: 'Load hymn', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Alternate source title');
});

test('unsupported numbers, download errors and replacement cancellation preserve the arrangement', async ({ page }) => {
  page.on('dialog', dialog => dialog.dismiss());
  await page.goto('/');
  await page.getByLabel('Title', { exact: true }).fill('Keep my arrangement');
  await page.getByLabel('Hymn number', { exact: true }).fill('962');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('No reviewed public-domain music');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Keep my arrangement');
  await page.getByLabel('Hymn number', { exact: true }).fill('64');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Load hymn', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Look up', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Keep my arrangement');
  await page.route('**/hymns/*.abc', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Load hymn', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Hymn download failed (503)');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Keep my arrangement');
});