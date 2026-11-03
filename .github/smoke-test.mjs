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

    // El documento externo no debe revelar la absorción ni desglosar IVA.
    const rendered = await page.evaluate(async () => {
      const { quoteDocHtml } = await import('./js/views.js');
      const { buildQuoteEmail } = await import('./js/quotes.js');
      const base = {
        number: 'P-PRUEBA', version: 1, currency: 'USD', status: 'borrador',
        quoteDate: '2026-11-03', validUntil: '2026-11-10',
        contractMonths: 2, owner: 'Equipo de ventas',
        client: { company: 'Cliente extranjero', contact: 'Prueba' },
        issuer: { commercialName: 'TaskFlow' },
        commercialInfo: [],
        lines: [{
          name: 'Servicio', code: 'TEST', periodicity: 'mensual',
          quantity: 1, unitPrice: 119, subtotal: 119, discount: 0,
          total: 119, discountMonths: 0
        }],
        totals: {
          setup: { subtotal: 0, discount: 0, net: 0, iva: 0, total: 0 },
          monthly: { subtotal: 119, discount: 0, net: 119, iva: 0, total: 119 },
          projection: [{ month: 1, net: 119, total: 119 }, { month: 2, net: 119, total: 119 }],
          contract: { net: 238, iva: 0, total: 238 }
        }
      };
      const absorbed = quoteDocHtml({ ...base, absorbIva: true });
      const normal = quoteDocHtml({ ...base, absorbIva: false });
      const full = quoteDocHtml({
        ...base, currency: 'UF', absorbIva: false,
        lines: [{
          ...base.lines[0], code: 'INV_FULL', name: 'Inventario Plan Full',
          description: 'Ítems de inventario ilimitados desde 10.000\nHasta 9.999 usuarios\n15 almacenes\nHasta 20.000 equipos seriados'
        }]
      });
      const email = buildQuoteEmail({
        ...base, absorbIva: true, items: base.lines,
        total: 238, subtotalNeto: 238, iva: 0
      }, null).body;
      return {
        checkboxPresent: Boolean(document.getElementById('quoteAbsorbIva')),
        hideByDefault: document.getElementById('quoteAbsorbIvaField')?.hidden,
        absorbedHasIva: /IVA/i.test(absorbed),
        normalHasIva: /IVA/i.test(normal),
        absorbedHasFinalTotal: absorbed.includes('238,00'),
        absorbedEmailHasIva: /IVA/i.test(email),
        absorbedEmailHasFinalTotal: email.includes('238,00'),
        fullCapacityIncluded: full.includes('Ítems de inventario ilimitados desde 10.000') && full.includes('Hasta 20.000 equipos seriados') && full.includes('Capacidades incluidas en su plan de Inventario'),
        commercialLanguage: full.includes('Propuesta de soluciones TaskFlow') && full.includes('Inversión total del período')
      };
    });
    if (!rendered.checkboxPresent || !rendered.hideByDefault || rendered.absorbedHasIva ||
        !rendered.normalHasIva || !rendered.absorbedHasFinalTotal ||
        rendered.absorbedEmailHasIva || !rendered.absorbedEmailHasFinalTotal ||
        !rendered.fullCapacityIncluded || !rendered.commercialLanguage) {
      throw new Error('Documento USD de IVA absorbido incorrecto: ' + JSON.stringify(rendered));
    }
    console.log('QUOTE ABSORB PASS', testCase.name, JSON.stringify(rendered));


    // Reproducir el error real: JS nuevo ejecutándose con campos ausentes
    // del HTML cacheado. La recuperación no debe perder selecciones.
    const oldShell = await page.evaluate(async () => {
      document.getElementById('quoteAbsorbIvaField')?.remove();
      document.getElementById('quoteMode')?.closest('label')?.remove();
      document.getElementById('quoteEarlyFields')?.remove();
      const { ensureQuoteFormControls } = await import('./js/quote-form-compat.js');
      const recovered = ensureQuoteFormControls();
      recovered.absorbInput.checked = true;
      recovered.mode.value = 'early';
      document.getElementById('quoteEarlyDays').value = '45';
      const second = ensureQuoteFormControls();
      const ids = [
        'quoteAbsorbIvaField','quoteAbsorbIva','quoteMode','quoteEarlyFields',
        'quoteEarlyDays','quoteEarlyPilotPrice','quoteEarlyBenefit',
        'quoteEarlyScope','quoteEarlyConditions'
      ];
      return {
        unique: ids.every((id) => document.querySelectorAll('#' + id).length === 1),
        absorbSelected: second.absorbInput.checked,
        modeSelected: second.mode.value,
        daysPreserved: document.getElementById('quoteEarlyDays').value,
        controlsInsideForm: ids.every((id) => Boolean(document.getElementById('quoteForm')?.contains(document.getElementById(id))))
      };
    });
    if (!oldShell.unique || !oldShell.absorbSelected || oldShell.modeSelected !== 'early' ||
        oldShell.daysPreserved !== '45' || !oldShell.controlsInsideForm) {
      throw new Error('Fallo al recuperar formulario HTML anterior: ' + JSON.stringify(oldShell));
    }
    console.log('QUOTE OLD SHELL PASS', testCase.name, JSON.stringify(oldShell));

    const itemScopeRecovered = await page.evaluate(async () => {
      document.getElementById('priceItemDescription')?.closest('label')?.remove();
      const { ensurePriceItemDescription } = await import('./js/quote-form-compat.js');
      const input = ensurePriceItemDescription();
      input.value = 'Ítems ilimitados desde 10.000';
      const again = ensurePriceItemDescription();
      return {
        unique: document.querySelectorAll('#priceItemDescription').length === 1,
        kept: again.value === 'Ítems ilimitados desde 10.000',
        inForm: document.getElementById('priceItemForm')?.contains(again)
      };
    });
    if (!itemScopeRecovered.unique || !itemScopeRecovered.kept || !itemScopeRecovered.inForm) {
      throw new Error('No se recuperó el campo de capacidades del catálogo: ' + JSON.stringify(itemScopeRecovered));
    }
    console.log('CATALOG OLD SHELL PASS', testCase.name);



    console.log(`SMOKE PASS ${testCase.name}`, JSON.stringify(state));
    if (consoleErrors.length) {
      console.log(`Console errors no bloqueantes [${testCase.name}]:`, consoleErrors.join('\n'));
    }
    await page.close();
  }
} finally {
  await browser.close();
}
