(function () {
  'use strict';

  const MAX_FILE_BYTES = 512 * 1024;

  function base64Encode(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }

  function base64Decode(str) {
    const cleaned = str.replace(/\s/g, '');
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function base64UrlEncode(str) {
    return base64Encode(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlDecode(str) {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4;
    if (pad) s += '='.repeat(4 - pad);
    return base64Decode(s);
  }

  function hexEncode(str) {
    const bytes = new TextEncoder().encode(str);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function hexDecode(str) {
    const cleaned = str.replace(/\s/g, '').replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]*$/.test(cleaned)) throw new Error('Invalid hex string.');
    if (cleaned.length % 2 !== 0) throw new Error('Hex string must have even length.');
    const bytes = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(cleaned.substring(i * 2, i * 2 + 2), 16);
    }
    return new TextDecoder().decode(bytes);
  }

  function urlEncode(str) {
    return encodeURIComponent(str);
  }

  function urlDecode(str) {
    return decodeURIComponent(str.replace(/\+/g, ' '));
  }

  function htmlEncode(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function htmlDecode(str) {
    const doc = new DOMParser().parseFromString(str, 'text/html');
    return doc.documentElement.textContent;
  }

  const ENCODERS = {
    base64: { encode: base64Encode, decode: base64Decode, label: 'Base64' },
    base64url: { encode: base64UrlEncode, decode: base64UrlDecode, label: 'Base64URL' },
    hex: { encode: hexEncode, decode: hexDecode, label: 'Hex' },
    url: { encode: urlEncode, decode: urlDecode, label: 'URL' },
    html: { encode: htmlEncode, decode: htmlDecode, label: 'HTML Entities' }
  };

  window.EncodeDecode = {
    ENCODERS,
    MAX_FILE_BYTES,
    base64Encode,
    base64Decode,
    base64UrlEncode,
    base64UrlDecode,
    hexEncode,
    hexDecode,
    urlEncode,
    urlDecode,
    htmlEncode,
    htmlDecode
  };
})();
