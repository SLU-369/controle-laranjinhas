export const PAYMENT_METHODS = ['pix', 'credit', 'debit', 'cash'];
export const PROMOTION_PRICES = [0, 1500, 1300, 1000];
export const MAX_QTY = 99999;
export const MAX_PRICE = 9999900;
export const MAX_TOTAL = 2000 * MAX_QTY * MAX_PRICE;

export const itemsQuantity = items => items.reduce((sum, item) => sum + item.qty, 0);
export const saleCost = items => items.reduce((sum, item) => sum + item.qty * item.costUnitCents, 0);
export const sumPayments = payments => payments.reduce((sum, payment) => sum + payment.amountCents, 0);
export const balance = sale => sale.totalCents - sumPayments(sale.payments);

export function localDate(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${month}-${day}`;
}

export function dateRange(period, now = new Date()) {
  const from = new Date(now);
  const to = new Date(now);
  if (period === 'week') {
    const offset = (now.getDay() + 6) % 7;
    from.setDate(now.getDate() - offset);
    to.setDate(now.getDate() - offset + 6);
  }
  if (period === 'month') {
    from.setDate(1);
    to.setMonth(now.getMonth() + 1, 0);
  }
  return { from: localDate(from), to: localDate(to) };
}

// Split cents across lines using cumulative weights so rounding preserves the exact total.
function allocate(amount, weights) {
  const totalWeight = BigInt(weights.reduce((sum, weight) => sum + weight, 0));
  let consumedWeight = 0n;
  let assigned = 0n;
  return weights.map(weight => {
    consumedWeight += BigInt(weight);
    const next = BigInt(amount) * consumedWeight / totalWeight;
    const share = Number(next - assigned);
    assigned = next;
    return share;
  });
}

export function quoteSale(items, mode, manualTotal, manualDiscount) {
  if (!['unit', 'promo', 'total'].includes(mode)) throw Error('Escolha como definir o preço.');
  const qty = itemsQuantity(items);
  if (mode === 'promo' && !PROMOTION_PRICES[qty]) {
    throw Error('A promoção vale para até 3 unidades. Escolha um preço manual para continuar.');
  }
  if (mode === 'total' && (!Number.isSafeInteger(manualTotal) || manualTotal < 1 || manualTotal > MAX_TOTAL)) {
    throw Error('Informe um valor total acima de zero com até duas casas decimais.');
  }
  const subtotals = mode === 'total'
    ? allocate(manualTotal, items.map(item => item.qty))
    : items.map(item => item.qty * (mode === 'promo' ? PROMOTION_PRICES[1] : item.unitPriceCents));
  const subtotal = subtotals.reduce((sum, value) => sum + value, 0);
  const discount = mode === 'promo' ? subtotal - qty * PROMOTION_PRICES[qty] : manualDiscount;
  if (!Number.isSafeInteger(discount) || discount < 0 || discount >= subtotal) {
    throw Error('O desconto deve ser menor que o subtotal e ter até duas casas decimais.');
  }
  const discounts = allocate(discount, subtotals);
  const pricedItems = items.map((item, index) => {
    const subtotalCents = subtotals[index];
    return {
      ...item,
      unitPriceCents: subtotalCents % item.qty === 0 ? subtotalCents / item.qty : null,
      subtotalCents,
      discountCents: discounts[index]
    };
  });
  return { items: pricedItems, qty, subtotal, discount, total: subtotal - discount, cost: saleCost(pricedItems) };
}

const zeroMethods = () => ({ pix: 0n, credit: 0n, debit: 0n, cash: 0n, unknown: 0n });

export function summarize(sales, { from = '', to = '' } = {}, charts = false) {
  const result = {
    qty: 0, gross: 0n, cost: 0n, received: 0n, due: 0n, methods: zeroMethods(),
    earlierDebtsReceived: 0n, undated: 0n, flavors: new Map(), days: new Map()
  };
  for (const sale of sales) {
    if (sale.canceledAt) continue;
    const day = localDate(new Date(sale.time));
    if (inRange(day, from, to)) {
      result.qty += itemsQuantity(sale.items);
      result.gross += BigInt(sale.totalCents);
      result.cost += BigInt(saleCost(sale.items));
      if (charts) {
        result.days.set(day, (result.days.get(day) ?? 0n) + BigInt(sale.totalCents));
        for (const item of sale.items) {
          const key = item.flavorId || item.flavorName;
          const previous = result.flavors.get(key)?.qty ?? 0;
          result.flavors.set(key, { qty: previous + item.qty, name: item.flavorName });
        }
      }
    }
    let paidByEnd = 0;
    for (const payment of sale.payments) {
      const paymentDay = payment.time ? localDate(new Date(payment.time)) : '';
      if (!to || !paymentDay || paymentDay <= to) paidByEnd += payment.amountCents;
      if (!paymentDay) result.undated += BigInt(payment.amountCents);
      if ((paymentDay || (!from && !to)) && inRange(paymentDay, from, to)) {
        const amount = BigInt(payment.amountCents);
        result.received += amount;
        const method = payment.method === 'card' ? 'unknown' : payment.method;
        result.methods[method] += amount;
        if (sale.method === 'fiado' && from && day < from) result.earlierDebtsReceived += amount;
      }
    }
    if (sale.method === 'fiado' && (!to || day <= to)) result.due += BigInt(sale.totalCents - paidByEnd);
  }
  return result;
}

export function inRange(day, from, to) {
  return (!from || day >= from) && (!to || day <= to);
}
