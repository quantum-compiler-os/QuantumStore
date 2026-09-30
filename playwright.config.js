import { defineConfig, devices } from '@playwright/test';

const backendEnv = {
  ...process.env,
  NODE_ENV: 'development',
  USE_MEMORY_DB: 'true',
  JWT_SECRET: process.env.JWT_SECRET || 'test-secret-at-least-16-chars',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@quaantumlogicslimited.com',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',
  CLIENT_URL: 'http://127.0.0.1:5173',
};

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'npm run dev --prefix backend',
      url: 'http://localhost:5000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: backendEnv,
    },
    {
      command: 'npm run dev --prefix frontend -- --host 127.0.0.1 --port 5173',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
