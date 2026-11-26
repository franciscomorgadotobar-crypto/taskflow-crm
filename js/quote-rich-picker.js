import { clientServiceScope } from './quote-client-copy.js';
import { fmtCurrency } from './utils.js';

/**
 * Selector enriquecido de productos de cotización.
 *
 * El SELECT nativo sigue siendo la fuente del ID seleccionado para conservar
 * el guardado, los descuentos y las RPC de cálculo existentes.
 *
 * En la lista desplegada se ven precio y capacidades de cada plan; al recorrer
 * las filas se muestra el alcance COMPLETO en un panel lateral (o inferior en
 * móvil). No es necesario agregar el producto para consultarlo.
 */
const make = (tag, className = '', content = '') => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content) element.textContent = content;
  return element;
};

const normal = (value) => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();

const capabilities = (product) => clientServiceScope(product)
  .split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);

/**
 * Idempotente: el formulario se reutiliza al cambiar la lista o editar otra
 * cotización, de modo que no se deben acumular controles ni listeners.
 */
export function enhanceQuoteProductSelect(select, products = [], currency = 'UF') {
  if (!select) return;
  if (select._quoteRichPicker) {
    select._quoteRichPicker.update(products, currency);
    return;
  }

  const dialog = select.closest('dialog');
  if (!dialog) return;
  const parent = make('div', 'quote-rich-picker');
  const trigger = make('button', 'quote-rich-trigger');
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', 'Seleccionar producto y consultar sus capacidades');
  const triggerName = make('span', 'quote-rich-trigger-name');
  const triggerPrice = make('span', 'quote-rich-trigger-price');
  const chevron = make('span', 'quote-rich-trigger-chevron', '⌄');
  chevron.setAttribute('aria-hidden', 'true');
  trigger.append(triggerName, triggerPrice, chevron);
  parent.appendChild(trigger);
  select.insertAdjacentElement('afterend', parent);
  select.classList.add('quote-picker-native');
  select.tabIndex = -1;

  // Se ancla al diálogo modal, NO al área desplazable del formulario.
  // Así el desplegable no queda cortado al abrirlo cerca del pie.
  const popup = make('div', 'quote-rich-popup');
  popup.hidden = true;
  const searchWrap = make('div', 'quote-rich-search-wrap');
  const search = make('input', 'quote-rich-search');
  search.type = 'search';
  search.placeholder = 'Buscar por plan, capacidad o producto…';
  search.autocomplete = 'off';
  search.setAttribute('aria-label', 'Buscar producto o capacidad dentro del desplegable');
  searchWrap.appendChild(search);
  const body = make('div', 'quote-rich-body');
  const options = make('div', 'quote-rich-options');
  options.setAttribute('role', 'listbox');
  options.setAttribute('aria-label', 'Productos disponibles');
  const details = make('div', 'quote-rich-details');
  details.setAttribute('aria-live', 'polite');
  body.append(options, details);
  popup.append(searchWrap, body);
  dialog.appendChild(popup);

  let items = [];
  let money = 'UF';
  let visible = [];
  let highlightedId = '';
  const selectedItem = () => items.find((item) => item.id === select.value);
  const itemDetails = (id) => items.find((item) => item.id === id);

  const updateTrigger = () => {
    const current = selectedItem();
    triggerName.textContent = current?.name || 'Seleccionar producto';
    triggerPrice.textContent = current ? fmtCurrency(current.price, money) : '';
  };

  const renderDetails = () => {
    details.replaceChildren();
    const item = itemDetails(highlightedId);
    if (!item) {
      details.appendChild(make('p', 'quote-rich-empty', 'Selecciona una opción para ver sus capacidades.'));
      return;
    }
    const eyebrow = make('span', 'quote-rich-detail-eyebrow', 'CONTENIDO DEL PRODUCTO');
    const name = make('strong', 'quote-rich-detail-title', item.name);
    const price = make('div', 'quote-rich-detail-price',
      fmtCurrency(item.price, money) + ' · ' + (item.periodicity === 'unico' ? 'pago único' : 'mensual'));
    const lines = capabilities(item);
    const list = make('ul', 'quote-rich-detail-list');
    for (const line of lines) list.appendChild(make('li', '', line));
    details.append(eyebrow, name, price, list);
    details.appendChild(make('p', 'quote-rich-detail-hint', 'Selecciona este producto para incorporarlo al campo de la cotización.'));
  };

  const highlight = (id, scroll = false) => {
    highlightedId = id;
    for (const button of options.querySelectorAll('[data-rich-item]')) {
      const focused = button.dataset.richItem === id;
      button.classList.toggle('is-highlighted', focused);
      if (focused && scroll) button.scrollIntoView({ block: 'nearest' });
    }
    renderDetails();
  };

  const renderOptions = () => {
    const term = normal(search.value);
    visible = items.filter((item) => {
      const searchTerms = [item.name, item.category, item.code, ...capabilities(item)];
      return !term || normal(searchTerms.join(' ')).includes(term);
    });
    options.replaceChildren();
    if (!visible.length) {
      options.appendChild(make('p', 'quote-rich-empty', 'No se encontraron productos con ese criterio.'));
      highlightedId = '';
      renderDetails();
      return;
    }
    const grouped = new Map();
    for (const item of visible) {
      const category = item.category || 'Otros';
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(item);
    }
    for (const [category, group] of grouped) {
      options.appendChild(make('div', 'quote-rich-group', category));
      for (const item of group) {
        const button = make('button', 'quote-rich-option');
        button.type = 'button';
        button.dataset.richItem = item.id;
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(select.value === item.id));
        const top = make('span', 'quote-rich-option-heading');
        top.append(make('strong', '', item.name), make('span', '', fmtCurrency(item.price, money)));
        const features = capabilities(item);
        const summary = make('span', 'quote-rich-option-summary',
          features.slice(0, 2).join(' · ') || 'Ver características');
        const periodicity = make('span', 'quote-rich-option-period', item.periodicity === 'unico' ? 'Pago único' : 'Mensual');
        button.append(top, summary, periodicity);
        options.appendChild(button);
      }
    }
    if (!visible.some((item) => item.id === highlightedId)) {
      highlightedId = visible.find((item) => item.id === select.value)?.id || visible[0].id;
    }
    highlight(highlightedId);
  };

  const placePopup = () => {
    const rectangle = trigger.getBoundingClientRect();
    const box = dialog.getBoundingClientRect();
    const width = Math.min(730, box.width - 24, window.innerWidth - 24);
    const height = Math.min(465, Math.max(240, box.height - 30), window.innerHeight - 24);
    const left = Math.max(box.left + 12, Math.min(rectangle.left, box.right - width - 12));
    const below = box.bottom - rectangle.bottom - 12;
    const above = rectangle.top - box.top - 12;
    let top;
    if (below >= height) top = rectangle.bottom + 5;
    else if (above >= height) top = rectangle.top - height - 5;
    else if (below >= above) top = Math.min(rectangle.bottom + 5, box.bottom - height - 12);
    else top = Math.max(box.top + 12, rectangle.top - height - 5);
    top = Math.max(box.top + 8, Math.min(top, box.bottom - height - 8));
    Object.assign(popup.style, {
      left: left + 'px', top: top + 'px',
      width: width + 'px', height: height + 'px'
    });
  };

  const close = (restoreFocus = false) => {
    if (popup.hidden) return;
    popup.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  };

  const open = () => {
    if (!popup.hidden) return close(true);
    dialog.dispatchEvent(new CustomEvent('quote-picker-opening', { detail: select.id }));
    popup.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    search.value = '';
    highlightedId = select.value;
    renderOptions();
    placePopup();
    // En móvil no abrir automáticamente el teclado, que taparía los packs.
    // El buscador permanece disponible al tocar el campo.
    if (window.innerWidth > 620) search.focus({ preventScroll: true });
  };

  const pick = (id) => {
    if (!items.some((item) => item.id === id)) return;
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    updateTrigger();
    close(true);
  };

  trigger.addEventListener('click', open);
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (popup.hidden) open();
    }
  });
  search.addEventListener('input', renderOptions);
  popup.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const i = visible.findIndex((item) => item.id === highlightedId);
      const next = visible[Math.max(0, Math.min(visible.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (next) highlight(next.id, true);
    } else if (event.key === 'Enter' && !event.shiftKey && highlightedId) {
      event.preventDefault();
      pick(highlightedId);
    }
  });
  options.addEventListener('mouseover', (event) => {
    const option = event.target.closest('[data-rich-item]');
    if (option && options.contains(option) && highlightedId !== option.dataset.richItem) {
      highlight(option.dataset.richItem);
    }
  });
  options.addEventListener('focusin', (event) => {
    const option = event.target.closest('[data-rich-item]');
    if (option && options.contains(option)) highlight(option.dataset.richItem);
  });
  options.addEventListener('click', (event) => {
    const option = event.target.closest('[data-rich-item]');
    if (option && options.contains(option)) pick(option.dataset.richItem);
  });
  dialog.addEventListener('pointerdown', (event) => {
    if (!popup.hidden && !popup.contains(event.target) && !trigger.contains(event.target)) close();
  });
  dialog.addEventListener('quote-picker-opening', (event) => {
    if (event.detail !== select.id) close();
  });
  dialog.addEventListener('close', () => close());
  const scrolling = dialog.querySelector('.quote-builder-body');
  scrolling?.addEventListener('scroll', () => {
    if (!popup.hidden) close();
  }, { passive: true });
  select.addEventListener('change', updateTrigger);

  const picker = {
    update(nextItems, currencyName) {
      close();
      items = Array.isArray(nextItems) ? nextItems.filter((item) => item?.active !== false) : [];
      money = currencyName || 'UF';
      updateTrigger();
    }
  };
  select._quoteRichPicker = picker;
  picker.update(products, currency);
}

/** Catálogo integrado: todas las capacidades y el precio visibles, sin popups. */
export function quoteCatalogModule(item) {
  const code = String(item.code || '').toUpperCase();
  const label = normal([item.name, item.category].filter(Boolean).join(' '));
  if (/^GE_/.test(code) || /gestion externa/.test(label)) return 'Gestión Externa';
  if (/^GI_/.test(code) || /gestion interna/.test(label)) return 'Gestión Interna';
  if (/^(INV_|PACK_INV_|PACK_SER_)/.test(code) || /inventario/.test(label)) return 'Inventario';
  if (/^(LAB_|LABORATORIO)/.test(code) || /laboratorio/.test(label)) return 'Laboratorio';
  return 'Otros servicios';
}
// Jerarquía comercial: elegir primero el plan, luego los accesos y
// finalmente ampliar capacidades. El precio solo desempata dentro de cada nivel.
export function quoteCatalogTier(item) {
  const code = String(item.code || '').trim().toUpperCase();
  const name = normal(item.name);
  if (/^(GE_BASE|GI_BASE|INV_(ENTRADA|BASICO|MEDIO|AVANZADO|FULL|BASE))$/.test(code)) return 0;
  if (/^(GE_APP|GI_WEB|INV_APP|INV_USER_ADD)$/.test(code)) return 1;
  // Los packs y ampliaciones no son planes base, aunque su nombre mencione uno.
  if (/^PACK_/.test(code) || /\b(packs?|ampliacion|almacen adicional|almacenamiento adicional|depreciacion)\b/.test(name)) return 2;
  if (/(^|_)(BASE|PLAN)(_|$)/.test(code) || /\bplan\b/.test(name)) return 0;
  if (/\b(usuarios?|licencias?|accesos?|tecnicos?)\b/.test(name) || /(^|_)(APP|WEB|USER)(_|$)/.test(code)) return 1;
  return 2;
}
export function quoteCatalogGroups(products, byPrice = false) {
  const priceOrder = (a, b) => Number(a.price) - Number(b.price) || String(a.name).localeCompare(String(b.name), 'es');
  const sorted = [...products].sort(byPrice ? priceOrder : (a, b) => quoteCatalogTier(a) - quoteCatalogTier(b) || priceOrder(a, b));
  if (byPrice) return [['Todos los servicios · menor a mayor', sorted]];
  const groups = new Map();
  for (const product of sorted) {
    const group = quoteCatalogModule(product);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(product);
  }
  const priority = ['Inventario', 'Gestión Interna', 'Gestión Externa', 'Laboratorio', 'Otros servicios'];
  const order = group => priority.includes(group) ? priority.indexOf(group) : priority.length;
  return [...groups].sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b, 'es'));
}
export function mountQuoteCatalog(host, products, currency) {
  host.replaceChildren();
  const groups = quoteCatalogGroups(products);
  const modules = make('div', 'quote-catalog-modules');
  modules.setAttribute('role', 'group');
  modules.setAttribute('aria-label', 'Seleccionar módulo del sistema');
  const header = make('div', 'quote-catalog-toolbar quote-catalog-module-toolbar');
  const search = make('input', 'quote-catalog-search');
  search.type = 'search';
  search.placeholder = 'Buscar módulo, plan o capacidad…';
  search.setAttribute('aria-label', 'Buscar en el catálogo');
  const back = make('button', 'small-btn quote-catalog-back', '← Módulos');
  back.type = 'button';
  const moduleLabel = make('strong', 'quote-catalog-current');
  const icons = {
    'Inventario': '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10M7 5l9 4"/>',
    'Gestión Interna': '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1M10 21v-3h4v3"/>',
    'Gestión Externa': '<rect x="5" y="3" width="14" height="18" rx="3"/><circle cx="12" cy="10" r="2.5"/><path d="M8 17c0-4 8-4 8 0M10 5h4"/>',
    'Laboratorio': '<path d="M9 3h6M10 3v7l-5 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3M8 15h8"/>',
    'Otros servicios': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'
  };
  const colors = {'Inventario':'inventory','Gestión Interna':'internal','Gestión Externa':'external','Laboratorio':'lab','Otros servicios':'other'};
  const buttons = new Map();
  let activeModule = '';
  for (const [name, rows] of groups) {
    const button = make('button', 'quote-catalog-module quote-module-' + colors[name]);
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    const icon = make('span', 'quote-module-icon');
    icon.setAttribute('aria-hidden','true');
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + icons[name] + '</svg>';
    const title = make('strong', '', name);
    const meta = make('span', 'quote-module-count', rows.length + ' servicios');
    button.append(icon, title, meta);
    button.addEventListener('click', () => selectModule(name));
    modules.append(button);
    buttons.set(name, {button, meta, rows});
  }
  const count = make('p', 'muted quote-catalog-count');
  const body = make('div', 'quote-catalog-body');
  const selection = make('p', 'quote-catalog-selection muted');
  selection.setAttribute('aria-live', 'polite');
  header.append(back, moduleLabel, search);
  host.append(modules, header, count, body, selection);
  let builder = null;
  function selectModule(name) {
    activeModule = groups.some(([group]) => group === name) ? name : '';
    search.value = '';
    paint();
  }
  back.addEventListener('click', () => selectModule(''));

  function update(next) {
    builder = next;
    const quantities = rows => {
      const map = new Map();
      for (const row of rows || []) map.set(row.priceListItemId, (map.get(row.priceListItemId) || 0) + Number(row.quantity || 0));
      return map;
    };
    const included = quantities(next?.items);
    const optional = quantities(next?.optionalItems);
    for (const {meta, rows} of buttons.values()) {
      const selected = rows.reduce((n, row) => n + (included.get(row.id) || 0) + (optional.get(row.id) || 0), 0);
      meta.textContent = rows.length + ' servicios' + (selected ? ' · ' + selected + ' agregados' : '');
    }
    for (const row of body.querySelectorAll('[data-catalog-product]')) {
      const id = row.dataset.catalogProduct;
      const qty = included.get(id) || 0;
      const opt = optional.get(id) || 0;
      row.classList.toggle('is-included', qty > 0);
      row.querySelector('.quote-catalog-quantity').textContent = qty || opt ? [qty ? qty + ' incluido(s)' : '', opt ? opt + ' opcional(es)' : ''].filter(Boolean).join(' · ') : 'Sin agregar';
    }
    selection.textContent = [...included.values()].reduce((a,b)=>a+b,0) + ' unidades incluidas · ' + [...optional.values()].reduce((a,b)=>a+b,0) + ' opcionales';
  }

  function paint() {
    for (const [name, {button}] of buttons) {
      button.classList.toggle('is-active', name === activeModule);
      button.setAttribute('aria-pressed', String(name === activeModule));
    }
    modules.classList.toggle('has-active', Boolean(activeModule));
    header.hidden = !activeModule;
    count.hidden = !activeModule;
    moduleLabel.textContent = activeModule;
    body.replaceChildren();
    if (!activeModule) {
      body.append(make('p', 'muted quote-catalog-choose', products.length ? 'Selecciona un módulo para ver sus planes y servicios.' : 'Esta lista no tiene servicios activos.'));
      update(builder);
      return;
    }
    const query = normal(search.value);
    const moduleProducts = groups.find(([name]) => name === activeModule)?.[1] || [];
    const visible = moduleProducts.filter(p => !query || normal([p.name, p.code, p.category, clientServiceScope(p)].join(' ')).includes(query));
    count.textContent = visible.length + ' de ' + moduleProducts.length + ' servicios · ' + currency + ' · planes, usuarios y complementos';
    if (!visible.length) body.append(make('p', 'muted', 'No hay servicios para mostrar.'));
    const sections = activeModule === 'Otros servicios' ? [['Servicios', visible]] : [
      ['Planes y bases', visible.filter(p => quoteCatalogTier(p) === 0)],
      ['Usuarios y accesos', visible.filter(p => quoteCatalogTier(p) === 1)],
      ['Complementos y ampliaciones', visible.filter(p => quoteCatalogTier(p) === 2)]
    ];
    for (const [group, rows] of sections) {
      if (!rows.length) continue;
      const section = make('section', 'quote-catalog-group');
      const grid = make('div', 'quote-catalog-grid');
      section.append(make('h5', '', group), grid);
      for (const product of rows) {
        const card = make('article', 'quote-catalog-card');
        card.dataset.catalogProduct = product.id;
        const top = make('div', 'quote-catalog-card-top');
        const name = make('strong', '', product.name);
        const price = make('div', 'quote-catalog-price');
        price.append(make('strong', '', fmtCurrency(product.price, currency)), make('small', '', product.periodicity === 'unico' ? 'Pago único' : 'Mensual'));
        top.append(name, price);
        const description = make('ul', 'quote-catalog-description');
        for (const line of capabilities(product)) description.append(make('li', '', line));
        const footer = make('div', 'quote-catalog-card-footer');
        const qty = make('span', 'quote-catalog-quantity');
        const actions = make('div', 'quote-catalog-actions');
        const optional = make('button', 'small-btn', '+ Opcional');
        optional.type = 'button'; optional.dataset.action = 'quote-catalog-optional'; optional.dataset.id = product.id;
        optional.setAttribute('aria-label', 'Agregar ' + product.name + ' como opcional');
        const add = make('button', 'primary-btn quote-catalog-plus', '+');
        add.type = 'button'; add.dataset.action = 'quote-catalog-add'; add.dataset.id = product.id;
        add.setAttribute('aria-label', 'Agregar una unidad de ' + product.name);
        actions.append(optional, add); footer.append(qty, actions);
        card.append(top, description, footer); grid.append(card);
      }
      body.append(section);
    }
    update(builder);
  }
  search.addEventListener('input', paint);
  search.addEventListener('keydown', ev => { if (ev.key === 'Enter') ev.preventDefault(); });
  host._quoteCatalog = { update, selectModule };
  paint();
  return host._quoteCatalog;
}
