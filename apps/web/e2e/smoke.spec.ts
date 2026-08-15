import { expect, test } from '@playwright/test';

/**
 * §12 — the web e2e smoke path: login → create room → create folder → upload →
 * share. It runs against a real API and a real browser, so it catches the things
 * the API suite cannot: cookie flow, the direct-to-storage PUT, and dialog wiring.
 */
const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'demo@strongroom.test';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password-001';

const roomName = `E2E Room ${Date.now()}`;

test('login, create a room, add a folder, upload a file, and share it', async ({ page }) => {
  // --- login (§3.2) -----------------------------------------------------
  await page.goto('/login');
  await page.getByLabel('Email').fill(DEMO_EMAIL);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Data rooms' })).toBeVisible();

  // --- create a data room (§8.1) ---------------------------------------
  await page.getByRole('button', { name: 'New data room' }).click();
  await page.getByLabel('Name').fill(roomName);
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByText(roomName)).toBeVisible();
  await page.getByText(roomName).first().click();
  await expect(page).toHaveURL(/\/n\//);

  // --- create a folder (§8.1) ------------------------------------------
  await page.getByRole('button', { name: 'New folder' }).first().click();
  await page.getByLabel('Name').fill('02 Financials');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('link', { name: '02 Financials' })).toBeVisible();

  // --- upload a file through the real §7.1 handshake --------------------
  await page.setInputFiles('input[type=file]', {
    name: 'QoE_Report.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\n% e2e fixture\n'),
  });

  await expect(page.getByText('Complete')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'QoE_Report.pdf' })).toBeVisible();

  // --- share the room by link (§8.3) -----------------------------------
  await page.getByRole('button', { name: 'Share', exact: true }).first().click();
  await page.getByRole('button', { name: 'Public link' }).click();
  await page.getByRole('button', { name: 'Create public link' }).click();

  const linkInput = page.locator('input[readonly]');
  await expect(linkInput).toHaveValue(/\/s\//, { timeout: 15_000 });

  // --- the public link resolves without a session (§8.4) ---------------
  const shareUrl = await linkInput.inputValue();
  const token = shareUrl.split('/s/')[1];

  const anonymous = await page.context().browser()!.newContext();
  const anonPage = await anonymous.newPage();
  await anonPage.goto(`/s/${token}`);
  await expect(anonPage.getByText('Shared with you · read only')).toBeVisible();
  await expect(anonPage.getByText('02 Financials')).toBeVisible();
  await anonymous.close();
});
