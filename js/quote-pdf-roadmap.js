/**
 * Planifica la última sección de una cotización ANTES de rasterizar el PDF.
 *
 * html2pdf 0.10.1 puede introducir rellenos invisibles dentro de una lista
 * cuando mezcla reglas avoid del bloque padre con sus hijos. El resultado
 * es engañoso: las coordenadas HTML de las cinco etapas parecen válidas, pero
 * la última se corta en el PDF final.
 *
 * El cronograma se saca de esas reglas automáticas y se calcula su posición
 * real en el clon que html2pdf imprimirá. Si no caben las cinco etapas en la
 * página actual con margen de seguridad, se desplaza TODO el bloque.
 */
export function placeQuoteRoadmap(container, innerPageHeightPx, options = {}) {
  const root = container?.querySelector?.('.quote-doc') ||
    (container?.classList?.contains('quote-doc') ? container : null);
  const roadmap = root?.querySelector?.('.qd-roadmap');
  if (!roadmap) return { applied: false, reason: 'not-found' };
  const pageHeight = Number(innerPageHeightPx);
  if (!(pageHeight > 0)) throw new Error('No se puede paginar la cotización sin altura útil de A4.');

  const items = [...roadmap.querySelectorAll('.qd-roadmap-step')];
  if (items.length !== 5 || !items[4]?.textContent.includes('Salida a producción')) {
    throw new Error('La propuesta debe incluir las cinco etapas de implementación.');
  }

  const marginPx = Number.isFinite(options.marginPx) ? options.marginPx : 42;
  const metrics = () => {
    const rootBox = root.getBoundingClientRect();
    const box = roadmap.getBoundingClientRect();
    const y = box.top - rootBox.top;
    const bottom = box.bottom - rootBox.top;
    const page = Math.floor((y + 0.25) / pageHeight);
    const limit = (page + 1) * pageHeight;
    return { y, bottom, height: box.height, page, limit, remaining: limit - bottom };
  };

  const first = metrics();
  if (first.height + marginPx >= pageHeight) {
    throw new Error('El cronograma no cabe completo en una hoja A4.');
  }

  const needsShift = (m) =>
    m.bottom > m.limit - marginPx || Math.floor((m.bottom - 0.25) / pageHeight) !== m.page;

  let spacer = null;
  if (needsShift(first)) {
    // Se desplaza el bloque ya clonado por html2pdf, ANTES de html2canvas.
    spacer = document.createElement('div');
    spacer.className = 'qd-roadmap-page-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.cssText =
      'display:block;box-sizing:border-box;width:100%;height:0;margin:0;padding:0;border:0;';
    roadmap.parentNode.insertBefore(spacer, roadmap);
    // Verificar posición real: los márgenes pueden cambiar al añadir hermano.
    for (let pass = 0; pass < 3; pass++) {
      const m = metrics();
      const desired = (first.page + 1) * pageHeight + 24;
      const delta = desired - m.y;
      if (delta > 0.5) {
        spacer.style.height = (parseFloat(spacer.style.height) + delta) + 'px';
      } else {
        break;
      }
    }
  }
  const after = metrics();
  if (needsShift(after) || (spacer && after.page <= first.page)) {
    throw new Error('No se pudo colocar completo el cronograma de implementación en el PDF.');
  }
  return {
    applied: !!spacer,
    fromPage: first.page + 1,
    toPage: after.page + 1,
    stageCount: items.length,
    bottomSafetyPx: after.remaining,
    pageHeightPx: pageHeight,
  };
}
