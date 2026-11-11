import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { clientServiceName, clientServiceScope } from '../js/quote-client-copy.js';
import { quoteDiscountPercent } from '../js/quote-commercial-pricing.js';

// Evalúa exactamente el generador del repositorio, sin red ni autenticación:
const file = await readFile(new URL('../js/quotes.js', import.meta.url), 'utf8');
const marker = '/* ---------- Correo de cotización: propuesta comercial ejecutiva ---------- */';
assert.ok(file.includes(marker));
const quoteCode = file.slice(file.indexOf(marker));
const ctx = {
  clientServiceName, clientServiceScope, quoteDiscountPercent,
  fmtNumber: (x) => new Intl.NumberFormat('es-CL').format(Number(x || 0)),
  fmtCurrency: (x, cur='UF') => (cur === 'USD' ? 'US$' : cur) + ' ' +
    new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(x || 0)),
  fmtDate: (x) => String(x),
  readOptionalQuoteData: (notes) => ({ notes: String(notes || ''), items: [] })
};
const buildQuoteEmail = runInNewContext(quoteCode.replace('export function buildQuoteEmail', 'function buildQuoteEmail') + '\nbuildQuoteEmail;', ctx);
const sample = {
  number: 'P-202611-0003', version: 3, contractMonths: 12,
  currency: 'UF', absorbIva: false, total: 105.67,
  client: { company: 'Soc Incosec Ltda.', contact: 'David Yáñez' },
  items: [
    { code: 'CFG_ADV', periodicity: 'unico', quantity: 4, subtotal: 8, discount: 8, total: 0 },
    { code: 'GE_BASE', periodicity: 'mensual', quantity: 1, subtotal: .7, discount: .42, total: .28 },
    { code: 'GE_APP', periodicity: 'mensual', quantity: 20, subtotal: 15, discount: 9, total: 6 },
    { code: 'INV_BASICO', periodicity: 'mensual', quantity: 1, subtotal: 2.8, discount: 1.68, total: 1.12 }
  ],
  totals: {
    setup: {subtotal:8,discount:8,net:0,iva:0,total:0},
    monthly: {subtotal:18.5,discount:11.1,net:7.4,iva:1.41,total:8.81},
    projection: Array.from({length:12}, (_,i)=>({month:i+1,total:8.81})),
    contract:{net:88.8,iva:16.87,total:105.67}
  },
  optionalItems:[{name:'Packs de ítems de inventario 500',unitPrice:.35,total:.4165,
    quantity:1,periodicity:'mensual',includesIva:false}],
  commercialInfo:['Implementación guiada por 1 mes','Soporte','Marketing conjunto (opcional)'],
  notes:''
};
const { body, subject } = buildQuoteEmail(sample);
for(const label of [
 'Estimado David:', 'cotización ajustada', 'Plan Básico de Inventario',
 '100% de descuento', '60% de descuento',
 'durante los 12 meses del contrato', 'UF 7,40 netos + IVA',
 'UF 8,81 IVA incluido', 'UF 18,50 netos + IVA', 'UF 105,67 IVA incluido',
 '20 usuarios App', 'Hasta 500 ítems de inventario', '250 equipos seriados',
 'UF 0,35 + IVA', 'Marketing conjunto (opcional)', 'Quedo atento a tus comentarios'
]) assert.ok(body.includes(label), 'Falta: '+label);
assert.ok(subject.includes('P-202611-0003 v3'));
assert.ok(!body.includes('Habilitación (pago único):'));
assert.ok(!body.includes('Incluye: Horas'));
const limited=buildQuoteEmail({...sample,totals:{...sample.totals,
  projection:sample.totals.projection.map((entry,i)=>({...entry,total:i?15:8.81}))}}).body;
assert.ok(!limited.includes('durante los 12 meses del contrato'));
assert.ok(!limited.includes('fijo durante todo el contrato'));
const noDiscount=buildQuoteEmail({...sample,version:1,
  totals:{...sample.totals,
    setup:{subtotal:0,discount:0,total:0},
    monthly:{subtotal:18.5,discount:0,net:18.5,iva:3.52,total:22.02}}}).body;
assert.ok(noDiscount.includes('El valor mensual de la propuesta es de'));
assert.ok(!noDiscount.includes('siguientes descuentos'));
const absorb=buildQuoteEmail({...sample,absorbIva:true,
  totals:{...sample.totals,monthly:{subtotal:22,discount:2,net:20,iva:0,total:20}}}).body;
assert.ok(absorb.includes('IVA incluido'));
assert.ok(!absorb.includes('netos + IVA ('));
console.log('QUOTE COMMERCIAL EMAIL PASS',body.length);
