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

/**
 * Construye hojas A4 reales antes de rasterizar. Cada hoja se mide al mismo
 * ancho que el área imprimible, y se añade una fila completa o bloque completo.
 * No se corta un canvas largo ni se descartan hojas por heurísticas de color.
 */
export function composeQuotePages(source, host, { maxHeight = 1010 } = {}) {
  if (!source || !host || !(maxHeight > 0)) throw new Error('No se pudo preparar la paginación.');
  const pages = [];
  let page;
  const newPage = () => {
    page = document.createElement('div');
    page.className = 'quote-doc qd-for-print qd-page';
    host.append(page); pages.push(page);
    return page;
  };
  const fits = () => Math.max(page.scrollHeight, page.getBoundingClientRect().height) <= maxHeight;
  const appendBlock = (node) => {
    const block = document.createElement('div');
    block.className = 'qd-page-block';
    block.append(node);
    page.append(block);
    if (!fits()) {
      block.remove();
      if (page.childElementCount) newPage();
      page.append(block);
      if (!fits()) throw new Error('Un bloque de la cotización supera una hoja A4. Reduce su extensión para exportar sin cortes.');
    }
  };
  const clone = node => node.cloneNode(true);
  newPage();

  function appendTable(tables, heading, caption, continued, kind) {
    if (!tables.length) return;
    const rows = tables.flatMap(table => [...table.querySelectorAll('tbody > tr')]);
    if (!rows.length) return;
    let section = null, body = null;
    const init = (first) => {
      section = document.createElement('section');
      section.className = 'qd-page-table ' + kind;
      if (first && heading) section.append(clone(heading));
      else {
        const h = document.createElement('h4'); h.textContent = continued; section.append(h);
      }
      if (first && caption) section.append(clone(caption));
      const table = tables[0].cloneNode(false);
      if (tables[0].tHead) table.append(clone(tables[0].tHead));
      body = document.createElement('tbody'); table.append(body); section.append(table);
      page.append(section);
    };
    for (let i = 0; i < rows.length; i++) {
      if (!section) init(i === 0);
      const row = clone(rows[i]);
      body.append(row);
      if (fits()) continue;
      row.remove();
      if (!body.childElementCount) section.remove();
      if (page.childElementCount) newPage();
      init(i === 0);
      body.append(row);
      if (!fits()) throw new Error('El alcance de un servicio supera una hoja A4. No se ha generado un PDF incompleto.');
    }
  }

  function appendProjection(section) {
    const heading = section.querySelector('h4');
    const months = section.querySelector('.qd-months');
    const totals = section.querySelector('.qd-contract');
    const entries = [...(months?.children || [])];
    // Bloques de hasta 24 meses para contratos largos; cada uno es indivisible.
    const chunks = Math.max(1, Math.ceil(entries.length / 24));
    for (let i = 0; i < chunks; i++) {
      const block = section.cloneNode(false);
      if (heading) {
        const h = clone(heading);
        if (i) h.append(document.createTextNode(' · continuación'));
        block.append(h);
      }
      if (months) {
        const grid = months.cloneNode(false);
        entries.slice(i * 24, (i + 1) * 24).forEach(node => grid.append(clone(node)));
        block.append(grid);
      }
      if (i === chunks - 1 && totals) block.append(clone(totals));
      appendBlock(block);
    }
  }

  for (const node of source.children) {
    if (node.classList.contains('qd-unified-economics')) {
      appendTable([...node.querySelectorAll('.qd-unified-table')], node.querySelector('.qd-economic-title'),
        node.querySelector('.qd-economic-caption'), 'Propuesta económica · continuación', 'qd-financial-group');
      const summary = node.querySelector('.qd-economic-summary');
      if (summary) appendBlock(clone(summary));
    } else if (node.classList.contains('qd-optionals-section')) {
      appendTable([...node.querySelectorAll('.qd-optional-table')], node.querySelector('h4'),
        node.querySelector('.qd-optional-notice'), 'Complementos opcionales · continuación', 'qd-optionals-section');
    } else if (node.classList.contains('qd-projection-summary')) {
      appendProjection(node);
    } else {
      appendBlock(clone(node));
    }
  }
  return pages.filter(p => p.childElementCount);
}
