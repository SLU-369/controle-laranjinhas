import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const files = {
  '': ['index.html', 'text/html'],
  'index.html': ['index.html', 'text/html'],
  'style.css': ['style.css', 'text/css'],
  'script.js': ['script.js', 'application/javascript'],
  'finance.js': ['finance.js', 'application/javascript'],
  'pwa.js': ['pwa.js', 'application/javascript'],
  'service-worker.js': ['service-worker.js', 'application/javascript'],
  'manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  ...Object.fromEntries(['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']
    .map(name => [`icons/${name}`, [`icons/${name}`, 'image/png']]))
};
const key = 'loja-gigi-v5';
const browserCandidates = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

async function until(read, predicate, label, timeout = 6000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await read();
    if (predicate(value)) return value;
    await delay(40);
  } while (Date.now() < deadline);
  assert.fail(`Tempo esgotado aguardando ${label}.`);
}

async function startSite() {
  const state = { version: '1.2.0', failedAsset: null, wrongTypeAsset: null, offline: false };
  const requests = [];
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    requests.push(path);
    const base = path.startsWith('/controle-laranjinhas/') ? '/controle-laranjinhas/' : '/';
    const relative = path.slice(base.length);
    const asset = Object.hasOwn(files, relative) && files[relative];
    if (state.offline || relative === state.failedAsset) {
      response.writeHead(503).end();
      return;
    }
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    const [name, type] = asset;
    let content = await readFile(new URL(`../${name}`, import.meta.url));
    if (name === 'service-worker.js') {
      content = content.toString().replace("const VERSION = '1.2.0';", `const VERSION = '${state.version}';`);
    } else if (name === 'index.html') {
      content = content.toString().replace('</head>', `<meta name="test-release" content="${state.version}"></head>`);
    }
    response.writeHead(200, {
      'Content-Type': relative === state.wrongTypeAsset ? 'text/html' : type,
      'Cache-Control': 'no-cache'
    });
    response.end(content);
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { server, state, requests, origin, url: `${origin}/controle-laranjinhas/` };
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
  return { targetId: page.id, client, errors, evaluate, text, click, fill, submit, snapshot, waitForText, navigate, loadBackup };
}

async function startBrowser(t, siteOverride) {
  const executable = browserCandidates.find(path => path && existsSync(path));
  assert.ok(executable, 'Instale o Edge ou Chrome ou defina BROWSER_PATH.');
  const directory = await mkdtemp(join(tmpdir(), 'loja-gigi-test-'));
  const site = siteOverride ?? (process.env.LOJA_TEST_URL ? { url: process.env.LOJA_TEST_URL } : await startSite());
  const profile = join(directory, 'profile');
  const browser = spawn(executable, [
    '--headless=new', '--disable-background-networking', '--disable-extensions', '--no-first-run',
    '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let browserLog = '';
  browser.stderr.on('data', data => { browserLog = (browserLog + data).slice(-6000); });
  let browserClosed;
  const pages = [];
  const browserExit = new Promise(resolve => {
    browser.on('exit', code => {
      browserClosed = Error(`O Chromium encerrou com código ${code}. ${browserLog}`);
      resolve();
    });
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
  }, value => value.includes('/devtools/browser/'), 'o Chromium iniciar', 20000)
    .catch(error => { throw Error(`${error.message}\n${browserLog}`, { cause: error }); });
  const [port] = activePort.trim().split(/\r?\n/u);
  const debuggerInfo = await fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json());
  browserClient = await connect(debuggerInfo.webSocketDebuggerUrl)
    .catch(error => { throw Error(`Conexão com o Chromium falhou: ${error.message}\n${browserLog}`, { cause: error }); });
  await browserClient.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory });
  return { directory, site, port, pages, browserClient };
}

export { until, startSite, openPage, startBrowser };
