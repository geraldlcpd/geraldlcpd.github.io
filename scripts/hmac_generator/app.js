(function (global) {
  'use strict';

  const ALGORITHMS = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

  // Pure JS RFC 1321 MD5
  const MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];

  const MD5_K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  }

  function md5Bytes(inputBytes) {
    const origLen = inputBytes.length;
    const bitLen = origLen * 8;
    const paddedLen = Math.ceil((origLen + 9) / 64) * 64;
    const buf = new Uint8Array(paddedLen);
    buf.set(inputBytes);
    buf[origLen] = 0x80;

    const view = new DataView(buf.buffer);
    view.setUint32(paddedLen - 8, bitLen >>> 0, true);
    view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000) >>> 0, true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let offset = 0; offset < paddedLen; offset += 64) {
      let A = a0;
      let B = b0;
      let C = c0;
      let D = d0;

      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) {
          F = (B & C) | (~B & D);
          g = i;
        } else if (i < 32) {
          F = (D & B) | (~D & C);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          F = B ^ C ^ D;
          g = (3 * i + 5) % 16;
        } else {
          F = C ^ (B | ~D);
          g = (7 * i) % 16;
        }
        const M = view.getUint32(offset + g * 4, true);
        const sum = (A + F + MD5_K[i] + M) >>> 0;
        const s = MD5_S[i];
        const rot = ((sum << s) | (sum >>> (32 - s))) >>> 0;
        A = D;
        D = C;
        C = B;
        B = (B + rot) >>> 0;
      }

      a0 = (a0 + A) >>> 0;
      b0 = (b0 + B) >>> 0;
      c0 = (c0 + C) >>> 0;
      d0 = (d0 + D) >>> 0;
    }

    const out = new Uint8Array(16);
    const outView = new DataView(out.buffer);
    outView.setUint32(0, a0, true);
    outView.setUint32(4, b0, true);
    outView.setUint32(8, c0, true);
    outView.setUint32(12, d0, true);
    return out;
  }

  // RFC 2104 HMAC-MD5
  function hmacMd5(msgBytes, keyBytes) {
    const blockSize = 64;
    let k = keyBytes;
    if (k.length > blockSize) {
      k = md5Bytes(k);
    }
    const keyPad = new Uint8Array(blockSize);
    keyPad.set(k);

    const oPad = new Uint8Array(blockSize);
    const iPad = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      oPad[i] = keyPad[i] ^ 0x5c;
      iPad[i] = keyPad[i] ^ 0x36;
    }

    const inner = new Uint8Array(blockSize + msgBytes.length);
    inner.set(iPad, 0);
    inner.set(msgBytes, blockSize);
    const innerHash = md5Bytes(inner);

    const outer = new Uint8Array(blockSize + innerHash.length);
    outer.set(oPad, 0);
    outer.set(innerHash, blockSize);
    return md5Bytes(outer);
  }

  function bytesToHex(bytes) {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function bytesToBase64Url(bytes) {
    return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function formatDigest(bytes) {
    const hex = bytesToHex(bytes);
    return {
      hex,
      hexUpper: hex.toUpperCase(),
      base64: bytesToBase64(bytes),
      base64url: bytesToBase64Url(bytes)
    };
  }

  function decodeKey(str, encoding) {
    const enc = encoding || 'utf8';
    if (enc === 'utf8') {
      return new TextEncoder().encode(str);
    }
    if (enc === 'hex') {
      const cleaned = str.replace(/\s+/g, '').replace(/^0x/i, '');
      if (!/^[0-9a-fA-F]*$/.test(cleaned) || cleaned.length % 2 !== 0) {
        throw new Error('Invalid hex key (must be even length of 0-9, a-f).');
      }
      const out = new Uint8Array(cleaned.length / 2);
      for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    }
    if (enc === 'base64') {
      let s = str.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
      const pad = s.length % 4;
      if (pad) s += '='.repeat(4 - pad);
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    throw new Error('Unsupported key encoding: ' + enc);
  }

  function constantTimeEqual(a, b) {
    const sa = String(a).trim();
    const sb = String(b).trim();
    const maxLen = Math.max(sa.length, sb.length);
    let diff = sa.length ^ sb.length;
    for (let i = 0; i < maxLen; i++) {
      const ca = i < sa.length ? sa.charCodeAt(i) : 0;
      const cb = i < sb.length ? sb.charCodeAt(i) : 0;
      diff |= ca ^ cb;
    }
    return diff === 0;
  }

  function getSubtle() {
    if (global.crypto && global.crypto.subtle) return global.crypto.subtle;
    throw new Error('Web Crypto API (crypto.subtle) is unavailable in this context.');
  }

  async function computeAllHashes(text) {
    const msgBytes = new TextEncoder().encode(String(text));
    const subtle = getSubtle();
    const results = {
      MD5: formatDigest(md5Bytes(msgBytes))
    };

    const webAlgos = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];
    const buffers = await Promise.all(webAlgos.map((alg) => subtle.digest(alg, msgBytes)));
    webAlgos.forEach((alg, idx) => {
      results[alg] = formatDigest(new Uint8Array(buffers[idx]));
    });
    return results;
  }

  async function computeAllHmacs(text, key, keyEncoding) {
    const msgBytes = new TextEncoder().encode(String(text));
    const keyBytes = decodeKey(String(key || ''), keyEncoding || 'utf8');
    const subtle = getSubtle();

    const results = {
      MD5: formatDigest(hmacMd5(msgBytes, keyBytes))
    };

    // Web Crypto importKey rejects zero-length HMAC keys; pad to 1 zero byte if empty (RFC 2104 equivalent)
    const hmacKeyBytes = keyBytes.length === 0 ? new Uint8Array(1) : keyBytes;
    const webAlgos = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];
    const sigs = await Promise.all(
      webAlgos.map(async (alg) => {
        const cryptoKey = await subtle.importKey(
          'raw',
          hmacKeyBytes,
          { name: 'HMAC', hash: { name: alg } },
          false,
          ['sign']
        );
        return subtle.sign('HMAC', cryptoKey, msgBytes);
      })
    );

    webAlgos.forEach((alg, idx) => {
      results[alg] = formatDigest(new Uint8Array(sigs[idx]));
    });
    return results;
  }

  const api = {
    ALGORITHMS,
    md5Bytes,
    hmacMd5,
    bytesToHex,
    bytesToBase64,
    bytesToBase64Url,
    decodeKey,
    constantTimeEqual,
    computeAllHashes,
    computeAllHmacs
  };

  global.HmacGenerator = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
