import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  const response = await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  if (!response?.ok()) throw new Error('No se pudo iniciar el sitio local para probar PDF');

  await page.addScriptTag({
    url: 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
  });

  const result = await page.evaluate(async () => {
    const { quoteDocHtml } = await import('./js/views.js');
    const { addQuotePdfFooters, trimTrailingEmptyQuotePages } = await import('./js/quote-pdf-cleanup.js');
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
    const doc = {
      number: 'P-202611-0002', version: 1, currency: 'UF',
      quoteDate: '2026-11-03', validUntil: '2026-11-10',
      contractMonths: 12, paymentMethod: 'transferencia', paymentTerms: '5_dias',
      owner: 'Francisco Morgado',
      client: {
        company: 'Soc Incosec Ltda.', rut: '89681600-4',
        contact: 'David Yáñez', phone: '+56979512039', email: 'dyanez@incosec.cl'
      },
      issuer: { commercialName: 'TaskFlow', legalName: 'Cuatro R Labs SpA', rut: '77.972.828-5' },
      commercialInfo: ['Soporte 24/7', 'Implementación guiada por 1 mes', 'Marketing conjunto incluido (opcional)'],
      lines,
      // 9 packs: comprueba tanto la fila que quedaba partida como la
      // continuidad de la tabla en varias hojas (grupos de 4 + 4 + 1).
      optionalItems: Array.from({ length: 9 }, (_, i) => ({
        name: 'Pack de inventario ' + (i + 1),
        description: 'Capacidad adicional para ítems de inventario',
        quantity: 1,
        unitPrice: 0.35 + i * 0.3,
        total: (0.35 + i * 0.3) * 1.19,
        periodicity: 'mensual',
        includesIva: false
      })),
      totals: {
        setup: { subtotal: 8, discount: 6, net: 2, iva: .38, total: 2.38 },
        monthly: { subtotal: 30.7, discount: 10.75, net: 19.95, iva: 3.79, total: 23.74 },
        projection: Array.from({ length: 12 }, (_, i) => ({
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
            avoid: ['.qd-financial-group', '.qd-economic-summary', '.qd-included-benefits', '.qd-plan-card', 'tr', '.qd-totals', '.qd-contract', '.qd-head', '.qd-roadmap', '.qd-roadmap-step', '.qd-optional-page-group']
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
        optionalGroups.length === 3 &&
        optionalRows.length === 9 &&
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
      const roadmapShouldFit = freeSpaceAfterTotals >= roadmapHeight + 40;

      await worker.toPdf();
      const pdf = await worker.get('pdf');
      const canvas = await worker.get('canvas');
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
        freeSpaceAfterTotals, roadmapHeight, roadmapShouldFit,
        noRoadmapCuts: stageIntegrity && allStagesOnSamePage,
        packsNeverSplit, optionalGroupPages, optionalRowPages,
        unifiedEconomicsCorrect: economicRows.length === 4 &&
          economicRows.filter((row) => row.querySelector('.qd-billing-once')).length === 1 &&
          economicRows.filter((row) => row.querySelector('.qd-billing-monthly')).length === 3 &&
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
        contractText: contract.textContent.trim()
      };
    } finally {
      holder.remove();
    }
  });

  console.log('COTIZACIÓN PDF A4 LAYOUT', JSON.stringify(result));
  const requirements = [
    'projectionOnFinalPageWhenFits', 'allFinalValuesSamePage',
    'startsOnNewPage', 'marginsSymmetric', 'tableWithinPaper',
    'closingOnLastPage', 'compactRoadmap', 'roadmapOnExistingPageWhenPossible', 'noRoadmapCuts', 'packsNeverSplit', 'unifiedEconomicsCorrect', 'projectionBeforeRoadmap', 'taxLabelsPresent', 'closingContents', 'footerOnEveryPage'
  ];
  for (const check of requirements) {
    if (!result[check]) {
      throw new Error('Fallo de paginación/márgenes del PDF: ' + check + ' ' + JSON.stringify(result));
    }
  }
  if (!result.contractText.includes('364,02')) {
    throw new Error('El total del período no quedó en la última página del documento.');
  }
  console.log('QUOTE PDF LAST PAGE PASS');
} finally {
  await browser.close();
}
