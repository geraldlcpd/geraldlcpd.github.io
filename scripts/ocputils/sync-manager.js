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
        // Pause background polling completely when in locked state
        if (!AppState.isUnlocked && !forceSync) {
            return;
        }

        try {
            let cipherText = null;

            if (protocol === 'firebase_rest') {
                const res = await fetch(endpoint, { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.payload) cipherText = data.payload;
                }
            } else if (protocol === 'custom_rest') {
                const res = await fetch(endpoint, { cache: 'no-store' });
                if (res.ok) {
                    const contentType = res.headers.get('content-type') || '';
                    if (contentType.includes('application/json')) {
                        const data = await res.json();
                        cipherText = data.payload || data.message || data.content;
                    } else {
                        cipherText = await res.text();
                    }
                }
            }

            if (cipherText) {
                const decryptedStr = await CryptoEngine.decryptPayload(cipherText, key);
                if (decryptedStr) {
                    const remoteEnvelope = JSON.parse(decryptedStr);
                    if (remoteEnvelope && (forceSync || remoteEnvelope.lastUpdated > AppState.lastUpdated)) {
                        if (!forceSync && document.activeElement === elements.codeEditor) {
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
                } catch (err) {}
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

            const envelope = {
                lastUpdated: AppState.lastUpdated,
                pages: AppState.pages
            };

            const encryptedB64 = await CryptoEngine.encryptPayload(JSON.stringify(envelope), AppState.masterKey);
            
            try {
                if (AppState.syncProtocol === 'websocket') {
                    const topic = `secure_clipboard_room_v1/${encodeURIComponent(AppState.roomCode)}`;
                    if (AppState.mqttClient) AppState.mqttClient.publish(topic, encryptedB64, { qos: 1 });
                } else {
                    const endpoint = SyncManager.getEndpointUrl(AppState.roomCode, AppState.syncProtocol);
                    
                    if (AppState.syncProtocol === 'firebase_rest') {
                        const baseEndpoint = endpoint.replace(/\.json$/, '/payload.json');
                        await fetch(baseEndpoint, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(encryptedB64)
                        });
                    } else if (AppState.syncProtocol === 'kvdb_rest') {
                        await fetch(endpoint, {
                            method: 'POST',
                            body: encryptedB64
                        });
                    } else {
                        await fetch(endpoint, {
                            method: 'POST',
                            body: encryptedB64
                        });
                    }
                }
                setSyncStatus('updated', 'Synced across devices!');
            } catch (e) {
                console.error("Broadcast sync error", e);
                setSyncStatus('connected', 'Sync pending...');
            }
        }, 400);
    }
}
