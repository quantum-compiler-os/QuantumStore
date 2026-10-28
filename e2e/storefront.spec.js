import { test, expect } from '@playwright/test';

test.describe('QuantumStore e2e', () => {
  test('guest checkout flow', async ({ page }) => {
    await page.goto('/shop');
    await expect(page.getByRole('heading', { name: 'Shop' })).toBeVisible();

    const firstCard = page.locator('.product-card').first();
    await expect(firstCard).toBeVisible({ timeout: 30000 });
    await firstCard.locator('a').first().click();

    await expect(page.locator('.detail-body h1')).toBeVisible();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.getByRole('link', { name: 'Checkout' }).click();

    await page.locator('label', { hasText: 'Full name' }).locator('input').fill('Guest Buyer');
    await page.locator('label', { hasText: 'Email' }).locator('input').fill('guest@example.com');
    await page.locator('label', { hasText: 'Phone' }).locator('input').fill('5551234567');
    await page.locator('label', { hasText: 'Shipping address' }).locator('textarea').fill('123 Quantum Street, City');
    await page.getByRole('button', { name: /Place order/ }).click();

    await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeVisible({ timeout: 30000 });
  });

  test('coupon apply on checkout', async ({ page }) => {
    await page.goto('/shop');
    const firstCard = page.locator('.product-card').first();
    await expect(firstCard).toBeVisible({ timeout: 30000 });
    await firstCard.locator('a').first().click();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.getByRole('link', { name: 'Checkout' }).click();

    await page.getByPlaceholder('Coupon code').fill('WELCOME10');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText(/Discount/)).toBeVisible({ timeout: 15000 });
  });

  test('mobile hamburger opens and navigates', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.locator('#primary-nav')).toHaveClass(/open/);
    await page.locator('#primary-nav').getByRole('link', { name: 'Shop' }).click();
    await expect(page).toHaveURL(/\/shop/);
    await expect(page.getByRole('heading', { name: 'Shop' })).toBeVisible();
  });

  test('mobile guest checkout', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/shop');
    const firstCard = page.locator('.product-card').first();
    await expect(firstCard).toBeVisible({ timeout: 30000 });
    await firstCard.locator('a').first().click();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.getByRole('link', { name: 'Checkout' }).first().click();

    await page.locator('label', { hasText: 'Full name' }).locator('input').fill('Mobile Buyer');
    await page.locator('label', { hasText: 'Email' }).locator('input').fill('mobile@example.com');
    await page.locator('label', { hasText: 'Phone' }).locator('input').fill('5559876543');
    await page.locator('label', { hasText: 'Shipping address' }).locator('textarea').fill('99 Pocket Street, Town');
    await page.getByRole('button', { name: /Place order/ }).click();
    await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeVisible({ timeout: 30000 });
  });

  test('filtered shop and checkout with saved address', async ({ page }) => {
    const email = `buyer_${Date.now()}@example.com`;
    const password = 'buyer123';

    await page.goto('/register');
    await page.getByLabel('Full name', { exact: true }).fill('Filter Buyer');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: /Create account|Register|Sign up/i }).click();
    await expect(page).not.toHaveURL(/\/register/, { timeout: 30000 });

    await page.goto('/account/addresses');
    await expect(page.getByRole('heading', { name: /Addresses/i })).toBeVisible({ timeout: 30000 });
    await page.locator('label', { hasText: /^Label$/i }).locator('input').fill('Home');
    await page.locator('label', { hasText: /^Name$/i }).locator('input').fill('Filter Buyer');
    await page.locator('label', { hasText: /^Phone$/i }).locator('input').fill('5554443333');
    await page.locator('label', { hasText: /^Address$/i }).locator('textarea').fill('77 Shareable Filter Ave');
    await page.getByRole('button', { name: 'Add address' }).click();
    await expect(page.getByText('77 Shareable Filter Ave')).toBeVisible({ timeout: 15000 });

    await page.goto('/shop?inStock=true');
    await expect(page.getByRole('heading', { name: 'Shop' })).toBeVisible();
    await expect(page.locator('.filter-panel')).toBeVisible();
    await expect(page).toHaveURL(/inStock=true/);

    const firstCard = page.locator('.product-card').first();
    await expect(firstCard).toBeVisible({ timeout: 30000 });
    await firstCard.locator('a').first().click();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.getByRole('link', { name: 'Checkout' }).click();

    await expect(page.locator('.address-picker')).toBeVisible({ timeout: 15000 });
    await page.locator('.address-picker .chip', { hasText: 'Home' }).click();
    await page.locator('label.checkbox-row', { hasText: /Express/i }).locator('input').check();
    await page.locator('label', { hasText: /Order note/i }).locator('textarea').fill('Ring the bell');
    await page.getByRole('button', { name: /Place order/ }).click();
    await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeVisible({ timeout: 30000 });
  });

  test('return request on delivered order', async ({ page, request }) => {
    const email = `return_${Date.now()}@example.com`;
    const password = 'buyer123';

    await page.goto('/register');
    await page.getByLabel('Full name', { exact: true }).fill('Return Buyer');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: /Create account|Register|Sign up/i }).click();
    await expect(page).not.toHaveURL(/\/register/, { timeout: 30000 });

    await page.goto('/shop');
    const firstCard = page.locator('.product-card').first();
    await expect(firstCard).toBeVisible({ timeout: 30000 });
    await firstCard.locator('a').first().click();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.getByRole('link', { name: 'Checkout' }).click();
    await page.locator('label', { hasText: 'Phone' }).locator('input').fill('5552221111');
    await page.locator('label', { hasText: 'Shipping address' }).locator('textarea').fill('12 Return Road');
    await page.getByRole('button', { name: /Place order/ }).click();
    await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeVisible({ timeout: 30000 });

    const adminLogin = await request.post('http://localhost:5000/api/auth/login', {
      data: { email: 'admin@quaantumlogicslimited.com', password: 'admin123' },
    });
    expect(adminLogin.ok()).toBeTruthy();
    const { token: adminToken } = await adminLogin.json();

    const buyerLogin = await request.post('http://localhost:5000/api/auth/login', {
      data: { email, password },
    });
    const { token: buyerToken } = await buyerLogin.json();
    const mine = await request.get('http://localhost:5000/api/orders/mine', {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    const orders = await mine.json();
    const orderId = orders[0]._id;

    const statusRes = await request.patch(`http://localhost:5000/api/orders/${orderId}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: 'delivered' },
    });
    expect(statusRes.ok()).toBeTruthy();

    await page.goto('/account/orders');
    await expect(page.getByText(/delivered/i).first()).toBeVisible({ timeout: 30000 });
    await page.locator('label', { hasText: 'Return reason' }).locator('select').selectOption('Damaged');
    await page.getByRole('button', { name: 'Request return' }).click();
    await expect(page.getByText(/Return: requested|Return status:.*requested/i).first()).toBeVisible({
      timeout: 15000,
    });
  });
});
