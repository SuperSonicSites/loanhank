import { expect, test } from '@playwright/test';

const pdf = Buffer.from('%PDF-1.4\n% SYNTHETIC ONLY\n');

test('guest completes the mobile-first U.S. X-Ray and scenario flow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /know what your loan is doing/i })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await page.getByRole('button', { name: /run a loan x-ray/i }).click();
  await expect(page.getByRole('heading', { name: /where is this loan held/i })).toBeVisible();
  await page.getByRole('button', { name: /united states/i }).click();

  await expect(page.getByRole('button', { name: /take a photo/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /choose an existing file/i })).toBeVisible();
  await expect(page.getByTestId('camera-input')).toHaveAttribute('capture', 'environment');
  await page.getByTestId('file-input').setInputFiles({ name: 'synthetic-loan.pdf', mimeType: 'application/pdf', buffer: pdf });

  await expect(page.getByRole('heading', { name: /confirm what drives the math/i })).toBeVisible();
  await expect(page.getByLabel('Interest compounding')).toHaveValue('nominal_payment_frequency');
  await page.getByRole('button', { name: /run the x-ray/i }).click();

  await expect(page.getByText('Estimate', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/your current structure is ready to compare/i)).toBeVisible();
  await expect(page.getByText(/holds up well/i)).toHaveCount(0);

  await page.getByLabel('Payment frequency').selectOption('monthly');
  await page.getByRole('button', { name: /test this scenario/i }).click();
  await expect(page.getByText('Scenario', { exact: true })).toBeVisible();
  await expect(page.getByText(/tested/i)).toBeVisible();

  await page.locator('summary').filter({ hasText: 'Show me the math' }).click();
  await expect(page.getByTestId('math-disclosure')).toContainText('Periodic rate:');
  await expect(page.getByTestId('math-disclosure')).toContainText('Compounding:');
  await page.locator('summary').filter({ hasText: 'Official reference context' }).click();
  await expect(page.getByText(/public references are context/i)).toBeVisible();

  await page.getByRole('button', { name: /close analysis/i }).click();
  await expect(page.getByRole('button', { name: /run a loan x-ray/i })).toBeVisible();
});

test('Canada shortcut, safe areas, offline messaging, and guest auth gates work', async ({ page, context }) => {
  await page.goto('/?start=1');
  await page.getByRole('button', { name: /canada/i }).click();
  await expect(page.getByText(/private upload · ca/i)).toBeVisible();
  await page.getByRole('button', { name: /close analysis/i }).click();

  await page.getByRole('button', { name: 'Loans' }).click();
  await expect(page.getByRole('link', { name: /sign in with chatgpt/i })).toBeVisible();
  await page.getByRole('button', { name: 'Watch' }).click();
  await expect(page.getByText(/quiet watch/i)).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText(/you’re offline/i)).toBeVisible();
  await context.setOffline(false);
});
