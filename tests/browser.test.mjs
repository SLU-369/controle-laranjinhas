import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

const files = {
  '': ['index.html', 'text/html'],
  'style.css': ['style.css', 'text/css'],
  'script.js': ['script.js', 'application/javascript'],
  'finance.js': ['finance.js', 'application/javascript']
};
const key = 'loja-gigi-v5';
const brazilianPhone = '(11) 0000-0000';
function signBackup(payload) {
  const content = JSON.stringify([payload.app, payload.version, payload.exportedAt, payload.state]);
  return { ...payload, sha256: createHash('sha256').update(content).digest('hex') };
}
const browserCandidates = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

async function until(read, predicate, label) {
  const deadline = Date.now() + 6000;
  do {
    const value = await read();
    if (predicate(value)) return value;
    await delay(40);
  } while (Date.now() < deadline);
  assert.fail(`Tempo esgotado aguardando ${label}.`);
}

async function startSite() {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const asset = path.startsWith('/controle-laranjinhas/') && files[path.slice('/controle-laranjinhas/'.length)];
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    const [name, type] = asset;
    response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
    response.end(await readFile(new URL(`../${name}`, import.meta.url)));
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/controle-laranjinhas/` };
}

async function connect(endpoint) {
  const socket = new WebSocket(endpoint);
  const pending = new Map();
  const handlers = new Map();
  let sequence = 0;
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', event => reject(event.error ?? Error(`Não foi possível conectar ao Chromium por ${endpoint}.`)), { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const callback = pending.get(message.id);
      if (!callback) return;
      pending.delete(message.id);
      if (message.error) callback.reject(Error(message.error.message));
      else callback.resolve(message.result);
    } else {
      handlers.get(message.method)?.(message.params);
    }
  });
  socket.addEventListener('close', () => {
    for (const callback of pending.values()) callback.reject(Error('Navegador desconectado.'));
    pending.clear();
  });

  function send(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  return { send, on: (method, handler) => handlers.set(method, handler), close: () => socket.close() };
}

async function openPage(port, directory) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  assert.ok(response.ok);
  const page = await response.json();
  const client = await connect(page.webSocketDebuggerUrl);
  const errors = [];
  client.on('Runtime.exceptionThrown', event => {
    errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text);
  });
  client.on('Page.javascriptDialogOpening', () => {
    client.send('Page.handleJavaScriptDialog', { accept: true }).catch(error => errors.push(error.message));
  });
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: directory });

  async function evaluate(expression) {
    const result = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }

  const selector = id => `document.getElementById(${JSON.stringify(id)})`;
  const text = id => evaluate(`${selector(id)}.textContent`);
  const click = id => evaluate(`${selector(id)}.click()`);
  async function fill(id, value) {
    await evaluate(`{
      const field = ${selector(id)};
      field.value = ${JSON.stringify(String(value))};
      for (const type of ['input', 'change']) field.dispatchEvent(new Event(type, { bubbles: true }));
    }`);
  }
  const submit = id => evaluate(`${selector(id)}.requestSubmit()`);
  const snapshot = () => evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);
  function waitForText(id, snippet) {
    return until(() => text(id), value => value.includes(snippet), `${id} conter "${snippet}"`);
  }
  async function navigate(url) {
    await client.send('Page.navigate', { url });
    await until(() => evaluate('document.readyState === "complete" && !!document.querySelector("#flavorGrid > *") || document.readyState === "complete" && !!document.querySelector("#storageNotice:not([hidden])")')
      .catch(() => false), Boolean, 'a aplicação inicializar');
  }
  async function loadBackup(payload) {
    await evaluate(`{
      const data = new DataTransfer();
      data.items.add(new File([${JSON.stringify(JSON.stringify(payload))}], 'teste.json', {type: 'application/json'}));
      const field = ${selector('importJson')};
      field.files = data.files;
      field.dispatchEvent(new Event('change', {bubbles: true}));
    }`);
  }
  return { client, errors, evaluate, text, click, fill, submit, snapshot, waitForText, navigate, loadBackup };
}

test('Loja da Gigi no Chromium', { timeout: 90000 }, async t => {
  const executable = browserCandidates.find(path => path && existsSync(path));
  assert.ok(executable, 'Instale o Edge ou Chrome ou defina BROWSER_PATH.');
  const directory = await mkdtemp(join(tmpdir(), 'loja-gigi-test-'));
  const site = process.env.LOJA_TEST_URL ? { url: process.env.LOJA_TEST_URL } : await startSite();
  const profile = join(directory, 'profile');
  const browser = spawn(executable, [
    '--headless=new', '--disable-background-networking', '--disable-extensions', '--no-first-run',
    '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  let browserClosed;
  const pages = [];
  const browserExit = new Promise(resolve => {
    browser.on('exit', resolve);
    browser.on('error', error => { browserClosed = error; resolve(); });
  });
  let browserClient;
  t.after(async () => {
    if (browserClient) await browserClient.send('Browser.close').catch(() => {});
    else browser.kill();
    for (const page of pages) page.client.close();
    browserClient?.close();
    await Promise.race([browserExit, delay(1500, undefined, { ref: false })]);
    site.server?.closeAllConnections();
    site.server?.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  });

  const activePort = await until(async () => {
    if (browserClosed) throw browserClosed;
    return readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
  }, value => value.includes('/devtools/browser/'), 'o Chromium iniciar');
  const [port, browserPath] = activePort.trim().split(/\r?\n/u);
  browserClient = await connect(`ws://127.0.0.1:${port}${browserPath}`);
  const page = await openPage(port, directory);
  pages.push(page);
  await page.navigate(site.url);
  const { evaluate, click, fill, text, submit, waitForText, snapshot, loadBackup } = page;
  const brl = value => value.replace(/\s/gu, ' ');
  const metric = async (id, expected) => assert.equal(brl(await text(id)), `R$ ${expected}`);
  let flavorId;
  let backup;

  async function download(prefix, extension) {
    const name = await until(() => readdir(directory), names => names.some(item => item.startsWith(prefix) && item.endsWith(extension)), prefix);
    return readFile(join(directory, name.find(item => item.startsWith(prefix) && item.endsWith(extension))), 'utf8');
  }

  await t.test('carrega recursos relativos, respeita toque, foco e movimento reduzido', async () => {
    assert.equal(await text('units'), '26');
    await metric('stockGross', '208,00');
    await metric('stockCost', '78,00');
    assert.equal(await evaluate('document.activeElement.id'), 'chooseSamuel');
    assert.equal(await evaluate('document.styleSheets.length'), 1);
    await click('chooseGiovanna');
    await waitForText('greeting', 'Olá, Giovanna!');
    for (const width of [320, 390, 768]) {
      await page.client.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: true });
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    }
    await page.client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".hero")).animationName'), 'none');
    assert.ok(await evaluate('document.querySelector("#saleForm button").getBoundingClientRect().height >= 44'));
    await page.client.send('Emulation.clearDeviceMetricsOverride');
  });

  await t.test('cadastra, renomeia e repõe sabores sem gravar estoque negativo', async () => {
    await fill('newName', '=1+1 "A"; <b>');
    await fill('newQty', '-2');
    await submit('addForm');
    assert.equal((await snapshot()).flavors.length, 13);
    await fill('newQty', '6');
    await fill('newPrice', '8.25');
    await submit('addForm');
    await waitForText('toast', 'cadastrado');
    flavorId = (await snapshot()).flavors.at(-1).id;
    assert.equal(await evaluate('document.querySelector("#flavorGrid b") === null'), true);
    await click(`edit-${flavorId}`);
    assert.equal(await evaluate('document.activeElement.id'), 'editName');
    await fill('editName', '=1+1 "B"; <b>');
    await fill('editQty', '5');
    await submit('editForm');
    await waitForText('toast', 'Sabor atualizado');
    assert.equal(await evaluate('document.activeElement.id'), `edit-${flavorId}`);
    await click(`add-${flavorId}`);
    await waitForText('toast', 'adicionada');
    assert.deepEqual((await snapshot()).flavors.at(-1), { id: flavorId, name: '=1+1 "B"; <b>', qty: 6, priceCents: 825 });
  });

  await t.test('registra venda, desconto e fiado com preços e custos históricos', async () => {
    await fill('saleFlavor', flavorId);
    await fill('saleQty', '7');
    await submit('saleForm');
    assert.equal((await snapshot()).sales.length, 0);
    await fill('saleQty', '2');
    await fill('salePrice', '9.15');
    await submit('saleForm');
    await waitForText('toast', 'Venda registrada');
    await metric('soldValue', '18,30');
    await metric('pixValue', '18,30');

    await fill('defaultPrice', '8.50');
    await fill('unitCost', '3.50');
    await submit('settingsForm');
    await waitForText('toast', 'Valores padrão salvos');
    assert.equal(await evaluate('document.querySelector("#salePrice").value'), '8.25');
    await fill('saleQty', '3');
    await fill('salePrice', '10');
    await fill('saleDiscount', '7.30');
    await fill('saleMethod', 'fiado');
    await fill('salePhone', '123');
    await submit('saleForm');
    await waitForText('toast', 'telefone com DDD');
    assert.equal((await snapshot()).sales.length, 1);
    await fill('salePhone', brazilianPhone);
    await fill('saleDiscount', '30');
    await submit('saleForm');
    await waitForText('toast', 'menor que o subtotal');
    await fill('saleDiscount', '7.30');
    await submit('saleForm');
    await waitForText('toast', 'Venda registrada');
    assert.deepEqual((await snapshot()).sales.map(sale => {
      const [item] = sale.items;
      return [item.unitPriceCents, item.costUnitCents, item.discountCents, sale.totalCents];
    }),
      [[915, 300, 0, 1830], [1000, 350, 730, 2270]]);
    await metric('soldValue', '41,00');
    await metric('soldCost', '16,50');
    await metric('profitValue', '24,50');
    await metric('receivedValue', '18,30');
    await metric('dueValue', '22,70');
  });

  await t.test('quita fiado, persiste após recarga e exporta CSV por dia', async () => {
    await evaluate('document.querySelector("#debtList button").click()');
    await waitForText('toast', 'Selecione como o fiado foi pago');
    await evaluate('document.querySelector("#debtList select").value = "debit"; document.querySelector("#debtList button").click()');
    await waitForText('toast', 'Fiado quitado');
    await metric('soldValue', '41,00');
    await metric('receivedValue', '41,00');
    await metric('dueValue', '0,00');
    await metric('debitValue', '22,70');
    const before = await snapshot();
    await page.navigate(site.url);
    assert.deepEqual(await snapshot(), before);
    assert.equal(await text('greeting'), 'Olá, Giovanna!');
    const storedWithOldName = JSON.stringify({ ...before, profile: 'Giovana' });
    await evaluate(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(storedWithOldName)})`);
    await page.navigate(site.url);
    assert.equal(await text('greeting'), 'Olá, Giovanna!');
    assert.equal(await evaluate('document.getElementById("userChoice").value'), 'Giovanna');
    await fill('userChoice', 'Giovanna');
    await waitForText('toast', 'Nome salvo');
    assert.deepEqual(await snapshot(), before);
    assert.equal(await evaluate('document.querySelector("#debtList button") === null'), true);

    const date = await evaluate('document.getElementById("dateFrom").value');
    await fill('dateFrom', '2000-01-01');
    await fill('dateTo', '2000-01-01');
    await click('exportCsv');
    await waitForText('toast', 'Nenhuma venda encontrada');
    await fill('dateFrom', date);
    await click('exportCsv');
    await waitForText('toast', 'data inicial');
    await fill('dateTo', date);
    await click('exportCsv');
    const csv = await download('vendas-loja-gigi', '.csv');
    assert.equal(csv.codePointAt(0), 0xfeff);
    assert.equal(csv.split('\r\n').length, 5);
    assert.ok(csv.includes(`"'${'=1+1 ""B""; <b>'}"`));
    assert.match(csv, /"22,70";"Fiado";"Fiado quitado";"Débito"/u);
    const dateSuffix = date + '_a_' + date;
    assert.ok((await readdir(directory)).includes('vendas-loja-gigi_' + dateSuffix + '.csv'));
  });

  await t.test('recusa backup inválido, protege a substituição e restaura sem duplicar', async () => {
    await click('exportJson');
    backup = JSON.parse(await download('backup-loja-gigi', '.json'));
    assert.deepEqual(backup.state, await snapshot());

    const invalid = [
      { ...backup, app: 'outro-app' },
      { ...backup, state: { ...backup.state, sales: [...backup.state.sales, backup.state.sales[0]] } },
      { ...backup, state: { ...backup.state, sales: [{ ...backup.state.sales[0], totalCents: 1 }] } },
      { ...backup, state: { ...backup.state, sales: [{ ...backup.state.sales[1], phone: '' }] } },
      { ...backup, state: { ...backup.state, flavors: [{ ...backup.state.flavors[0], qty: -1 }] } }
    ];
    for (const payload of invalid) {
      await evaluate('document.getElementById("toast").textContent = ""');
      await loadBackup(signBackup(payload));
      await waitForText('toast', 'Importação recusada');
      assert.equal(await evaluate('document.getElementById("restoreDialog").open'), false);
      assert.deepEqual(await snapshot(), backup.state);
    }

    await click(`add-${flavorId}`);
    await waitForText('toast', 'adicionada');
    await loadBackup(backup);
    await waitForText('restoreDetails', '2 registro(s)');
    await fill('restoreInput', 'ERRADO');
    assert.equal(await evaluate('document.getElementById("applyRestore").disabled'), true);
    await click('closeRestore');
    assert.equal((await snapshot()).flavors.at(-1).qty, 2);

    const backupWithOldName = signBackup({ ...backup, state: { ...backup.state, profile: 'Giovana' } });
    for (const source of [backupWithOldName, backup]) {
      await evaluate('document.getElementById("toast").textContent = ""');
      await loadBackup(source);
      await until(() => evaluate('document.getElementById("restoreDialog").open'), Boolean, 'a prévia do backup');
      await fill('restoreInput', 'RESTAURAR');
      await submit('restoreForm');
      await waitForText('toast', 'Backup restaurado');
      assert.deepEqual(await snapshot(), backup.state);
    }
  });

  await t.test('registra crédito, cancela com trilha e não altera saldo se a gravação falha', async () => {
    await fill('saleFlavor', flavorId);
    await fill('saleMethod', 'credit');
    await fill('salePrice', '2.49');
    await evaluate(`{
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === ${JSON.stringify(key)}) throw new DOMException("Simulado", "QuotaExceededError");
        return original.call(this, name, value);
      };
      globalThis.restoreStorage = () => { Storage.prototype.setItem = original; };
    }`);
    await submit('saleForm');
    await waitForText('toast', 'Não foi possível gravar');
    await metric('soldValue', '41,00');
    assert.deepEqual(await snapshot(), backup.state);
    await evaluate('restoreStorage()');

    await submit('saleForm');
    await waitForText('toast', 'Venda registrada');
    await metric('creditValue', '2,49');
    await metric('profitValue', '23,49');
    await evaluate('document.querySelector("#historyList button").click()');
    await waitForText('toast', 'Venda cancelada');
    assert.equal((await snapshot()).sales.length, 3);
    assert.ok((await snapshot()).sales.at(-1).canceledAt);
    assert.equal((await snapshot()).flavors.at(-1).qty, 1);
    await metric('soldValue', '41,00');
    await metric('creditValue', '0,00');
    await click('reset');
    await fill('restoreInput', 'RESTAURAR');
    assert.equal(await evaluate('document.getElementById("applyRestore").disabled'), true);
    await click('closeRestore');
  });

  await t.test('impede gravação sobre uma versão mais recente em outra aba', async () => {
    const other = await openPage(port, directory);
    pages.push(other);
    await other.navigate(site.url);
    await click(`add-${flavorId}`);
    await waitForText('toast', 'adicionada');
    await other.waitForText('storageNotice', 'outra aba');
    await other.click(`add-${flavorId}`);
    await other.waitForText('toast', 'Recarregue');
    assert.equal((await snapshot()).flavors.at(-1).qty, 2);
  });

  await t.test('migra histórico v2 e v3 locais, importa v4 e protege dados locais ilegíveis', async () => {
    await evaluate(`{
      localStorage.clear();
      localStorage.setItem('laranjinhas-estoque-vendas-v2', JSON.stringify({
        stock: Array(13).fill(1),
        sales: [{ id: 'v2-sale', flavorIndex: 0, method: 'card', time: Date.now() }]
      }));
      localStorage.setItem('loja-gigi-profile', 'Samuel');
    }`);
    await page.navigate(site.url);
    assert.equal(await text('units'), '13');
    await metric('receivedValue', '8,00');
    await metric('unknownValue', '8,00');

    await evaluate(`{
      localStorage.clear();
      localStorage.setItem('laranjinhas-estoque-vendas-v3', JSON.stringify({
        flavors: [{ id: 'v3-flavor', name: 'Sabor antigo', qty: 2 }],
        sales: [{ id: 'v3-sale', flavorId: 'v3-flavor', flavorName: 'Sabor antigo', method: 'fiado', paid: true, time: new Date().toISOString() }]
      }));
      localStorage.setItem('loja-gigi-profile', 'Samuel');
    }`);
    await page.navigate(site.url);
    await metric('unknownValue', '8,00');
    await metric('soldCost', '3,00');
    assert.equal(await text('greeting'), 'Olá, Samuel!');

    const time = '2026-01-01T12:00:00.000Z';
    const oldBackup = {
      app: 'loja-da-gigi', version: 4, exportedAt: time,
      state: {
        version: 4, settings: { defaultPriceCents: 900, unitCostCents: 300 },
        flavors: [{ id: 'old-flavor', name: 'Sabor antigo', qty: 4, priceCents: 900 }],
        sales: [{
          id: 'old-sale', flavorId: 'old-flavor', flavorName: 'Sabor antigo', qty: 1,
          unitPriceCents: 900, costUnitCents: 300, totalCents: 900, method: 'cash', phone: '',
          paid: true, receivedVia: 'cash', paidAt: time, time
        }]
      }
    };
    await loadBackup(oldBackup);
    await until(() => evaluate('document.getElementById("restoreDialog").open'), Boolean, 'backup v4 validado');
    await fill('restoreInput', 'RESTAURAR');
    await submit('restoreForm');
    await waitForText('toast', 'Backup restaurado');
    assert.equal((await snapshot()).sales[0].id, 'old-sale');
    await metric('cashValue', '9,00');

    await evaluate(`localStorage.setItem(${JSON.stringify(key)}, '{arquivo corrompido')`);
    await page.navigate(site.url);
    await waitForText('storageNotice', 'não puderam ser lidos');
    assert.equal(await evaluate('document.getElementById("saleForm").inert'), true);
    await click('exportJson');
    assert.equal(await download('recuperacao-loja-gigi', '.txt'), '{arquivo corrompido');
    await loadBackup(backup);
    await until(() => evaluate('document.getElementById("restoreDialog").open'), Boolean, 'a prévia de recuperação');
    await fill('restoreInput', 'RESTAURAR');
    await submit('restoreForm');
    await waitForText('toast', 'Backup restaurado');
    assert.deepEqual(await snapshot(), backup.state);
  });

  await t.test('aplica três faixas de promoção em vários sabores e aceita total manual acima da faixa', async () => {
    await click('reset');
    await fill('restoreInput', 'APAGAR');
    await submit('restoreForm');
    await waitForText('toast', 'Dados iniciais restaurados');
    await fill('salePricing', 'promo');
    await metric('saleTotal', '15,00');
    await fill('saleQty', '2');
    await metric('saleTotal', '26,00');
    await fill('saleQty', '1');
    await click('addSaleItem');
    await evaluate(`{
      const item = document.querySelector('#saleItems').lastElementChild;
      const flavor = item.querySelector('[data-flavor]');
      flavor.value = 'initial-3';
      flavor.dispatchEvent(new Event('change', { bubbles: true }));
      const qty = item.querySelector('[data-qty]');
      qty.id = 'testExtraQty';
    }`);
    await fill('testExtraQty', '2');
    await metric('saleTotal', '30,00');
    assert.match(brl(await text('saleBreakdown')), /3 un.*R\$ 10,00\/un.*R\$ 15,00/u);
    assert.match(brl(await text('saleProfit')), /R\$ 21,00/u);
    await fill('testExtraQty', '3');
    await submit('saleForm');
    await waitForText('toast', 'até 3 unidades');
    assert.equal((await snapshot()).sales.length, 0);

    await fill('testExtraQty', '2');
    await submit('saleForm');
    await waitForText('toast', 'Venda registrada');
    const first = (await snapshot()).sales[0];
    assert.equal(first.totalCents, 3000);
    assert.deepEqual(first.items.map(({ flavorId, qty, costUnitCents, discountCents }) => [flavorId, qty, costUnitCents, discountCents]),
      [['initial-1', 1, 300, 500], ['initial-3', 2, 300, 1000]]);
    assert.deepEqual((await snapshot()).flavors.slice(0, 3).map(flavor => flavor.qty), [1, 1, 3]);

    await click('addSaleItem');
    await evaluate(`{
      const item = document.querySelector('#saleItems').lastElementChild;
      const flavor = item.querySelector('[data-flavor]');
      flavor.value = 'initial-3';
      flavor.dispatchEvent(new Event('change', { bubbles: true }));
      item.querySelector('[data-qty]').id = 'testExtraQty';
    }`);
    await fill('testExtraQty', '3');
    await fill('salePricing', 'total');
    await fill('manualTotal', '33.01');
    await fill('saleDiscount', '1.02');
    await metric('saleTotal', '31,99');
    await submit('saleForm');
    await waitForText('toast', '31,99');
    const second = (await snapshot()).sales[1];
    assert.equal(second.totalCents, 3199);
    assert.equal(second.items.reduce((sum, item) => sum + item.subtotalCents, 0), 3301);
    assert.equal(second.items.reduce((sum, item) => sum + item.discountCents, 0), 102);
    await metric('soldValue', '61,99');
    await metric('soldCost', '21,00');
    await metric('profitValue', '40,99');
    assert.equal(await text('reportQty'), '7');
    assert.equal(await evaluate('document.querySelectorAll("#topFlavors meter").length'), 2);
    await evaluate('document.querySelector("#historyList button").click()');
    await waitForText('toast', 'Venda cancelada');
    assert.deepEqual((await snapshot()).flavors.slice(0, 3).map(flavor => flavor.qty), [1, 1, 3]);
    await metric('reportGross', '30,00');
  });

  await t.test('preserva IDs da v5 e lança pagamentos parciais no caixa pela data de recebimento', async () => {
    const time = '2021-05-10T12:00:00.000Z';
    const v5 = {
      version: 5, profile: 'Samuel', settings: { defaultPriceCents: 800, unitCostCents: 300 },
      flavors: [{ id: 'v5-flavor', name: 'Sabor de teste', qty: 4, priceCents: 800 }],
      sales: [{
        id: 'v5-sale', flavorId: 'v5-flavor', flavorName: 'Sabor de teste', qty: 2, unitPriceCents: 800,
        costUnitCents: 300, discountCents: 0, totalCents: 1600, method: 'fiado', phone: '1100000000',
        paid: false, receivedVia: null, paidAt: null, time, canceledAt: null, legacy: false
      }]
    };
    await evaluate('localStorage.setItem(' + JSON.stringify(key) + ', ' + JSON.stringify(JSON.stringify(v5)) + ')');
    await page.navigate(site.url);
    assert.equal((await snapshot()).version, 5);
    await metric('soldValue', '16,00');
    assert.match(await text('debtList'), /Saldo pendente/u);
    await loadBackup({ app: 'loja-da-gigi', version: 5, exportedAt: time, state: v5 });
    await until(() => evaluate('document.getElementById("restoreDialog").open'), Boolean, 'backup v5 validado');
    await fill('restoreInput', 'RESTAURAR');
    await submit('restoreForm');
    await waitForText('toast', 'Backup restaurado');
    assert.equal((await snapshot()).sales[0].id, 'v5-sale');

    await evaluate(`{
      document.querySelector('#debtList select').value = 'debit';
      document.querySelector('#debtList input').value = '16.01';
      document.querySelector('#debtList button').click();
    }`);
    assert.equal((await snapshot()).sales[0].payments.length, 0);
    await evaluate(`{
      document.querySelector('#debtList input').value = '5';
      document.querySelector('#debtList button').click();
    }`);
    await waitForText('toast', 'Pagamento registrado');
    await metric('receivedValue', '5,00');
    await metric('dueValue', '11,00');
    await metric('reportGross', '0,00');
    await metric('reportDebit', '5,00');
    await metric('reportEarlier', '5,00');
    await metric('reportDue', '11,00');
    assert.match(brl(await text('debtList')), /Débito.*R\$ 5,00/u);

    await evaluate(`{
      document.querySelector('#debtList select').value = 'pix';
      document.querySelector('#debtList button').click();
    }`);
    await waitForText('toast', 'Fiado quitado');
    await metric('soldValue', '16,00');
    await metric('reportReceived', '16,00');
    await metric('reportPix', '11,00');
    await metric('reportDue', '0,00');
    assert.deepEqual((await snapshot()).sales.map(sale => [sale.id, sale.payments.length]), [['v5-sale', 2]]);
    assert.match(await text('historyList'), /Recebimentos \(2\)/u);

    await fill('dateFrom', '2021-05-10');
    await fill('dateTo', '2021-05-10');
    await metric('reportGross', '16,00');
    await metric('reportReceived', '0,00');
    await metric('reportCost', '6,00');
    await metric('reportProfit', '10,00');
    await metric('reportDue', '16,00');
    const oldDay = await evaluate(`document.getElementById('reportPeriod').value`);
    assert.equal(oldDay, 'custom');
    await fill('reportPeriod', 'week');
    const weekRange = await evaluate(`['dateFrom', 'dateTo'].map(id => document.getElementById(id).value)`);
    assert.equal(new Date(weekRange[0] + 'T12:00:00Z').getUTCDay(), 1);
    assert.equal(new Date(weekRange[1] + 'T12:00:00Z').getUTCDay(), 0);
    await fill('reportPeriod', 'month');
    assert.match(await evaluate(`document.getElementById('dateFrom').value`), /-01$/u);
    await fill('reportPeriod', 'today');
    const today = await evaluate(`document.getElementById('dateTo').value`);
    await fill('dateFrom', '2021-05-11');
    await fill('dateTo', today);
    await page.client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
    await click('exportCsv');
    const csv = await download('vendas-loja-gigi_2021-05-11_a_' + today, '.csv');
    const rows = csv.split('\r\n').slice(1);
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.startsWith('"v5-sale/pagamento/') && row.includes('"Recebimento"') && row.includes('"2021-05-10"')));
    assert.deepEqual(rows.map(row => row.split(';')[0]),
      (await snapshot()).sales[0].payments.map(payment => '"v5-sale/pagamento/' + payment.id + '"'));
    assert.ok(rows.some(row => row.includes('"5,00";"Fiado";"Fiado quitado";"Débito"')));
    assert.ok(rows.some(row => row.includes('"11,00";"Fiado";"Fiado quitado";"Pix"')));
    await page.client.send('Emulation.clearDeviceMetricsOverride');
  });

  await t.test('registra nome opcional, data do backup e rejeita conteúdo alterado mesmo com estrutura válida', async () => {
    await fill('saleMethod', 'fiado');
    await fill('saleBuyer', 'Contato de teste');
    await fill('salePhone', brazilianPhone);
    await submit('saleForm');
    await waitForText('toast', 'Venda registrada');
    assert.equal((await snapshot()).sales.at(-1).buyer, 'Contato de teste');
    assert.match(await text('debtList'), /Contato de teste/u);
    const filesBefore = await readdir(directory);
    await click('exportJson');
    await waitForText('lastBackup', 'Último download de backup iniciado em');
    const filename = await until(async () => (await readdir(directory)).find(name => /^backup-loja-gigi_\d{4}-\d\d-\d\d_\d{6}-\d{3}\.json$/u.test(name) &&
      !filesBefore.includes(name)), Boolean, 'o arquivo JSON com data e hora');
    const current = JSON.parse(await readFile(join(directory, filename), 'utf8'));
    assert.equal(current.version, 6);
    assert.match(current.sha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(current.state, await snapshot());
    const modified = structuredClone(current);
    modified.state.settings.unitCostCents++;
    await loadBackup(modified);
    await waitForText('toast', 'verificação de integridade');
    assert.deepEqual(await snapshot(), current.state);

    const overpaid = structuredClone(current);
    overpaid.state.sales[0].payments[0].amountCents++;
    await loadBackup(signBackup(overpaid));
    await waitForText('toast', 'venda inválida');
    assert.deepEqual(await snapshot(), current.state);
    await page.navigate(site.url);
    assert.match(await text('lastBackup'), /Último download/u);
  });

  assert.deepEqual(pages.flatMap(item => item.errors), []);
});
