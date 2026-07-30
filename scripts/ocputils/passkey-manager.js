/**
 * PasskeyManager - Multi-Domain WebAuthn Passkey Management Module
 */
class PasskeyManager {
    static async registerOrAuthenticate(roomCode, passphraseKey, isNewCreation = false) {
        if (!window.PublicKeyCredential) {
            throw new Error("WebAuthn / Passkeys not supported in this browser.");
        }

        const currentDomain = window.location.hostname || "localhost";
        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);

        const base = (elements.inputCustomUrl.value || AppState.customUrl).trim().replace(/\/+$/, '').replace(/\/rooms\/.*$/, '');
        const metaEndpoint = `${base}/rooms/${encodeURIComponent(roomCode)}/meta.json`;

        // Fetch room metadata from DB
        let roomMeta = null;
        try {
            const res = await fetch(metaEndpoint, { cache: 'no-store' });
            if (res.ok) roomMeta = await res.json();
        } catch(e){}

        if (!isNewCreation && roomMeta && roomMeta.passkeys) {
            // Filter passkeys strictly matching current domain
            const validCredKeys = Object.keys(roomMeta.passkeys).filter(id => {
                const entry = roomMeta.passkeys[id];
                return entry.rpId === currentDomain;
            });

            if (validCredKeys.length === 0) {
                throw new Error(`No Passkey registered for domain "${currentDomain}". Unlock via Passphrase below, then click "+ Domain Passkey".`);
            }

            const credIds = validCredKeys.map(id => ({
                id: Uint8Array.from(atob(id), c => c.charCodeAt(0)),
                type: 'public-key'
            }));

            const credential = await navigator.credentials.get({
                publicKey: {
                    challenge: challenge,
                    allowCredentials: credIds,
                    userVerification: "preferred"
                }
            });

            const credIdB64 = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
            const passkeyDerivedKey = await CryptoEngine.deriveKeyFromPassword(credIdB64 + "_passkey_key", roomCode);

            if (roomMeta.passkeys[credIdB64] && roomMeta.passkeys[credIdB64].wrappedKey) {
                const masterKeyJson = await CryptoEngine.decryptPayload(roomMeta.passkeys[credIdB64].wrappedKey, passkeyDerivedKey);
                if (masterKeyJson) {
                    const rawKey = Uint8Array.from(atob(masterKeyJson), c => c.charCodeAt(0));
                    return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
                }
            }
            return passkeyDerivedKey;
        } else {
            // Create & Register New Passkey for Current Domain
            return PasskeyManager.registerPasskeyForCurrentDomain(roomCode, passphraseKey);
        }
    }

    static async registerPasskeyForCurrentDomain(roomCode, masterKey) {
        const currentDomain = window.location.hostname || "localhost";
        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);

        if (!masterKey) {
            throw new Error("Master Passphrase is required to enroll a Passkey. Please unlock room with Passphrase first.");
        }

        const base = (elements.inputCustomUrl.value || AppState.customUrl).trim().replace(/\/+$/, '').replace(/\/rooms\/.*$/, '');
        const metaEndpoint = `${base}/rooms/${encodeURIComponent(roomCode)}/meta.json`;

        // 1. Clean up / Delete any existing Passkeys registered for currentDomain (Enforce 1 Passkey per domain)
        try {
            const res = await fetch(metaEndpoint, { cache: 'no-store' });
            if (res.ok) {
                const roomMeta = await res.json();
                if (roomMeta && roomMeta.passkeys) {
                    const oldCredIds = Object.keys(roomMeta.passkeys).filter(id => roomMeta.passkeys[id].rpId === currentDomain);
                    for (const oldId of oldCredIds) {
                        await fetch(`${base}/rooms/${encodeURIComponent(roomCode)}/meta/passkeys/${encodeURIComponent(oldId)}.json`, {
                            method: 'DELETE'
                        });
                    }
                }
            }
        } catch(e) {
            console.warn("Failed deleting existing domain passkeys", e);
        }

        // 2. Create WebAuthn Credential
        const pin = Math.floor(100000 + Math.random() * 900000);
        const credential = await navigator.credentials.create({
            publicKey: {
                challenge: challenge,
                rp: { name: "Online Clipboard App", id: currentDomain },
                user: {
                    id: crypto.getRandomValues(new Uint8Array(16)),
                    name: `${roomCode}-${pin}`,
                    displayName: `Clipboard Key #${pin} (${roomCode})`
                },
                pubKeyCredParams: [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }],
                authenticatorSelection: { userVerification: "preferred", residentKey: "preferred" },
                timeout: 60000
            }
        });

        const rawIdB64 = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));

        // 3. Export actual master room key and encrypt with passkey key
        const exportedRaw = await crypto.subtle.exportKey("raw", masterKey);
        const rawB64 = btoa(String.fromCharCode(...new Uint8Array(exportedRaw)));

        const passkeyKey = await CryptoEngine.deriveKeyFromPassword(rawIdB64 + "_passkey_key", roomCode);
        const wrappedKey = await CryptoEngine.encryptPayload(rawB64, passkeyKey);

        const passkeyData = {
            name: `Passkey #${pin}`,
            rpId: currentDomain,
            registeredAt: Date.now(),
            wrappedKey: wrappedKey
        };

        await fetch(`${base}/rooms/${encodeURIComponent(roomCode)}/meta/passkeys/${encodeURIComponent(rawIdB64)}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(passkeyData)
        }).catch(e => console.error("Passkey reg upload error", e));

        return masterKey;
    }
}
