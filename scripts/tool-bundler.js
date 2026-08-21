(function (global) {
  'use strict';

  const BUNDLE_MANIFEST = {
    'exif_analyser.html': { tier: 'medium', offlineCapable: true, warning: 'Map tiles require network (OpenStreetMap). PDF export adds ~200 KB (html2pdf).' },
    'jwt_inspector.html': { tier: 'light', offlineCapable: true },
    'cron_explainer.html': { tier: 'light', offlineCapable: true },
    'encode_decode.html': { tier: 'light', offlineCapable: true },
    'snap_signature_debugger.html': { tier: 'light', offlineCapable: true },
    'cert_inspector.html': { tier: 'medium', offlineCapable: true },
    'json_workbench.html': { tier: 'medium', offlineCapable: true },
    'file_hashing.html': { tier: 'medium', offlineCapable: true },
    'pgp_inspector.html': { tier: 'medium', offlineCapable: true },
    'hash_check.html': { tier: 'medium', offlineCapable: true },
    'sqlite_viewer.html': { tier: 'heavy', offlineCapable: true, warning: 'Large download (~2 MB), may take 10–20 seconds.' },
    'online_clipboard.html': { tier: 'network', offlineCapable: false, warning: 'Portable bundle only. MQTT sync requires network.' },
    'tools_font_offline.html': { tier: 'medium', offlineCapable: true },
    'muilockerauto.html': { tier: 'medium', offlineCapable: false, warning: 'Offline bundle not supported (Tailwind CDN). Use Portable mode.' },
    'locker-unlocked.html': { tier: 'medium', offlineCapable: false, warning: 'Offline bundle not supported (Tailwind CDN). Use Portable mode.' },
    'sik_automation.html': { tier: 'medium', offlineCapable: true },
    'hash_check.html': { tier: 'medium', offlineCapable: true }
  };

  const OFFLINE_UNSUPPORTED_HOSTS = ['cdn.tailwindcss.com'];

  function getManifest(filename) {
    return BUNDLE_MANIFEST[filename] || { tier: 'medium', offlineCapable: true };
  }

  function estimateComplexity(filename) {
    const m = getManifest(filename);
    return {
      tier: m.tier,
      offlineCapable: m.offlineCapable !== false,
      warning: m.warning || null
    };
  }

  function resolveUrl(href, baseUrl) {
    try {
      return new URL(href, baseUrl).href;
    } catch {
      return href;
    }
  }

  function isSameOrigin(url, pageOrigin) {
    try {
      const u = new URL(url);
      return u.origin === pageOrigin;
    } catch {
      return false;
    }
  }

  function isOfflineUnsupported(url) {
    try {
      const host = new URL(url).hostname;
      return OFFLINE_UNSUPPORTED_HOSTS.some((h) => host === h || host.endsWith('.' + h));
    } catch {
      return false;
    }
  }

  async function fetchText(url) {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error('Failed to fetch ' + url + ' (' + res.status + ')');
    return res.text();
  }

  async function fetchBytes(url) {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error('Failed to fetch ' + url + ' (' + res.status + ')');
    return res.arrayBuffer();
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function mimeFromUrl(url) {
    const lower = url.split('?')[0].toLowerCase();
    if (lower.endsWith('.woff2')) return 'font/woff2';
    if (lower.endsWith('.woff')) return 'font/woff';
    if (lower.endsWith('.ttf')) return 'font/ttf';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.gif')) return 'image/gif';
    return 'application/octet-stream';
  }

  async function rewriteCssUrls(css, cssBaseUrl, offline) {
    if (!offline) return css;
    const urlRegex = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    const replacements = [];
    let match;
    while ((match = urlRegex.exec(css)) !== null) {
      const raw = match[2].trim();
      if (raw.startsWith('data:') || raw.startsWith('#')) continue;
      const abs = resolveUrl(raw, cssBaseUrl);
      replacements.push({ from: match[0], abs });
    }
    let out = css;
    for (const { from, abs } of replacements) {
      try {
        const buf = await fetchBytes(abs);
        const b64 = arrayBufferToBase64(buf);
        const dataUri = 'url(data:' + mimeFromUrl(abs) + ';base64,' + b64 + ')';
        out = out.split(from).join(dataUri);
      } catch {
        /* keep original url on failure */
      }
    }
    return out;
  }

  function shouldSkipAsset(url) {
    try {
      const path = new URL(url).pathname;
      return (
        /\/tool-bundler\.js$/i.test(path) ||
        /\/tool-download-init\.js$/i.test(path) ||
        /\/tool-download\.css$/i.test(path)
      );
    } catch {
      return false;
    }
  }

  function shouldInlineAsset(url, pageOrigin, mode) {
    if (mode === 'offline') {
      if (isOfflineUnsupported(url)) return false;
      return true;
    }
    return isSameOrigin(url, pageOrigin);
  }

  async function inlineStylesheets(doc, baseUrl, mode, pageOrigin, onProgress, progress) {
    const links = [...doc.querySelectorAll('link[rel="stylesheet"][href]')];
    for (const link of links) {
      const href = link.getAttribute('href');
      const abs = resolveUrl(href, baseUrl);
      if (shouldSkipAsset(abs)) {
        link.remove();
        continue;
      }
      progress.current++;
      onProgress && onProgress(progress);

      if (!shouldInlineAsset(abs, pageOrigin, mode)) continue;

      try {
        let css = await fetchText(abs);
        css = await rewriteCssUrls(css, abs, mode === 'offline');
        const style = doc.createElement('style');
        style.setAttribute('data-inlined-from', href);
        style.textContent = css;
        link.replaceWith(style);
      } catch (err) {
        if (mode === 'offline') {
          const comment = doc.createComment(' failed to inline stylesheet: ' + href + ' — ' + err.message + ' ');
          link.parentNode.insertBefore(comment, link);
        }
      }
    }
  }

  async function inlineScripts(doc, baseUrl, mode, pageOrigin, onProgress, progress) {
    const scripts = [...doc.querySelectorAll('script[src]')];
    for (const script of scripts) {
      const src = script.getAttribute('src');
      const abs = resolveUrl(src, baseUrl);
      if (shouldSkipAsset(abs)) {
        script.remove();
        continue;
      }
      progress.current++;
      onProgress && onProgress(progress);

      if (!shouldInlineAsset(abs, pageOrigin, mode)) {
        if (mode === 'offline' && isOfflineUnsupported(abs)) {
          const comment = doc.createComment(' offline bundle skipped (unsupported CDN): ' + src + ' ');
          script.parentNode.insertBefore(comment, script);
        }
        continue;
      }

      try {
        const js = await fetchText(abs);
        const inline = doc.createElement('script');
        inline.setAttribute('data-inlined-from', src);
        if (script.type) inline.type = script.type;
        if (script.defer) inline.defer = true;
        if (script.async) inline.async = true;
        inline.textContent = js;
        script.replaceWith(inline);
      } catch (err) {
        if (mode === 'offline') {
          const comment = doc.createComment(' failed to inline script: ' + src + ' — ' + err.message + ' ');
          script.parentNode.insertBefore(comment, script);
        }
      }
    }
  }

  function finalizeDocument(doc, mode) {
    if (mode === 'offline') {
      doc.querySelectorAll('link[rel="preconnect"], link[rel="dns-prefetch"]').forEach((el) => el.remove());
    }

    doc.querySelectorAll('a[href="index.html"], a[href="./index.html"]').forEach((a) => {
      a.setAttribute('href', '#');
      a.setAttribute('title', 'Standalone bundle — portal link disabled');
    });

    const footer = doc.querySelector('footer');
    if (footer) {
      const note = doc.createElement('p');
      note.style.cssText = 'margin-top:0.5rem;font-size:0.8rem;opacity:0.85';
      note.textContent =
        'Standalone bundle (' +
        mode +
        ' mode) generated by DevOps Tool Directory on ' +
        new Date().toISOString().slice(0, 10) +
        '.';
      footer.appendChild(note);
    }
  }

  function countAssets(doc) {
    return (
      doc.querySelectorAll('link[rel="stylesheet"][href]').length +
      doc.querySelectorAll('script[src]').length
    );
  }

  async function bundleTool(htmlPath, mode, onProgress) {
    if (mode !== 'portable' && mode !== 'offline') {
      throw new Error('Invalid bundle mode: ' + mode);
    }

    const manifest = getManifest(htmlPath);
    if (mode === 'offline' && manifest.offlineCapable === false) {
      throw new Error(manifest.warning || 'Offline bundle is not supported for this tool.');
    }

    const baseUrl = resolveUrl(htmlPath, window.location.href);
    const pageOrigin = window.location.origin;

    const html = await fetchText(baseUrl);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const progress = { current: 0, total: countAssets(doc) + 1 };

    await inlineStylesheets(doc, baseUrl, mode, pageOrigin, onProgress, progress);
    await inlineScripts(doc, baseUrl, mode, pageOrigin, onProgress, progress);

    progress.current++;
    onProgress && onProgress(progress);

    finalizeDocument(doc, mode);

    const comment =
      '<!-- Bundled by DevOps Tool Directory | mode: ' +
      mode +
      ' | source: ' +
      htmlPath +
      ' | date: ' +
      new Date().toISOString() +
      ' -->\n';

    return '<!DOCTYPE html>\n' + comment + doc.documentElement.outerHTML;
  }

  function downloadBlob(html, filename) {
    const safeName = filename.replace(/\.html$/i, '') + '.standalone.html';
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 200);
  }

  global.ToolBundler = {
    BUNDLE_MANIFEST,
    bundleTool,
    downloadBlob,
    estimateComplexity,
    getManifest
  };
})(typeof window !== 'undefined' ? window : globalThis);
