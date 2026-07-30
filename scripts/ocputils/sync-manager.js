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
            if (protocol === 'firebase_rest') {
                const base = (AppState.customUrl || APP_CONFIG.DEFAULT_FIREBASE_URL).trim().replace(/\/+$/, '').replace(/\/rooms\/.*$/, '');
                const roomCode = AppState.roomCode;
                const pagesEndpoint = `${base}/rooms/${encodeURIComponent(roomCode)}/pages.json`;
                const imagesEndpoint = `${base}/rooms/${encodeURIComponent(roomCode)}/images.json`;
                const legacyEndpoint = `${base}/rooms/${encodeURIComponent(roomCode)}.json`;

                const res = await fetch(pagesEndpoint, { cache: 'no-store' });
                if (res.ok) {
                    const pagesData = await res.json();
                    if (pagesData && typeof pagesData === 'object' && Object.keys(pagesData).length > 0) {
                        // Fetch images map if exists
                        let imagesMap = {};
                        try {
                            const imgRes = await fetch(imagesEndpoint, { cache: 'no-store' });
                            if (imgRes.ok) {
                                imagesMap = (await imgRes.json()) || {};
                            }
                        } catch (e) {}

                        let latestTime = 0;
                        let assembledPages = [];

                        for (const pId of Object.keys(pagesData)) {
                            const node = pagesData[pId];
                            if (node && node.payload) {
                                const decryptedStr = await CryptoEngine.decryptPayload(node.payload, key);
                                if (decryptedStr) {
                                    const pageObj = JSON.parse(decryptedStr);

                                    // If page is an image gallery, resolve sub-node images
                                    if (pageObj.type === 'image') {
                                        let resolvedImages = [];

                                        // Fallback / Backward Compatibility: check for inline images in legacy format
                                        if (pageObj.images && Array.isArray(pageObj.images) && pageObj.images.length > 0 && pageObj.images[0].dataUrl) {
                                            resolvedImages = pageObj.images;
                                        } else if (pageObj.imageManifest && Array.isArray(pageObj.imageManifest)) {
                                            // Resolve each image from sub-nodes
                                            for (const imgId of pageObj.imageManifest) {
                                                const imgNode = imagesMap[imgId];
                                                if (imgNode && imgNode.payload) {
                                                    const imgStr = await CryptoEngine.decryptPayload(imgNode.payload, key);
                                                    if (imgStr) {
                                                        try {
                                                            resolvedImages.push(JSON.parse(imgStr));
                                                        } catch (e) {}
                                                    }
                                                }
                                            }
                                        }
                                        pageObj.images = resolvedImages;
                                    }

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
            const updateTimestamp = Date.now();

            try {
                if (AppState.syncProtocol === 'websocket') {
                    AppState.lastUpdated = updateTimestamp;
                    const envelope = { lastUpdated: AppState.lastUpdated, pages: AppState.pages };
                    const encryptedB64 = await CryptoEngine.encryptPayload(JSON.stringify(envelope), AppState.masterKey);
                    const topic = `secure_clipboard_room_v1/${encodeURIComponent(AppState.roomCode)}`;
                    if (AppState.mqttClient) AppState.mqttClient.publish(topic, encryptedB64, { qos: 1 });
                } else if (AppState.syncProtocol === 'firebase_rest') {
                    const base = (AppState.customUrl || APP_CONFIG.DEFAULT_FIREBASE_URL).trim().replace(/\/+$/, '').replace(/\/rooms\/.*$/, '');
                    const pagesBaseUrl = `${base}/rooms/${encodeURIComponent(AppState.roomCode)}/pages`;
                    const imagesBaseUrl = `${base}/rooms/${encodeURIComponent(AppState.roomCode)}/images`;

                    const activePageIds = AppState.pages.map(p => p.id);
                    const activeImageIds = [];

                    // 1. Process each page
                    for (const page of AppState.pages) {
                        let pageToSave = { ...page };

                        if (page.type === 'image' && Array.isArray(page.images)) {
                            const manifest = [];

                            // Save each image into individual sub-node /rooms/{roomCode}/images/{imgId}.json
                            for (const img of page.images) {
                                manifest.push(img.id);
                                activeImageIds.push(img.id);

                                const imgCipher = await CryptoEngine.encryptPayload(JSON.stringify(img), AppState.masterKey);
                                await fetch(`${imagesBaseUrl}/${encodeURIComponent(img.id)}.json`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        lastUpdated: updateTimestamp,
                                        payload: imgCipher
                                    })
                                });
                            }

                            // Replace inline images with imageManifest reference list to keep page payload tiny (~1 KB)
                            pageToSave.imageManifest = manifest;
                            delete pageToSave.images;
                        }

                        const pageCipher = await CryptoEngine.encryptPayload(JSON.stringify(pageToSave), AppState.masterKey);
                        await fetch(`${pagesBaseUrl}/${encodeURIComponent(page.id)}.json`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                lastUpdated: updateTimestamp,
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

                    // 3. Delete orphaned images from Firebase
                    try {
                        const existingImgRes = await fetch(`${imagesBaseUrl}.json`, { cache: 'no-store' });
                        if (existingImgRes.ok) {
                            const existingImgMap = await existingImgRes.json();
                            if (existingImgMap) {
                                for (const remoteImgId of Object.keys(existingImgMap)) {
                                    if (!activeImageIds.includes(remoteImgId)) {
                                        await fetch(`${imagesBaseUrl}/${encodeURIComponent(remoteImgId)}.json`, { method: 'DELETE' });
                                    }
                                }
                            }
                        }
                    } catch(e){}

                    // 4. Clean up legacy payload.json if it exists
                    const legacyPayloadUrl = `${base}/rooms/${encodeURIComponent(AppState.roomCode)}/payload.json`;
                    fetch(legacyPayloadUrl, { method: 'DELETE' }).catch(() => {});

                    AppState.lastUpdated = updateTimestamp;
                } else {
                    AppState.lastUpdated = updateTimestamp;
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
