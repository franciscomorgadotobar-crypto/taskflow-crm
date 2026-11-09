import assert from 'node:assert/strict';
import * as docx from 'docx';
import JSZip from 'jszip';
import { createQuoteWordBlob, quoteWordModel } from '../js/quote-word-export.js';

const sample = {
  number: 'P-202611-0004', version: 2, currency: 'UF',
  contractMonths: 12, quoteDate: '2026-11-06', validUntil: '2026-11-20',
  issuer: { commercialName: 'TaskFlow', legalName: 'Cuatro R Labs SpA', rut: '77.972.828-5' },
  client: { company: 'Cliente de prueba', contact: 'Cliente', email: 'cliente@example.org' },
  owner: 'Equipo comercial', notes: 'Cotización de prueba',
  lines: [
    { code: 'CFG_ADV', name: 'Configuración avanzada', periodicity: 'unico', quantity: 4,
      unitPrice: 2, subtotal: 8, discount: 8, total: 0 },
    { code: 'INV_BASICO', name: 'Inventario Plan Básico', periodicity: 'mensual', quantity: 1,
      unitPrice: 2.8, subtotal: 2.8, discount: 0.98, total: 1.82 },
    { code: 'INV_ALMACEN_ADD', name: 'Inventario Almacén adicional', periodicity: 'mensual',
      quantity: 20, unitPrice: 0.2, subtotal: 4, discount: 1.4, total: 2.6 }
  ],
  optionalItems: [
    { name: 'Pack adicional de 500 ítems', quantity: 1, unitPrice: 0.35, total: 0.4165, periodicity: 'mensual' }
  ],
  commercialInfo: ['Implementación guiada'],
  totals: {
    setup: { subtotal: 8, discount: 8, net: 0, iva: 0, total: 0 },
    monthly: { subtotal: 6.8, discount: 2.38, net: 4.42, iva: 0.84, total: 5.26 },
    projection: Array.from({length: 12}, (_, i) => ({ month: i + 1, total: 5.26 })),
    contract: { net: 53.04, iva: 10.08, total: 63.12 }
  }
};
const data = quoteWordModel(sample);
assert.equal(data.steps.length, 5);
assert.equal(data.steps[4].period, 'Salida a producción');
assert.equal(data.items.length, 3);
assert.equal(data.optional.length, 1);
const file = await createQuoteWordBlob(sample, docx);
assert.ok(file.size > 10000, 'No se generó un DOCX con contenido real');
const zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));
assert.ok(zip.file('word/document.xml'));
assert.ok(zip.file('word/styles.xml'));
const xml = await zip.file('word/document.xml').async('string');
for (const label of [
  'P-202611-0004', 'Cliente de prueba', 'Total mensual (IVA incluido)',
  'Total puesta en marcha (IVA incluido)', 'Neto', '5,26', '0,00',
  'Complementos opcionales', 'Pack adicional de 500 ítems',
  'Sin descuento (IVA incluido)', 'Descuento aplicado', 'Con descuento (IVA incluido)',
  '35%', '100%', '8,09', '9,52', '2,83', '5,26',
  'Kickoff', 'Semana 1', 'Semanas 2 y 3', 'Semana 4',
  'Salida a producción', '09:00 a 18:00'
]) {
  assert.ok(xml.includes(label), 'Falta en el Word: ' + label);
}
assert.ok(!xml.includes('Total primer mes'), 'No debe usarse la etiqueta antigua');
assert.ok(!xml.includes('Beneficio neto') && !xml.includes('Beneficio neto'), 'No deben mostrarse beneficios como descuentos');
const alternate = await createQuoteWordBlob({ ...sample, absorbIva: true }, docx);
assert.ok(alternate.size > 10000);
console.log('QUOTE WORD DOCX PASS', file.size, alternate.size);
