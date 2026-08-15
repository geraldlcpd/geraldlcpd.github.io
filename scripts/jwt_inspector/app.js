(function () {
  'use strict';

  function base64UrlDecode(str) {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4;
    if (pad) s += '='.repeat(4 - pad);
    const binary = atob(s);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function base64UrlToBytes(str) {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4;
    if (pad) s += '='.repeat(4 - pad);
    const binary = atob(s);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function parseJwt(token) {
    const parts = token.trim().split('.');
    if (parts.length < 2) throw new Error('Invalid JWT: expected at least header and payload segments.');
    if (parts.length > 3) throw new Error('Invalid JWT: too many dot-separated segments.');

    let header, payload;
    try {
      header = JSON.parse(base64UrlDecode(parts[0]));
    } catch (e) {
      throw new Error('Failed to decode header: ' + e.message);
    }
    try {
      payload = JSON.parse(base64UrlDecode(parts[1]));
    } catch (e) {
      throw new Error('Failed to decode payload: ' + e.message);
    }

    return { header, payload, signature: parts[2] || null, signed: parts.length === 3 };
  }

  function formatClaimValue(key, value) {
    if (value === null || value === undefined) return '—';
    if (key === 'exp' || key === 'iat' || key === 'nbf') {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      const d = new Date(n * 1000);
      return `${d.toUTCString()} (${n})`;
    }
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function getExpiryStatus(payload) {
    if (!payload.exp) return null;
    const exp = Number(payload.exp);
    if (!Number.isFinite(exp)) return null;
    const now = Date.now() / 1000;
    if (exp < now) return { expired: true, expDate: new Date(exp * 1000) };
    return { expired: false, expDate: new Date(exp * 1000), remaining: exp - now };
  }

  const HMAC_ALG_MAP = {
    HS256: 'SHA-256',
    HS384: 'SHA-384',
    HS512: 'SHA-512'
  };

  async function verifyHmacSignature(alg, secret, signingInput, signatureB64) {
    const hash = HMAC_ALG_MAP[alg];
    if (!hash) throw new Error(`Unsupported HMAC algorithm: ${alg}. Only HS256, HS384, HS512 are supported.`);

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash },
      false,
      ['verify']
    );

    const sigBytes = base64UrlToBytes(signatureB64);
    return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(signingInput));
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function highlightJson(obj) {
    const json = JSON.stringify(obj, null, 2);
    return json.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = 'json-number';
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? 'json-key' : 'json-string';
        } else if (/true|false/.test(match)) {
          cls = 'json-boolean';
        } else if (/null/.test(match)) {
          cls = 'json-null';
        }
        return `<span class="${cls}">${escapeHtml(match)}</span>`;
      }
    );
  }

  const CLAIM_LABELS = {
    iss: 'Issuer',
    sub: 'Subject',
    aud: 'Audience',
    exp: 'Expiration',
    nbf: 'Not Before',
    iat: 'Issued At',
    jti: 'JWT ID'
  };

  const PRIORITY_CLAIMS = ['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti'];

  window.JwtInspector = {
    parseJwt,
    formatClaimValue,
    getExpiryStatus,
    verifyHmacSignature,
    highlightJson,
    escapeHtml,
    CLAIM_LABELS,
    PRIORITY_CLAIMS,
    HMAC_ALG_MAP
  };
})();
