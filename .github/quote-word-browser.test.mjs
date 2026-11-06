import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import JSZip from 'jszip';

const browser = await chromium.launch({ headless: true, acceptDownloads: true });
try {
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ path: 'node_modules/docx/dist/index.umd.cjs' });
  const libraryReady = await page.evaluate(() => !!(window.docx?.Document && window.docx?.Packer?.toBlob));
  assert.ok(libraryReady, 'El constructor Word no se registró como window.docx');
  const doc = {
    number: 'P-202611-0004', version: 2, currency: 'UF', contractMonths: 12,
    quoteDate: '2026-11-06', client: {company:'Prueba cliente'},
    issuer: { commercialName:'TaskFlow', legalName:'Cuatro R Labs SpA' },
    lines: [
      {code:'CFG_ADV', name:'Configuración avanzada', quantity:4, periodicity:'unico',unitPrice:2,subtotal:8,discount:8,total:0},
      {code:'INV_BASICO', name:'Inventario Plan Básico',quantity:1,periodicity:'mensual',unitPrice:2.8,subtotal:2.8,discount:0.98,total:1.82}
    ],
    optionalItems: [],
    totals: {
      setup:{subtotal:8,discount:8,net:0,iva:0,total:0},
      monthly:{subtotal:2.8,discount:0.98,net:1.82,iva:0.35,total:2.17},
      contract:{net:21.84,iva:4.15,total:25.99},
      projection:[{month:1,total:2.17},{month:2,total:2.17}]
    }
  };
  const [download] = await Promise.all([
    page.waitForEvent('download', {timeout: 30000}),
    page.evaluate(async (docData) => {
      const mod = await import('./js/quote-word-export.js');
      await mod.downloadQuoteWord(docData);
    }, doc)
  ]);
  assert.match(download.suggestedFilename(), /^P-202611-0004-v2-Prueba-cliente\.docx$/);
  const filePath = await download.path();
  const bytes = await readFile(filePath);
  assert.ok(bytes.subarray(0,2).equals(Buffer.from('PK')));
  const docx = await JSZip.loadAsync(bytes);
  const xml = await docx.file('word/document.xml').async('string');
  for(const label of ['Total mensual (IVA incluido)', 'Total puesta en marcha (IVA incluido)',
    'Inventario', 'Salida a producción','09:00 a 18:00']){
    assert.ok(xml.includes(label), 'Falta en DOCX descargado por el navegador: ' + label);
  }
  console.log('QUOTE WORD BROWSER DOWNLOAD PASS', download.suggestedFilename(), bytes.length);
} finally {
  await browser.close();
}
