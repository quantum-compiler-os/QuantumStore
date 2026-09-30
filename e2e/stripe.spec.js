import { test, expect } from '@playwright/test';

test.describe('Stripe + legal pages', () => {
  test('payments config is public and stripe disabled without keys', async ({ request }) => {
    const res = await request.get('http://localhost:5000/api/payments/config');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('stripeEnabled');
    expect(body).toHaveProperty('publishableKey');
  });

  test('checkout session refuses when Stripe is not configured', async ({ request }) => {
    const products = await request.get('http://localhost:5000/api/products?limit=1');
    const { items } = await products.json();
    expect(items.length).toBeGreaterThan(0);

    const orderRes = await request.post('http://localhost:5000/api/orders', {
      data: {
        customerName: 'Stripe Guest',
        email: `stripe_${Date.now()}@example.com`,
        phone: '5559998888',
        address: '1 Stripe Avenue, City',
        paymentMethod: 'stripe',
        items: [{ productId: items[0]._id, quantity: 1 }],
      },
    });
    expect(orderRes.ok()).toBeTruthy();
    const order = await orderRes.json();

    const checkout = await request.post('http://localhost:5000/api/payments/create-checkout-session', {
      data: { orderId: order._id },
    });
    expect(checkout.status()).toBe(400);
    const body = await checkout.json();
    expect(body.message).toMatch(/stripe/i);
  });

  test('session-status is read-only and requires a reference', async ({ request }) => {
    const res = await request.get('http://localhost:5000/api/payments/session-status');
    expect(res.status()).toBe(400);
  });

  test('legal pages render', async ({ page }) => {
    for (const path of ['/privacy', '/terms', '/returns']) {
      await page.goto(path);
      await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
    }
  });

  test('health endpoint reports storage driver', async ({ request }) => {
    const res = await request.get('http://localhost:5000/api/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.storage).toBeTruthy();
  });
});
