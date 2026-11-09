import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  const response = await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  if (!response?.ok()) throw new Error('No se pudo iniciar el sitio local para probar PDF');

  await page.addScriptTag({
    url: 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
  });

  const evaluateScenario = async (scenario) => page.evaluate(async (scenario) => {
    const { quoteDocHtml } = await import('./js/views.js');
    const { addQuotePdfFooters, trimTrailingEmptyQuotePages } = await import('./js/quote-pdf-cleanup.js');
    const { placeQuoteRoadmap } = await import('./js/quote-pdf-roadmap.js');
    const lines = [
      { code: 'CFG_ADV', name: 'Configuración avanzada de la plataforma', periodicity: 'unico',
        quantity: 4, unitPrice: 2, subtotal: 8, discount: 6, total: 2 },
      { code: 'GE_BASE', name: 'Gestión Externa Plan Base', periodicity: 'mensual',
        quantity: 1, unitPrice: .7, subtotal: .7, discount: 0, total: .7 },
      { code: 'GE_APP', name: 'Gestión Externa Usuario App', periodicity: 'mensual',
        quantity: 20, unitPrice: .75, subtotal: 15, discount: 5.25, total: 9.75, discountMonths: 6 },
      { code: 'INV_FULL', name: 'Inventario Plan Full', periodicity: 'mensual',
        quantity: 1, unitPrice: 15, subtotal: 15, discount: 5.25, total: 9.75, discountMonths: 6 }
    ];
    const isReal = scenario === 'real' || scenario === 'mobile';
    const isStress = scenario === 'stress';
    const monthCount = isStress ? 84 : 12;
    const effectiveLines = isReal ? [
      { code: 'CFG_ADV', name: 'Configuración avanzada de la plataforma', periodicity: 'unico',
        quantity: 4, unitPrice: 2, subtotal: 8, discount: 8, total: 0 },
      { code: 'INV_BASICO', name: 'Inventario Plan Básico', periodicity: 'mensual',
        quantity: 1, unitPrice: 2.8, subtotal: 2.8, discount: .98, total: 1.82 },
      { code: 'INV_ALMACEN_ADD', name: 'Inventario Almacén adicional', periodicity: 'mensual',
        quantity: 20, unitPrice: .2, subtotal: 4, discount: 1.4, total: 2.6 }
    ] : lines;
    const packCount = isReal ? 4 : 9;
    const doc = {
      number: isReal ? 'P-202611-0004' : 'P-202611-0002', version: 1, currency: 'UF',
      quoteDate: '2026-11-03', validUntil: '2026-11-10',
      contractMonths: monthCount, paymentMethod: 'transferencia', paymentTerms: '5_dias',
      owner: 'Francisco Morgado',
      client: {
        company: 'Soc Incosec Ltda.', rut: '89681600-4',
        contact: 'David Yáñez', phone: '+56979512039', email: 'dyanez@incosec.cl'
      },
      issuer: { commercialName: 'TaskFlow', legalName: 'Cuatro R Labs SpA', rut: '77.972.828-5' },
      commercialInfo: ['Soporte 24/7', 'Implementación guiada por 1 mes', 'Marketing conjunto incluido (opcional)'],
      lines: effectiveLines,
      // La segunda variante replica el contrato de la captura del usuario:
      // Plan Básico + 20 almacenes + 4 packs opcionales.
      optionalItems: Array.from({ length: packCount }, (_, i) => ({
        name: 'Pack de inventario ' + (i + 1),
        description: 'Capacidad adicional para ítems de inventario',
        quantity: 1,
        unitPrice: 0.35 + i * 0.3,
        total: (0.35 + i * 0.3) * 1.19,
        periodicity: 'mensual',
        includesIva: false
      })),
      totals: isReal ? {
        setup: { subtotal: 8, discount: 8, net: 0, iva: 0, total: 0 },
        monthly: { subtotal: 6.8, discount: 2.38, net: 4.42, iva: .84, total: 5.26 },
        projection: Array.from({ length: monthCount }, (_, i) => ({
          month: i + 1, net: 4.42, total: 5.26
        })),
        contract: { net: 53.04, iva: 10.08, total: 63.12 }
      } : {
        setup: { subtotal: 8, discount: 6, net: 2, iva: .38, total: 2.38 },
        monthly: { subtotal: 30.7, discount: 10.75, net: 19.95, iva: 3.79, total: 23.74 },
        projection: Array.from({ length: monthCount }, (_, i) => ({
          month: i + 1, net: i < 6 ? 19.95 : 30.7, total: i < 6 ? 23.74 : 36.53
        })),
        contract: { net: 305.9, iva: 58.12, total: 364.02 }
      }
    };

    const holder = document.createElement('div');
    holder.className = 'quote-pdf-holder';
    holder.innerHTML = quoteDocHtml(doc);
    holder.firstElementChild.classList.add('qd-for-print');
    document.body.appendChild(holder);
    try {
      const worker = window.html2pdf()
        .set({
          margin: [12, 12, 12, 12],
          image: { type: 'jpeg', quality: 0.96 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: {
            mode: ['css', 'legacy'],
            before: ['.qd-projection-summary'],
            avoid: ['.qd-financial-group', '.qd-economic-summary', '.qd-included-benefits', '.qd-plan-card', 'tr', '.qd-totals', '.qd-contract', '.qd-head', '.qd-optional-page-group']
          }
        })
        .from(holder.firstElementChild);

      await worker.toContainer();
      const container = await worker.get('container');
      const root = container.querySelector('.quote-doc');
      const projection = root.querySelector('.qd-projection-summary');
      const contract = projection.querySelector('.qd-contract');
      const closing = root.querySelector('.qd-closing');
      const stages = [...closing.querySelectorAll('.qd-roadmap-step')];
      const optionalGroups = [...root.querySelectorAll('.qd-optional-page-group')];
      const optionalRows = [...root.querySelectorAll('.qd-optionals-section tbody tr')];
      const header = projection.querySelector('h4');
      const table = root.querySelector('.qd-unified-economics .qd-unified-table');
      const economicRows = [...root.querySelectorAll('.qd-unified-table tbody tr')];
      const economicBlocks = [...root.querySelectorAll('.qd-financial-group')];
      const economicSummary = root.querySelector('.qd-economic-summary');
      const pageSize = await worker.get('pageSize');
      const pagePx = pageSize.inner.px.height;
      const roadmapPlacement = placeQuoteRoadmap(container, pagePx, { marginPx: 55 });
      const baseY = root.getBoundingClientRect().top;
      const projectionY = projection.getBoundingClientRect().top - baseY;
      const contractBottom = contract.getBoundingClientRect().bottom - baseY;
      const closingTop = closing.getBoundingClientRect().top - baseY;
      const closingBottom = closing.getBoundingClientRect().bottom - baseY;
      const stagesBounds = stages.map((stage) => ({
        top: stage.getBoundingClientRect().top - baseY,
        bottom: stage.getBoundingClientRect().bottom - baseY
      }));
      const projectionPage = Math.floor((projectionY + 3) / pagePx);
      const contractPage = Math.floor((contractBottom - 3) / pagePx);
      const closingStartPage = Math.floor((closingTop + 3) / pagePx);
      const closingPage = Math.floor((closingBottom - 3) / pagePx);
      const optionalGroupPages = optionalGroups.map((el) => ({
        first: Math.floor((el.getBoundingClientRect().top - baseY + 3) / pagePx),
        last: Math.floor((el.getBoundingClientRect().bottom - baseY - 3) / pagePx)
      }));
      const optionalRowPages = optionalRows.map((el) => ({
        first: Math.floor((el.getBoundingClientRect().top - baseY + 3) / pagePx),
        last: Math.floor((el.getBoundingClientRect().bottom - baseY - 3) / pagePx)
      }));
      const packsNeverSplit =
        optionalGroups.length === Math.ceil(packCount / 4) &&
        optionalRows.length === packCount &&
        optionalGroupPages.every(({ first, last }) => first === last) &&
        optionalRowPages.every(({ first, last }) => first === last);
      const stagePages = stagesBounds.map(({ top, bottom }) => ({
        start: Math.floor((top + 3) / pagePx),
        end: Math.floor((bottom - 3) / pagePx)
      }));
      const stageIntegrity = stages.length === 5 && stagePages.every(({ start, end }) => start === end) &&
        stages[4]?.textContent.includes('Salida a producción') &&
        stages[4]?.textContent.includes('09:00 a 18:00');
      const allStagesOnSamePage = stagePages.every(({ start, end }) => start === closingStartPage && end === closingPage);
      const rootBox = root.getBoundingClientRect();
      const tableBox = table.getBoundingClientRect();
      const economicBlocksWithinPages = economicBlocks.every((el) => {
        const yStart = el.getBoundingClientRect().top - baseY;
        const yEnd = el.getBoundingClientRect().bottom - baseY;
        return Math.floor((yStart + 3) / pagePx) === Math.floor((yEnd - 3) / pagePx);
      });
      const css = getComputedStyle(root);
      const horizontalPadding = [parseFloat(css.paddingLeft), parseFloat(css.paddingRight)];
      const marginTolerance = 20; // tolera el padding superior del documento
      const freeSpaceAfterTotals = pagePx - (contractBottom % pagePx);
      const roadmapHeight = closingBottom - closingTop;
      // Margen de seguridad para la distancia entre ambos bloques y el footer.
      const roadmapShouldFit = freeSpaceAfterTotals >= roadmapHeight + 55;
      const lastDescription = stages[4].querySelector('p').getBoundingClientRect();
      const lastDescBounds = {
        left: lastDescription.left - root.getBoundingClientRect().left,
        top: lastDescription.top - baseY,
        width: lastDescription.width,
        height: lastDescription.height
      };

      await worker.toPdf();
      const pdf = await worker.get('pdf');
      const canvas = await worker.get('canvas');
      // Verificar los píxeles capturados de la descripción de la quinta etapa,
      // no solamente el HTML: la regresión real ocultaba la última tarjeta
      // aunque el DOM la contuviera completa.
      const scale = canvas.width / rootBox.width;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const xStart = Math.max(0, Math.floor(lastDescBounds.left * scale) + 4);
      const yStart = Math.max(0, Math.floor(lastDescBounds.top * scale) + 3);
      const xEnd = Math.min(canvas.width, Math.ceil((lastDescBounds.left + lastDescBounds.width) * scale) - 3);
      const yEnd = Math.min(canvas.height, Math.ceil((lastDescBounds.top + lastDescBounds.height) * scale) - 3);
      let lastDescriptionInk = 0;
      for (let y = yStart; y < yEnd; y += 2) {
        const pixels = ctx.getImageData(xStart, y, xEnd - xStart, 1).data;
        for (let x = 0; x < pixels.length; x += 8) {
          if (pixels[x] < 125 && pixels[x+1] < 155 && pixels[x+2] < 185) lastDescriptionInk++;
        }
      }
      const trimmed = trimTrailingEmptyQuotePages(pdf, canvas, {
        top: 12, right: 12, bottom: 12, left: 12
      });
      const pdfPages = pdf.getNumberOfPages();
      const footerTexts = [];
      const originalText = pdf.text.bind(pdf);
      pdf.text = (...args) => {
        footerTexts.push(String(args[0]));
        return originalText(...args);
      };
      const decorated = addQuotePdfFooters(pdf, doc);
      pdf.text = originalText;
      const footerNumbers = Array.from({length: pdfPages}, (_, i) => 'Página ' + (i + 1) + ' de ' + pdfPages);
      const footerNumbersCorrect = footerNumbers.every((text) => footerTexts.includes(text));
      const footerBrandsCorrect = footerTexts.filter((text) => text.includes('Propuesta comercial')).length === pdfPages;


      return {
        projectionPage, contractPage, closingStartPage, closingPage, pdfPages,
        closingOnLastPage: closingStartPage === closingPage && closingPage === pdfPages - 1,
        compactRoadmap: !roadmapShouldFit || closingStartPage === projectionPage,
        roadmapOnExistingPageWhenPossible: roadmapShouldFit ? closingStartPage === projectionPage : true,
        freeSpaceAfterTotals, roadmapHeight, roadmapShouldFit, roadmapPlacement,
        lastStageActuallyVisible: lastDescriptionInk > 30 && closingPage < pdfPages &&
          roadmapPlacement.bottomSafetyPx >= 55,
        lastDescriptionInk,
        forcedBreakWhenNeeded: !isStress || (roadmapPlacement.applied && closingStartPage > projectionPage),
        noRoadmapCuts: stageIntegrity && allStagesOnSamePage,
        packsNeverSplit, optionalGroupPages, optionalRowPages,
        unifiedEconomicsCorrect: economicRows.length === effectiveLines.length &&
          economicRows.filter((row) => row.querySelector('.qd-billing-once')).length === 1 &&
          economicRows.filter((row) => row.querySelector('.qd-billing-monthly')).length === effectiveLines.length - 1 &&
          economicBlocksWithinPages &&
          economicSummary.querySelectorAll('.qd-economic-summary-row').length === 2 &&
          !root.querySelector('.qd-setup-section, .qd-monthly-section'),
        projectionBeforeRoadmap: contractBottom < closingTop,
        taxLabelsPresent: root.textContent.includes('Total mensual (IVA incluido)') &&
          root.textContent.includes('Valor total del contrato UF (IVA incluido)') &&
          root.textContent.includes('Neto contrato') &&
          !root.textContent.includes('Total primer mes'),
        closingContents: closing.textContent.includes('Próximos pasos: de la contratación a la operación') && closing.textContent.includes('Kickoff') && closing.textContent.includes('Carga de información') && closing.textContent.includes('Capacitación') && closing.textContent.includes('Marcha blanca') && closing.textContent.includes('Salida a producción') && closing.textContent.includes('09:00 a 18:00') && closing.querySelectorAll('.qd-roadmap-step').length === 5,
        footerOnEveryPage: decorated === pdfPages && pdf.getNumberOfPages() === pdfPages && footerNumbersCorrect && footerBrandsCorrect,
        projectionOnFinalPageWhenFits: !roadmapShouldFit || projectionPage === pdfPages - 1,
        allFinalValuesSamePage: projectionPage === contractPage,
        startsOnNewPage: projectionPage > 0 && Math.abs(projectionY % pagePx) < marginTolerance,
        marginsSymmetric: horizontalPadding[0] === horizontalPadding[1] &&
          Math.abs(pageSize.width - 210) < 0.1 && Math.abs(pageSize.height - 297) < 0.1,
        tableWithinPaper: tableBox.left >= rootBox.left - 1 &&
          tableBox.right <= rootBox.right + 1,
        marginValues: horizontalPadding,
        trimmed, pagePx,
        projectionOffset: projectionY % pagePx,
        headerText: header.textContent.trim(),
        contractText: contract.textContent.trim(),
        scenario,
        expectedTotal: isReal ? '63,12' : '364,02'
      };
    } finally {
      holder.remove();
    }
  }, scenario);

  for (const scenario of ['expanded', 'real', 'stress', 'mobile']) {
    if (scenario === 'mobile') await page.setViewportSize({ width: 390, height: 844 });
    const result = await evaluateScenario(scenario);
    console.log('COTIZACIÓN PDF A4 LAYOUT', JSON.stringify(result));
    const requirements = [
    'projectionOnFinalPageWhenFits', 'allFinalValuesSamePage',
    'startsOnNewPage', 'marginsSymmetric', 'tableWithinPaper',
    'closingOnLastPage', 'compactRoadmap', 'roadmapOnExistingPageWhenPossible', 'noRoadmapCuts', 'lastStageActuallyVisible', 'forcedBreakWhenNeeded', 'packsNeverSplit', 'unifiedEconomicsCorrect', 'projectionBeforeRoadmap', 'taxLabelsPresent', 'closingContents', 'footerOnEveryPage'
  ];
  for (const check of requirements) {
    if (!result[check]) {
      throw new Error('Fallo de paginación/márgenes del PDF: ' + check + ' ' + JSON.stringify(result));
    }
  }
    if (!result.contractText.includes(result.expectedTotal)) {
      throw new Error('El total del período no quedó en la última página: ' + scenario);
    }
    console.log('QUOTE PDF LAST PAGE PASS', scenario);
  }
} finally {
  await browser.close();
}
