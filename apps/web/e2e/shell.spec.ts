import { expect, test } from '@playwright/test';

/**
 * spec 003 §3–§4 — the shell behaviours that only a real browser can prove:
 * theme persistence across reloads, sidebar collapse, the mobile drawer, and
 * breadcrumb collapsing past four segments.
 */
const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'demo@strongroom.test';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password-001';

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(DEMO_EMAIL);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Data rooms' })).toBeVisible();
}

test.describe('app shell', () => {
  test('theme can be switched from the user menu and survives a reload (§3.1, §3.2)', async ({
    page,
  }) => {
    await signIn(page);

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // §3.2 — the pre-paint script re-applies it before the page renders.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // And the settings page drives the same state (§3.4).
    await page.goto('/account');
    await expect(page.getByRole('radio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('sidebar collapses to icons and remembers it (§4.1)', async ({ page }) => {
    await signIn(page);

    const nav = page.getByRole('link', { name: 'Data rooms', exact: true });
    await expect(nav).toBeVisible();

    await page.getByRole('button', { name: 'Collapse sidebar' }).click();

    // Collapsed: the label is gone from the DOM, but reachable as a tooltip.
    const collapsedNav = page.locator('aside a[title="Data rooms"]');
    await expect(collapsedNav).toBeVisible();

    await page.reload();
    await expect(page.locator('aside a[title="Data rooms"]')).toBeVisible();
  });

  test('mobile shows a header with a drawer and an account menu (§4.4)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await signIn(page);

    await expect(page.locator('aside')).toBeHidden();

    await page.getByRole('button', { name: 'Open navigation' }).click();
    // Scoped to the drawer landmark: the desktop sidebar carries the same links,
    // and a data room can legitimately be named "Trash".
    const drawerTrash = page
      .getByRole('navigation', { name: 'Navigation drawer' })
      .locator('a[href="/trash"]');
    await expect(drawerTrash).toBeVisible();

    // Escape closes it (§4.4).
    await page.keyboard.press('Escape');
    await expect(drawerTrash).toBeHidden();

    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  });

  test('breadcrumbs collapse past four segments (§4.5)', async ({ page }) => {
    await signIn(page);

    // Build a deep-enough tree: room / A / B / C / D.
    await page.getByRole('button', { name: 'New data room' }).click();
    const room = `Breadcrumbs ${Date.now()}`;
    await page.getByLabel('Name').fill(room);
    await page.getByRole('button', { name: 'Create' }).click();
    await page.getByText(room).first().click();
    await expect(page).toHaveURL(/\/n\//);

    for (const name of ['A', 'B', 'C', 'D']) {
      await page.getByRole('button', { name: 'New folder' }).first().click();
      await page.getByLabel('Name').fill(name);
      await page.getByRole('button', { name: 'Create' }).click();
      await page.getByRole('link', { name, exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    }

    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    // Root, ellipsis menu, then the last two — first and last never collapse.
    await expect(crumbs.getByRole('button', { name: /Show \d+ hidden folders/ })).toBeVisible();
    await expect(crumbs.getByText('D', { exact: true })).toBeVisible();

    await crumbs.getByRole('button', { name: /Show \d+ hidden folders/ }).click();
    await expect(page.getByRole('menuitem', { name: 'A' })).toBeVisible();
  });
});

test('deleting moves an item to Trash, and restoring puts it back (003 §2.2, §2.6)', async ({
  page,
}) => {
  await signIn(page);

  const room = `Deleting ${Date.now()}`;
  const folder = `Doomed ${Date.now()}`;
  await page.getByRole('button', { name: 'New data room' }).click();
  await page.getByLabel('Name').fill(room);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByText(room).first().click();
  await expect(page).toHaveURL(/\/n\//);

  await page.getByRole('button', { name: 'New folder' }).first().click();
  await page.getByLabel('Name').fill(folder);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('link', { name: folder, exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Item actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: /Delete folder/ }).click();
  await expect(page.getByRole('link', { name: folder, exact: true })).toBeHidden();

  await page.goto('/trash');
  await expect(page.getByText(folder, { exact: true })).toBeVisible();
  // §2.4 — the origin trail is what tells trashed items apart. Target the
  // "Deleted from" cell specifically; the same text also renders in a
  // mobile-only line that is hidden at this viewport.
  await expect(page.getByRole('cell', { name: room, exact: true })).toBeVisible();

  // Restore the row we just created, not whatever else the trash holds.
  await page
    .getByRole('row')
    .filter({ hasText: folder })
    .getByRole('button', { name: 'Restore' })
    .click();
  await expect(page.getByText(folder, { exact: true })).toBeHidden();
});

test('a trashed item can be destroyed early, named exactly (003 §2.7)', async ({ page }) => {
  await signIn(page);

  const room = `Purging ${Date.now()}`;
  await page.getByRole('button', { name: 'New data room' }).click();
  await page.getByLabel('Name').fill(room);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByText(room).first().click();
  await expect(page).toHaveURL(/\/n\//);

  const folder = `Condemned ${Date.now()}`;
  await page.getByRole('button', { name: 'New folder' }).first().click();
  await page.getByLabel('Name').fill(folder);
  await page.getByRole('button', { name: 'Create' }).click();

  await page.getByRole('button', { name: 'Item actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: /Delete folder/ }).click();

  await page.goto('/trash');
  await page
    .getByRole('row')
    .filter({ hasText: folder })
    .getByRole('button', { name: `Delete “${folder}” permanently` })
    .click();

  // The dialog names the item and says plainly that 30 days do not apply.
  await expect(page.getByText(`Permanently delete “${folder}”?`)).toBeVisible();
  await page.getByRole('button', { name: 'Delete permanently' }).click();

  await expect(page.getByText(folder, { exact: true })).toBeHidden();
});
