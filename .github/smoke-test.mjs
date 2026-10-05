import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const cases = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } }
];

try {
  for (const testCase of cases) {
    const page = await browser.newPage({ viewport: testCase.viewport });
    const pageErrors = [];
    const consoleErrors = [];

    page.on('pageerror', (error) => pageErrors.push(error?.stack || error?.message || String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    const response = await page.goto('http://127.0.0.1:4173/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    if (!response?.ok()) {
      throw new Error(`[${testCase.name}] index.html respondió HTTP ${response?.status() ?? 'sin respuesta'}`);
    }

    await page.waitForFunction(() => {
      const auth = document.getElementById('authScreen');
      const app = document.getElementById('appShell');
      return Boolean(auth && app && (!auth.hidden || !app.hidden));
    }, { timeout: 20000 });

    await page.waitForTimeout(750);

    if (pageErrors.length) {
      throw new Error(`[${testCase.name}] Errores JavaScript de página:\n` + pageErrors.join('\n---\n'));
    }

    const state = await page.evaluate(() => ({
      authVisible: !document.getElementById('authScreen')?.hidden,
      appVisible: !document.getElementById('appShell')?.hidden,
      title: document.title,
      hasAppModule: Boolean(document.querySelector('script[type="module"][src*="js/app.js"]')),
      width: window.innerWidth,
      height: window.innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
    }));

    if (!state.hasAppModule) throw new Error(`[${testCase.name}] No se encontró el módulo js/app.js.`);
    if (!state.authVisible && !state.appVisible) throw new Error(`[${testCase.name}] Pantalla blanca: authScreen y appShell siguen ocultos.`);
    if (state.horizontalOverflow) throw new Error(`[${testCase.name}] Hay overflow horizontal global (${state.width}x${state.height}).`);

    console.log(`SMOKE PASS ${testCase.name}`, JSON.stringify(state));
    if (consoleErrors.length) {
      console.log(`Console errors no bloqueantes [${testCase.name}]:`, consoleErrors.join('\n'));
    }
    await page.close();
  }
} finally {
  await browser.close();
}
