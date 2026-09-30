#!/usr/bin/env node
// Capture a page at a set of standard viewport widths (mobile/tablet/laptop/desktop)
// using Playwright, for quick visual review of responsive changes.
//
// Requires the target dev server to already be running (e.g. `npm run dev:client`).
//
// Usage:
//   node scripts/screenshot.mjs [path] [options]
//
// Options:
//   --base=<url>        Base URL of the running server (default: http://localhost:5183)
//   --out=<dir>          Output directory (default: scripts/.screenshots)
//   --devices=<list>      Comma-separated preset names (default: all presets)
//   --theme=<light|dark>  Seeds localStorage("qs_theme") before navigating
//   --full                Capture the full scrollable page instead of just the viewport
//
// Examples:
//   node scripts/screenshot.mjs /
//   node scripts/screenshot.mjs /cart --devices=mobile,laptop --theme=dark
//   node scripts/screenshot.mjs /shop --base=http://localhost:5173 --full

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const PRESETS = {
  'mobile-sm': { width: 375, height: 667 }, // iPhone SE
  mobile: { width: 390, height: 844 }, // iPhone 12/13/14
  tablet: { width: 820, height: 1180 }, // iPad
  laptop: { width: 1366, height: 800 }, // common laptop
  desktop: { width: 1920, height: 1080 },
};

function parseArgs(argv) {
  const opts = {
    path: '/',
    base: process.env.SCREENSHOT_BASE_URL || 'http://localhost:5183',
    out: 'scripts/.screenshots',
    devices: Object.keys(PRESETS),
    theme: null,
    full: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--base=')) opts.base = arg.slice(7);
    else if (arg.startsWith('--out=')) opts.out = arg.slice(6);
    else if (arg.startsWith('--devices=')) opts.devices = arg.slice(10).split(',').filter(Boolean);
    else if (arg.startsWith('--theme=')) opts.theme = arg.slice(8);
    else if (arg === '--full') opts.full = true;
    else if (!arg.startsWith('--')) opts.path = arg;
  }

  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const unknown = opts.devices.filter((name) => !PRESETS[name]);
  if (unknown.length) {
    console.error(`Unknown device preset(s): ${unknown.join(', ')}`);
    console.error(`Available presets: ${Object.keys(PRESETS).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const url = new URL(opts.path, opts.base).toString();
  await mkdir(opts.out, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const name of opts.devices) {
      const size = PRESETS[name];
      const context = await browser.newContext({ viewport: size });
      if (opts.theme) {
        await context.addInitScript((theme) => {
          window.localStorage.setItem('qs_theme', theme);
        }, opts.theme);
      }

      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);

      if (opts.full) {
        // .cv-auto sections use content-visibility:auto for perf; Chromium won't
        // paint them for a full-page screenshot unless forced, so override it here.
        await page.addStyleTag({ content: '.cv-auto { content-visibility: visible !important; }' });

        // This site reveals sections via IntersectionObserver as they scroll into
        // view (see useReveal.ts) — walk the page once so everything below the
        // fold has already animated in before the full-page capture.
        await page.evaluate(async () => {
          const step = Math.max(200, window.innerHeight);
          for (let y = 0; y < document.body.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise((resolve) => setTimeout(resolve, 60));
          }
          window.scrollTo(0, 0);
        });
        await page.waitForTimeout(300);
      }

      const suffix = opts.theme ? `-${opts.theme}` : '';
      const file = path.join(opts.out, `${name}-${size.width}x${size.height}${suffix}.png`);
      await page.screenshot({ path: file, fullPage: opts.full });
      console.log(`Saved ${file}`);

      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
