/**
 * Presentación comercial de precios para PDF y Word.
 *
 * La RPC calcula montos netos cuando absorbIva=false; en modo absorbido
 * los montos del cliente ya llevan IVA y NO se debe añadirlo dos veces.
 * Se preservan los valores de la RPC, se modifica sólo su visualización.
 */
export function quoteDiscountComparison(totals = {}, { absorbIva = false, vatRate = 0.19 } = {}) {
  const subtotal = Number(totals.subtotal) || 0;
  const discount = Number(totals.discount) || 0;
  const final = Number(totals.total) || 0;
  const multiplier = absorbIva ? 1 : 1 + vatRate;
  // El valor del descuento se deriva de la diferencia entre precio de lista
  // y precio final: asegura que ambos coincidan tras el redondeo de la RPC.
  const listWithVat = Math.max(0, subtotal * multiplier);
  const savedWithVat = Math.max(0, listWithVat - final);
  const discountPercent = subtotal > 0 ? discount / subtotal * 100 : 0;
  return {
    listWithVat,
    savedWithVat,
    finalWithVat: final,
    discountPercent: Math.max(0, Math.min(100, discountPercent)),
    netAfterDiscount: Number(totals.net) || 0,
    vatAfterDiscount: Number(totals.iva) || 0,
    isVatAbsorbed: absorbIva
  };
}

export function quoteDiscountPercent(value) {
  const n = Number(value) || 0;
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(n) + '%';
}
