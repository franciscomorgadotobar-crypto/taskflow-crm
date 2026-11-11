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

    // En IVA absorbido se muestra «IVA incluido», pero sin desglose interno.
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
      const monthlyOnly = quoteDocHtml({ ...base, lines: base.lines });
      const withSetup = quoteDocHtml({
        ...base,
        lines: [{ ...base.lines[0], periodicity: 'unico' }, ...base.lines]
      });
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

      const temporaryBenefitsHtml = quoteDocHtml({
        ...base,
        lines: [{...base.lines[0], periodicity: 'mensual', discountMonths: 6, discount: 5.25, total: 9.75}],
        totals: {...base.totals,
          monthly: {subtotal: 15, discount: 5.25, net: 9.75, iva: 1.85, total: 11.60}}
      });
      const benefitDoc = new DOMParser().parseFromString(temporaryBenefitsHtml, 'text/html');
      const benefitTable = benefitDoc.querySelector('.qd-unified-economics .qd-unified-table');
      const benefitHeaders = [...benefitTable.querySelectorAll('thead th')].map((el) => el.textContent.trim());
      const discountMonthsHidden =
        benefitHeaders.length === 6 &&
        !temporaryBenefitsHtml.includes('Meses con beneficio') &&
        benefitTable.querySelector('tbody tr')?.children.length === 6 &&
        temporaryBenefitsHtml.includes('5,25') &&
        temporaryBenefitsHtml.includes('9,75') &&
        temporaryBenefitsHtml.includes('11,60');

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
      const economicSection = docNode.querySelector('.qd-unified-economics');
      const financialGroup = economicSection?.querySelector('.qd-financial-group');
      const summary = economicSection?.querySelector('.qd-economic-summary');
      const allRows = [...(economicSection?.querySelectorAll('.qd-unified-table tbody tr') || [])];
      const orderOK = scopeSection?.nextElementSibling === benefitsSection &&
        benefitsSection?.nextElementSibling === economicSection;
      const groupingOK = Boolean(economicSection && financialGroup && summary) &&
        allRows.length === 4 &&
        allRows.filter((row) => row.querySelector('.qd-billing-once')).length === 1 &&
        allRows.filter((row) => row.querySelector('.qd-billing-monthly')).length === 3 &&
        summary.querySelectorAll('.qd-economic-summary-row').length === 2 &&
        !economicSection.querySelector('.qd-setup-section, .qd-monthly-section') &&
        getComputedStyle(financialGroup).breakInside === 'avoid';
      const headingsOK = benefitsSection?.querySelector('h4')?.textContent === 'Incluidos' &&
        !restructuredHtml.includes('Beneficios y acompañamiento');
      docNode.remove();

      // Vista inmediata del contenido de cada pack al seleccionarlo en el cotizador.
      const { quoteCatalogServiceInfoHtml } = await import('./js/views.js');
      const { state: quoteCatalogState } = await import('./js/quotes.js');
      const oldPriceItems = quoteCatalogState.priceListItems;
      const oldPriceLists = quoteCatalogState.priceLists;
      let packInfoOK = false;
      try {
        quoteCatalogState.priceLists = [{ id: 'catalog-preview', currency: 'UF' }];
        quoteCatalogState.priceListItems = [
          { id: 'entrada', priceListId: 'catalog-preview', code: 'INV_ENTRADA', name: 'Inventario Plan Entrada', price: 1.2, periodicity: 'mensual', description: '' },
          { id: 'basico', priceListId: 'catalog-preview', code: 'INV_BASICO', name: 'Inventario Plan Básico', price: 2.8, periodicity: 'mensual', description: '' },
          { id: 'full', priceListId: 'catalog-preview', code: 'INV_FULL', name: 'Inventario Plan Full', price: 15, periodicity: 'mensual', description: '' },
          { id: 'pack', priceListId: 'catalog-preview', code: 'PACK_INV_1000', name: 'Pack adicional 1.000 ítems', price: 1, periodicity: 'mensual', description: '' }
        ];
        const entradaInfo = quoteCatalogServiceInfoHtml('entrada');
        const basicoInfo = quoteCatalogServiceInfoHtml('basico');
        const fullInfo = quoteCatalogServiceInfoHtml('full');
        const packInfo = quoteCatalogServiceInfoHtml('pack', { optional: true });
        packInfoOK =
          entradaInfo.includes('Hasta 200 ítems de inventario') &&
          entradaInfo.includes('1 usuario incluido') &&
          basicoInfo.includes('Hasta 500 ítems de inventario') &&
          basicoInfo.includes('Hasta 250 equipos seriados') &&
          fullInfo.includes('Ítems de inventario ilimitados desde 10.000') &&
          fullInfo.includes('Hasta 20.000 equipos seriados') &&
          fullInfo.includes('UF 15,00') &&
          packInfo.includes('Amplía la capacidad contratada en 1.000 ítems') &&
          packInfo.includes('no forma parte del total del contrato');

        // El detalle debe estar DENTRO del selector desplegado, no bajo el campo.
        const { enhanceQuoteProductSelect } = await import('./js/quote-rich-picker.js');
        const dialog = document.getElementById('quoteDialog');
        const service = document.getElementById('quoteAddService');
        const optional = document.getElementById('quoteOptionalService');
        const oldOptions = service.innerHTML;
        const oldOptionalOptions = optional.innerHTML;
        try {
          const catalogItems = quoteCatalogState.priceListItems;
          const optionsHtml = catalogItems.map((item) =>
            '<option value="' + item.id + '">' + item.name + '</option>').join('');
          service.innerHTML = optionsHtml;
          optional.innerHTML = optionsHtml;
          enhanceQuoteProductSelect(service, catalogItems, 'UF');
          enhanceQuoteProductSelect(optional, catalogItems, 'UF');
          dialog.showModal();
          const trigger = service.nextElementSibling.querySelector('.quote-rich-trigger');
          trigger.click();
          const menu = [...dialog.querySelectorAll('.quote-rich-popup')].find((el) => !el.hidden);
          const basicOption = menu?.querySelector('[data-rich-item="basico"]');
          const basicSummary = basicOption?.textContent || '';
          basicOption?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          const hovered = menu?.querySelector('.quote-rich-details')?.textContent || '';
          const search = menu?.querySelector('.quote-rich-search');
          search.value = '250 equipos';
          search.dispatchEvent(new Event('input', { bubbles: true }));
          const filtered = menu?.querySelectorAll('[data-rich-item]') || [];
          const filteredBasic = filtered.length === 1 && filtered[0].dataset.richItem === 'basico';
          filtered[0]?.click();
          const serviceSelected = service.value === 'basico' && menu?.hidden;
          optional.nextElementSibling.querySelector('.quote-rich-trigger').click();
          const optionalMenu = [...dialog.querySelectorAll('.quote-rich-popup')].find((el) => !el.hidden);
          const optionalRows = optionalMenu?.querySelectorAll('[data-rich-item]').length || 0;
          const optionalDetail = optionalMenu?.querySelector('.quote-rich-details')?.textContent || '';
          packInfoOK = packInfoOK &&
            !!menu && !!basicOption &&
            basicSummary.includes('500 ítems') &&
            basicSummary.includes('2 usuarios') &&
            hovered.includes('Hasta 500 ítems de inventario') &&
            hovered.includes('Hasta 250 equipos seriados') &&
            filteredBasic && serviceSelected &&
            optionalRows === 4 &&
            optionalDetail.includes('Hasta 200 ítems de inventario') &&
            !document.getElementById('quoteServiceInfo') &&
            !document.getElementById('quoteOptionalInfo');
        } finally {
          if (dialog.open) dialog.close();
          service.innerHTML = oldOptions;
          optional.innerHTML = oldOptionalOptions;
        }
      } finally {
        quoteCatalogState.priceListItems = oldPriceItems;
        quoteCatalogState.priceLists = oldPriceLists;
      }

      const optionalPack = {
        code: 'INV_PACK_1000', name: 'Pack adicional de 1.000 ítems',
        description: 'Capacidad extra de inventario', quantity: 1,
        periodicity: 'mensual', unitPrice: 2, total: 2.38,
        currency: 'UF', includesIva: false
      };
      const optionalHtml = quoteDocHtml({ ...base, currency: 'UF', optionalItems: [optionalPack] });
      const optionalEmail = buildQuoteEmail({
        ...base, currency: 'UF', absorbIva: false,
        items: base.lines, total: 238, subtotalNeto: 200, iva: 38,
        optionalItems: [optionalPack],
        notes: 'Notas públicas\n[[TF_OPTIONALS:metadato]]'
      }, null).body;
      const optionalSection = new DOMParser().parseFromString(optionalHtml, 'text/html')
        .querySelector('.qd-optionals-section');
      const optionalOK = Boolean(optionalSection) &&
        optionalSection.textContent.includes('Pack adicional de 1.000 ítems') &&
        optionalSection.textContent.includes('2,38') &&
        optionalHtml.indexOf('qd-unified-economics') < optionalHtml.indexOf('qd-optionals-section') &&
        optionalHtml.indexOf('qd-optionals-section') < optionalHtml.indexOf('qd-projection-summary') &&
        optionalHtml.includes('Valor total del contrato') &&
        optionalHtml.includes('238,00') &&
        optionalEmail.includes('Si más adelante necesitan mayor capacidad') &&
        optionalEmail.includes('2,38') && !optionalEmail.includes('TF_OPTIONALS');

      // Dos opciones con una versión histórica: una ficha, no tarjetas
      // duplicadas ni un segundo selector de opciones dentro del documento.
      const { quoteFamilyOf, quoteGroupsOf, state: quoteSnapshot } = await import('./js/quotes.js');
      const { renderQuotesSection, renderQuotes } = await import('./js/views.js');
      const savedQuotes = quoteSnapshot.quotes;
      const original = {
        id: 'original-2', rootId: 'original-1', number: 'P-202611-0002', version: 2,
        isCurrent: true, leadId: 'fixture-lead', ownerId: 'user-fixture',
        sellerName: 'Prueba', status: 'borrador', currency: 'UF',
        alternativeOfRootId: '', contractMonths: 12, total: 210,
        updatedAt: '2026-11-06T10:00:00Z',
        totals: { monthly: { net: 14, total: 16.66 } },
        client: { company: 'Soc Incosec Ltda.' },
        items: [{ code: 'INV_FULL', name: 'Inventario Plan Full' }]
      };
      const alternative = {
        ...original, id: 'alternative-1', rootId: 'alternative-1',
        number: 'P-202611-0003', version: 1,
        alternativeOfRootId: 'original-1', status: 'enviada',
        items: [{ code: 'INV_BASICO', name: 'Inventario Plan Básico' }],
        totals: { monthly: { net: 8, total: 9.52 } }
      };
      const previous = { ...original, id: 'original-1', version: 1, isCurrent: false };
      const third = {
        ...alternative, id: 'third-3', rootId: 'third-1',
        number: 'P-202611-0004', version: 3, status: 'borrador'
      };
      const thirdV2 = { ...third, id: 'third-2', version: 2, isCurrent: false };
      const thirdV1 = { ...third, id: 'third-1', version: 1, isCurrent: false };
      const standalone = {
        ...original, id: 'unrelated-1', rootId: 'unrelated-1', number: 'P-202611-0010',
        version: 1, alternativeOfRootId: '', items: [], status: 'rechazada'
      };
      let existingAlternativesCorrect = false;
      try {
        quoteSnapshot.quotes = [previous, original, alternative, thirdV1, thirdV2, third, standalone];
        const linked = quoteFamilyOf(original);
        const families = quoteGroupsOf();
        const filtered = quoteGroupsOf(quoteSnapshot.quotes, { status: 'enviada' });
        const list = new DOMParser().parseFromString(renderQuotesSection('fixture-lead'), 'text/html');
        const general = new DOMParser().parseFromString(
          renderQuotes({ quotesView: 'list', quoteFilters: { status: '' } }), 'text/html');
        const group = [...list.querySelectorAll('.quote-group-card')]
          .find((node) => node.dataset.quoteGroup === 'original-1');
        const optionRows = group?.querySelectorAll('.quote-group-option') || [];
        const history = group?.querySelector('.quote-option-history');
        existingAlternativesCorrect =
          linked.length === 3 && linked[0].id === original.id &&
          linked[1].id === alternative.id && linked[2].id === third.id &&
          families.length === 2 && filtered.length === 1 && filtered[0].options.length === 3 &&
          list.querySelectorAll('.quote-group-card').length === 2 &&
          general.querySelectorAll('.quote-group-card').length === 2 &&
          list.querySelectorAll('.quote-list-card').length === 0 &&
          optionRows.length === 3 &&
          group.querySelector('summary').textContent.includes('3 opciones comerciales') &&
          group.querySelector('summary').textContent.includes('6 versiones') &&
          group.querySelectorAll('.quote-option-history').length === 2 &&
          history?.querySelectorAll('.quote-option-version').length === 2 &&
          group.querySelectorAll('.quote-option-version').length === 5 &&
          history.querySelector('[data-action="view-quote"][data-id="original-1"]') !== null &&
          group.querySelector('.quote-group-options [data-quote-id="alternative-1"]') !== null &&
          group.querySelector('.quote-group-options [data-quote-id="third-3"]') !== null &&
          list.querySelectorAll('[data-action="quote-family"]').length === 0 &&
          group.textContent.includes('Plan Full') && group.textContent.includes('Plan Básico') &&
          group.textContent.includes('IVA incluido');
      } finally {
        quoteSnapshot.quotes = savedQuotes;
      }

      const email = buildQuoteEmail({
        ...base, absorbIva: true, items: base.lines,
        total: 238, subtotalNeto: 238, iva: 0
      }, null).body;
      // Caso comercial: Incosec Plan Básico, 100% implementación,
      // 60% mensual por 12 meses y capacidad exacta desde el catálogo.
      const incosec = {
        ...base, currency: 'UF', number: 'P-202611-0003', version: 3,
        absorbIva: false, contractMonths: 12, total: 105.67,
        client: { company: 'Soc Incosec Ltda.', contact: 'David Yáñez' },
        items: [
          { code: 'CFG_ADV', periodicity: 'unico', quantity: 4, unitPrice: 2, subtotal: 8, discount: 8, total: 0 },
          { code: 'GE_BASE', periodicity: 'mensual', quantity: 1, unitPrice: .7, subtotal: .7, discount: .42, total: .28 },
          { code: 'GE_APP', periodicity: 'mensual', quantity: 20, unitPrice: .75, subtotal: 15, discount: 9, total: 6 },
          { code: 'INV_BASICO', periodicity: 'mensual', quantity: 1, unitPrice: 2.8, subtotal: 2.8, discount: 1.68, total: 1.12 }
        ],
        totals: {
          setup: { subtotal: 8, discount: 8, net: 0, iva: 0, total: 0 },
          monthly: { subtotal: 18.5, discount: 11.1, net: 7.4, iva: 1.41, total: 8.81 },
          projection: Array.from({length:12},(_,i)=>({month:i+1,total:8.81})),
          contract: { net: 88.8, iva: 16.87, total: 105.67 }
        },
        commercialInfo: ['Implementación guiada por 1 mes', 'Soporte', 'Marketing conjunto (opcional)'],
        optionalItems: [{ name: 'Packs de ítems de inventario 500', unitPrice: .35,
          total: .4165, quantity: 1, periodicity: 'mensual', includesIva: false }],
        notes: ''
      };
      const mail = buildQuoteEmail(incosec, null);
      const variable = buildQuoteEmail({
        ...incosec,
        totals: {...incosec.totals, projection: incosec.totals.projection.map((m,i) =>
          i ? {...m,total:12.54} : m)}
      }, null).body;
      const noDiscount = buildQuoteEmail({
        ...incosec, version:1,
        totals:{...incosec.totals,
          setup:{subtotal:0,discount:0,net:0,total:0},
          monthly:{subtotal:18.5,discount:0,net:18.5,iva:3.52,total:22.02}}
      }, null).body;
      const commercialEmailQuality =
        mail.subject.includes('P-202611-0003 v3') &&
        mail.body.includes('Estimado David:') &&
        mail.body.includes('cotización ajustada') &&
        mail.body.includes('Plan Básico de Inventario') &&
        mail.body.includes('100% de descuento') &&
        mail.body.includes('60% de descuento') &&
        mail.body.includes('durante los 12 meses del contrato') &&
        mail.body.includes('UF 7,40 netos + IVA (UF 8,81 IVA incluido)') &&
        mail.body.includes('UF 18,50 netos + IVA') &&
        mail.body.includes('UF 105,67 IVA incluido') &&
        mail.body.includes('20 usuarios App') &&
        mail.body.includes('Hasta 500 ítems de inventario') &&
        mail.body.includes('250 equipos seriados') &&
        mail.body.includes('UF 0,35 + IVA') &&
        mail.body.includes('500 ítems') &&
        !mail.body.includes('Servicio ·') &&
        !variable.includes('durante los 12 meses del contrato') &&
        !variable.includes('fijo durante todo el contrato') &&
        noDiscount.includes('El valor mensual de la propuesta es de') &&
        !noDiscount.includes('siguientes descuentos');
      return {
        checkboxPresent: Boolean(document.getElementById('quoteAbsorbIva')),
        optionalSelectorPresent: Boolean(document.getElementById('quoteOptionalService')) && Boolean(document.getElementById('quoteOptionalQty')),
        optionalOK,
        shortCommercialCopy: !optionalHtml.includes('Los descuentos temporales pueden variar según el mes') &&
          !optionalHtml.includes('El cliente puede solicitar uno o varios posteriormente'),
        existingAlternativesCorrect,
        packInfoOK,
        hideByDefault: document.getElementById('quoteAbsorbIvaField')?.hidden,
        absorbedHasIva: /IVA incluido/i.test(absorbed),
        normalHasIva: /\bIVA\b/i.test(normal),
        absorbedHasFinalTotal: absorbed.includes('238,00'),
        projectionUsesFinalPrice: monthlyWithIva.includes('Proyección de valores mensuales') && monthlyWithIva.includes('Proyección de valores mensuales <span class="qd-muted">(IVA incluido)') && monthlyWithIva.includes('<span>Mes 1</span><strong>36,53</strong>') && !monthlyWithIva.includes('<span>Mes 1</span><strong>30,70</strong>'),
        commercialEmailQuality,
        absorbedEmailHasIva: /IVA incluido/i.test(email),
        absorbedEmailHasFinalTotal: email.includes('238,00'),
        fullCapacityIncluded: full.includes('Ítems de inventario ilimitados desde 10.000') && full.includes('Hasta 20.000 equipos seriados') && full.includes('Qué incluye cada solución contratada'),
        commercialLanguage: full.includes('Propuesta de soluciones TaskFlow') && full.includes('Valor total del contrato'),
        noInvestmentTerminology: !/inversi[oó]n/i.test([normal, withSetup, monthlyOnly, email].join(' ')) && withSetup.includes('Total puesta en marcha') && monthlyOnly.includes('Total mensual') && normal.includes('Valor total del contrato'),
        oldQuoteHasScope: oldHtml.includes('Qué incluye cada solución contratada') &&
          oldHtml.includes('plataforma web administrativa para gestión técnica') &&
          oldHtml.includes('aplicación móvil para gestión de trabajos en terreno') &&
          oldHtml.includes('20 accesos de usuario') &&
          oldHtml.includes('4 horas contratadas') &&
          oldHtml.includes('Ítems de inventario ilimitados desde 10.000'),
        oldQuoteNoInternalStatus: !oldHtml.includes('Estado:') && !oldHtml.includes('Borrador'),
        benefitsBelowScope: orderOK && headingsOK,
        pricesNotSplit: groupingOK,
        discountMonthsHidden,
        projectionAndTotalTogether: normal.includes('class="qd-projection-summary"') &&
          /<section class="qd-projection-summary">[\s\S]*?qd-months[\s\S]*?qd-contract[\s\S]*?<\/section>/.test(normal),
        wordButtonsPresent: document.querySelectorAll('[data-action="quote-builder-word"]').length >= 2 &&
          Boolean(document.querySelector('#quoteViewWordBtn[data-action="quote-word"]')),
        taxAndMonthlyLabels: withSetup.includes('Total mensual (IVA incluido)') &&
          withSetup.includes('Total puesta en marcha (IVA incluido)') &&
          withSetup.includes('(neto)') && absorbed.includes('(IVA incluido)') &&
          !withSetup.includes('Total primer mes') &&
          withSetup.includes('Valor total del contrato USD (IVA incluido)') &&
          withSetup.includes('Salida a producción') &&
          withSetup.includes('09:00 a 18:00'),
        commercialDiscountClarity: withSetup.includes('Precio sin descuento (IVA incluido)') &&
          withSetup.includes('Descuento aplicado') &&
          withSetup.includes('con descuento (IVA incluido)') &&
          withSetup.includes('Precio con descuento: neto') &&
          withSetup.includes('Descuento USD (neto)') &&
          absorbed.includes('Descuento USD (IVA incluido)') &&
          !withSetup.includes('Beneficio USD') &&
          !monthlyOnly.includes('Beneficio USD'),
        financialHeading: withSetup.includes('Propuesta económica') &&
          withSetup.includes('Resumen de valores') &&
          withSetup.includes('Total puesta en marcha') &&
          withSetup.includes('Total mensual') &&
          (withSetup.match(/class="qd-unified-table"/g) || []).length === 0 &&
          (withSetup.match(/qd-unified-table/g) || []).length === 1 &&
          (withSetup.match(/class="qd-economic-title"/g) || []).length === 1 &&
          monthlyOnly.includes('Propuesta económica') &&
          monthlyOnly.includes('Total mensual') &&
          !monthlyOnly.includes('Total puesta en marcha') &&
          (monthlyOnly.match(/class="qd-economic-title"/g) || []).length === 1
      };
    });
    if (!rendered.checkboxPresent || !rendered.optionalSelectorPresent || !rendered.optionalOK || !rendered.shortCommercialCopy || !rendered.existingAlternativesCorrect || !rendered.packInfoOK || !rendered.hideByDefault || !rendered.absorbedHasIva ||
        !rendered.normalHasIva || !rendered.absorbedHasFinalTotal || !rendered.projectionUsesFinalPrice ||
        !rendered.commercialEmailQuality || !rendered.absorbedEmailHasIva || !rendered.absorbedEmailHasFinalTotal ||
        !rendered.fullCapacityIncluded || !rendered.commercialLanguage || !rendered.noInvestmentTerminology || !rendered.oldQuoteHasScope ||
        !rendered.oldQuoteNoInternalStatus || !rendered.benefitsBelowScope ||
        !rendered.pricesNotSplit || !rendered.financialHeading || !rendered.commercialDiscountClarity || !rendered.wordButtonsPresent || !rendered.taxAndMonthlyLabels || !rendered.projectionAndTotalTogether || !rendered.discountMonthsHidden) {
      throw new Error('Documento USD de IVA absorbido incorrecto: ' + JSON.stringify(rendered));
    }
    console.log('QUOTE ABSORB PASS', testCase.name, JSON.stringify(rendered));

    // Página final en blanco: retira solo hojas sin contenido real.
    const pdfCleanup = await page.evaluate(async () => {
      const { trimTrailingEmptyQuotePages } = await import('./js/quote-pdf-cleanup.js');
      const canvas = document.createElement('canvas');
      canvas.width = 380;
      canvas.height = 1650; // Tres hojas con 10/10/12/10 mm de márgenes.
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#1b3257';
      context.fillRect(25, 90, 100, 18);
      context.fillRect(25, 605, 100, 18);
      // Una línea de borde al comienzo de la tercera hoja no justifica
      // exportarla como una página de papel vacía.
      context.fillStyle = '#e2e8f0';
      context.fillRect(25, 1120, 300, 2);
      const makePdf = () => ({
        count: 3,
        internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
        getNumberOfPages() { return this.count; },
        deletePage(n) { if (n !== this.count) throw Error('Borrado incorrecto'); this.count--; }
      });
      const emptyPdf = makePdf();
      const removed = trimTrailingEmptyQuotePages(emptyPdf, canvas);
      context.fillStyle = '#1b3257';
      context.fillRect(25, 1220, 120, 20);
      const nonEmptyPdf = makePdf();
      const preserved = trimTrailingEmptyQuotePages(nonEmptyPdf, canvas);
      return {
        blankRemoved: removed === 1 && emptyPdf.count === 2,
        realContentPreserved: preserved === 0 && nonEmptyPdf.count === 3
      };
    });
    if (!pdfCleanup.blankRemoved || !pdfCleanup.realContentPreserved) {
      throw new Error('La limpieza del PDF no conserva correctamente sus páginas: ' + JSON.stringify(pdfCleanup));
    }
    console.log('QUOTE PDF PAGINATION PASS', testCase.name, JSON.stringify(pdfCleanup));



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
        const card = view.querySelector('.quote-group-card');
        card.open = true;
        const actions = [...card.querySelectorAll('.quote-option-actions button')];
        const within = (child, parent) => {
          const a = child.getBoundingClientRect();
          const b = parent.getBoundingClientRect();
          return a.left >= b.left - 2 && a.right <= b.right + 2;
        };
        const list = {
          fullWidth: card.scrollWidth <= card.clientWidth + 2,
          buttonsVisible: actions.length >= 3 && actions.every((button) => within(button, card)),
          gridActions: getComputedStyle(card.querySelector('.quote-option-actions')).display === 'grid',
          amountFull: card.querySelector('.quote-option-price')?.textContent.includes('UF 36,53'),
          titleReadable: card.querySelector('.quote-group-company')?.getBoundingClientRect().width > 120,
          alternativesCoexist: view.querySelectorAll('.quote-group-card').length === 1 &&
            view.querySelectorAll('.quote-group-option').length === 2 &&
            view.textContent.includes('Plan Full') &&
            view.textContent.includes('Plan Entrada') &&
            card.querySelector('summary').textContent.includes('2 opciones comerciales') &&
            view.querySelectorAll('[data-action="quote-family"]').length === 0 &&
            view.querySelector('[data-action="view-quote"][data-id="test-quote"]') !== null
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
          compactFooter: ['quoteViewPdfBtn', 'quoteViewEditBtn', 'quoteViewAlternativeBtn', 'quoteViewSendBtn']
            .every((id) => {
              const button = dialog.querySelector('#' + id);
              return Boolean(button && getComputedStyle(button).display !== 'none' &&
                button.getBoundingClientRect().width > 70);
            }),
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
