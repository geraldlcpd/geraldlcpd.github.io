import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function resolveUrl(href, baseUrl) {
  return new URL(href, baseUrl).href;
}

function isSameOrigin(url, pageOrigin) {
  return new URL(url).origin === pageOrigin;
}

function shouldInline(url, pageOrigin, mode) {
  if (mode === 'offline') {
    if (new URL(url).hostname === 'cdn.tailwindcss.com') return false;
    return true;
  }
  return isSameOrigin(url, pageOrigin);
}

function fileUrlToPath(url) {
  const u = new URL(url);
  if (u.protocol !== 'file:') {
    const pathPart = u.pathname.replace(/^\//, '').replace(/\//g, '\\');
    return join(root, pathPart);
  }
  return decodeURIComponent(u.pathname.replace(/^\//, '').replace(/\//g, '\\'));
}

function httpUrlToPath(url, pageOrigin) {
  const u = new URL(url);
  if (u.origin !== pageOrigin) return null;
  const rel = u.pathname.replace(/^\//, '');
  return join(root, rel);
}

function readLocal(url, pageOrigin) {
  const path = httpUrlToPath(url, pageOrigin);
  if (!path || !existsSync(path)) throw new Error('Missing ' + url);
  return readFileSync(path, 'utf8');
}

function bundlePortable(htmlPath) {
  const pageOrigin = 'http://localhost:8765';
  const baseUrl = pageOrigin + '/' + htmlPath;
  let html = readLocal(baseUrl, pageOrigin);

  html = html.replace(/<link\b([^>]*?)rel=["']stylesheet["']([^>]*?)href=["']([^"']+)["']([^>]*)>/gi, (full, a, b, href, c) => {
    const abs = resolveUrl(href, baseUrl);
    if (!shouldInline(abs, pageOrigin, 'portable')) return full;
    const css = readLocal(abs, pageOrigin);
    return '<style data-inlined-from="' + href + '">' + css + '</style>';
  });

  html = html.replace(/<link\b([^>]*?)href=["']([^"']+)["']([^>]*?)rel=["']stylesheet["']([^>]*)>/gi, (full, a, href, b, c) => {
    const abs = resolveUrl(href, baseUrl);
    if (!shouldInline(abs, pageOrigin, 'portable')) return full;
    const css = readLocal(abs, pageOrigin);
    return '<style data-inlined-from="' + href + '">' + css + '</style>';
  });

  html = html.replace(/<script\b([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (full, a, src, b) => {
    const abs = resolveUrl(src, baseUrl);
    if (!shouldInline(abs, pageOrigin, 'portable')) return full;
    const js = readLocal(abs, pageOrigin);
    return '<script data-inlined-from="' + src + '">' + js + '</script>';
  });

  return '<!DOCTYPE html>\n<!-- test bundle portable -->\n' + html;
}

const tests = ['jwt_inspector.html', 'json_workbench.html'];
const outDir = join(root, 'scratch');

for (const file of tests) {
  const bundled = bundlePortable(file);
  const out = join(outDir, file.replace('.html', '.portable.test.html'));
  writeFileSync(out, bundled, 'utf8');
  const hasInlinedJs = bundled.includes('data-inlined-from="scripts/');
  const hasExternalCdn = bundled.includes('cdnjs.cloudflare.com');
  console.log(file + ': inlined=' + hasInlinedJs + ' cdnKept=' + hasExternalCdn + ' size=' + bundled.length);
}

console.log('Portable bundle smoke tests written to scratch/');
