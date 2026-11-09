import { clientServiceName, clientServiceScope } from './quote-client-copy.js';
import { readOptionalQuoteData } from './quote-optionals.js';
import { QUOTE_IMPLEMENTATION_STEPS } from './quote-implementation.js';
import { quoteDiscountComparison, quoteDiscountPercent } from './quote-commercial-pricing.js';
import { fmtAmount, fmtDate } from './utils.js';

// Biblioteca DOCX real: el archivo es editable en Microsoft Word, no HTML .doc.
const DOCX_SOURCES = [
  'https://cdn.jsdelivr.net/npm/docx@9.5.3/dist/index.umd.cjs',
  'https://unpkg.com/docx@9.5.3/dist/index.umd.cjs'
];
let loadingLibrary = null;

export function loadQuoteWordLibrary() {
  if (window.docx?.Packer?.toBlob && window.docx?.Document) return Promise.resolve(window.docx);
  if (loadingLibrary) return loadingLibrary;
  loadingLibrary = (async () => {
    for (const source of DOCX_SOURCES) {
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = source;
          script.async = true;
          script.onload = resolve;
          script.onerror = () => { script.remove(); reject(new Error('No se pudo cargar biblioteca Word.')); };
          document.head.appendChild(script);
        });
        if (window.docx?.Packer?.toBlob) return window.docx;
      } catch {
        // Probar espejo alternativo si la primera red está bloqueada.
      }
    }
    throw new Error('No se pudo cargar la biblioteca Word. Revisa tu conexión e inténtalo nuevamente.');
  })().catch((error) => {
    loadingLibrary = null;
    throw error;
  });
  return loadingLibrary;
}

export function quoteWordModel(rawDoc = {}) {
  const doc = rawDoc;
  const currency = doc.currency || 'UF';
  const includesIva = true;
  const taxBasis = doc.absorbIva ? 'IVA incluido' : 'neto';
  const optional = Array.isArray(doc.optionalItems)
    ? doc.optionalItems
    : readOptionalQuoteData(doc.notes).items;
  const cleanNotes = readOptionalQuoteData(doc.notes).notes.replace(/\[\[TF_EARLY:.*?\]\]/g, '').trim();
  const money = (value) => fmtAmount(value, currency) + ' ' + currency;
  return {
    number: doc.number || 'Cotización en preparación',
    version: doc.version || 1,
    issuer: doc.issuer || {},
    client: doc.client || {},
    owner: doc.owner || 'Equipo TaskFlow',
    quoteDate: fmtDate(doc.quoteDate) || '',
    validUntil: fmtDate(doc.validUntil) || '',
    contractMonths: Number(doc.contractMonths) || 0,
    currency, taxBasis, includesIva, notes: cleanNotes,
    commercialInfo: doc.commercialInfo || [],
    items: (doc.lines || []).map((l) => ({
      name: clientServiceName(l),
      description: clientServiceScope(l),
      periodicity: l.periodicity === 'unico' ? 'Pago único' : 'Mensual',
      quantity: Number(l.quantity) || 0,
      unit: money(l.unitPrice),
      subtotal: money(l.subtotal),
      discount: money(l.discount),
      total: money(l.total)
    })),
    optional: optional.map((o) => ({
      name: o.name || 'Complemento',
      description: o.description || '',
      periodicity: o.periodicity === 'unico' ? 'Pago único' : 'Mensual',
      quantity: Number(o.quantity) || 0,
      unit: money(o.unitPrice),
      total: money(o.total)
    })),
    totals: doc.totals || {},
    money,
    steps: QUOTE_IMPLEMENTATION_STEPS.map((step) => ({ ...step }))
  };
}

export async function createQuoteWordBlob(rawDoc, lib) {
  const D = lib || await loadQuoteWordLibrary();
  const model = quoteWordModel(rawDoc);
  const {
    Document, Paragraph, TextRun, Table, TableRow, TableCell, Header, Footer,
    WidthType, AlignmentType, HeadingLevel, BorderStyle, Packer
  } = D;
  const NAVY = '1B3257';
  const BLUE = '1D71B8';
  const MUTED = '53657C';
  const BORDER = 'D7E3F2';
  const p = (value, opts = {}) => new Paragraph({
    text: String(value ?? ''), spacing: { after: 105 }, ...opts
  });
  const title = (value) => new Paragraph({
    children: [new TextRun({ text: value, bold: true, color: NAVY, size: 31 })],
    spacing: { before: 180, after: 160 }, keepNext: true
  });
  const heading = (value) => new Paragraph({
    children: [new TextRun({ text: value, bold: true, color: NAVY, size: 24 })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 250, after: 100 },
    keepNext: true
  });
  const subheading = (value) => new Paragraph({
    children: [new TextRun({ text: value, bold: true, color: BLUE, size: 20 })],
    spacing: { before: 130, after: 70 }, keepNext: true
  });
  const cell = (value, { head = false, strong = false } = {}) => new TableCell({
    shading: head ? { fill: 'EAF2FA' } : undefined,
    margins: { top: 90, bottom: 90, left: 90, right: 90 },
    children: [new Paragraph({
      children: [new TextRun({ text: String(value ?? ''), bold: head || strong, color: NAVY, size: 17 })],
      spacing: { after: 0 }
    })]
  });
  const table = (headings, rows) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
      left: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
      right: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 3, color: BORDER },
      insideVertical: { style: BorderStyle.SINGLE, size: 3, color: BORDER }
    },
    rows: [
      new TableRow({ cantSplit: true, children: headings.map((v) => cell(v, { head: true })) }),
      ...rows.map((values) => new TableRow({
        cantSplit: true,
        children: values.map((v, i) => cell(v, { strong: i === values.length - 1 }))
      }))
    ]
  });
  const children = [];
  const put = (...entries) => children.push(...entries);
  const line = (k, v) => p(k + ': ' + (v || '—'));
  const issuerName = model.issuer.commercialName || model.issuer.legalName || 'TaskFlow';
  put(title('PROPUESTA COMERCIAL | ' + issuerName));
  put(p('Cotización ' + model.number + ' · Versión ' + model.version));
  if (model.issuer.legalName) put(p(model.issuer.legalName + (model.issuer.rut ? ' · RUT ' + model.issuer.rut : '')));
  if (model.issuer.email || model.issuer.website) put(p([model.issuer.email, model.issuer.website].filter(Boolean).join(' · ')));
  put(heading('Datos de la propuesta'));
  put(line('Cliente', model.client.company), line('RUT cliente', model.client.rut));
  put(line('Contacto', [model.client.contact, model.client.email].filter(Boolean).join(' · ')));
  put(line('Vendedor', model.owner), line('Fecha', model.quoteDate));
  put(line('Vigencia hasta', model.validUntil), line('Contrato considerado', model.contractMonths + ' meses'));

  if (model.notes) put(heading('Observaciones'), p(model.notes));
  if (model.items.length) {
    put(heading('Qué incluye la solución contratada'));
    for (const item of model.items) {
      put(subheading(item.name + ' · ' + item.periodicity));
      for (const detail of item.description.split(/\r?\n/).filter(Boolean)) {
        put(p('• ' + detail, { indent: { left: 240 } }));
      }
    }
  }
  if (model.commercialInfo.length) {
    put(heading('Incluidos'));
    for (const benefit of model.commercialInfo) put(p('• ' + benefit));
  }
  put(heading('Propuesta económica'));
  put(p('Precios unitarios, valores de lista, descuentos y subtotales expresados como ' + model.taxBasis + '. Los importes finales indicados a continuación incluyen IVA.'));
  const financeHead = ['Solución / tipo', 'Cant.', 'Unit. ' + model.taxBasis, 'Base ' + model.taxBasis, 'Descuento ' + model.taxBasis, 'Subtotal ' + model.taxBasis];
  if (model.items.length) put(table(financeHead, model.items.map((it) => [
    it.name + ' (' + it.periodicity + ')', it.quantity, it.unit, it.subtotal, it.discount, it.total
  ])));
  const setup = model.totals.setup || {};
  const monthly = model.totals.monthly || {};
  const contract = model.totals.contract || {};
  put(heading('Resumen de valores'));
  // Los tres importes del comparativo usan la MISMA base: IVA incluido.
  const addComparison = (name, values) => {
    const prices = quoteDiscountComparison(values, { absorbIva: rawDoc.absorbIva === true });
    put(subheading(name + ' (IVA incluido)'));
    put(table(
      ['Sin descuento (IVA incluido)', 'Descuento aplicado', 'Con descuento (IVA incluido)'],
      [[
        model.money(prices.listWithVat),
        quoteDiscountPercent(prices.discountPercent) + '  (−' + model.money(prices.savedWithVat) + ')',
        model.money(prices.finalWithVat)
      ]]
    ));
    if (!rawDoc.absorbIva) put(p(
      'Precio final: neto ' + model.money(prices.netAfterDiscount) +
      ' + IVA 19% ' + model.money(prices.vatAfterDiscount) + '.'
    ));
  };
  if (model.items.some((it) => it.periodicity === 'Pago único')) {
    addComparison('Total puesta en marcha', setup);
  }
  addComparison('Total mensual', monthly);
  put(p('Los descuentos temporales pueden variar según el mes; consulta la proyección de valores.'));

  if (model.optional.length) {
    put(heading('Complementos opcionales — contratación por separado'));
    put(p('Valores informativos, no incluidos en la solución ni en el valor total del contrato.'));
    put(table(['Complemento', 'Tipo', 'Cantidad', 'Unitario (' + model.taxBasis + ')', 'Total (IVA incluido)'], model.optional.map((it) => [
      it.name, it.periodicity, it.quantity, it.unit, it.total
    ])));
  }
  put(heading('Proyección de valores mensuales (IVA incluido)'));
  const projection = (model.totals.projection || []).map((entry) => [
    'Mes ' + entry.month, model.money(entry.total)
  ]);
  if (projection.length) put(table(['Mes', 'Valor final (IVA incluido)'], projection));
  if (!rawDoc.absorbIva) put(p('Neto del contrato: ' + model.money(contract.net) + ' · IVA 19%: ' + model.money(contract.iva)));
  put(subheading('Valor total del contrato (IVA incluido): ' + model.money(contract.total)));

  put(heading('Próximos pasos: de la contratación a la operación'));
  for (let i = 0; i < model.steps.length; i++) {
    const step = model.steps[i];
    put(subheading(String(i + 1).padStart(2, '0') + '  ' + step.period + ' — ' + step.title));
    put(p(step.body, { keepLines: true }));
  }
  const word = new Document({
    creator: issuerName,
    title: 'Propuesta comercial ' + model.number,
    description: 'Cotización editable TaskFlow, valores con IVA y plan de implementación',
    styles: { default: { document: { run: { font: 'Aptos', size: 19, color: NAVY } } } },
    sections: [{
      properties: { page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 870, bottom: 900, left: 850, right: 850 }
      } },
      headers: { default: new Header({ children: [p(issuerName + '  |  Propuesta comercial', { alignment: AlignmentType.RIGHT })] }) },
      footers: { default: new Footer({ children: [p(model.number + '  |  TaskFlow', { alignment: AlignmentType.CENTER })] }) },
      children
    }]
  });
  const blob = await Packer.toBlob(word);
  if (!blob || blob.size < 500 || blob.type && !/wordprocessingml|octet-stream/i.test(blob.type)) {
    throw new Error('No se pudo generar un archivo Word válido.');
  }
  return blob;
}

export async function downloadQuoteWord(doc, lib) {
  const blob = await createQuoteWordBlob(doc, lib);
  const safe = (part) => String(part || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
  const filename = (safe(doc.number) || 'cotizacion')
    + (doc.version > 1 ? '-v' + doc.version : '')
    + '-' + (safe(doc.client?.company) || 'cliente') + '.docx';
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Revocar en otra tarea de event loop para no invalidar la descarga.
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  return filename;
}
