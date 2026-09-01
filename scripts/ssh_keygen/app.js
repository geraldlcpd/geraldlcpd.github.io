(function () {
  'use strict';

  const DEFAULT_BITS = 2048;
  const BIT_OPTIONS = [2048, 3072, 4096];

  function ensureForge() {
    if (typeof forge === 'undefined') {
      throw new Error('forge.js library not loaded.');
    }
  }

  function generateKeypair(options) {
    ensureForge();

    const bits = options.bits || DEFAULT_BITS;
    const comment = (options.comment || '').trim();
    const passphrase = options.passphrase || '';

    if (!BIT_OPTIONS.includes(bits)) {
      return Promise.reject(new Error('Unsupported key size. Choose 2048, 3072, or 4096 bits.'));
    }

    return new Promise((resolve, reject) => {
      forge.pki.rsa.generateKeyPair({ bits, workers: -1 }, (err, keypair) => {
        if (err) {
          reject(err);
          return;
        }

        try {
          const publicKeyOpenSSH = forge.ssh.publicKeyToOpenSSH(
            keypair.publicKey,
            comment || undefined
          );
          const privateKeyOpenSSH = passphrase
            ? forge.ssh.privateKeyToOpenSSH(keypair.privateKey, passphrase)
            : forge.ssh.privateKeyToOpenSSH(keypair.privateKey);

          const fingerprintMd5 = forge.ssh.getPublicKeyFingerprint(keypair.publicKey, {
            encoding: 'hex',
            delimiter: ':'
          });
          const fingerprintSha256 = getSha256Fingerprint(keypair.publicKey);

          resolve({
            bits,
            comment,
            publicKey: String(publicKeyOpenSSH).trim(),
            privateKey: String(privateKeyOpenSSH).trim(),
            fingerprintMd5,
            fingerprintSha256,
            encrypted: !!passphrase
          });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  function getSha256Fingerprint(publicKey) {
    const digest = forge.ssh.getPublicKeyFingerprint(publicKey, {
      md: forge.md.sha256.create()
    });
    const b64 = forge.util.encode64(digest.getBytes()).replace(/=+$/, '');
    return 'SHA256:' + b64;
  }

  function downloadText(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  window.SshKeygen = {
    DEFAULT_BITS,
    BIT_OPTIONS,
    generateKeypair,
    downloadText,
    escapeHtml
  };
})();
