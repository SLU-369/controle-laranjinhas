import {
  MAX_PRICE, MAX_QTY, MAX_TOTAL, PAYMENT_METHODS as PAID_METHODS, PROMOTION_PRICES,
  balance, dateRange, inRange, localDate, quoteSale, summarize, sumPayments
} from './finance.js';

(() => {
  'use strict';

  const APP = 'loja-da-gigi';
  const VERSION = 6;
  const STORE = 'loja-gigi-v5';
  const LAST_BACKUP = 'loja-gigi-last-backup';
  const OLD_STORES = ['loja-gigi-v4', 'laranjinhas-estoque-vendas-v3', 'laranjinhas-estoque-vendas-v2'];
  const OLD_PROFILE = 'loja-gigi-profile';
  const PROFILES = ['', 'Samuel', 'Giovana'];
  const MAX_FLAVORS = 2000;
  const MAX_SALES = 100000;
  const FILE_LIMIT = 8 * 1024 * 1024;
  const PAGE_SIZE = 80;
  const METHODS = {
    pix: 'Pix', credit: 'Crédito', debit: 'Débito', cash: 'Dinheiro', fiado: 'Fiado',
    unknown: 'Modalidade desconhecida', card: 'Cartão (modalidade desconhecida)'
  };
  const NAMES = [
    'Morango com Leite Ninho', 'Maracujá', 'Maracujá com Chocolate', 'Açaí com Leite Ninho',
    'Cupuaçu', 'Ninho com Chocolate', 'Blue Ice', 'Açaí com Maracujá', 'Paçoca',
    'Chocolate', 'Leite Condensado', 'Abacaxi', 'Flocos'
  ];
  const INITIAL_QTY = [2, 1, 5, 2, 2, 2, 2, 3, 2, 1, 2, 1, 1];
  const $ = id => document.getElementById(id);
  const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const timestamp = () => new Date().toISOString();
  const validQty = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_QTY;
  const validCents = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_PRICE;
  const validPrice = value => validCents(value) && value > 0;
  const validId = value => typeof value === 'string' && /^[\w.:-]{1,150}$/u.test(value);
  const validName = value => typeof value === 'string' && value === value.trim() &&
    value.length >= 1 && value.length <= 80 && !/[\u0000-\u001f\u007f]/u.test(value);
  const validPhone = value => typeof value === 'string' && /^(?:55)?[1-9]\d{9,10}$/u.test(value);
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const formatCurrency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const timeFormatter = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' });

  function money(cents) {
    const amount = BigInt(cents);
    const whole = amount / 100n;
    const fraction = (amount < 0n ? -amount : amount) % 100n;
    return formatCurrency.formatToParts(amount < 0n && whole === 0n ? -0 : whole)
      .map(part => part.type === 'fraction' ? String(fraction).padStart(2, '0') : part.value).join('');
  }

  function decimal(cents) {
    return (cents / 100).toFixed(2);
  }

  function inputCents(value) {
    if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/u.test(value)) return NaN;
    const [whole, fraction = ''] = value.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  }

  function validTime(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString() === value;
  }

  function initialState(profile = '') {
    return {
      version: VERSION, profile,
      settings: { defaultPriceCents: 800, unitCostCents: 300 },
      flavors: NAMES.map((name, index) => ({ id: `initial-${index + 1}`, name, qty: INITIAL_QTY[index], priceCents: 800 })),
      sales: []
    };
  }

  function hasKeys(value, keys) {
    return record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  }

  function validOldSale(sale, flavorIds) {
    if (!hasKeys(sale, ['id', 'flavorId', 'flavorName', 'qty', 'unitPriceCents', 'costUnitCents', 'discountCents',
      'totalCents', 'method', 'phone', 'paid', 'receivedVia', 'paidAt', 'time', 'canceledAt', 'legacy'])) return false;
    if (!validId(sale.id) || !validName(sale.flavorName) || !validQty(sale.qty) || sale.qty === 0 ||
        !validPrice(sale.unitPriceCents) || !validCents(sale.costUnitCents) ||
        typeof sale.legacy !== 'boolean' || typeof sale.paid !== 'boolean' || !validTime(sale.time)) return false;

    const subtotal = sale.qty * sale.unitPriceCents;
    if (!Number.isSafeInteger(sale.discountCents) || sale.discountCents < 0 || sale.discountCents >= subtotal ||
        sale.totalCents !== subtotal - sale.discountCents) return false;

    if (!flavorIds.has(sale.flavorId) &&
        !(sale.legacy && (sale.flavorId === '' || validId(sale.flavorId)))) return false;

    if (sale.canceledAt !== null &&
        (!validTime(sale.canceledAt) || sale.canceledAt < (sale.paidAt || sale.time))) return false;

    if (sale.method === 'fiado') {
      const legacyPhone = sale.legacy && typeof sale.phone === 'string' && /^[+() .\d-]{0,25}$/u.test(sale.phone);
      if (!validPhone(sale.phone) && !legacyPhone) return false;
      if (!sale.paid) return sale.receivedVia === null && sale.paidAt === null;
      if (!PAID_METHODS.includes(sale.receivedVia) && !(sale.legacy && sale.receivedVia === 'unknown')) return false;
      return (sale.legacy && sale.paidAt === null) || (validTime(sale.paidAt) && sale.paidAt >= sale.time);
    }
    const validMethod = PAID_METHODS.includes(sale.method) || (sale.legacy && sale.method === 'card');
    const paidAtSale = sale.paidAt === sale.time;
    const legacyTimestamp = sale.legacy && validTime(sale.paidAt) && sale.paidAt >= sale.time;
    return validMethod && sale.paid && sale.phone === '' && sale.receivedVia === sale.method && (paidAtSale || legacyTimestamp);
  }

  function validSale(sale, flavorIds) {
    if (!hasKeys(sale, ['id', 'items', 'totalCents', 'method', 'buyer', 'phone', 'payments', 'time', 'canceledAt', 'legacy']) ||
        !validId(sale.id) || typeof sale.legacy !== 'boolean' || !validTime(sale.time) ||
        !Array.isArray(sale.items) || sale.items.length < 1 || sale.items.length > MAX_FLAVORS ||
        !Array.isArray(sale.payments) || !Number.isSafeInteger(sale.totalCents) ||
        sale.totalCents < 1 || sale.totalCents > MAX_TOTAL) return false;
    if (sale.canceledAt !== null && (!validTime(sale.canceledAt) || sale.canceledAt < sale.time)) return false;

    const itemIds = new Set();
    let subtotal = 0;
    let total = 0;
    for (const item of sale.items) {
      if (!hasKeys(item, ['flavorId', 'flavorName', 'qty', 'unitPriceCents', 'costUnitCents', 'subtotalCents', 'discountCents']) ||
          !validName(item.flavorName) || !validQty(item.qty) || item.qty === 0 || !validCents(item.costUnitCents) ||
          (!flavorIds.has(item.flavorId) && !(sale.legacy && (item.flavorId === '' || validId(item.flavorId)))) ||
          itemIds.has(item.flavorId) || !Number.isSafeInteger(item.subtotalCents) || item.subtotalCents < 0 ||
          !Number.isSafeInteger(item.discountCents) || item.discountCents < 0 || item.discountCents > item.subtotalCents ||
          (item.unitPriceCents !== null && (!Number.isSafeInteger(item.unitPriceCents) ||
            item.unitPriceCents * item.qty !== item.subtotalCents))) return false;
      itemIds.add(item.flavorId);
      subtotal += item.subtotalCents;
      if (subtotal > MAX_TOTAL) return false;
      total += item.subtotalCents - item.discountCents;
    }
    if (total !== sale.totalCents) return false;

    const debt = sale.method === 'fiado';
    const legacyPhone = sale.legacy && typeof sale.phone === 'string' && /^[+() .\d-]{0,25}$/u.test(sale.phone);
    if (debt) {
      if ((!validPhone(sale.phone) && !legacyPhone) || (sale.buyer !== '' && !validName(sale.buyer))) return false;
    } else if ((!PAID_METHODS.includes(sale.method) && !(sale.legacy && sale.method === 'card')) ||
        sale.phone !== '' || sale.buyer !== '' || sale.payments.length !== 1) return false;

    let received = 0;
    const paymentIds = new Set();
    for (const payment of sale.payments) {
      if (!hasKeys(payment, ['id', 'amountCents', 'method', 'time']) || !validId(payment.id) || paymentIds.has(payment.id) ||
          !Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) return false;
      if (debt) {
        if (!PAID_METHODS.includes(payment.method) && !(sale.legacy && payment.method === 'unknown')) return false;
      } else if (payment.method !== sale.method || payment.amountCents !== total || (!sale.legacy && payment.time !== sale.time)) {
        return false;
      }
      const undatedLegacy = debt && sale.legacy && payment.time === null && sale.payments.length === 1 && payment.amountCents === total;
      if (!undatedLegacy && (!validTime(payment.time) || payment.time < sale.time ||
          (sale.canceledAt && payment.time > sale.canceledAt))) return false;
      paymentIds.add(payment.id);
      received += payment.amountCents;
      if (received > total) return false;
    }
    return true;
  }

  function upgradeSale(sale) {
    const { flavorId, flavorName, qty, unitPriceCents, costUnitCents, discountCents } = sale;
    return {
      id: sale.id,
      items: [{ flavorId, flavorName, qty, unitPriceCents, costUnitCents, discountCents, subtotalCents: qty * unitPriceCents }],
      totalCents: sale.totalCents, method: sale.method, phone: sale.phone, buyer: '',
      payments: sale.paid ? [{ id: 'original', amountCents: sale.totalCents, method: sale.receivedVia, time: sale.paidAt }] : [],
      time: sale.time, canceledAt: sale.canceledAt, legacy: sale.legacy
    };
  }

  function upgradeHistory(data) {
    const ids = new Set(data.flavors.map(flavor => flavor.id));
    if (data.sales.length > MAX_SALES || !data.sales.every(sale => validOldSale(sale, ids))) {
      throw Error('O histórico anterior contém uma venda inválida.');
    }
    return validateState({ ...data, version: VERSION, sales: data.sales.map(upgradeSale) });
  }

  function validateV5(data) {
    if (!hasKeys(data, ['version', 'profile', 'settings', 'flavors', 'sales']) || data.version !== 5 ||
        !Array.isArray(data.flavors) || data.flavors.length > MAX_FLAVORS || !Array.isArray(data.sales)) {
      throw Error('Versão anterior inválida.');
    }
    return upgradeHistory(data);
  }

  function validateState(data) {
    if (!hasKeys(data, ['version', 'profile', 'settings', 'flavors', 'sales']) ||
        data.version !== VERSION || !PROFILES.includes(data.profile) ||
        !hasKeys(data.settings, ['defaultPriceCents', 'unitCostCents']) ||
        !validPrice(data.settings.defaultPriceCents) || !validCents(data.settings.unitCostCents) ||
        !Array.isArray(data.flavors) || data.flavors.length > MAX_FLAVORS ||
        !Array.isArray(data.sales) || data.sales.length > MAX_SALES) throw Error('Formato de dados inválido.');

    const flavorIds = new Set();
    for (const flavor of data.flavors) {
      if (!hasKeys(flavor, ['id', 'name', 'qty', 'priceCents']) || !validId(flavor.id) || flavorIds.has(flavor.id) ||
          !validName(flavor.name) || !validQty(flavor.qty) || !validPrice(flavor.priceCents)) {
        throw Error('O arquivo contém um sabor inválido ou com ID repetido.');
      }
      flavorIds.add(flavor.id);
    }
    const saleIds = new Set();
    for (const sale of data.sales) {
      if (!validSale(sale, flavorIds) || saleIds.has(sale.id)) throw Error('O arquivo contém uma venda inválida ou com ID repetido.');
      saleIds.add(sale.id);
    }
    return data;
  }

  function legacyTime(value) {
    const time = new Date(value);
    if ((typeof value !== 'string' && typeof value !== 'number') || !Number.isFinite(time.getTime())) {
      throw Error('Há um registro antigo sem data válida.');
    }
    return time.toISOString();
  }

  function legacySale(sale, profileVersion, index, flavors) {
    if (!record(sale)) throw Error('Há um registro de venda antigo inválido.');
    const stockFlavor = profileVersion === 2 ? flavors[sale.flavorIndex] : flavors.find(flavor => flavor.id === String(sale.flavorId ?? ''));
    if (profileVersion === 2 && (!Number.isInteger(sale.flavorIndex) || !stockFlavor)) throw Error('Sabor antigo inválido.');
    const method = sale.method;
    const time = legacyTime(profileVersion === 2 ? Number(sale.time ?? NaN) : sale.time);
    const hasPrices = profileVersion === 4;
    const paid = hasPrices ? sale.paid : method !== 'fiado' || Boolean(sale.paid);
    return {
      id: hasPrices ? sale.id : String(sale.id || `legacy-${profileVersion}-${Date.parse(time)}-${index + 1}`),
      flavorId: hasPrices ? sale.flavorId : stockFlavor?.id ?? String(sale.flavorId ?? ''),
      flavorName: profileVersion === 2 ? stockFlavor.name : (sale.flavorName ?? stockFlavor?.name ?? 'Sabor').trim(),
      qty: hasPrices ? sale.qty : 1,
      unitPriceCents: hasPrices ? sale.unitPriceCents : 800,
      costUnitCents: hasPrices ? sale.costUnitCents : 300,
      discountCents: 0,
      totalCents: hasPrices ? sale.totalCents : 800,
      method,
      phone: hasPrices ? sale.phone : method === 'fiado' ? String(sale.phone || '') : '',
      paid,
      receivedVia: hasPrices ? sale.receivedVia : method === 'fiado' ? (paid ? 'unknown' : null) : method,
      paidAt: sale.paidAt == null ? (method === 'fiado' ? null : time) : legacyTime(sale.paidAt),
      time,
      canceledAt: null,
      legacy: true
    };
  }

  function migrate(data, fromVersion, profile) {
    if (!record(data) || !Array.isArray(data.sales) || data.sales.length > MAX_SALES) throw Error('Dados antigos inválidos.');
    const next = initialState(profile);
    if (fromVersion === 2) {
      if (!Array.isArray(data.stock) || data.stock.length !== NAMES.length || !data.stock.every(validQty)) {
        throw Error('Estoque antigo inválido.');
      }
      next.flavors.forEach((flavor, index) => { flavor.qty = data.stock[index]; });
    } else {
      if (!Array.isArray(data.flavors) || data.flavors.length > MAX_FLAVORS) throw Error('Estoque antigo inválido.');
      next.flavors = data.flavors.map((flavor, index) => ({
        id: fromVersion === 4 ? flavor.id : String(flavor.id || `legacy-flavor-${index + 1}`),
        name: flavor.name.trim(),
        qty: flavor.qty,
        priceCents: fromVersion === 4 ? flavor.priceCents : 800
      }));
    }
    if (fromVersion === 4) {
      if (data.version !== 4) throw Error('Versão antiga inválida.');
      next.settings = { defaultPriceCents: data.settings.defaultPriceCents, unitCostCents: data.settings.unitCostCents };
    }
    next.sales = data.sales.map((sale, index) => legacySale(sale, fromVersion, index, next.flavors));
    return upgradeHistory(next);
  }

  let state = initialState();
  let savedSnapshot;
  let readFailure = false;
  let writing = false;
  let toastTimer;
  let editId;
  let pendingRestore;
  let debtLimit = PAGE_SIZE;
  let historyLimit = PAGE_SIZE;

  function storageSnapshot() {
    for (const [index, key] of [STORE, ...OLD_STORES].entries()) {
      const raw = localStorage.getItem(key);
      if (raw !== null) return { key, raw, version: index ? 5 - index : VERSION, profile: index ? localStorage.getItem(OLD_PROFILE) : null };
    }
    return { key: null, raw: null, version: null, profile: localStorage.getItem(OLD_PROFILE) };
  }

  function load() {
    try {
      savedSnapshot = storageSnapshot();
      const { raw, version, profile } = savedSnapshot;
      const oldProfile = PROFILES.includes(profile) ? profile : '';
      if (raw === null) {
        state = initialState(oldProfile);
      } else {
        const data = JSON.parse(raw);
        if (version === VERSION) {
          state = data?.version === 5 ? validateV5(data) : validateState(data);
        } else state = migrate(data, version, oldProfile);
      }
    } catch {
      readFailure = true;
      showNotice(savedSnapshot
        ? 'Os dados locais não puderam ser lidos. Baixe a cópia local e restaure um backup válido.'
        : 'O navegador bloqueou o armazenamento local. Habilite-o e recarregue a página.');
    }
  }

  function showNotice(message) {
    $('storageNotice').textContent = message;
    $('storageNotice').hidden = !message;
  }

  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 5500);
  }

  async function commit(change, { restore = false } = {}) {
    if (writing) throw Error('Aguarde a gravação em andamento.');
    if (!savedSnapshot || (readFailure && !restore)) throw Error('Restaure um backup válido para voltar a gravar.');
    writing = true;
    try {
      const write = () => {
        const latest = storageSnapshot();
        if (latest.key !== savedSnapshot.key || latest.raw !== savedSnapshot.raw || latest.profile !== savedSnapshot.profile) {
          const message = 'Os dados mudaram em outra aba. Recarregue a página antes de gravar.';
          showNotice(message);
          throw Error(message);
        }
        const next = change(structuredClone(state));
        const raw = JSON.stringify(next);
        if (new TextEncoder().encode(raw).length >= FILE_LIMIT - 1024) {
          throw Error('O limite local de dados foi atingido. Exporte um backup para guardar o histórico.');
        }
        try {
          localStorage.setItem(STORE, raw);
        } catch {
          throw Error('Não foi possível gravar. Verifique o espaço e as permissões do navegador.');
        }
        savedSnapshot = { key: STORE, raw, version: VERSION, profile: null };
        state = next;
        readFailure = false;
        showNotice('');
      };
      if (navigator.locks) await navigator.locks.request(STORE, write);
      else write();
    } finally {
      writing = false;
    }
  }

  async function apply(change, onSuccess, onError = toast) {
    try {
      await commit(change);
    } catch (error) {
      onError(error.message);
      return;
    }
    onSuccess();
  }

  function stockTotals() {
    let qty = 0;
    let gross = 0n;
    for (const flavor of state.flavors) {
      qty += flavor.qty;
      gross += BigInt(flavor.qty * flavor.priceCents);
    }
    return { qty, gross, cost: BigInt(qty) * BigInt(state.settings.unitCostCents) };
  }

  function node(tag, text = '', className = '') {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function button(label, action, description = '') {
    const element = node('button', label, 'mini-btn');
    element.type = 'button';
    if (description) element.setAttribute('aria-label', description);
    element.addEventListener('click', action);
    return element;
  }

  const saleRows = () => Array.from($('saleItems').children);

  function draftFields(row) {
    return {
      flavor: row.querySelector('[data-flavor]'), qty: row.querySelector('[data-qty]'),
      price: row.querySelector('[data-price]'), available: row.querySelector('[data-available]')
    };
  }

  function saleDraft() {
    const mode = $('salePricing').value;
    const flavors = new Map(state.flavors.map(flavor => [flavor.id, flavor]));
    const selected = new Set();
    const items = saleRows().map(row => {
      const fields = draftFields(row);
      const flavor = flavors.get(fields.flavor.value);
      const qty = fields.qty.valueAsNumber;
      const unitPriceCents = inputCents(fields.price.value);
      if (!flavor || !validQty(qty) || qty === 0 || qty > flavor.qty) {
        throw Error('Informe quantidades disponíveis em estoque.');
      }
      if (selected.has(flavor.id)) throw Error('Reúna as unidades de cada sabor na mesma linha.');
      selected.add(flavor.id);
      if (mode === 'unit' && !validPrice(unitPriceCents)) throw Error('Informe preços válidos com até duas casas decimais.');
      return { flavorId: flavor.id, flavorName: flavor.name, qty, unitPriceCents, costUnitCents: state.settings.unitCostCents };
    });
    const discount = $('saleDiscount').value ? inputCents($('saleDiscount').value) : 0;
    return quoteSale(items, mode, inputCents($('manualTotal').value), discount);
  }

  function calculateSale() {
    const mode = $('salePricing').value;
    for (const row of saleRows()) {
      const fields = draftFields(row);
      const flavor = state.flavors.find(item => item.id === fields.flavor.value);
      fields.available.textContent = flavor ? `${flavor.qty} un. disponíveis` : 'Escolha um sabor disponível.';
      fields.qty.max = flavor?.qty || MAX_QTY;
      fields.price.disabled = fields.price.parentElement.hidden = mode !== 'unit';
    }
    $('promotionHelp').hidden = mode !== 'promo';
    $('manualTotalWrap').hidden = $('manualTotal').disabled = mode !== 'total';
    $('manualTotal').required = mode === 'total';
    $('discountWrap').hidden = $('saleDiscount').disabled = mode === 'promo';
    $('saleBreakdown').textContent = '';
    try {
      const draft = saleDraft();
      const price = mode === 'promo' ? `${money(PROMOTION_PRICES[draft.qty])}/un. na promoção` : `${money(draft.subtotal)} antes do desconto`;
      $('saleTotal').textContent = money(draft.total);
      $('saleBreakdown').textContent = `${draft.qty} un. · ${price} · Desconto ${money(draft.discount)}`;
      $('saleProfit').textContent = `Lucro bruto estimado de ${money(draft.total - draft.cost)}`;
      $('saleProfit').classList.toggle('negative-text', draft.total < draft.cost);
    } catch (error) {
      $('saleTotal').textContent = '—';
      $('saleProfit').textContent = error.message;
      $('saleProfit').classList.add('negative-text');
    }
  }

  function setSalePrice(row = $('saleItems').firstElementChild) {
    const fields = draftFields(row);
    const flavor = state.flavors.find(item => item.id === fields.flavor.value);
    fields.price.value = flavor ? decimal(flavor.priceCents) : '';
  }

  function refreshSaleOptions(resetPrice = false) {
    const elements = saleRows();
    const rows = elements.map(draftFields);
    const choices = rows.map(fields => fields.flavor.value);
    const inStock = state.flavors.filter(flavor => flavor.qty > 0);
    for (const [index, fields] of rows.entries()) {
      const previous = fields.flavor.value;
      const selectedElsewhere = new Set(choices.filter((_, rowIndex) => rowIndex !== index));
      const fallback = inStock.find(flavor => !selectedElsewhere.has(flavor.id));
      const available = node('option', 'Escolha um sabor');
      available.value = '';
      const options = state.flavors.map(flavor => {
        const option = node('option', `${flavor.name} · ${flavor.qty} un.`);
        option.value = flavor.id;
        option.disabled = !flavor.qty || selectedElsewhere.has(flavor.id);
        return option;
      });
      fields.flavor.replaceChildren(available, ...options);
      const keep = state.flavors.some(flavor => flavor.id === previous && (flavor.qty > 0 || index > 0));
      fields.flavor.value = keep ? previous : (fallback?.id || '');
      fields.flavor.disabled = inStock.length === 0;
      if (resetPrice || previous !== fields.flavor.value) setSalePrice(elements[index]);
    }
    $('addSaleItem').disabled = readFailure || inStock.length <= rows.length;
    $('saleForm').querySelector('button[type=submit]').disabled = !inStock.length || readFailure;
    calculateSale();
  }

  function appendSaleItem(flavorId) {
    const primary = $('saleItems').firstElementChild;
    const row = primary.cloneNode(true);
    row.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    const fields = draftFields(row);
    const labelId = `availability-${uid()}`;
    fields.available.id = labelId;
    fields.qty.setAttribute('aria-describedby', labelId);
    fields.qty.value = '1';
    const remove = button('Remover sabor', () => {
      row.remove();
      refreshSaleOptions();
      ($('addSaleItem').disabled ? $('saleFlavor') : $('addSaleItem')).focus();
    });
    row.append(remove);
    $('saleItems').append(row);
    const selected = new Set(saleRows().filter(candidate => candidate !== row).map(candidate => draftFields(candidate).flavor.value));
    fields.flavor.value = flavorId || state.flavors.find(flavor => flavor.qty > 0 && !selected.has(flavor.id))?.id || '';
    setSalePrice(row);
    refreshSaleOptions();
    fields.flavor.focus();
  }

  function resetSaleItems() {
    saleRows().slice(1).forEach(row => row.remove());
    for (const [id, value] of Object.entries({ saleQty: '1', saleDiscount: '', manualTotal: '', salePhone: '', saleBuyer: '' })) {
      $(id).value = value;
    }
  }

  function render({ resetPrice = false, resetSettings = false } = {}) {
    const stock = stockTotals();
    const totals = summarize(state.sales);
    const values = {
      units: stock.qty, flavorCount: `${state.flavors.length} sabores`, stockGross: money(stock.gross),
      stockCost: money(stock.cost), stockPotential: money(stock.gross - stock.cost), soldValue: money(totals.gross),
      soldCost: money(totals.cost), receivedValue: money(totals.received), dueValue: money(totals.due),
      profitValue: money(totals.gross - totals.cost), pixValue: money(totals.methods.pix),
      creditValue: money(totals.methods.credit), debitValue: money(totals.methods.debit), cashValue: money(totals.methods.cash),
      unknownValue: money(totals.methods.unknown), stockInfo: `${stock.qty} unidades`
    };
    for (const [id, value] of Object.entries(values)) $(id).textContent = readFailure ? '—' : value;
    $('stockPotential').parentElement.classList.toggle('negative', stock.gross < stock.cost);
    $('profitValue').parentElement.classList.toggle('negative', totals.gross < totals.cost);
    $('legacyPayment').hidden = totals.methods.unknown === 0n;
    for (const form of ['saleForm', 'addForm', 'settingsForm']) $(form).inert = readFailure;
    $('userChoice').disabled = readFailure;
    $('exportCsv').disabled = readFailure;
    $('exportJson').disabled = readFailure && savedSnapshot?.raw == null;
    $('exportJson').textContent = readFailure ? 'Baixar cópia local' : 'Exportar backup (JSON)';
    if (resetSettings) {
      $('defaultPrice').value = decimal(state.settings.defaultPriceCents);
      $('unitCost').value = decimal(state.settings.unitCostCents);
      $('newPrice').value = decimal(state.settings.defaultPriceCents);
    }
    refreshSaleOptions(resetPrice);
    renderFlavors();
    renderDebts();
    renderHistory();
    renderReport();
    renderBackupDate();
    renderProfile();
  }

  function openEditor(flavor) {
    editId = flavor.id;
    $('editName').value = flavor.name;
    $('editQty').value = flavor.qty;
    $('editPrice').value = decimal(flavor.priceCents);
    $('editError').textContent = '';
    $('editDialog').showModal();
  }

  function renderFlavors() {
    const grid = $('flavorGrid');
    grid.replaceChildren();
    if (readFailure) return;
    if (state.flavors.length === 0) grid.append(node('p', 'Nenhum sabor cadastrado.', 'empty'));
    for (const flavor of state.flavors) {
      const card = node('article', '', 'flavor');
      const head = node('div', '', 'flavor-head');
      head.append(node('h3', flavor.name), node('span', `${flavor.qty} un.`, 'qty'));
      const price = node('small', `${money(flavor.priceCents)} por unidade · ${money(flavor.qty * flavor.priceCents)} em estoque`);
      const actions = node('div', '', 'flavor-actions');
      const edit = button('Editar', () => openEditor(flavor), `Editar sabor ${flavor.name}`);
      edit.id = `edit-${flavor.id}`;
      const add = button('+1 un.', () => {
        apply(next => {
          const target = next.flavors.find(item => item.id === flavor.id);
          if (target.qty >= MAX_QTY) throw Error('Este sabor atingiu o limite de estoque.');
          target.qty++;
          return next;
        }, () => {
          render();
          const quickAdd = $(add.id);
          if (quickAdd.disabled) $(edit.id).focus();
          else quickAdd.focus();
          toast(`Uma unidade de ${flavor.name} adicionada.`);
        });
      }, `Adicionar uma unidade de ${flavor.name}`);
      add.id = `add-${flavor.id}`;
      add.disabled = flavor.qty === MAX_QTY;
      const sell = button('Vender', () => {
        const rows = saleRows();
        const existing = rows.find(row => draftFields(row).flavor.value === flavor.id);
        if (existing) {
          draftFields(existing).qty.focus();
        } else if (rows.length > 1 && !$('addSaleItem').disabled) {
          appendSaleItem(flavor.id);
        } else if (rows.length === 1) {
          $('saleFlavor').value = flavor.id;
          $('saleQty').value = '1';
          $('saleDiscount').value = '';
          setSalePrice();
          refreshSaleOptions();
          $('saleQty').focus();
        }
      }, `Vender ${flavor.name}`);
      sell.disabled = flavor.qty === 0;
      actions.append(edit, add, sell);
      card.append(head, price, actions);
      grid.append(card);
    }
  }

  function addOrEditFlavor(event) {
    event.preventDefault();
    const edit = event.target.id === 'editForm';
    const prefix = edit ? 'edit' : 'new';
    const name = $(`${prefix}Name`).value.trim();
    const qty = $(`${prefix}Qty`).valueAsNumber;
    const priceCents = inputCents($(`${prefix}Price`).value);
    const showError = edit ? message => { $('editError').textContent = message; } : toast;
    if (!validName(name) || !validQty(qty) || !validPrice(priceCents)) {
      showError('Confira o nome, a quantidade e o preço do sabor.');
      return;
    }
    const id = edit ? editId : uid();
    const previousPrice = state.flavors.find(flavor => flavor.id === id)?.priceCents;
    apply(next => {
      if (edit) Object.assign(next.flavors.find(flavor => flavor.id === id), { name, qty, priceCents });
      else {
        if (next.flavors.length >= MAX_FLAVORS) throw Error('O limite de sabores foi atingido.');
        next.flavors.push({ id, name, qty, priceCents });
      }
      return next;
    }, () => {
      if (edit) $('editDialog').close();
      else {
        $('newName').value = '';
        $('newQty').value = '0';
        $('newPrice').value = decimal(state.settings.defaultPriceCents);
      }
      render();
      if (edit) {
        for (const row of saleRows()) {
          const fields = draftFields(row);
          if (fields.flavor.value === id && inputCents(fields.price.value) === previousPrice) setSalePrice(row);
        }
        calculateSale();
      }
      $(edit ? `edit-${id}` : 'newName').focus();
      toast(edit ? 'Sabor atualizado.' : `Sabor ${name} cadastrado.`);
    }, showError);
  }

  function updateSettings(event) {
    event.preventDefault();
    const price = inputCents($('defaultPrice').value);
    const cost = inputCents($('unitCost').value);
    if (!validPrice(price) || !validCents(cost)) {
      toast('Confira os valores. Use até duas casas decimais.');
      return;
    }
    const followed = saleRows().filter(row => {
      const fields = draftFields(row);
      const price = state.flavors.find(flavor => flavor.id === fields.flavor.value)?.priceCents;
      return price === inputCents(fields.price.value);
    });
    apply(next => {
      const oldPrice = next.settings.defaultPriceCents;
      next.settings = { defaultPriceCents: price, unitCostCents: cost };
      for (const flavor of next.flavors) {
        if (flavor.priceCents === oldPrice) flavor.priceCents = price;
      }
      return next;
    }, () => {
      render({ resetSettings: true });
      for (const row of followed) setSalePrice(row);
      calculateSale();
      toast('Valores padrão salvos.');
    });
  }

  function handleSale(event) {
    event.preventDefault();
    let draft;
    try {
      draft = saleDraft();
    } catch (error) {
      toast(error.message);
      return;
    }
    const method = $('saleMethod').value;
    const debt = method === 'fiado';
    if (!debt && !PAID_METHODS.includes(method)) {
      toast('Selecione uma forma de pagamento válida.');
      return;
    }
    const rawPhone = $('salePhone').value.trim();
    const phone = debt ? rawPhone.replace(/\D/gu, '') : '';
    const buyer = debt ? $('saleBuyer').value.trim() : '';
    if (debt && (!/^[+() .\d-]+$/u.test(rawPhone) || !validPhone(phone))) {
      $('salePhone').focus();
      toast('Informe um telefone com DDD para registrar o fiado.');
      return;
    }
    if (buyer && !validName(buyer)) {
      $('saleBuyer').focus();
      toast('Informe um nome válido com até 80 caracteres.');
      return;
    }
    const time = timestamp();
    const sale = {
      id: uid(), items: draft.items, totalCents: draft.total, method, buyer, phone,
      payments: debt ? [] : [{ id: uid(), amountCents: draft.total, method, time }],
      time, canceledAt: null, legacy: false
    };
    apply(next => {
      if (next.sales.length >= MAX_SALES) throw Error('O histórico atingiu seu limite.');
      const flavors = new Map(next.flavors.map(flavor => [flavor.id, flavor]));
      for (const item of sale.items) flavors.get(item.flavorId).qty -= item.qty;
      next.sales.push(sale);
      return next;
    }, () => {
      resetSaleItems();
      render({ resetPrice: true });
      if ($('saleFlavor').disabled) $('sale-heading').scrollIntoView({ block: 'nearest' });
      else $('saleFlavor').focus();
      toast(`Venda registrada por ${money(sale.totalCents)}.`);
    });
  }

  function togglePhone() {
    const fiado = $('saleMethod').value === 'fiado';
    $('buyerWrap').hidden = $('saleBuyer').disabled = !fiado;
    $('phoneWrap').hidden = $('salePhone').disabled = !fiado;
    $('salePhone').required = fiado;
  }

  const saleDescription = sale => sale.items.map(item => `${item.qty} × ${item.flavorName}`).join(' + ');

  function saleRow(sale, ...details) {
    const row = node('article', '', 'entry');
    const content = node('div', '', 'details');
    content.append(node('strong', `${saleDescription(sale)} · ${money(sale.totalCents)}`), node('small', details.filter(Boolean).join(' · ')));
    row.append(content);
    row.dataset.saleId = sale.id;
    return row;
  }

  function appendPaymentHistory(container, sale) {
    if (!sale.payments.length) return;
    const group = node('details', '', 'payment-history');
    group.append(node('summary', `Recebimentos (${sale.payments.length})`));
    const list = node('ul');
    for (const payment of sale.payments) {
      const when = payment.time ? dateFormatter.format(new Date(payment.time)) : 'Data desconhecida';
      list.append(node('li', `${when} · ${METHODS[payment.method]} · ${money(payment.amountCents)}`));
    }
    group.append(list);
    container.append(group);
  }

  function settleDebt(sale, method, amount) {
    if (!PAID_METHODS.includes(method)) {
      toast('Selecione como o fiado foi pago.');
      return;
    }
    const remaining = balance(sale);
    const amountCents = amount === '' ? remaining : inputCents(amount);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > remaining) {
      toast('Informe um valor acima de zero, até o saldo pendente.');
      return;
    }
    if (!confirm(`Confirmar o recebimento de ${money(amountCents)} via ${METHODS[method]}?`)) return;
    apply(next => {
      const target = next.sales.find(item => item.id === sale.id);
      if (target.canceledAt || amountCents > balance(target)) throw Error('Este fiado já foi atualizado.');
      const time = [timestamp(), target.payments.at(-1)?.time || target.time].sort().at(-1);
      target.payments.push({ id: uid(), amountCents, method, time });
      return next;
    }, () => {
      render();
      $('debt-heading').focus();
      toast(amountCents === remaining ? 'Fiado quitado. O valor foi registrado nos recebimentos.' :
        `Pagamento registrado. Saldo de ${money(remaining - amountCents)}.`);
    });
  }

  function renderDebts() {
    const area = $('debtList');
    const open = readFailure ? [] : state.sales.filter(sale => sale.method === 'fiado' && !sale.canceledAt && balance(sale) > 0).reverse();
    area.replaceChildren();
    $('moreDebts').hidden = open.length <= debtLimit;
    if (!open.length && !readFailure) area.append(node('p', 'Nenhum fiado pendente.', 'empty'));
    for (const sale of open.slice(0, debtLimit)) {
      const row = saleRow(sale, dateFormatter.format(new Date(sale.time)), sale.buyer,
        sale.phone ? `Telefone ${sale.phone}` : 'Telefone ausente no registro antigo', `Saldo pendente ${money(balance(sale))}`);
      appendPaymentHistory(row.firstElementChild, sale);
      const controls = node('div', '', 'entry-controls debt-controls');
      const methodsLabel = node('label', 'Recebido via');
      const methods = node('select');
      methods.setAttribute('aria-label', `Forma de quitação do fiado de ${saleDescription(sale)}`);
      const placeholder = node('option', 'Selecione');
      placeholder.value = '';
      methods.append(placeholder);
      for (const method of PAID_METHODS) {
        const option = node('option', METHODS[method]);
        option.value = method;
        methods.append(option);
      }
      methodsLabel.append(methods);
      const amountLabel = node('label', 'Pagamento parcial (R$)');
      const amount = node('input');
      amount.type = 'number';
      amount.inputMode = 'decimal';
      amount.min = '0.01';
      amount.step = '0.01';
      amount.max = decimal(balance(sale));
      amount.placeholder = decimal(balance(sale));
      amountLabel.append(amount);
      const pay = button('Quitar fiado', () => {
        if (amount.reportValidity()) settleDebt(sale, methods.value, amount.value);
      });
      amount.addEventListener('input', () => { pay.textContent = amount.value ? 'Registrar pagamento' : 'Quitar fiado'; });
      controls.append(methodsLabel, amountLabel, pay);
      row.append(controls);
      area.append(row);
    }
  }

  function cancelSale(sale) {
    const paymentNote = sale.payments.length ? ' Estorne todos os pagamentos já registrados antes de confirmar.' : '';
    if (!confirm(`Cancelar a venda e devolver as unidades ao estoque?${paymentNote}`)) return;
    apply(next => {
      const target = next.sales.find(item => item.id === sale.id);
      if (target.canceledAt) throw Error('A venda já foi cancelada.');
      const flavors = new Map(next.flavors.map(flavor => [flavor.id, flavor]));
      for (const item of target.items) {
        const flavor = flavors.get(item.flavorId) ||
          (target.legacy ? next.flavors.find(candidate => candidate.name === item.flavorName) : undefined);
        if (!flavor || flavor.qty + item.qty > MAX_QTY) throw Error('Não foi possível devolver todas as unidades ao estoque.');
        flavor.qty += item.qty;
      }
      target.canceledAt = [timestamp(), ...target.payments.map(payment => payment.time).filter(Boolean), target.time].sort().at(-1);
      return next;
    }, () => {
      render();
      $('history-heading').focus();
      toast('Venda cancelada e estoque corrigido.');
    });
  }

  function saleStatus(sale) {
    if (sale.canceledAt) return 'Cancelada';
    if (sale.method !== 'fiado') return METHODS[sale.method];
    const paid = sumPayments(sale.payments);
    if (paid === sale.totalCents) return 'Fiado quitado';
    return paid ? 'Fiado parcialmente pago' : 'Fiado pendente';
  }

  function renderHistory() {
    const area = $('historyList');
    area.replaceChildren();
    $('moreSales').hidden = readFailure || state.sales.length <= historyLimit;
    if (readFailure) return;
    if (state.sales.length === 0) area.append(node('p', 'Nenhuma venda registrada.', 'empty'));
    for (const sale of state.sales.slice(-historyLimit).reverse()) {
      const pending = sale.method === 'fiado' && !sale.canceledAt ? `Saldo ${money(balance(sale))}` : '';
      const row = saleRow(sale, dateFormatter.format(new Date(sale.time)), saleStatus(sale), sale.buyer, pending);
      const itemList = node('ul', '', 'sale-history-items');
      for (const item of sale.items) {
        const effectivePrice = (item.subtotalCents - item.discountCents) / item.qty;
        const price = Number.isInteger(effectivePrice) ? `Preço ${money(effectivePrice)}/un.` :
          `Valor do sabor ${money(item.subtotalCents - item.discountCents)}`;
        itemList.append(node('li', `${item.flavorName} · ${price} · Custo ${money(item.costUnitCents)}/un. · Desconto ${money(item.discountCents)}`));
      }
      row.firstElementChild.append(itemList);
      if (sale.method === 'fiado') appendPaymentHistory(row.firstElementChild, sale);
      if (!sale.canceledAt) row.append(button('Cancelar venda', () => cancelSale(sale), `Cancelar venda de ${saleDescription(sale)}`));
      area.append(row);
    }
  }

  function csvCell(value, text = false) {
    const content = String(value ?? '');
    const protectedText = text && /^[\s\u200b-\u200f]*[=+\-@＝＋－＠]/u.test(content) ? "'" + content : content;
    return '"' + protectedText.replace(/"/gu, '""') + '"';
  }

  function download(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = node('a');
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function selectedRange() {
    return { from: $('dateFrom').value, to: $('dateTo').value };
  }

  function setReportPeriod() {
    const period = $('reportPeriod').value;
    if (period !== 'custom') {
      const { from, to } = dateRange(period);
      $('dateFrom').value = from;
      $('dateTo').value = to;
    }
    renderReport();
  }

  function chart(id, rows, label) {
    const list = $(id);
    const max = rows.reduce((highest, row) => row.value > highest ? row.value : highest, 0);
    list.replaceChildren();
    if (!rows.length) {
      list.append(node('li', 'Nenhuma venda no período.', 'empty'));
      return;
    }
    for (const row of rows) {
      const item = node('li');
      const text = node('div', '', 'chart-label');
      text.append(node('span', row.name), node('strong', label(row.value)));
      const meter = node('meter');
      meter.max = Number(max);
      meter.value = Number(row.value);
      meter.setAttribute('aria-hidden', 'true');
      item.append(text, meter);
      list.append(item);
    }
  }

  function renderReport() {
    const { from, to } = selectedRange();
    const invalid = from && to && from > to;
    $('reportError').textContent = invalid ? 'A data inicial deve ser anterior ou igual à final.' : '';
    $('reportResult').hidden = Boolean(invalid || readFailure);
    if (invalid || readFailure) return;
    const result = summarize(state.sales, { from, to }, true);
    const values = {
      reportGross: result.gross, reportReceived: result.received, reportPix: result.methods.pix,
      reportCredit: result.methods.credit, reportDebit: result.methods.debit, reportCash: result.methods.cash,
      reportUnknown: result.methods.unknown, reportEarlier: result.earlierDebtsReceived, reportDue: result.due,
      reportCost: result.cost, reportProfit: result.gross - result.cost
    };
    for (const [id, value] of Object.entries(values)) $(id).textContent = money(value);
    $('reportProfit').parentElement.classList.toggle('negative', result.gross < result.cost);
    $('reportQty').textContent = result.qty.toLocaleString('pt-BR');
    $('reportUndated').hidden = result.undated === 0n;
    $('reportUnknownRow').hidden = result.methods.unknown === 0n;
    const names = new Map(state.flavors.map(flavor => [flavor.id, flavor.name]));
    const flavors = [...result.flavors].sort(([, a], [, b]) => b.qty - a.qty).slice(0, 5);
    chart('topFlavors', flavors.map(([id, flavor]) => ({ name: names.get(id) || flavor.name, value: flavor.qty })),
      value => `${value.toLocaleString('pt-BR')} un.`);
    const buckets = new Map();
    const monthly = result.days.size > 14;
    for (const [day, value] of result.days) {
      const bucket = monthly ? day.slice(0, 7) : day;
      buckets.set(bucket, (buckets.get(bucket) ?? 0n) + value);
    }
    const periods = [...buckets].sort(([a], [b]) => a.localeCompare(b)).slice(-12);
    chart('salesChart', periods.map(([period, value]) => ({ name: period.split('-').reverse().join('/'), value })), money);
  }

  function exportCsv() {
    const { from, to } = selectedRange();
    if (from && to && from > to) {
      $('dateFrom').focus();
      toast('A data inicial deve ser anterior ou igual à final.');
      return;
    }
    const headers = [
      'ID do registro', 'Tipo', 'ID da venda', 'Data da venda', 'Hora da venda', 'ID do sabor', 'Sabor', 'Quantidade',
      'Preço unitário antes do desconto (R$)', 'Custo unitário (R$)', 'Subtotal (R$)', 'Desconto (R$)',
      'Valor original (R$)', 'Receita bruta (R$)', 'Custo dos produtos vendidos (R$)', 'Lucro bruto (R$)',
      'Recebido (R$)', 'Forma original', 'Situação atual', 'Recebido via', 'Data do recebimento',
      'Hora do recebimento', 'Data do cancelamento', 'Nome fiado', 'Telefone fiado'
    ];
    const asDecimal = cents => decimal(cents).replace('.', ',');
    const rows = [];
    for (const sale of state.sales) {
      const date = new Date(sale.time);
      const day = localDate(date);
      const dateAndTime = [day, timeFormatter.format(date)];
      const status = [METHODS[sale.method], saleStatus(sale)];
      const context = [sale.canceledAt ? dateFormatter.format(new Date(sale.canceledAt)) : '', sale.buyer, sale.phone];
      if (inRange(day, from, to)) {
        sale.items.forEach((item, index) => {
          const original = item.subtotalCents - item.discountCents;
          const gross = sale.canceledAt ? 0 : original;
          const cost = sale.canceledAt ? 0 : item.qty * item.costUnitCents;
          rows.push([`${sale.id}/item/${index + 1}`, 'Item de venda', sale.id, ...dateAndTime, item.flavorId, item.flavorName,
            item.qty, item.unitPriceCents === null ? '' : asDecimal(item.unitPriceCents), asDecimal(item.costUnitCents),
            ...[item.subtotalCents, item.discountCents, original, gross, cost, gross - cost].map(asDecimal),
            '', ...status, '', '', '', ...context]);
        });
      }
      for (const payment of sale.payments) {
        const receivedAt = payment.time ? new Date(payment.time) : null;
        const receivedDay = receivedAt ? localDate(receivedAt) : '';
        if ((!receivedDay && (from || to)) || !inRange(receivedDay, from, to)) continue;
        rows.push([`${sale.id}/pagamento/${payment.id}`, 'Recebimento', sale.id, ...dateAndTime,
          '', '', '', '', '', '', '', asDecimal(payment.amountCents), '', '', '',
          asDecimal(sale.canceledAt ? 0 : payment.amountCents), ...status, METHODS[payment.method],
          receivedDay, receivedAt ? timeFormatter.format(receivedAt) : '', ...context]);
      }
    }
    if (!rows.length) {
      toast('Nenhuma venda encontrada no período selecionado.');
      return;
    }
    const textColumns = [0, 2, 5, 6, 23, 24];
    const csv = '\ufeff' + [headers, ...rows].map(row => row.map((value, index) => csvCell(value, textColumns.includes(index))).join(';')).join('\r\n');
    const period = `${from || 'inicio'}_a_${to || 'fim'}`;
    download(csv, `vendas-loja-gigi_${period}.csv`, 'text/csv;charset=utf-8');
    toast(`${rows.length} registro(s) exportado(s) em CSV.`);
  }

  async function checksum(data) {
    const bytes = new TextEncoder().encode(JSON.stringify([data.app, data.version, data.exportedAt, data.state]));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  }

  function renderBackupDate() {
    let last;
    try {
      last = localStorage.getItem(LAST_BACKUP);
    } catch {
      last = null;
    }
    $('lastBackup').textContent = validTime(last)
      ? `Último download de backup iniciado em ${dateFormatter.format(new Date(last))}.`
      : 'Este navegador ainda não registrou um download de backup.';
  }

  function backupFileDate(iso) {
    const date = new Date(iso);
    const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map(value => String(value).padStart(2, '0')).join('');
    return `${localDate(date)}_${time}-${String(date.getMilliseconds()).padStart(3, '0')}`;
  }

  async function exportJson() {
    const exportedAt = timestamp();
    const fileDate = backupFileDate(exportedAt);
    if (readFailure) {
      if (savedSnapshot?.raw != null) {
        download(savedSnapshot.raw, `recuperacao-loja-gigi_${fileDate}.txt`, 'text/plain;charset=utf-8');
        toast('Cópia dos dados locais baixada para recuperação.');
      }
      return;
    }
    const snapshot = state;
    try {
      const payload = { app: APP, version: VERSION, exportedAt, state: snapshot };
      payload.sha256 = await checksum(payload);
      download(JSON.stringify(payload), `backup-loja-gigi_${fileDate}.json`, 'application/json;charset=utf-8');
    } catch {
      toast('Não foi possível gerar o backup. Abra a loja em um endereço HTTPS ou localhost.');
      return;
    }
    try {
      localStorage.setItem(LAST_BACKUP, exportedAt);
      renderBackupDate();
    } catch {
      toast('Download iniciado. Não foi possível gravar a data do backup.');
      return;
    }
    toast('Download de backup iniciado. Guarde o arquivo em local seguro.');
  }

  async function validateBackup(data) {
    if (data?.version === 4 && !Object.hasOwn(data, 'app') && !Object.hasOwn(data, 'state')) {
      return migrate(data, 4, state.profile);
    }
    const keys = ['app', 'version', 'exportedAt', 'state'];
    if (data?.version === VERSION) keys.push('sha256');
    if (!hasKeys(data, keys) || data.app !== APP || !validTime(data.exportedAt)) {
      throw Error('O arquivo precisa ser um backup da Loja da Gigi.');
    }
    if (data.version === 4) return migrate(data.state, 4, state.profile);
    if (data.version === 5) return validateV5(data.state);
    if (data.version !== VERSION) throw Error('A versão do backup é incompatível.');
    const validated = validateState(data.state);
    if (typeof data.sha256 !== 'string' || data.sha256 !== await checksum(data)) {
      throw Error('A verificação de integridade do backup falhou.');
    }
    return validated;
  }

  function previewRestore(replacement, reset = false) {
    if (!savedSnapshot) {
      toast('O armazenamento local está indisponível. Habilite-o e recarregue a página.');
      return;
    }
    const word = reset ? 'APAGAR' : 'RESTAURAR';
    pendingRestore = { replacement, word };
    $('restoreHeading').textContent = reset ? 'Restaurar dados iniciais' : 'Restaurar backup';
    const payments = replacement.sales.reduce((count, sale) => count + sale.payments.length, 0);
    const incoming = reset ? 'O estoque voltará aos 13 sabores iniciais e o histórico será apagado.' :
      `O arquivo tem ${replacement.flavors.length} sabor(es), ${replacement.sales.length} registro(s) de venda e ${payments} pagamento(s).`;
    const current = readFailure ? 'Os dados locais ilegíveis serão substituídos.' :
      `O estoque, os ajustes e os ${state.sales.length} registro(s) locais serão substituídos. Baixe uma cópia local antes de confirmar.`;
    $('restoreDetails').textContent = `${incoming} ${current}`;
    $('restoreWord').textContent = word;
    $('restoreInput').value = '';
    $('restoreError').textContent = '';
    $('applyRestore').disabled = true;
    $('saveBeforeRestore').disabled = readFailure && savedSnapshot.raw === null;
    $('restoreDialog').showModal();
  }

  async function importJson(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    try {
      if (file.size > FILE_LIMIT) throw Error('O arquivo excede 8 MB.');
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw Error('O arquivo não contém um JSON válido.');
      }
      const replacement = await validateBackup(data);
      previewRestore(replacement);
    } catch (error) {
      toast(`Importação recusada. ${error.message}`);
    }
  }

  async function restoreData(event) {
    event.preventDefault();
    const restore = pendingRestore;
    if (!restore || $('restoreInput').value.trim() !== restore.word) return;
    $('applyRestore').disabled = true;
    $('restoreInput').disabled = true;
    $('closeRestore').disabled = true;
    try {
      await commit(() => restore.replacement, { restore: true });
    } catch (error) {
      $('restoreError').textContent = error.message;
      return;
    } finally {
      $('applyRestore').disabled = false;
      $('restoreInput').disabled = false;
      $('closeRestore').disabled = false;
    }
    pendingRestore = null;
    debtLimit = historyLimit = PAGE_SIZE;
    $('restoreDialog').close();
    resetSaleItems();
    $('saleForm').reset();
    $('addForm').reset();
    togglePhone();
    render({ resetPrice: true, resetSettings: true });
    $('chooseBackup').focus();
    toast(restore.word === 'APAGAR' ? 'Dados iniciais restaurados.' : 'Backup restaurado.');
  }

  function renderProfile() {
    $('userChoice').value = state.profile;
    $('greeting').textContent = state.profile ? `Olá, ${state.profile}!` : 'Boas-vindas à Loja da Gigi!';
  }

  function chooseProfile(profile) {
    if (!PROFILES.includes(profile)) return;
    apply(next => ({ ...next, profile }), () => {
      const dialog = $('profileDialog');
      if (dialog.open) dialog.close();
      renderProfile();
      toast('Nome salvo neste navegador.');
    }, message => {
      renderProfile();
      if ($('profileDialog').open) $('profileError').textContent = message;
      else toast(message);
    });
  }

  function init() {
    load();
    setReportPeriod();
    render({ resetPrice: true, resetSettings: true });
    $('saleForm').addEventListener('submit', handleSale);
    $('settingsForm').addEventListener('submit', updateSettings);
    $('addForm').addEventListener('submit', addOrEditFlavor);
    $('editForm').addEventListener('submit', addOrEditFlavor);
    $('closeEdit').addEventListener('click', () => $('editDialog').close());
    $('saleItems').addEventListener('change', event => {
      if (!event.target.matches('[data-flavor]')) return;
      setSalePrice(event.target.closest('.sale-item'));
      refreshSaleOptions();
    });
    $('saleItems').addEventListener('input', event => { if (event.target.matches('input')) calculateSale(); });
    $('addSaleItem').addEventListener('click', () => appendSaleItem());
    $('salePricing').addEventListener('change', calculateSale);
    for (const key of ['manualTotal', 'saleDiscount']) $(key).addEventListener('input', calculateSale);
    $('saleMethod').addEventListener('change', togglePhone);
    togglePhone();
    $('moreDebts').addEventListener('click', () => {
      debtLimit += PAGE_SIZE;
      renderDebts();
      $('debtList').children[debtLimit - PAGE_SIZE]?.querySelector('select')?.focus();
    });
    $('moreSales').addEventListener('click', () => {
      historyLimit += PAGE_SIZE;
      renderHistory();
      const firstNew = $('historyList').children[historyLimit - PAGE_SIZE];
      firstNew.tabIndex = -1;
      firstNew.focus();
    });
    $('reportPeriod').addEventListener('change', setReportPeriod);
    for (const id of ['dateFrom', 'dateTo']) {
      $(id).addEventListener('input', () => {
        $('reportPeriod').value = 'custom';
        renderReport();
      });
    }
    window.addEventListener('focus', setReportPeriod);
    $('exportCsv').addEventListener('click', exportCsv);
    $('exportJson').addEventListener('click', exportJson);
    $('chooseBackup').addEventListener('click', () => $('importJson').click());
    $('importJson').addEventListener('change', importJson);
    $('reset').addEventListener('click', () => previewRestore(initialState(state.profile), true));
    $('closeRestore').addEventListener('click', () => $('restoreDialog').close());
    $('restoreDialog').addEventListener('cancel', event => { if (writing) event.preventDefault(); });
    $('saveBeforeRestore').addEventListener('click', exportJson);
    $('restoreInput').addEventListener('input', event => {
      $('applyRestore').disabled = event.target.value.trim() !== pendingRestore?.word;
    });
    $('restoreForm').addEventListener('submit', restoreData);
    $('userChoice').addEventListener('change', event => chooseProfile(event.target.value));
    $('chooseSamuel').addEventListener('click', () => chooseProfile('Samuel'));
    $('chooseGiovana').addEventListener('click', () => chooseProfile('Giovana'));
    $('skipProfile').addEventListener('click', () => $('profileDialog').close());
    window.addEventListener('storage', event => {
      if (event.key === LAST_BACKUP) renderBackupDate();
      if (event.key === STORE || event.key === null ||
          (savedSnapshot?.key !== STORE && (event.key === OLD_PROFILE || OLD_STORES.includes(event.key)))) {
        showNotice('Os dados mudaram em outra aba. Recarregue a página antes de editar ou exportar.');
      }
    });
    if (!readFailure && !state.profile) $('profileDialog').showModal();
  }

  init();
})();
