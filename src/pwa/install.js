// Offline support and the "install as app" prompt on the start screen.

export function isInstalledApp() {
  return window.matchMedia('(display-mode: fullscreen)').matches
    || window.matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true; // iOS home-screen app
}

export function registerServiceWorker() {
  // Only the production build has a generated sw.js
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

export function initInstallPrompt() {
  if (isInstalledApp()) return;
  const btnInstall = document.getElementById('btn-install');
  const btnIosInstall = document.getElementById('btn-ios-install');
  const iosScreen = document.getElementById('ios-install-screen');
  const btnIosClose = document.getElementById('btn-ios-install-close');

  // Android / desktop Chrome: show our own button for the browser's install prompt
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    btnInstall.hidden = false;
  });
  btnInstall.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btnInstall.hidden = true;
  });
  window.addEventListener('appinstalled', () => { btnInstall.hidden = true; });

  // iOS has no install prompt or fullscreen API; show how to add it to the
  // Home Screen, which launches it full screen
  if (!isIOS()) return;
  btnIosInstall.hidden = false;
  btnIosInstall.addEventListener('click', () => iosScreen.classList.add('active'));
  btnIosClose.addEventListener('click', () => iosScreen.classList.remove('active'));
  // Tapping the dimmed background also closes it
  iosScreen.addEventListener('click', e => {
    if (e.target === iosScreen) iosScreen.classList.remove('active');
  });
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    // iPadOS reports itself as a Mac
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
