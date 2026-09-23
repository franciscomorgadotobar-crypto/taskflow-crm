import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
const consoleErrors = [];

page.on('pageerror', (error) => pageErrors.push(error?.stack || error?.message || String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

try {
  const response = await page.goto('http://127.0.0.1:4173/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  if (!response?.ok()) {
    throw new Error(`index.html respondió HTTP ${response?.status() ?? 'sin respuesta'}`);
  }

  await page.waitForFunction(() => {
    const auth = document.getElementById('authScreen');
    const app = document.getElementById('appShell');
    return Boolean(auth && app && (!auth.hidden || !app.hidden));
  }, { timeout: 20000 });

  await page.waitForTimeout(750);

  if (pageErrors.length) {
    throw new Error('Errores JavaScript de página:\n' + pageErrors.join('\n---\n'));
  }

  const state = await page.evaluate(() => ({
    authVisible: !document.getElementById('authScreen')?.hidden,
    appVisible: !document.getElementById('appShell')?.hidden,
    title: document.title,
    hasAppModule: Boolean(document.querySelector('script[type="module"][src*="js/app.js"]'))
  }));

  if (!state.hasAppModule) throw new Error('No se encontró el módulo js/app.js.');
  if (!state.authVisible && !state.appVisible) throw new Error('Pantalla blanca: authScreen y appShell siguen ocultos.');

  console.log('SMOKE PASS', JSON.stringify(state));
  if (consoleErrors.length) {
    console.log('Console errors no bloqueantes:', consoleErrors.join('\n'));
  }
} finally {
  await browser.close();
}
