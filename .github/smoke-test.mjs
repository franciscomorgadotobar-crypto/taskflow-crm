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
      const monthlyWithIva = quoteDocHtml({
        ...base, currency: 'UF', absorbIva: false,
        totals: {
          ...base.totals,
          monthly: { subtotal: 30.70, discount: 0, net: 30.70, iva: 5.83, total: 36.53 },
          projection: [{ month: 1, net: 30.70, iva: 5.83, total: 36.53 }, { month: 2, net: 30.70, iva: 5.83, total: 36.53 }]
        }
      });
      const full = quoteDocHtml({
        ...base, currency: 'UF', absorbIva: false,
        lines: [{
          ...base.lines[0], code: 'INV_FULL', name: 'Inventario Plan Full',
          description: 'Ítems de inventario ilimitados desde 10.000\nHasta 9.999 usuarios\n15 almacenes\nHasta 20.000 equipos seriados'
        }]
      });
      // Regresión Soc Incosec: cotización v1 sin descripciones guardadas.
      const { quoteDocFromSaved } = await import('./js/views.js');
      const oldQuote = {
        ...base, priceListId: 'no-catalogo-en-prueba',
        items: [
          { ...base.lines[0], code: 'CFG_ADV', name: 'Configuración Avanzada (Hora)', quantity: 4, description: '', periodicity: 'unico' },
          { ...base.lines[0], code: 'GE_BASE', name: 'Gestión Externa Plan Base', quantity: 1, description: '', periodicity: 'mensual' },
          { ...base.lines[0], code: 'GE_APP', name: 'Gestión Externa Usuario App', quantity: 20, description: '', periodicity: 'mensual' },
          { ...base.lines[0], code: 'INV_FULL', name: 'Inventario Plan Full', quantity: 1, description: '', periodicity: 'mensual' }
        ]
      };
      const oldHtml = quoteDocHtml(quoteDocFromSaved(oldQuote));
      const restructuredHtml = quoteDocHtml(quoteDocFromSaved({
        ...oldQuote, commercialInfo: ['Soporte 24/7', 'Implementación guiada']
      }));
      const parsed = new DOMParser().parseFromString(restructuredHtml, 'text/html');
      const docNode = parsed.querySelector('.quote-doc');
      // Comprobar estructura real y CSS aplicado para el generador html2pdf.
      docNode.style.cssText = 'position:absolute;left:-10000px;width:780px';
      document.body.appendChild(docNode);
      const scopeSection = docNode.querySelector('.qd-included-capacities');
      const benefitsSection = docNode.querySelector('.qd-included-benefits');
      const setupSection = docNode.querySelector('.qd-setup-section');
      const monthlySection = docNode.querySelector('.qd-monthly-section');
      const orderOK = scopeSection?.nextElementSibling === benefitsSection &&
        benefitsSection?.nextElementSibling === setupSection &&
        setupSection?.nextElementSibling === monthlySection;
      const groupingOK = [setupSection, monthlySection].every((node) =>
        node && node.querySelector('h4') && node.querySelector('.qd-table') &&
        node.querySelector('.qd-totals') && getComputedStyle(node).breakInside === 'avoid');
      const headingsOK = benefitsSection?.querySelector('h4')?.textContent === 'Beneficios incluidos' &&
        !restructuredHtml.includes('Beneficios y acompañamiento');
      docNode.remove();

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
        projectionUsesFinalPrice: monthlyWithIva.includes('Proyección de inversión mensual') && monthlyWithIva.includes('montos finales, IVA incluido') && monthlyWithIva.includes('<span>Mes 1</span><strong>36,53</strong>') && !monthlyWithIva.includes('<span>Mes 1</span><strong>30,70</strong>'),
        absorbedEmailHasIva: /IVA/i.test(email),
        absorbedEmailHasFinalTotal: email.includes('238,00'),
        fullCapacityIncluded: full.includes('Ítems de inventario ilimitados desde 10.000') && full.includes('Hasta 20.000 equipos seriados') && full.includes('Qué incluye cada solución contratada'),
        commercialLanguage: full.includes('Propuesta de soluciones TaskFlow') && full.includes('Inversión total del período'),
        oldQuoteHasScope: oldHtml.includes('Qué incluye cada solución contratada') &&
          oldHtml.includes('plataforma web administrativa para gestión técnica') &&
          oldHtml.includes('aplicación móvil para gestión de trabajos en terreno') &&
          oldHtml.includes('20 accesos de usuario') &&
          oldHtml.includes('4 horas contratadas') &&
          oldHtml.includes('Ítems de inventario ilimitados desde 10.000'),
        oldQuoteNoInternalStatus: !oldHtml.includes('Estado:') && !oldHtml.includes('Borrador'),
        benefitsBelowScope: orderOK && headingsOK,
        pricesNotSplit: groupingOK
      };
    });
    if (!rendered.checkboxPresent || !rendered.hideByDefault || rendered.absorbedHasIva ||
        !rendered.normalHasIva || !rendered.absorbedHasFinalTotal || !rendered.projectionUsesFinalPrice ||
        rendered.absorbedEmailHasIva || !rendered.absorbedEmailHasFinalTotal ||
        !rendered.fullCapacityIncluded || !rendered.commercialLanguage || !rendered.oldQuoteHasScope ||
        !rendered.oldQuoteNoInternalStatus || !rendered.benefitsBelowScope || !rendered.pricesNotSplit) {
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




    // UX móvil de Cotizaciones: tarjeta financiera, acciones y vista del
    // documento sin scroll horizontal, mientras el PDF conserva formato A4.
    const quotesMobile = await page.evaluate(async () => {
      if (window.innerWidth > 760) return { skipped: true };
      const { renderQuotes, quoteDocHtml } = await import('./js/views.js');
      const { state: quoteState } = await import('./js/quotes.js');
      const app = document.getElementById('appShell');
      const view = document.getElementById('viewRoot');
      const dialog = document.getElementById('quoteViewDialog');
      const body = document.getElementById('quoteViewBody');
      const previous = {
        appHidden: app.hidden,
        root: view.innerHTML,
        quoteRows: quoteState.quotes,
        crmView: document.documentElement.dataset.crmView,
        viewBody: body.innerHTML
      };
      const long = 'Soc Incosec Ltda. Servicios y Mantenimiento Industrial Limitada';
      const quote = {
        id: 'test-quote', rootId: 'test-quote', priceListId: 'test-list',
        isCurrent: true, version: 1, number: 'P-202611-0002',
        client: { company: long }, leadId: '', owner: 'Francisco Morgado',
        status: 'borrador', currency: 'UF', contractMonths: 12, total: 440.78,
        totals: { monthly: { net: 30.70, total: 36.53 } },
        updatedAt: '2026-11-03T18:05:00Z'
      };
      const alternate = {
        ...quote,
        id: 'test-quote-alt',
        rootId: 'test-quote-alt',
        alternativeOfRootId: 'test-quote',
        number: 'P-202611-0003',
        items: [{ code: 'INV_ENTRADA', name: 'Inventario Plan Entrada' }]
      };
      quote.items = [{ code: 'INV_FULL', name: 'Inventario Plan Full' }];
      const doc = {
        ...quote, quoteDate: '2026-11-03', validUntil: '2026-11-10',
        paymentMethod: 'transferencia', paymentTerms: '5_dias',
        issuer: { commercialName: 'TaskFlow', legalName: 'Cuatro R Labs SpA' },
        owner: 'Francisco Morgado',
        lines: [
          { code: 'CFG_ADV', name: 'Configuración avanzada', periodicity: 'unico',
            quantity: 4, unitPrice: 2, subtotal: 8, discount: 6, total: 2 },
          { code: 'GE_BASE', name: 'Gestión Externa Plan Base', periodicity: 'mensual',
            quantity: 1, unitPrice: .7, subtotal: .7, discount: 0, total: .7 },
          { code: 'GE_APP', name: 'Gestión Externa Usuario App', periodicity: 'mensual',
            quantity: 20, unitPrice: .75, subtotal: 15, discount: 0, total: 15 },
          { code: 'INV_FULL', name: 'Inventario Plan Full', periodicity: 'mensual',
            quantity: 1, unitPrice: 15, subtotal: 15, discount: 0, total: 15 }
        ],
        commercialInfo: ['Soporte 24/7', 'Implementación guiada'],
        totals: {
          setup: { subtotal: 8, discount: 6, net: 2, iva: .38, total: 2.38 },
          monthly: { subtotal: 30.7, discount: 0, net: 30.7, iva: 5.83, total: 36.53 },
          projection: Array.from({ length: 12 }, (_, i) => ({ month: i+1, net: 30.7, total: 36.53 })),
          contract: { net: 370.4, iva: 70.38, total: 440.78 }
        }
      };
      try {
        app.hidden = false;
        document.documentElement.dataset.crmView = 'quotes';
        // La misma empresa puede tener dos propuestas vigentes a la vez.
        quoteState.quotes = [quote, alternate];
        view.innerHTML = renderQuotes({ quotesView: 'list', quoteFilters: { status: '' } });
        const card = view.querySelector('.quote-list-card');
        const actions = [...card.querySelectorAll('.quote-card-actions button')];
        const within = (child, parent) => {
          const a = child.getBoundingClientRect();
          const b = parent.getBoundingClientRect();
          return a.left >= b.left - 2 && a.right <= b.right + 2;
        };
        const list = {
          fullWidth: card.scrollWidth <= card.clientWidth + 2,
          buttonsVisible: actions.length >= 3 && actions.every((button) => within(button, card)),
          gridActions: getComputedStyle(card.querySelector('.quote-card-actions')).display === 'grid',
          amountFull: card.querySelector('.quote-card-monthly')?.textContent.includes('UF 30,70'),
          titleReadable: card.querySelector('.quote-card-title')?.getBoundingClientRect().width > 120,
          alternativesCoexist: view.querySelectorAll('.quote-list-card').length === 2 &&
            view.textContent.includes('Plan Full') &&
            view.textContent.includes('Plan Entrada') &&
            view.textContent.includes('Alternativa de P-202611-0002') &&
            view.textContent.includes('2 opciones disponibles')
        };

        body.innerHTML = quoteDocHtml(doc);
        dialog.showModal();
        const documentNode = body.querySelector('.quote-doc');
        const financialTable = documentNode.querySelector('.qd-table');
        const docInfo = {
          fitsWidth: documentNode.scrollWidth <= documentNode.clientWidth + 2 &&
            body.scrollWidth <= body.clientWidth + 2,
          singleColumn: getComputedStyle(documentNode.querySelector('.qd-head')).gridTemplateColumns.trim().split(/\s+/).length === 1,
          planSingleColumn: getComputedStyle(documentNode.querySelector('.qd-plan-grid')).gridTemplateColumns.trim().split(/\s+/).length === 1,
          priceCards: getComputedStyle(financialTable).display === 'block',
          labeledPrices: Boolean(financialTable.querySelector('td[data-label="Valor unitario UF"]')),
          footerButtonsVisible: [...dialog.querySelectorAll('.modal-actions button')]
            .filter((button) => getComputedStyle(button).display !== 'none')
            .every((button) => button.getBoundingClientRect().width > 70),
          compactFooter: getComputedStyle(dialog.querySelector('[data-close-dialog="quoteViewDialog"]')).display === 'none' &&
            [...dialog.querySelectorAll('.modal-actions button')]
              .filter((button) => getComputedStyle(button).display !== 'none').length === 5,
          alternativeAction: dialog.querySelector('#quoteViewAlternativeBtn')?.textContent.trim() === 'Crear alternativa' &&
            getComputedStyle(dialog.querySelector('#quoteViewAlternativeBtn')).gridColumnStart === '1'
        };

        const pdf = document.createElement('div');
        pdf.className = 'quote-pdf-holder';
        pdf.innerHTML = quoteDocHtml(doc);
        document.body.appendChild(pdf);
        const printDoc = pdf.querySelector('.quote-doc');
        const printLayout = {
          pageWidth: pdf.getBoundingClientRect().width === 780,
          conventionalTable: getComputedStyle(printDoc.querySelector('.qd-table')).display === 'table',
          threePartHeader: getComputedStyle(printDoc.querySelector('.qd-head')).gridTemplateColumns.trim().split(/\s+/).length === 3
        };
        pdf.remove();
        return { list, docInfo, printLayout };
      } finally {
        if (dialog.open) dialog.close();
        body.innerHTML = previous.viewBody;
        view.innerHTML = previous.root;
        quoteState.quotes = previous.quoteRows;
        app.hidden = previous.appHidden;
        if (previous.crmView === undefined) delete document.documentElement.dataset.crmView;
        else document.documentElement.dataset.crmView = previous.crmView;
      }
    });
    if (!quotesMobile.skipped && !Object.values({
      ...quotesMobile.list, ...quotesMobile.docInfo, ...quotesMobile.printLayout
    }).every(Boolean)) {
      throw new Error('UX móvil de cotizaciones no supera las pruebas: ' + JSON.stringify(quotesMobile));
    }
    console.log('QUOTES MOBILE PASS', testCase.name, JSON.stringify(quotesMobile));

    console.log(`SMOKE PASS ${testCase.name}`, JSON.stringify(state));
    if (consoleErrors.length) {
      console.log(`Console errors no bloqueantes [${testCase.name}]:`, consoleErrors.join('\n'));
    }
    await page.close();
  }
} finally {
  await browser.close();
}
