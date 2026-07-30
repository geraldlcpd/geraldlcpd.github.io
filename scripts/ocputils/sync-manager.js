/**
 * SyncManager - Multi-Provider Transport & Polling Module
 */
class SyncManager {
    static connect(roomCode, key, protocol, customUrl, isNewRoom = false) {
        if (AppState.mqttClient) AppState.mqttClient.end();
        if (AppState.pollTimer) clearInterval(AppState.pollTimer);

        AppState.syncProtocol = protocol;
        AppState.customUrl = customUrl || AppState.customUrl;

        if (protocol === 'websocket') {
            SyncManager.initWebSocket(roomCode, key);
        } else {
            SyncManager.initHttpsRest(roomCode, key, protocol, isNewRoom);
        }
    }

    static getEndpointUrl(roomCode, protocol) {
        const safeRoom = encodeURIComponent(roomCode);
        
        if (protocol === 'firebase_rest') {
            let base = (AppState.customUrl || APP_CONFIG.DEFAULT_FIREBASE_URL).trim();
            base = base.replace(/\/+$/, '').replace(/\/rooms\/.*$/, '');
            return `${base}/rooms/${safeRoom}.json`;
        }

        if (protocol === 'custom_rest') {
            let url = (AppState.customUrl || '').trim();
            if (!url) return `${APP_CONFIG.DEFAULT_FIREBASE_URL}/rooms/${safeRoom}.json`;
            return url.replace('{roomCode}', safeRoom).replace('{room}', safeRoom);
        }

        return `${APP_CONFIG.DEFAULT_FIREBASE_URL}/rooms/${safeRoom}.json`;
    }

    // --- HTTPS REST Transport (Port 443) ---
    static initHttpsRest(roomCode, key, protocol, isNewRoom = false) {
        setSyncStatus('connected', `Synced (${protocol.split('_')[0].toUpperCase()})`);

        const endpoint = SyncManager.getEndpointUrl(roomCode, protocol);

        if (isNewRoom) {
            SyncManager.broadcastState();
        } else {
            SyncManager.pollHttpsRest(endpoint, key, protocol);
        }

        AppState.pollTimer = setInterval(() => {
            SyncManager.pollHttpsRest(endpoint, key, protocol);
        }, APP_CONFIG.POLL_INTERVAL_MS);
    }

    static async pollHttpsRest(endpoint, key, protocol, forceSync = false) {
        // Pause background polling completely when in locked state or when tab/window is hidden in background
        if ((!AppState.isUnlocked || document.hidden) && !forceSync) {
            return;
        }

        try {
            if (protocol === 'firebase_rest') {
                const base = (AppState.customUrl || APP_CONFIG.DEFAULT_FIREBASE_URL).trim().replace(/\/+$/, '').replace(/\/rooms\/.*$/, '');
                const roomCode = AppState.roomCode;
                const pagesEndpoint = `${base}/rooms/${encodeURIComponent(roomCode)}/pages.json`;
                const legacyEndpoint = `${base}/rooms/${encodeURIComponent(roomCode)}.json`;

                const res = await fetch(pagesEndpoint, { cache: 'no-store' });
                if (res.ok) {
                    const pagesData = await res.json();
                    if (pagesData && typeof pagesData === 'object' && Object.keys(pagesData).length > 0) {
                        // Sub-Node Strategy 1: Read individual page ciphertexts
                        let latestTime = 0;
                        let assembledPages = [];

                        for (const pId of Object.keys(pagesData)) {
                            const node = pagesData[pId];
                            if (node && node.payload) {
                                const decryptedStr = await CryptoEngine.decryptPayload(node.payload, key);
                                if (decryptedStr) {
                                    const pageObj = JSON.parse(decryptedStr);
                                    assembledPages.push(pageObj);
                                    if (node.lastUpdated && node.lastUpdated > latestTime) {
                                        latestTime = node.lastUpdated;
                                    }
                                }
                            }
                        }

                        if (assembledPages.length > 0 && (forceSync || latestTime > AppState.lastUpdated)) {
                            if (!forceSync && document.activeElement === elements.codeEditor) {
                                AppState.pendingRemoteEnvelope = { lastUpdated: latestTime, pages: assembledPages };
                                elements.syncBanner.classList.add('show');
                            } else {
                                AppState.lastUpdated = latestTime;
                                AppState.pages = assembledPages;
                                AppState.pendingRemoteEnvelope = null;
                                elements.syncBanner.classList.remove('show');
                                renderPageList();
                                updateEditorView();
                                setSyncStatus('updated', 'Remote update synced!');
                            }
                        }
                        return;
                    }
                }

                // Legacy Fallback Check
                const legRes = await fetch(legacyEndpoint, { cache: 'no-store' });
                if (legRes.ok) {
                    const legData = await legRes.json();
                    if (legData && legData.payload) {
                        const decryptedStr = await CryptoEngine.decryptPayload(legData.payload, key);
                        if (decryptedStr) {
                            const remoteEnvelope = JSON.parse(decryptedStr);
                            if (remoteEnvelope && (forceSync || remoteEnvelope.lastUpdated > AppState.lastUpdated)) {
                                AppState.lastUpdated = remoteEnvelope.lastUpdated;
                                AppState.pages = remoteEnvelope.pages;
                                renderPageList();
                                updateEditorView();
                                setSyncStatus('updated', 'Legacy payload synced (Auto-upgrading...)');
                                // Trigger broadcast to auto-upgrade legacy payload to Sub-Node Structure
                                SyncManager.broadcastState();
                            }
                        }
                    }
                }
            } else {
                // Custom REST / Generic transport
                const res = await fetch(endpoint, { cache: 'no-store' });
                if (res.ok) {
                    let cipherText = null;
                    const contentType = res.headers.get('content-type') || '';
                    if (contentType.includes('application/json')) {
                        const data = await res.json();
                        cipherText = data.payload || data.message || data.content;
                    } else {
                        cipherText = await res.text();
                    }

                    if (cipherText) {
                        const decryptedStr = await CryptoEngine.decryptPayload(cipherText, key);
                        if (decryptedStr) {
                            const remoteEnvelope = JSON.parse(decryptedStr);
                            if (remoteEnvelope && (forceSync || remoteEnvelope.lastUpdated > AppState.lastUpdated)) {
                                AppState.lastUpdated = remoteEnvelope.lastUpdated;
                                AppState.pages = remoteEnvelope.pages;
                                renderPageList();
                                updateEditorView();
                                setSyncStatus('updated', 'Remote update synced!');
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.warn("HTTPS REST poll error", err);
        }
    }

    // --- WebSocket Transport ---
    static initWebSocket(roomCode, key) {
        setSyncStatus('connecting', 'Connecting WSS...');

        const client = mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
            clientId: 'clipboard_' + Math.random().toString(16).substring(2, 10),
            keepalive: 30,
            clean: true
        });

        const topic = `secure_clipboard_room_v1/${encodeURIComponent(roomCode)}`;

        client.on('connect', () => {
            setSyncStatus('connected', 'WSS Synced');
            client.subscribe(topic, { qos: 1 });
            SyncManager.broadcastState();
        });

        client.on('message', async (t, message) => {
            if (t === topic) {
                try {
                    const decryptedStr = await CryptoEngine.decryptPayload(message.toString(), key);
                    if (decryptedStr) {
                        const remoteEnvelope = JSON.parse(decryptedStr);
                        if (remoteEnvelope && remoteEnvelope.lastUpdated > AppState.lastUpdated) {
                            if (document.activeElement === elements.codeEditor) {
                                AppState.pendingRemoteEnvelope = remoteEnvelope;
                                elements.syncBanner.classList.add('show');
                            } else {
                                AppState.lastUpdated = remoteEnvelope.lastUpdated;
                                AppState.pages = remoteEnvelope.pages;
                                AppState.pendingRemoteEnvelope = null;
                                elements.syncBanner.classList.remove('show');
                                renderPageList();
                                updateEditorView();
                                setSyncStatus('updated', 'Remote update synced!');
                            }
                        }
                    }
                } catch (e) {}
            }
        });

        client.on('error', () => {
            setSyncStatus('locked', 'WSS Blocked');
        });

        AppState.mqttClient = client;
    }

    static broadcastState() {
        if (!AppState.isUnlocked || !AppState.masterKey) return;
        
        clearTimeout(AppState.debounceTimer);
        AppState.debounceTimer = setTimeout(async () => {
            setSyncStatus('syncing', 'Broadcasting changes...');
            AppState.lastUpdated = Date.now();

            try {
                if (AppState.syncProtocol === 'websocket') {
                    const envelope = { lastUpdated: AppState.lastUpdated, pages: AppState.pages };
                    const encryptedB64 = await CryptoEngine.encryptPayload(JSON.stringify(envelope), AppState.masterKey);
                    const topic = `secure_clipboard_room_v1/${encodeURIComponent(AppState.roomCode)}`;
                    if (AppState.mqttClient) AppState.mqttClient.publish(topic, encryptedB64, { qos: 1 });
                } else if (AppState.syncProtocol === 'firebase_rest') {
                    const base = (AppState.customUrl || APP_CONFIG.DEFAULT_FIREBASE_URL).trim().replace(/\/+$/, '').replace(/\/rooms\/.*$/, '');
                    const pagesBaseUrl = `${base}/rooms/${encodeURIComponent(AppState.roomCode)}/pages`;

                    // 1. Encrypt and upload each page to /rooms/{roomCode}/pages/{pageId}.json
                    const activePageIds = AppState.pages.map(p => p.id);
                    for (const page of AppState.pages) {
                        const pageCipher = await CryptoEngine.encryptPayload(JSON.stringify(page), AppState.masterKey);
                        await fetch(`${pagesBaseUrl}/${encodeURIComponent(page.id)}.json`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                lastUpdated: AppState.lastUpdated,
                                payload: pageCipher
                            })
                        });
                    }

                    // 2. Delete removed pages from Firebase
                    try {
                        const existingRes = await fetch(`${pagesBaseUrl}.json`, { cache: 'no-store' });
                        if (existingRes.ok) {
                            const existingMap = await existingRes.json();
                            if (existingMap) {
                                for (const remoteId of Object.keys(existingMap)) {
                                    if (!activePageIds.includes(remoteId)) {
                                        await fetch(`${pagesBaseUrl}/${encodeURIComponent(remoteId)}.json`, { method: 'DELETE' });
                                    }
                                }
                            }
                        }
                    } catch(e){}

                    // 3. Clean up legacy payload.json if it exists
                    const legacyPayloadUrl = `${base}/rooms/${encodeURIComponent(AppState.roomCode)}/payload.json`;
                    fetch(legacyPayloadUrl, { method: 'DELETE' }).catch(() => {});
                } else {
                    const envelope = { lastUpdated: AppState.lastUpdated, pages: AppState.pages };
                    const encryptedB64 = await CryptoEngine.encryptPayload(JSON.stringify(envelope), AppState.masterKey);
                    const endpoint = SyncManager.getEndpointUrl(AppState.roomCode, AppState.syncProtocol);
                    await fetch(endpoint, {
                        method: 'POST',
                        body: encryptedB64
                    });
                }
                setSyncStatus('updated', 'Synced across devices!');
            } catch (e) {
                console.error("Broadcast sync error", e);
                setSyncStatus('connected', 'Sync pending...');
            }
        }, 400);
    }
}

// Immediately refresh sync state when user switches back to this tab
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && AppState.isUnlocked && AppState.masterKey) {
        const endpoint = SyncManager.getEndpointUrl(AppState.roomCode, AppState.syncProtocol);
        SyncManager.pollHttpsRest(endpoint, AppState.masterKey, AppState.syncProtocol, true);
    }
});

