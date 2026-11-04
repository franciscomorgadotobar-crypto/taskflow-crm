/**
 * Evita exportar una hoja final sin contenido útil en html2pdf.
 *
 * html2pdf 0.10.1 rasteriza el documento en un lienzo y luego lo divide
 * en páginas; sus reglas de "avoid" pueden dejar una última página con
 * únicamente un borde o una sombra, aun cuando no haya más contenido.
 * Analizamos la misma imagen que usa el PDF y retiramos exclusivamente las
 * hojas finales que no contienen trazos oscuros (texto o números).
 *
 * No altera el diseño ni el número de ninguna página con texto visible.
 */
export function trimTrailingEmptyQuotePages(pdf, canvas, { top = 10, right = 10, bottom = 12, left = 10 } = {}) {
  if (!pdf || !canvas || !canvas.width || !canvas.height) return 0;
  if (typeof pdf.getNumberOfPages !== 'function' || typeof pdf.deletePage !== 'function') return 0;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return 0;

  const pageWidth = pdf.internal?.pageSize?.getWidth?.();
  const pageHeight = pdf.internal?.pageSize?.getHeight?.();
  const contentWidth = pageWidth - left - right;
  const contentHeight = pageHeight - top - bottom;
  if (!(contentWidth > 0 && contentHeight > 0)) return 0;
  // Mismo redondeo de píxeles utilizado por html2pdf para separar el lienzo.
  const pxPerPage = Math.floor(canvas.width * contentHeight / contentWidth);
  if (!pxPerPage) return 0;

  const total = pdf.getNumberOfPages();
  let removed = 0;
  // No eliminar jamás la primera hoja, aunque una cotización estuviera vacía.
  for (let page = total - 1; page >= 1; page--) {
    const start = page * pxPerPage;
    const end = Math.min(canvas.height, start + pxPerPage);
    if (start >= end) {
      pdf.deletePage(page + 1);
      removed++;
      continue;
    }

    // Muestreo discreto de los píxeles del rango visible de esta hoja.
    // No cuentan fondos, bordes grises claros, sombras ni espacios blancos.
    // Si aparece texto oscuro, por pequeño que sea, se conserva la hoja.
    let ink = 0;
    const step = 3;
    const x0 = Math.min(canvas.width, Math.max(0, Math.round(canvas.width * 0.025)));
    const xEnd = Math.max(x0, Math.round(canvas.width * 0.975));
    for (let y = start; y < end && ink < 12; y += step) {
      const row = context.getImageData(x0, y, xEnd - x0, 1).data;
      for (let x = 0; x < row.length; x += 4 * step) {
        if (row[x + 3] > 100 && row[x] < 170 && row[x + 1] < 170 && row[x + 2] < 185) {
          ink++;
          if (ink >= 12) break;
        }
      }
    }
    if (ink >= 12) break;
    pdf.deletePage(page + 1);
    removed++;
  }
  return removed;
}
