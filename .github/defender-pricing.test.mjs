import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/defender-pricing.js', import.meta.url), 'utf8');
const {
  DEFENDER_DEFAULT, calculateDefender, defenderSoftwareQuantities,
  defenderPriceListItems, defenderPriceListName, defenderQuoteLines, defenderConfig
} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

const approx = (value, expected, label) =>
  assert.ok(Math.abs(value - expected) < 0.00001, label + ': ' + value + ' vs ' + expected);

// Reproduce fielmente la referencia Las Condes, incluida su división de hardware entre 12.
const base = calculateDefender(DEFENDER_DEFAULT);
assert.equal(base.hardwareReference, 187);
assert.equal(base.tagsReference, 39);
assert.equal(base.implementationReference, 430);
assert.equal(base.software, 100);
approx(base.monthlyNet, 154.6666666667, 'Las Condes UF netas mensuales');
approx(base.contractNet, 1856, 'Las Condes UF netas contrato');
assert.deepEqual(base.softwareTierUsers, { tier1: 100, tier2: 0, tier3: 0 });

// La segunda modalidad resuelve la ambigüedad de la tarifa de hardware UF/mes.
const literal = calculateDefender({ ...DEFENDER_DEFAULT, hardwareMode: 'monthly' });
approx(literal.monthlyNet, 326.0833333333, 'Arriendo mensual literal');
assert.ok(literal.monthlyNet > base.monthlyNet);

// Tramos progresivos: 100*1 + 400*0.8 + 100*0.65 = 485 UF.
assert.deepEqual(defenderSoftwareQuantities(600), { tier1: 100, tier2: 400, tier3: 100 });
assert.equal(calculateDefender({ ...DEFENDER_DEFAULT, users: 600 }).software, 485);
assert.equal(calculateDefender({ ...DEFENDER_DEFAULT, users: 50 }).software, 50);
assert.equal(calculateDefender({ ...DEFENDER_DEFAULT, users: 500 }).software, 420);
assert.equal(calculateDefender({ ...DEFENDER_DEFAULT, users: 501 }).software, 420.65);

// Dos locales y equipos editables cambian implementación y hardware de modo independiente.
const multi = calculateDefender({ ...DEFENDER_DEFAULT, sites: 2, tunnel: 2, tagMini: 300 });
assert.equal(multi.hardwareReference, 277);
assert.equal(multi.tagsReference, 69);
assert.equal(multi.implementationReference, 850);
assert.equal(multi.tagged, 500);

// Cada fila requiere código, periodicidad mensual y tarifa positiva.
for (const months of [12,24,36]) {
  for (const hardwareMode of ['reference','monthly']) {
    const config = { ...DEFENDER_DEFAULT, months, hardwareMode };
    const items = defenderPriceListItems(config);
    assert.equal(items.length, 18);
    assert.equal(new Set(items.map(x => x.code)).size, items.length);
    assert.ok(items.every(x => x.price > 0 && x.periodicity === 'mensual'));
    assert.ok(defenderPriceListName(config).includes(String(months)));
    const lines = defenderQuoteLines(config);
    assert.ok(lines.every(x => items.some(item => item.code === x.code)));
    assert.equal(lines.find(x => x.code === 'DEF_SETUP_TAGGED').quantity, 300);
    const fromCatalog = lines.reduce((sum, x) => sum + x.quantity * items.find(y => y.code === x.code).price, 0);
    approx(fromCatalog, calculateDefender(config).monthlyNet, 'Totales catálogo ' + months + ' ' + hardwareMode);
  }
}
assert.equal(defenderConfig({ users: -50, sites: -2 }).users, 1);
console.log('defender-pricing: PASS');
