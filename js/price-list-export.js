/**
 * Exportación de las listas de precios del cotizador.
 * Se exportan todos los servicios, también los inactivos, sin modificar datos.
 * Los encabezados y valores son compatibles con la importación del CRM.
 */
const columns = (list) => ['Código', 'Nombre', 'Precio ' + (list.currency || 'UF'), 'Periodicidad', 'Categoría', 'Activo'];

export function priceListMatrix(list, items) {
  if (!list?.id) throw new Error('Lista de precios no disponible.');
  const rows = [...items].sort((a, b) =>
    Number(a.position || 0) - Number(b.position || 0) ||
    String(a.code || '').localeCompare(String(b.code || ''), 'es')
  ).map((item) => {
    const price = Number(item.price);
    if (!Number.isFinite(price) || price < 0) throw new Error('Hay precios no válidos en la lista.');
    return [
      String(item.code || ''),
      String(item.name || ''),
      price,
      item.periodicity === 'unico' ? 'Único' : 'Mensual',
      String(item.category || ''),
      item.active === false ? 'No' : 'Sí'
    ];
  });
  return [columns(list), ...rows];
}

function filenameForList(list, extension) {
  const slug = String(list.name || 'lista-precios')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 75) || 'lista-precios';
  return 'lista-precios-' + slug + '-' + list.id.slice(0, 8) + '.' + extension;
}

function safeCsvCell(value) {
  let s = String(value ?? '');
  // Evita que Excel ejecute fórmulas al abrir un CSV de datos comerciales.
  if (/^\s*[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export function priceListCsv(list, items) {
  const matrix = priceListMatrix(list, items);
  return '\uFEFF' + matrix.map((row) => row.map(safeCsvCell).join(';')).join('\r\n') + '\r\n';
}

export function downloadPriceListCsv(list, items) {
  const csv = priceListCsv(list, items);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filenameForList(list, 'csv');
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function createWorksheet(XLSX, list, items) {
  const sheet = XLSX.utils.aoa_to_sheet(priceListMatrix(list, items));
  sheet['!cols'] = [{ wch: 20 }, { wch: 50 }, { wch: 20 }, { wch: 18 }, { wch: 26 }, { wch: 10 }];
  return sheet;
}

function sheetName(name, taken) {
  const base = String(name || 'Lista').replace(/[\[\]:*?\/\\]/g, ' ').trim() || 'Lista';
  let number = 1;
  let value = base.slice(0, 31);
  while (taken.has(value.toLocaleLowerCase('es'))) {
    number += 1;
    const suffix = ' (' + number + ')';
    value = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(value.toLocaleLowerCase('es'));
  return value;
}

export async function downloadPriceListXlsx(list, items, ensureXlsx) {
  const XLSX = await ensureXlsx();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, createWorksheet(XLSX, list, items), sheetName(list.name, new Set()));
  XLSX.writeFile(workbook, filenameForList(list, 'xlsx'), { bookType: 'xlsx', compression: true });
}

export async function downloadAllPriceListsXlsx(collection, ensureXlsx) {
  if (!collection.length) throw new Error('No hay listas de precios para descargar.');
  const XLSX = await ensureXlsx();
  const workbook = XLSX.utils.book_new();
  const taken = new Set();
  collection.forEach(({ list, items }) => {
    XLSX.utils.book_append_sheet(workbook, createWorksheet(XLSX, list, items), sheetName(list.name, taken));
  });
  XLSX.writeFile(workbook, 'listas-precios-taskflow.xlsx', { bookType: 'xlsx', compression: true });
}
