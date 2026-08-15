(function () {
  'use strict';

  function extractPemBlocks(text) {
    const regex = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/g;
    const blocks = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      blocks.push({ type: match[1], body: match[2].replace(/\s/g, '') });
    }
    return blocks;
  }

  async function sha256Fingerprint(derBytes) {
    const hash = await crypto.subtle.digest('SHA-256', derBytes);
    const hex = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    return hex.match(/.{1,2}/g).join(':');
  }

  function getKeyInfo(publicKey) {
    if (!publicKey) return { type: 'Unknown', size: '—' };
    const alg = publicKey.algorithm || publicKey.type || 'Unknown';
    let type = alg;
    let size = '—';

    if (publicKey.n) {
      type = 'RSA';
      size = publicKey.n.bitLength() + ' bits';
    } else if (publicKey.curve) {
      type = publicKey.curve;
      if (publicKey.q) size = publicKey.q.bitLength() + ' bits';
    } else if (alg === 'ed25519' || alg === 'Ed25519') {
      type = 'Ed25519';
      size = '256 bits';
    }

    return { type, size };
  }

  function formatDn(attrs) {
    if (!attrs || !attrs.length) return '—';
    return attrs.map((a) => `${a.shortName}=${a.value}`).join(', ');
  }

  function getSansFromExtensions(extensions) {
    if (!extensions || !extensions.length) return [];
    const sanExt = extensions.find((ext) => ext.name === 'subjectAltName' || ext.id === '2.5.29.17');
    if (!sanExt || !sanExt.altNames) return [];
    return sanExt.altNames.map((n) => {
      if (n.type === 2) return `DNS:${n.value}`;
      if (n.type === 7) return `IP:${n.ip || n.value}`;
      if (n.type === 1) return `Email:${n.value}`;
      if (n.type === 6) return `URI:${n.value}`;
      return String(n.value || n.ip || '');
    });
  }

  function getSans(cert) {
    return getSansFromExtensions(cert.extensions);
  }

  function getCsrSans(csr) {
    const attr = csr.getAttribute({ name: 'extensionRequest' });
    if (!attr || !attr.extensions) return [];
    return getSansFromExtensions(attr.extensions);
  }

  function parseCertOrCsr(pemText) {
    if (typeof forge === 'undefined') {
      throw new Error('forge.js library not loaded.');
    }

    const blocks = extractPemBlocks(pemText);
    if (!blocks.length) {
      throw new Error('No PEM block found. Paste a certificate or CSR in PEM format.');
    }

    const results = [];

    for (const block of blocks) {
      const pem = `-----BEGIN ${block.type}-----\n${block.body.match(/.{1,64}/g).join('\n')}\n-----END ${block.type}-----`;

      if (block.type.includes('CERTIFICATE REQUEST') || block.type === 'NEW CERTIFICATE REQUEST') {
        const csr = forge.pki.certificationRequestFromPem(pem);
        const pubKey = csr.publicKey;
        results.push({
          kind: 'CSR',
          subject: formatDn(csr.subject.attributes),
          issuer: '— (unsigned request)',
          sans: getCsrSans(csr),
          notBefore: null,
          notAfter: null,
          serialNumber: '—',
          fingerprint: null,
          keyInfo: getKeyInfo(pubKey),
          isExpired: false,
          isNotYetValid: false,
          pemType: block.type
        });
      } else if (block.type.includes('CERTIFICATE')) {
        const cert = forge.pki.certificateFromPem(pem);
        const now = new Date();
        const notBefore = cert.validity.notBefore;
        const notAfter = cert.validity.notAfter;
        const isExpired = now > notAfter;
        const isNotYetValid = now < notBefore;

        results.push({
          kind: 'Certificate',
          subject: formatDn(cert.subject.attributes),
          issuer: formatDn(cert.issuer.attributes),
          sans: getSans(cert),
          notBefore,
          notAfter,
          serialNumber: cert.serialNumber,
          cert,
          keyInfo: getKeyInfo(cert.publicKey),
          isExpired,
          isNotYetValid,
          pemType: block.type
        });
      }
    }

    if (!results.length) {
      throw new Error('Unsupported PEM type. Expected CERTIFICATE or CERTIFICATE REQUEST.');
    }

    return results;
  }

  async function enrichWithFingerprints(results) {
    for (const r of results) {
      if (r.cert) {
        const asn1 = forge.pki.certificateToAsn1(r.cert);
        const der = forge.asn1.toDer(asn1).getBytes();
        const bytes = new Uint8Array(der.length);
        for (let i = 0; i < der.length; i++) bytes[i] = der.charCodeAt(i);
        r.fingerprint = await sha256Fingerprint(bytes);
      }
    }
    return results;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  window.CertInspector = {
    parseCertOrCsr,
    enrichWithFingerprints,
    escapeHtml
  };
})();
