(() => {
  'use strict';

  const APP = 'loja-da-gigi';
  const VERSION = 5;
  const STORE = 'loja-gigi-v5';
  const OLD_STORES = ['loja-gigi-v4', 'laranjinhas-estoque-vendas-v3', 'laranjinhas-estoque-vendas-v2'];
  const OLD_PROFILE = 'loja-gigi-profile';
  const PROFILES = ['', 'Samuel', 'Giovana'];
  const MAX_QTY = 99999;
  const MAX_PRICE = 9999900;
  const MAX_FLAVORS = 2000;
  const MAX_SALES = 100000;
  const FILE_LIMIT = 8 * 1024 * 1024;
  const PAGE_SIZE = 80;
  const PAID_METHODS = ['pix', 'credit', 'debit', 'cash'];
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

  function localDate(date = new Date()) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${String(date.getFullYear()).padStart(4, '0')}-${month}-${day}`;
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

  function validSale(sale, flavorIds) {
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
      id: hasPrices ? sale.id : String(sale.id || `legacy-sale-${index + 1}`),
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
    return validateState(next);
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
      if (raw !== null) return { key, raw, version: VERSION - index, profile: index ? localStorage.getItem(OLD_PROFILE) : null };
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
        state = version === VERSION ? validateState(data) : migrate(data, version, oldProfile);
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

  function saleTotals() {
    const totals = {
      gross: 0n, cost: 0n, received: 0n, due: 0n,
      methods: { pix: 0n, credit: 0n, debit: 0n, cash: 0n, unknown: 0n }
    };
    for (const sale of state.sales) {
      if (sale.canceledAt) continue;
      const total = BigInt(sale.totalCents);
      totals.gross += total;
      totals.cost += BigInt(sale.qty * sale.costUnitCents);
      if (sale.paid) {
        totals.received += total;
        const method = sale.receivedVia === 'card' ? 'unknown' : sale.receivedVia;
        totals.methods[method] += total;
      } else {
        totals.due += total;
      }
    }
    return totals;
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

  const activeFlavor = () => state.flavors.find(flavor => flavor.id === $('saleFlavor').value);

  function saleDraft() {
    const flavor = activeFlavor();
    const qty = $('saleQty').valueAsNumber;
    const price = inputCents($('salePrice').value);
    const discount = $('saleDiscount').value ? inputCents($('saleDiscount').value) : 0;
    if (!flavor || !validQty(qty) || qty === 0 || qty > flavor.qty) throw Error('Informe uma quantidade disponível em estoque.');
    if (!validPrice(price)) throw Error('Informe um preço válido com até duas casas decimais.');
    const subtotal = qty * price;
    if (!Number.isSafeInteger(discount) || discount < 0 || discount >= subtotal) {
      throw Error('O desconto deve ser menor que o subtotal e ter até duas casas decimais.');
    }
    return { flavor, qty, price, discount, total: subtotal - discount };
  }

  function calculateSale() {
    const flavor = activeFlavor();
    $('available').textContent = flavor ? `${flavor.qty} un. disponíveis` : 'Sem unidades disponíveis.';
    $('saleQty').max = flavor?.qty || MAX_QTY;
    try {
      const draft = saleDraft();
      $('saleTotal').textContent = money(draft.total);
      $('saleProfit').textContent = `Lucro bruto estimado de ${money(draft.total - draft.qty * state.settings.unitCostCents)}`;
    } catch (error) {
      $('saleTotal').textContent = '—';
      $('saleProfit').textContent = flavor ? error.message : '';
    }
  }

  function setSalePrice() {
    $('salePrice').value = activeFlavor() ? decimal(activeFlavor().priceCents) : '';
    calculateSale();
  }

  function refreshSaleOptions(resetPrice) {
    const select = $('saleFlavor');
    const previous = select.value;
    const options = state.flavors.map(flavor => {
      const option = node('option', `${flavor.name} · ${flavor.qty} un.`);
      option.value = flavor.id;
      option.disabled = flavor.qty === 0;
      return option;
    });
    const available = state.flavors.find(flavor => flavor.qty > 0);
    select.replaceChildren(...options);
    select.value = state.flavors.some(flavor => flavor.qty > 0 && flavor.id === previous) ? previous : (available?.id || '');
    select.disabled = !available;
    $('saleForm').querySelector('button[type=submit]').disabled = !available || readFailure;
    if (resetPrice || previous !== select.value) setSalePrice();
    else calculateSale();
  }

  function render({ resetPrice = false, resetSettings = false } = {}) {
    const stock = stockTotals();
    const totals = saleTotals();
    const values = {
      units: stock.qty, flavorCount: `${state.flavors.length} sabores`, stockGross: money(stock.gross),
      stockCost: money(stock.cost), stockPotential: money(stock.gross - stock.cost), soldValue: money(totals.gross),
      soldCost: money(totals.cost), receivedValue: money(totals.received), dueValue: money(totals.due),
      profitValue: money(totals.gross - totals.cost), pixValue: money(totals.methods.pix),
      creditValue: money(totals.methods.credit), debitValue: money(totals.methods.debit), cashValue: money(totals.methods.cash),
      unknownValue: money(totals.methods.unknown), stockInfo: `${stock.qty} unidades`
    };
    for (const [id, value] of Object.entries(values)) $(id).textContent = readFailure ? '—' : value;
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
        $('saleFlavor').value = flavor.id;
        $('saleQty').value = '1';
        $('saleDiscount').value = '';
        setSalePrice();
        $('saleQty').focus();
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
      render({ resetPrice: edit && activeFlavor()?.id === id });
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
    const active = activeFlavor();
    const previous = active?.priceCents;
    const followedDefault = previous === inputCents($('salePrice').value);
    apply(next => {
      const oldPrice = next.settings.defaultPriceCents;
      next.settings = { defaultPriceCents: price, unitCostCents: cost };
      for (const flavor of next.flavors) {
        if (flavor.priceCents === oldPrice) flavor.priceCents = price;
      }
      return next;
    }, () => {
      render({ resetPrice: followedDefault, resetSettings: true });
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
    if (method !== 'fiado' && !PAID_METHODS.includes(method)) {
      toast('Selecione uma forma de pagamento válida.');
      return;
    }
    const rawPhone = $('salePhone').value.trim();
    const phone = method === 'fiado' ? rawPhone.replace(/\D/gu, '') : '';
    if (method === 'fiado' && (!/^[+() .\d-]+$/u.test(rawPhone) || !validPhone(phone))) {
      $('salePhone').focus();
      toast('Informe um telefone com DDD para registrar o fiado.');
      return;
    }
    const time = timestamp();
    const paid = method !== 'fiado';
    const sale = {
      id: uid(), flavorId: draft.flavor.id, flavorName: draft.flavor.name, qty: draft.qty,
      unitPriceCents: draft.price, costUnitCents: state.settings.unitCostCents,
      discountCents: draft.discount, totalCents: draft.total, method, phone, paid,
      receivedVia: paid ? method : null, paidAt: paid ? time : null, time, canceledAt: null, legacy: false
    };
    apply(next => {
      if (next.sales.length >= MAX_SALES) throw Error('O histórico atingiu seu limite.');
      next.flavors.find(flavor => flavor.id === sale.flavorId).qty -= sale.qty;
      next.sales.push(sale);
      return next;
    }, () => {
      $('saleQty').value = '1';
      $('saleDiscount').value = '';
      $('salePhone').value = '';
      render({ resetPrice: true });
      if ($('saleFlavor').disabled) $('sale-heading').scrollIntoView({ block: 'nearest' });
      else $('saleFlavor').focus();
      toast(`Venda registrada por ${money(sale.totalCents)}.`);
    });
  }

  function togglePhone() {
    const fiado = $('saleMethod').value === 'fiado';
    $('phoneWrap').hidden = !fiado;
    $('salePhone').disabled = !fiado;
    $('salePhone').required = fiado;
  }

  function saleRow(sale, ...details) {
    const row = node('article', '', 'entry');
    const content = node('div', '', 'details');
    content.append(node('strong', `${sale.qty} × ${sale.flavorName} · ${money(sale.totalCents)}`), node('small', details.join(' · ')));
    row.append(content);
    row.dataset.saleId = sale.id;
    return row;
  }

  function settleDebt(sale, method) {
    if (!PAID_METHODS.includes(method)) {
      toast('Selecione como o fiado foi pago.');
      return;
    }
    if (!confirm(`Confirmar o recebimento de ${money(sale.totalCents)} via ${METHODS[method]}?`)) return;
    apply(next => {
      const target = next.sales.find(item => item.id === sale.id);
      if (target.paid || target.canceledAt) throw Error('Este fiado já foi atualizado.');
      target.paid = true;
      target.receivedVia = method;
      target.paidAt = [timestamp(), target.time].sort().at(-1);
      return next;
    }, () => {
      render();
      $('debt-heading').focus();
      toast('Fiado quitado. O valor foi registrado nos recebimentos.');
    });
  }

  function renderDebts() {
    const area = $('debtList');
    const open = readFailure ? [] : state.sales.filter(sale => !sale.paid && !sale.canceledAt).reverse();
    area.replaceChildren();
    $('moreDebts').hidden = open.length <= debtLimit;
    if (!open.length && !readFailure) area.append(node('p', 'Nenhum fiado pendente.', 'empty'));
    for (const sale of open.slice(0, debtLimit)) {
      const row = saleRow(sale, sale.phone ? `Telefone ${sale.phone}` : 'Telefone ausente no registro antigo', dateFormatter.format(new Date(sale.time)));
      const controls = node('div', '', 'entry-controls');
      const methods = node('select');
      methods.setAttribute('aria-label', `Forma de quitação do fiado de ${sale.flavorName}`);
      const placeholder = node('option', 'Recebido via…');
      placeholder.value = '';
      methods.append(placeholder);
      for (const method of PAID_METHODS) {
        const option = node('option', METHODS[method]);
        option.value = method;
        methods.append(option);
      }
      const pay = button('Quitar fiado', () => settleDebt(sale, methods.value), `Quitar fiado de ${sale.flavorName}`);
      controls.append(methods, pay);
      row.append(controls);
      area.append(row);
    }
  }

  function cancelSale(sale) {
    const paymentNote = sale.paid ? ' Se houve pagamento, faça o estorno pelo meio utilizado antes de confirmar.' : '';
    if (!confirm(`Cancelar a venda e devolver as unidades ao estoque?${paymentNote}`)) return;
    apply(next => {
      const target = next.sales.find(item => item.id === sale.id);
      const flavor = next.flavors.find(item => item.id === target.flavorId) ||
        (target.legacy ? next.flavors.find(item => item.name === target.flavorName) : undefined);
      if (target.canceledAt || !flavor || flavor.qty + target.qty > MAX_QTY) {
        throw Error('Não foi possível devolver as unidades ao estoque.');
      }
      flavor.qty += target.qty;
      target.canceledAt = [timestamp(), target.paidAt || target.time].sort().at(-1);
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
    return sale.paid ? `Fiado quitado via ${METHODS[sale.receivedVia]}` : 'Fiado pendente';
  }

  function renderHistory() {
    const area = $('historyList');
    area.replaceChildren();
    $('moreSales').hidden = readFailure || state.sales.length <= historyLimit;
    if (readFailure) return;
    if (state.sales.length === 0) area.append(node('p', 'Nenhuma venda registrada.', 'empty'));
    for (const sale of state.sales.slice(-historyLimit).reverse()) {
      const row = saleRow(sale, dateFormatter.format(new Date(sale.time)), saleStatus(sale),
        `Preço/un. ${money(sale.unitPriceCents)}`, `Custo/un. ${money(sale.costUnitCents)}`,
        `Desconto ${money(sale.discountCents)}`);
      if (!sale.canceledAt) row.append(button('Cancelar venda', () => cancelSale(sale), `Cancelar venda de ${sale.flavorName}`));
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

  function exportCsv() {
    const from = $('dateFrom').value;
    const to = $('dateTo').value;
    if (from && to && from > to) {
      $('dateFrom').focus();
      toast('A data inicial deve ser anterior ou igual à final.');
      return;
    }
    const selected = state.sales.filter(sale => {
      const day = localDate(new Date(sale.time));
      return (!from || day >= from) && (!to || day <= to);
    });
    if (!selected.length) {
      toast('Nenhuma venda encontrada no período selecionado.');
      return;
    }
    const headers = [
      'ID da venda', 'Data', 'Hora', 'Sabor', 'Quantidade', 'Preço unitário (R$)', 'Custo unitário (R$)',
      'Desconto aplicado (R$)', 'Valor original (R$)', 'Receita bruta (R$)', 'Custo dos produtos vendidos (R$)',
      'Lucro bruto (R$)', 'Recebido (R$)', 'A receber (R$)', 'Forma original', 'Situação', 'Recebido via',
      'Telefone fiado', 'Data do recebimento', 'Data do cancelamento'
    ];
    const asDecimal = cents => decimal(cents).replace('.', ',');
    const formatTime = date => date ? dateFormatter.format(new Date(date)) : '';
    const rows = selected.map(sale => {
      const time = new Date(sale.time);
      const gross = sale.canceledAt ? 0 : sale.totalCents;
      const cost = sale.canceledAt ? 0 : sale.qty * sale.costUnitCents;
      return [
        csvCell(sale.id, true), csvCell(localDate(time)), csvCell(timeFormatter.format(time)), csvCell(sale.flavorName, true),
        ...[sale.qty, asDecimal(sale.unitPriceCents), asDecimal(sale.costUnitCents), asDecimal(sale.discountCents),
          asDecimal(sale.totalCents), asDecimal(gross), asDecimal(cost), asDecimal(gross - cost),
          asDecimal(sale.paid ? gross : 0), asDecimal(sale.paid ? 0 : gross), METHODS[sale.method],
          sale.canceledAt ? 'Cancelada' : sale.paid ? 'Pago' : 'Pendente', METHODS[sale.receivedVia]].map(value => csvCell(value)),
        csvCell(sale.phone, true), csvCell(formatTime(sale.paidAt)), csvCell(formatTime(sale.canceledAt))
      ].join(';');
    });
    const csv = '\ufeff' + [headers.map(value => csvCell(value)).join(';'), ...rows].join('\r\n');
    const period = `${from || 'inicio'}_a_${to || 'fim'}`;
    download(csv, `vendas-loja-gigi_${period}.csv`, 'text/csv;charset=utf-8');
    toast(`${selected.length} registro(s) exportado(s) em CSV.`);
  }

  function exportJson() {
    if (readFailure) {
      if (savedSnapshot?.raw != null) {
        download(savedSnapshot.raw, `recuperacao-loja-gigi_${localDate()}.txt`, 'text/plain;charset=utf-8');
        toast('Cópia dos dados locais baixada para recuperação.');
      }
      return;
    }
    const payload = { app: APP, version: VERSION, exportedAt: timestamp(), state };
    download(JSON.stringify(payload), `backup-loja-gigi_${localDate()}.json`, 'application/json;charset=utf-8');
    toast('Backup baixado. Guarde-o em local seguro.');
  }

  function validateBackup(data) {
    if (data?.version === 4 && !Object.hasOwn(data, 'app') && !Object.hasOwn(data, 'state')) {
      return migrate(data, 4, state.profile);
    }
    if (!hasKeys(data, ['app', 'version', 'exportedAt', 'state']) || data.app !== APP || !validTime(data.exportedAt)) {
      throw Error('O arquivo precisa ser um backup da Loja da Gigi.');
    }
    if (data.version === 4) return migrate(data.state, 4, state.profile);
    if (data.version !== VERSION) throw Error('A versão do backup é incompatível.');
    return validateState(data.state);
  }

  function previewRestore(replacement, reset = false) {
    if (!savedSnapshot) {
      toast('O armazenamento local está indisponível. Habilite-o e recarregue a página.');
      return;
    }
    const word = reset ? 'APAGAR' : 'RESTAURAR';
    pendingRestore = { replacement, word };
    $('restoreHeading').textContent = reset ? 'Restaurar dados iniciais' : 'Restaurar backup';
    const incoming = reset ? 'O estoque voltará aos 13 sabores iniciais e o histórico será apagado.' :
      `O arquivo tem ${replacement.flavors.length} sabor(es) e ${replacement.sales.length} registro(s) de venda.`;
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
      const replacement = validateBackup(data);
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
    render({ resetPrice: true, resetSettings: true });
    $('saleForm').addEventListener('submit', handleSale);
    $('settingsForm').addEventListener('submit', updateSettings);
    $('addForm').addEventListener('submit', addOrEditFlavor);
    $('editForm').addEventListener('submit', addOrEditFlavor);
    $('closeEdit').addEventListener('click', () => $('editDialog').close());
    $('saleFlavor').addEventListener('change', setSalePrice);
    for (const key of ['saleQty', 'salePrice', 'saleDiscount']) $(key).addEventListener('input', calculateSale);
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
    $('dateFrom').value = $('dateTo').value = localDate();
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
      if (event.key === STORE || event.key === null ||
          (savedSnapshot?.key !== STORE && (event.key === OLD_PROFILE || OLD_STORES.includes(event.key)))) {
        showNotice('Os dados mudaram em outra aba. Recarregue a página antes de editar ou exportar.');
      }
    });
    if (!readFailure && !state.profile) $('profileDialog').showModal();
  }

  init();
})();
