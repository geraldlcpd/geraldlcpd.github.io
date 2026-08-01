/**
 * CryptoEngine - AES-256-GCM + PBKDF2 Zero-Knowledge Security Module
 */
class CryptoEngine {
    static async deriveKeyFromPassword(password, saltString) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            "raw",
            enc.encode(password),
            "PBKDF2",
            false,
            ["deriveKey"]
        );

        return crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: enc.encode(saltString),
                iterations: 100000,
                hash: "SHA-256"
            },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
        );
    }

    static async createVerificationToken(passphrase, roomCode) {
        const verifyKey = await CryptoEngine.deriveKeyFromPassword(passphrase, roomCode + "_verify_v1");
        return CryptoEngine.encryptPayload(VERIFY_MAGIC_TOKEN, verifyKey);
    }

    static async verifyPassphraseToken(passphrase, roomCode, verifyCipherB64) {
        try {
            const verifyKey = await CryptoEngine.deriveKeyFromPassword(passphrase, roomCode + "_verify_v1");
            const decrypted = await CryptoEngine.decryptPayload(verifyCipherB64, verifyKey);
            return decrypted === VERIFY_MAGIC_TOKEN;
        } catch(e) {
            return false;
        }
    }

    static bytesToBase64(uint8Array) {
        let binary = '';
        const len = uint8Array.byteLength;
        const CHUNK_SIZE = 0x8000; // 32KB chunk limit for stack safety
        for (let i = 0; i < len; i += CHUNK_SIZE) {
            binary += String.fromCharCode.apply(null, uint8Array.subarray(i, i + CHUNK_SIZE));
        }
        return btoa(binary);
    }

    static async encryptPayload(plainText, key) {
        const enc = new TextEncoder();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            key,
            enc.encode(plainText)
        );

        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(encrypted), iv.length);

        return CryptoEngine.bytesToBase64(combined);
    }

    static async decryptPayload(cipherTextB64, key) {
        try {
            const binaryStr = atob(cipherTextB64);
            const len = binaryStr.length;
            if (len < 13) return null;
            const combined = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                combined[i] = binaryStr.charCodeAt(i);
            }
            const iv = combined.subarray(0, 12);
            const data = combined.subarray(12);

            const decrypted = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv },
                key,
                data
            );

            return new TextDecoder().decode(decrypted);
        } catch (e) {
            return null;
        }
    }
}
