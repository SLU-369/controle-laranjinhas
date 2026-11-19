const status = document.getElementById('pwaStatus');
const updateNotice = document.getElementById('pwaUpdate');
const installButton = document.getElementById('installApp');
const installHelp = document.getElementById('installHelp');
const installMessage = document.getElementById('installMessage');
const displayMode = matchMedia('(display-mode: standalone)');
let installPrompt;
let registration;
let offlineReady = false;
let unavailable = false;
let installedFromEvent = false;
let preparing = false;
let lastUpdateCheck = Date.now();

function renderInstallation() {
  const installed = installedFromEvent || displayMode.matches || navigator.standalone === true;
  installButton.hidden = installed || !installPrompt;
  installHelp.hidden = installed;
  if (installed) installMessage.hidden = true;
}

function renderStatus() {
  status.hidden = false;
  if (offlineReady) {
    status.textContent = navigator.onLine
      ? 'Pronto para usar sem internet neste aparelho.'
      : 'Sem conexão. Você pode continuar usando a loja neste aparelho.';
  } else if (unavailable) {
    status.textContent = 'O uso offline não está disponível neste navegador. Use a loja com internet e mantenha seu backup JSON.';
  } else {
    status.textContent = navigator.onLine
      ? 'Preparando a loja para usar sem internet…'
      : 'Sem conexão. Conecte-se à internet para preparar o uso offline.';
  }
}

function checkOffline(worker) {
  return new Promise(resolve => {
    if (!worker) return resolve(false);
    const channel = new MessageChannel();
    const finish = ready => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(ready);
    };
    const timeout = setTimeout(() => finish(false), 5000);
    channel.port1.onmessage = event => finish(event.data?.ready === true);
    try {
      worker.postMessage({ type: 'CHECK_OFFLINE' }, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}

async function refreshStatus() {
  offlineReady = await checkOffline(registration?.active);
  if (registration?.active) unavailable = !offlineReady;
  renderStatus();
}

function showUpdate() {
  updateNotice.hidden = !registration?.waiting;
  updateNotice.textContent = updateNotice.hidden ? '' :
    'Atualização pronta. Conclua seus registros, feche todas as abas e janelas da loja e abra novamente.';
}

function watchWorker(worker) {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    showUpdate();
    if (worker.state === 'activated') void refreshStatus();
    if (worker.state === 'redundant' && !registration.active) {
      unavailable = true;
      renderStatus();
    }
  });
}

async function checkUpdate() {
  if (!registration || !navigator.onLine || Date.now() - lastUpdateCheck < 60000) return;
  lastUpdateCheck = Date.now();
  // Uma falha de rede não invalida a versão offline já preparada.
  await registration.update().catch(() => {});
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  renderInstallation();
});

installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  installButton.disabled = true;
  try {
    await prompt.prompt();
    await prompt.userChoice;
  } catch {
    installMessage.textContent = 'Use o menu do navegador para instalar a loja. Veja as instruções em Como instalar.';
    installMessage.hidden = false;
  } finally {
    installButton.disabled = false;
    renderInstallation();
  }
});

window.addEventListener('appinstalled', () => {
  installedFromEvent = true;
  installPrompt = null;
  installMessage.hidden = true;
  installHelp.open = false;
  renderInstallation();
  installHelp.hidden = true;
});
displayMode.addEventListener('change', renderInstallation);

const isIOS = /iPad|iPhone|iPod/u.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (isIOS) {
  installHelp.querySelector('summary').textContent = 'Instalar no iPhone ou iPad';
  document.getElementById('installInstructions').textContent =
    'Abra a loja no Safari, toque em Compartilhar e escolha Adicionar à Tela de Início. Confirme em Adicionar e abra pelo novo ícone.';
}
renderInstallation();
renderStatus();

async function prepareOffline() {
  if (preparing) return;
  preparing = true;
  unavailable = false;
  renderStatus();
  try {
    const next = await navigator.serviceWorker.register(new URL('./service-worker.js', import.meta.url), {
      scope: new URL('./', import.meta.url).href,
      updateViaCache: 'none'
    });
    if (registration !== next) {
      registration = next;
      registration.addEventListener('updatefound', () => watchWorker(registration.installing));
    }
    watchWorker(registration.installing);
    showUpdate();
    if (registration.active) await refreshStatus();
    else if (!registration.installing && !registration.waiting) {
      unavailable = true;
      renderStatus();
    }
  } catch {
    unavailable = true;
    renderStatus();
  } finally {
    preparing = false;
  }
}

const supportsOffline = 'serviceWorker' in navigator && window.isSecureContext;
if (supportsOffline) await prepareOffline();
else {
  unavailable = true;
  renderStatus();
}

window.addEventListener('online', () => {
  if (supportsOffline && !registration?.active && !registration?.installing) void prepareOffline();
  else { void refreshStatus(); void checkUpdate(); }
});
window.addEventListener('offline', () => { void refreshStatus(); });
window.addEventListener('focus', () => { void checkUpdate(); });
