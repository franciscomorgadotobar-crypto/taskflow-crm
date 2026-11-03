import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/price-list-export.js', import.meta.url), 'utf8');
const { priceListMatrix, priceListCsv, downloadAllPriceListsXlsx } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
);

const list = { id: '12345678-0000-0000-0000-000000000000', name: 'Servicios: / Norte', currency: 'UF' };
const items = [
  { code: 'SERV-02', name: 'Servicio; visita', description: 'Hasta 500 ítems de inventario\n2 almacenes', price: 1.25, periodicity: 'mensual', category: 'Terreno', active: false, position: 1 },
  { code: 'SERV-01', name: 'Instalación', description: '', price: 0.75, periodicity: 'unico', category: 'Inicial', active: true, position: 0 }
];

const matrix = priceListMatrix(list, items);
assert.deepEqual(matrix[0], ['Código', 'Nombre', 'Alcance comercial', 'Precio UF', 'Periodicidad', 'Categoría', 'Activo']);
assert.deepEqual(matrix[1], ['SERV-01', 'Instalación', '', 0.75, 'Único', 'Inicial', 'Sí']);
assert.deepEqual(matrix[2], ['SERV-02', 'Servicio; visita', 'Hasta 500 ítems de inventario\n2 almacenes', 1.25, 'Mensual', 'Terreno', 'No']);

const csv = priceListCsv(list, items);
assert.ok(csv.startsWith('\uFEFF"Código";'));
assert.ok(csv.includes('"Servicio; visita"'));
assert.ok(csv.includes('"Hasta 500 ítems de inventario\n2 almacenes"'));
assert.ok(csv.includes('"0.75"'));
assert.ok(csv.includes('"No"'));

const injected = priceListCsv(list, [{ ...items[0], code: '=SUM(A1:A2)' }]);
assert.ok(injected.includes("\"'=SUM(A1:A2)\""), 'CSV no debe permitir fórmulas ejecutables');

const writes = [];
const XLSX = {
  utils: {
    book_new: () => ({ SheetNames: [], Sheets: {} }),
    aoa_to_sheet: (rows) => ({ rows }),
    book_append_sheet: (workbook, worksheet, title) => {
      workbook.SheetNames.push(title);
      workbook.Sheets[title] = worksheet;
    }
  },
  writeFile: (workbook, filename) => writes.push({ workbook, filename })
};
await downloadAllPriceListsXlsx(
  [{ list, items }, { list: { ...list, id: '87654321-0000-0000-0000-000000000000' }, items }],
  async () => XLSX
);
assert.equal(writes.length, 1);
assert.equal(writes[0].filename, 'listas-precios-taskflow.xlsx');
assert.equal(writes[0].workbook.SheetNames.length, 2);
assert.notEqual(writes[0].workbook.SheetNames[0], writes[0].workbook.SheetNames[1]);
assert.ok(writes[0].workbook.SheetNames.every((name) => name.length <= 31 && !/[\[\]:*?\/\\]/.test(name)));
assert.deepEqual(writes[0].workbook.Sheets[writes[0].workbook.SheetNames[0]].rows, matrix);

console.log('price-list-export: PASS');
