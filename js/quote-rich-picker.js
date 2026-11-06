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
