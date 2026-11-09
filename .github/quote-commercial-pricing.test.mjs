import assert from 'node:assert/strict';
import { quoteDiscountComparison, quoteDiscountPercent } from '../js/quote-commercial-pricing.js';

// Cotización real Incosec: propuesta de puesta en marcha + mensualidad.
const startup = quoteDiscountComparison({
  subtotal: 8, discount: 8, net: 0, iva: 0, total: 0
});
const monthly = quoteDiscountComparison({
  subtotal: 6.8, discount: 2.38, net: 4.42, iva: 0.84, total: 5.26
});
assert.equal(quoteDiscountPercent(startup.discountPercent), '100%');
assert.equal(quoteDiscountPercent(monthly.discountPercent), '35%');
assert.equal(startup.listWithVat.toFixed(2), '9.52');
assert.equal(startup.savedWithVat.toFixed(2), '9.52');
assert.equal(startup.finalWithVat, 0);
assert.equal(monthly.listWithVat.toFixed(2), '8.09');
assert.equal(monthly.savedWithVat.toFixed(2), '2.83');
assert.equal(monthly.finalWithVat.toFixed(2), '5.26');
assert.equal(monthly.netAfterDiscount, 4.42);
assert.equal(monthly.vatAfterDiscount, 0.84);

// IVA absorbido: los valores ya son finales, jamás duplicar el impuesto.
const absorbed = quoteDiscountComparison({ subtotal: 119, discount: 19, total: 100 }, { absorbIva: true });
assert.equal(absorbed.listWithVat, 119);
assert.equal(absorbed.savedWithVat, 19);
assert.equal(absorbed.finalWithVat, 100);

const noDiscount = quoteDiscountComparison({ subtotal: 0, discount: 0, total: 0 });
assert.equal(quoteDiscountPercent(noDiscount.discountPercent), '0%');
assert.equal(quoteDiscountPercent(12.5), '12,5%');
console.log('QUOTE COMMERCIAL DISCOUNT PASS');
