import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
const consoleLines = [];

page.on('pageerror', (error) => errors.push(error?.stack || error?.message || String(error)));
page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));

try {
  const response = await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('HTTP', response?.status());
  await page.waitForTimeout(7000);

  const state = await page.evaluate(() => ({
    title: document.title,
    authHidden: document.getElementById('authScreen')?.hidden,
    appHidden: document.getElementById('appShell')?.hidden,
    readyState: document.readyState,
    appScript: document.querySelector('script[type="module"][src*="js/app.js"]')?.getAttribute('src') || ''
  }));

  console.log('STATE', JSON.stringify(state));
  console.log('PAGE_ERRORS', JSON.stringify(errors));
  console.log('CONSOLE', JSON.stringify(consoleLines));

  if (errors.length) throw new Error(errors.join('\n---\n'));
  if (state.authHidden === true && state.appHidden === true) throw new Error('Pantalla blanca reproducida');
} finally {
  await browser.close();
}
