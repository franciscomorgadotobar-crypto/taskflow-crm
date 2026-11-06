import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/quote-optionals.js', import.meta.url), 'utf8');
const { optionalUnitPrice, optionalItemSnapshot, readOptionalQuoteData, writeOptionalQuoteData } =
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

const pack = { id: 'pack-1000', code: 'INV_PACK_1000', name: 'Pack adicional de 1.000 ítems',
  description: 'Amplía la capacidad de inventario', price: 2, periodicity: 'mensual' };
const opts = { currency: 'UF', listCurrency: 'UF', ufValue: 41000, usdValue: 1000, absorbIva: false };

const line = optionalItemSnapshot(pack, 2, opts);
assert.equal(line.quantity, 2);
assert.equal(line.unitPrice, 2);
assert.equal(line.total, 4.76);
assert.equal(line.periodicity, 'mensual');
assert.equal(optionalUnitPrice(2, 'UF', 'CLP', 41000, null), 82000);
assert.equal(optionalUnitPrice(82000, 'CLP', 'UF', 41000, null), 2);
assert.equal(optionalUnitPrice(1, 'UF', 'USD', 41000, 1000), 41);
assert.equal(optionalUnitPrice(41, 'USD', 'UF', 41000, 1000), 1);
assert.equal(optionalUnitPrice(2, 'UF', 'CLP', null, null), null);

const absorbed = optionalItemSnapshot({ ...pack, price: 25 }, 1,
  { currency: 'USD', listCurrency: 'USD', absorbIva: true });
assert.equal(absorbed.total, 25);
assert.equal(absorbed.includesIva, true);

const earlier = 'Observaciones públicas\n[[TF_EARLY:%7B%22days%22%3A60%7D]]';
const stored = writeOptionalQuoteData(earlier, [line]);
const parsed = readOptionalQuoteData(stored);
assert.equal(parsed.items.length, 1);
assert.equal(parsed.items[0].name, pack.name);
assert.equal(parsed.items[0].total, 4.76);
assert.equal(parsed.notes, earlier);
assert.equal(readOptionalQuoteData(writeOptionalQuoteData(stored, [])).items.length, 0);
assert.ok(!readOptionalQuoteData('Sin opcionales').items.length);
console.log('Complementos opcionales PASS');
