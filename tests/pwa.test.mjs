import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { until, openPage, startBrowser, startSite } from './browser-helpers.mjs';

const network = offline => ({ offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
const release = page => page.evaluate('document.querySelector("meta[name=test-release]").content');
const cacheNames = page => page.evaluate('caches.keys()');

async function ready(page) {
  await page.waitForText('pwaStatus', 'Pronto para usar sem internet');
}

async function finishUpdateAttempt(page) {
  await page.evaluate('navigator.serviceWorker.getRegistration().then(reg => reg.update())');
  await until(() => page.evaluate('navigator.serviceWorker.getRegistration().then(reg => !reg.installing)'),
    Boolean, 'a tentativa de instalar uma versão');
}

test('PWA da Loja da Gigi', { timeout: 120000 }, async t => {
  const site = await startSite();
  const { port, directory, pages, browserClient } = await startBrowser(t, site);
  const downloads = [];
  await browserClient.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory, eventsEnabled: true });
  browserClient.on('Browser.downloadProgress', event => downloads.push(event));
  async function open() {
    const item = await openPage(port, directory);
    pages.push(item);
    return item;
  }
  async function close(item) {
    await browserClient.send('Target.closeTarget', { targetId: item.targetId });
  }
  let page = await open();
  await page.navigate(site.url);
  await page.click('chooseSamuel');
  await ready(page);
  await page.navigate(site.url);

  await t.test('o navegador reconhece manifesto, ícones, instalação e escopo no subdiretório', async () => {
    const result = await page.client.send('Page.getAppManifest');
    assert.deepEqual(result.errors, []);
    const manifest = JSON.parse(result.data);
    assert.equal(manifest.name, 'Loja da Gigi');
    assert.equal(manifest.display, 'standalone');
    for (const key of ['id', 'start_url', 'scope']) assert.equal(new URL(manifest[key], result.url).href, site.url);
    const errors = await page.client.send('Page.getInstallabilityErrors');
    assert.deepEqual(errors.installabilityErrors, []);
    assert.equal(await page.evaluate('navigator.serviceWorker.controller !== null'), true);
    assert.equal(await page.evaluate('navigator.serviceWorker.getRegistration().then(reg => reg.scope)'), site.url);
    for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512], ['apple-touch-icon.png', 180]]) {
      const bytes = await readFile(new URL(`../icons/${name}`, import.meta.url));
      assert.equal(bytes.readUInt32BE(16), size);
      assert.equal(bytes.readUInt32BE(20), size);
      assert.equal(await page.evaluate(`new Promise((resolve, reject) => {
        const img = new Image(); img.onload = () => resolve(img.naturalWidth);
        img.onerror = reject; img.src = ${JSON.stringify(`icons/${name}`)};
      })`), size);
    }
    const names = await cacheNames(page);
    assert.equal(names.length, 1);
    assert.ok(names[0].endsWith(':1.2.0'));
    const entries = await page.evaluate('caches.keys().then(names => caches.open(names[0])).then(cache => cache.keys()).then(keys => keys.map(key => new URL(key.url).pathname))');
    assert.equal(entries.length, 10);
    assert.ok(entries.every(path => path.startsWith('/controle-laranjinhas/')));
    assert.ok(!entries.some(path => /backup|service-worker|tests/u.test(path)));
    assert.equal((await fetch(site.url + 'arquivo-inexistente.js')).status, 404);
  });

  await t.test('instalação exige gesto, aceita recusa e oculta a oferta após instalar', async subtest => {
    await page.evaluate(`{
      const event = new Event('beforeinstallprompt', { cancelable: true });
      globalThis.promptCalls = 0;
      event.prompt = async () => { globalThis.promptCalls++; };
      event.userChoice = Promise.resolve({ outcome: 'dismissed' });
      dispatchEvent(event);
      globalThis.installPrevented = event.defaultPrevented;
    }`);
    assert.equal(await page.evaluate('promptCalls'), 0);
    assert.equal(await page.evaluate('installPrevented'), true);
    assert.equal(await page.evaluate('document.getElementById("installApp").hidden'), false);
    await page.click('installApp');
    await until(() => page.evaluate('document.getElementById("installApp").hidden'), Boolean, 'a recusa da instalação');
    assert.equal(await page.evaluate('promptCalls'), 1);
    await page.evaluate('dispatchEvent(new Event("appinstalled"))');
    assert.equal(await page.evaluate('document.getElementById("installHelp").hidden'), true);
    await page.navigate(site.url);

    const ios = await open();
    subtest.after(() => close(ios).catch(() => {}));
    await ios.client.send('Page.addScriptToEvaluateOnNewDocument', { source:
      'Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" });' });
    await ios.navigate(site.url);
    await ready(ios);
    assert.match(await ios.text('installInstructions'), /Safari.*Compartilhar.*Adicionar à Tela de Início/u);
    assert.equal(await ios.evaluate('document.getElementById("installHelp").hidden'), false);
    await ios.client.send('Page.addScriptToEvaluateOnNewDocument', { source:
      'Object.defineProperty(navigator, "standalone", { value: true });' });
    await ios.navigate(site.url);
    await until(() => ios.evaluate('document.getElementById("installHelp").hidden'), Boolean, 'a oferta desaparecer no modo instalado');
  });

  await t.test('mantém instalação e instruções acessíveis em telas estreitas e no computador', async () => {
    for (const width of [320, 390, 768, 1280]) {
      await page.client.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await page.evaluate('document.getElementById("installHelp").open = true');
      assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
      assert.equal(await page.evaluate('document.querySelector("#installHelp summary").getBoundingClientRect().height >= 44'), true);
      if (process.env.LOJA_SCREENSHOT_DIR && [390, 1280].includes(width)) {
        await mkdir(process.env.LOJA_SCREENSHOT_DIR, { recursive: true });
        const screenshot = await page.client.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(join(process.env.LOJA_SCREENSHOT_DIR, `pwa-${width}.png`), Buffer.from(screenshot.data, 'base64'));
      }
    }
    await page.evaluate('document.getElementById("installHelp").open = false');
    await page.client.send('Emulation.clearDeviceMetricsOverride');
  });

  await t.test('abre offline e registra estoque, fiado, recebimento, cancelamento, relatórios e backups', async subtest => {
    subtest.after(() => {
      site.state.offline = false;
      return page.client.send('Network.emulateNetworkConditions', network(false)).catch(() => {});
    });
    site.state.offline = true;
    await page.client.send('Network.enable');
    await page.client.send('Network.emulateNetworkConditions', network(true));
    await page.navigate(site.url + 'index.html?origem=offline#venda');
    await page.waitForText('pwaStatus', 'Sem conexão. Você pode continuar');
    await page.fill('newName', 'Sabor offline');
    await page.fill('newQty', '8');
    await page.fill('newPrice', '15');
    await page.submit('addForm');
    await page.waitForText('toast', 'cadastrado');
    const id = (await page.snapshot()).flavors.at(-1).id;
    await page.fill('saleFlavor', id);
    await page.fill('saleQty', '2');
    await page.fill('saleDiscount', '1');
    await page.fill('saleMethod', 'fiado');
    await page.fill('saleBuyer', 'Cliente de teste');
    await page.fill('salePhone', '(11) 99999-9999');
    await page.submit('saleForm');
    await page.waitForText('toast', 'Venda registrada');
    assert.equal((await page.snapshot()).sales.at(-1).totalCents, 2900);
    await page.evaluate(`{
      const debt = document.querySelector('#debtList .entry');
      debt.querySelector('select').value = 'pix';
      debt.querySelector('input').value = '10';
      debt.querySelector('button').click();
    }`);
    await page.waitForText('toast', 'Pagamento registrado');
    assert.equal((await page.snapshot()).sales[0].payments[0].amountCents, 1000);
    await page.fill('saleFlavor', id);
    await page.fill('saleQty', '1');
    await page.fill('saleMethod', 'cash');
    await page.submit('saleForm');
    await page.waitForText('toast', 'Venda registrada');
    await page.evaluate('document.querySelector("#historyList button").click()');
    await page.waitForText('toast', 'Venda cancelada');
    assert.equal((await page.snapshot()).flavors.at(-1).qty, 6);
    assert.equal((await page.snapshot()).sales.filter(sale => sale.canceledAt).length, 1);
    assert.equal((await page.text('reportGross')).replace(/\s/gu, ' '), 'R$ 29,00');
    assert.equal((await page.text('reportReceived')).replace(/\s/gu, ' '), 'R$ 10,00');
    assert.equal((await page.text('reportDue')).replace(/\s/gu, ' '), 'R$ 19,00');
    await page.click('exportCsv');
    await until(() => readdir(directory), names => names.some(name => name.endsWith('.csv')), 'o CSV offline')
      .catch(async error => { throw Error(`${error.message} ${JSON.stringify(downloads)} ${JSON.stringify(await readdir(directory))} ${await page.text('toast')}`); });
    const before = await readdir(directory);
    await page.click('exportJson');
    const file = await until(async () => (await readdir(directory)).find(name => name.endsWith('.json') && !before.includes(name)),
      Boolean, 'o backup JSON offline');
    const backup = JSON.parse(await readFile(join(directory, file), 'utf8'));
    assert.equal(backup.version, 6);
    assert.deepEqual(backup.state, await page.snapshot());
    await page.click(`add-${id}`);
    await page.waitForText('toast', 'adicionada');
    for (let index = 0; index < 2; index++) {
      await page.loadBackup(backup);
      await until(() => page.evaluate('document.getElementById("restoreDialog").open'), Boolean, 'a restauração offline');
      await page.fill('restoreInput', 'RESTAURAR');
      await page.submit('restoreForm');
      await page.waitForText('toast', 'Backup restaurado');
      assert.deepEqual(await page.snapshot(), backup.state);
    }
    await close(page);
    page = await open();
    await page.client.send('Network.enable');
    await page.client.send('Network.emulateNetworkConditions', network(true));
    await page.navigate(site.url);
    assert.deepEqual(await page.snapshot(), backup.state);
    await page.waitForText('pwaStatus', 'Sem conexão. Você pode continuar');
    assert.equal(await release(page), '1.2.0');
    site.state.offline = false;
    await page.client.send('Network.emulateNetworkConditions', network(false));
    await ready(page);
  });

  await t.test('download incompleto ou tipo incorreto rejeita a atualização e conserva a versão utilizável', async () => {
    const saved = await page.snapshot();
    for (const [version, field, file] of [
      ['1.2.1', 'failedAsset', 'icons/icon-512.png'],
      ['1.2.2', 'wrongTypeAsset', 'finance.js']
    ]) {
      site.state.version = version;
      site.state[field] = file;
      await finishUpdateAttempt(page);
      assert.equal(await page.evaluate('navigator.serviceWorker.getRegistration().then(reg => reg.waiting === null)'), true);
      assert.deepEqual((await cacheNames(page)).map(name => name.split(':').at(-1)), ['1.2.0']);
      await page.navigate(site.url);
      await ready(page);
      assert.equal(await release(page), '1.2.0');
      assert.deepEqual(await page.snapshot(), saved);
      site.state[field] = null;
    }
  });

  await t.test('aguarda todas as abas fecharem, conserva rascunhos e dados e limpa apenas o próprio cache', async () => {
    const other = await open();
    await other.navigate(site.url);
    await ready(other);
    await page.fill('saleQty', '2');
    await other.fill('saleQty', '3');
    const saved = await page.snapshot();
    const unrelated = ['outra-aplicacao-v1', `loja-gigi-pwa:${site.origin}/outra/:1.0.0`];
    await page.evaluate(`Promise.all(${JSON.stringify(unrelated)}.map(name => caches.open(name).then(cache => cache.put('/outro-recurso', new Response('preservar')))))`);
    site.state.version = '1.2.3';
    await finishUpdateAttempt(page);
    for (const item of [page, other]) {
      await item.waitForText('pwaUpdate', 'feche todas as abas e janelas');
      assert.equal(await release(item), '1.2.0');
    }
    assert.equal(await page.evaluate('document.getElementById("saleQty").value'), '2');
    assert.equal(await other.evaluate('document.getElementById("saleQty").value'), '3');
    await page.navigate(site.url);
    assert.equal(await release(page), '1.2.0');
    await close(page);
    assert.equal(await other.evaluate('navigator.serviceWorker.getRegistration().then(reg => !!reg.waiting)'), true);
    assert.equal(await other.evaluate('document.getElementById("saleQty").value'), '3');
    await close(other);
    page = await open();
    await page.client.send('Page.navigate', { url: site.origin + '/?verificar-atualizacao' });
    await until(() => page.evaluate('location.pathname === "/" && document.readyState === "complete"'), Boolean, 'a página fora do escopo');
    await until(() => page.evaluate(`navigator.serviceWorker.getRegistration(${JSON.stringify(site.url)}).then(reg => reg && !reg.waiting && !reg.installing && reg.active?.state === 'activated')`),
      Boolean, 'a ativação depois de fechar todas as abas');
    await page.navigate(site.url);
    await ready(page);
    assert.equal(await release(page), '1.2.3');
    assert.deepEqual(await page.snapshot(), saved);
    assert.equal(await page.evaluate('document.getElementById("pwaUpdate").hidden'), true);
    const names = await cacheNames(page);
    assert.ok(names.includes(`loja-gigi-pwa:${site.url}:1.2.3`));
    assert.ok(!names.some(name => name.startsWith(`loja-gigi-pwa:${site.url}:`) && !name.endsWith(':1.2.3')));
    for (const name of unrelated) assert.ok(names.includes(name));
    site.state.offline = true;
    await page.client.send('Network.enable');
    await page.client.send('Network.emulateNetworkConditions', network(true));
    await page.navigate(site.url);
    assert.equal(await release(page), '1.2.3');
    assert.deepEqual(await page.snapshot(), saved);
    site.state.offline = false;
    await page.client.send('Network.emulateNetworkConditions', network(false));
  });

  await t.test('a instalação inicial incompleta informa a falha e mantém as operações locais online', async () => {
    const broken = await startSite();
    t.after(() => { broken.server.closeAllConnections(); broken.server.close(); });
    broken.state.failedAsset = 'icons/icon-512.png';
    const failed = await open();
    await failed.navigate(broken.url);
    await failed.waitForText('pwaStatus', 'O uso offline não está disponível');
    await failed.click('chooseGiovanna');
    await failed.waitForText('greeting', 'Giovanna');
    assert.equal((await failed.snapshot()).profile, 'Giovanna');
    assert.deepEqual(await cacheNames(failed), []);
    assert.equal(await failed.evaluate('navigator.serviceWorker.getRegistration().then(reg => !reg?.active)'), true);
    broken.state.failedAsset = null;
    await failed.evaluate('dispatchEvent(new Event("online"))');
    await ready(failed);
    assert.equal((await failed.snapshot()).profile, 'Giovanna');
    await close(failed);

    const blocked = await open();
    await blocked.client.send('Page.addScriptToEvaluateOnNewDocument', { source:
      `Object.defineProperty(navigator, 'serviceWorker', { value: { register: () => Promise.reject(new DOMException('Negado', 'SecurityError')) } });` });
    await blocked.navigate(broken.url);
    await blocked.waitForText('pwaStatus', 'O uso offline não está disponível');
    assert.equal(await blocked.text('greeting'), 'Olá, Giovanna!');
    await close(blocked);
  });

  await t.test('instala e reabre offline também quando hospedado na raiz', async () => {
    const rootSite = await startSite();
    t.after(() => { rootSite.server.closeAllConnections(); rootSite.server.close(); });
    const root = await open();
    const url = rootSite.origin + '/';
    await root.navigate(url);
    await root.click('chooseSamuel');
    await ready(root);
    assert.equal(await root.evaluate('navigator.serviceWorker.getRegistration().then(reg => reg.scope)'), url);
    const saved = await root.snapshot();
    rootSite.state.offline = true;
    await root.client.send('Network.enable');
    await root.client.send('Network.emulateNetworkConditions', network(true));
    await root.navigate(url + 'index.html?teste=raiz');
    await root.waitForText('pwaStatus', 'Sem conexão. Você pode continuar');
    assert.deepEqual(await root.snapshot(), saved);
    assert.equal(await root.text('greeting'), 'Olá, Samuel!');
    await close(root);
  });

  assert.deepEqual(pages.flatMap(item => item.errors), []);
});
