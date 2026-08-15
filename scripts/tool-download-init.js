(function () {
  'use strict';

  if (typeof ToolBundler === 'undefined') {
    console.error('tool-download-init.js requires tool-bundler.js');
    return;
  }

  let activeBundle = false;

  function ensureToast() {
    let toast = document.getElementById('bundle-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'bundle-toast';
      toast.className = 'bundle-toast';
      toast.innerHTML = '<div class="bundle-toast-inner"><i class="fa-solid fa-spinner fa-spin"></i><span id="bundle-toast-msg">Bundling…</span></div>';
      document.body.appendChild(toast);
    }
    return toast;
  }

  function showToast(msg, isError) {
    const toast = ensureToast();
    const msgEl = document.getElementById('bundle-toast-msg');
    const icon = toast.querySelector('i');
    if (msgEl) msgEl.textContent = msg;
    if (icon) {
      icon.className = isError ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-spinner fa-spin';
    }
    toast.classList.toggle('bundle-toast-error', !!isError);
    toast.classList.add('show');
  }

  function hideToast(delay) {
    setTimeout(() => {
      const toast = document.getElementById('bundle-toast');
      if (toast) toast.classList.remove('show');
    }, delay || 0);
  }

  function setButtonsDisabled(disabled) {
    document.querySelectorAll('[data-bundle-tool]').forEach((btn) => {
      btn.disabled = disabled;
      btn.classList.toggle('is-bundling', disabled);
    });
  }

  async function runBundle(toolFile, mode) {
    if (activeBundle) return;
    activeBundle = true;
    setButtonsDisabled(true);

    const info = ToolBundler.estimateComplexity(toolFile);
    if (info.warning && info.tier !== 'light') {
      const proceed = window.confirm(info.warning + '\n\nContinue with download?');
      if (!proceed) {
        activeBundle = false;
        setButtonsDisabled(false);
        return;
      }
    }

    showToast('Bundling ' + toolFile + '…');

    try {
      const html = await ToolBundler.bundleTool(toolFile, mode, (p) => {
        const msg =
          p.total > 0
            ? 'Bundling ' + toolFile + '… (' + Math.min(p.current, p.total) + '/' + p.total + ')'
            : 'Bundling ' + toolFile + '…';
        showToast(msg);
      });

      ToolBundler.downloadBlob(html, toolFile);
      showToast('Download started: ' + toolFile.replace(/\.html$/i, '') + '.standalone.html');
      hideToast(2500);
    } catch (err) {
      showToast(err.message || 'Bundle failed', true);
      hideToast(4000);
    } finally {
      activeBundle = false;
      setButtonsDisabled(false);
    }
  }

  function closeAllMenus() {
    document.querySelectorAll('.download-menu.open').forEach((m) => m.classList.remove('open'));
  }

  function buildDownloadMenu(toolFile, extraClass) {
    const info = ToolBundler.estimateComplexity(toolFile);
    const offlineDisabled = !info.offlineCapable;

    const wrap = document.createElement('div');
    wrap.className = 'download-wrap' + (extraClass ? ' ' + extraClass : '');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-download';
    btn.setAttribute('data-bundle-tool', toolFile);
    btn.title = 'Download single-file bundle';
    btn.innerHTML = '<i class="fa-solid fa-download"></i><span class="dl-label">Download</span><i class="fa-solid fa-chevron-down dl-chevron"></i>';

    const menu = document.createElement('div');
    menu.className = 'download-menu';
    menu.innerHTML =
      '<button type="button" class="download-menu-item" data-mode="portable"><i class="fa-solid fa-file-export"></i> Portable (.html)</button>' +
      (offlineDisabled
        ? '<button type="button" class="download-menu-item disabled" disabled title="' +
          (info.warning || 'Offline not supported') +
          '"><i class="fa-solid fa-wifi"></i> Offline (.html)</button>'
        : '<button type="button" class="download-menu-item" data-mode="offline"><i class="fa-solid fa-plane"></i> Offline (.html)</button>');

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wasOpen = menu.classList.contains('open');
      closeAllMenus();
      if (!wasOpen) menu.classList.add('open');
    });

    menu.querySelectorAll('.download-menu-item[data-mode]').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeAllMenus();
        runBundle(toolFile, item.getAttribute('data-mode'));
      });
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  }

  function findDownloadAnchor() {
    const selectors = [
      'header .header-nav',
      'header .header-actions',
      '.header-actions',
      '.header > div:last-child',
      'header'
    ];
    for (let i = 0; i < selectors.length; i++) {
      const el = document.querySelector(selectors[i]);
      if (el) return el;
    }
    return null;
  }

  function injectToolPageButton() {
    const toolFile = document.body.getAttribute('data-tool-file');
    if (!toolFile) return;

    const nav = findDownloadAnchor();
    if (!nav || nav.querySelector('.download-wrap')) return;

    const menu = buildDownloadMenu(toolFile, 'download-wrap-header');
    const themeBtn = nav.querySelector('#theme-toggle, .theme-toggle-btn');
    if (themeBtn) nav.insertBefore(menu, themeBtn);
    else nav.appendChild(menu);
  }

  function wirePortalMenus() {
    document.querySelectorAll('.download-wrap[data-tool]').forEach((wrap) => {
      if (wrap.dataset.wired === '1') return;
      wrap.dataset.wired = '1';
      const toolFile = wrap.getAttribute('data-tool');
      const btn = wrap.querySelector('.btn-download');
      const menu = wrap.querySelector('.download-menu');
      if (!btn || !menu) return;

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const wasOpen = menu.classList.contains('open');
        closeAllMenus();
        if (!wasOpen) menu.classList.add('open');
      });

      menu.querySelectorAll('.download-menu-item[data-mode]').forEach((item) => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeAllMenus();
          runBundle(toolFile, item.getAttribute('data-mode'));
        });
      });
    });
  }

  document.addEventListener('click', () => closeAllMenus());

  document.addEventListener('DOMContentLoaded', () => {
    injectToolPageButton();
    wirePortalMenus();
  });

  window.ToolDownload = {
    runBundle,
    buildDownloadMenu,
    wirePortalMenus,
    showToast
  };
})();
