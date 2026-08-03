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
        AppState.isInitialLoaded = false;

        if (isNewRoom) {
            SyncManager.broadcastState();
            AppState.isInitialLoaded = true;
        } else {
            // Initial one-time full load of room pages on unlock
            SyncManager.pollHttpsRest(endpoint, key, protocol, true);
        }

        AppState.pollTimer = setInterval(() => {
            SyncManager.pollHttpsRest(endpoint, key, protocol);
        }, APP_CONFIG.POLL_INTERVAL_MS);
    }

    static async pollHttpsRest(endpoint, key, protocol, forceSync = false) {
        // Pause background polling completely when in locked state or when tab polling is paused (30s inactivity)
        if (!AppState.isUnlocked || (AppState.isTabPollingPaused && !forceSync)) {
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
                        let latestTime = 0;
                        let assembledPages = [];

                        for (const pId of Object.keys(pagesData)) {
                            const node = pagesData[pId];
                            if (node && node.payload) {
                                const decryptedStr = await CryptoEngine.decryptPayload(node.payload, key);
                                if (decryptedStr) {
                                    const pageObj = JSON.parse(decryptedStr);

                                    // If page is an image gallery, resolve cached images from IndexedDB or preserve currently loaded images
                                    if (pageObj.type === 'image') {
                                        const existingPage = AppState.pages ? AppState.pages.find(p => p.id === pageObj.id) : null;
                                        const existingImageMap = new Map();
                                        if (existingPage && Array.isArray(existingPage.images)) {
                                            existingPage.images.forEach(img => existingImageMap.set(img.id, img));
                                        }

                                        let resolvedImages = [];
                                        if (pageObj.images && Array.isArray(pageObj.images) && pageObj.images.length > 0 && pageObj.images[0].dataUrl) {
                                            resolvedImages = pageObj.images;
                                        } else if (pageObj.imageManifest && Array.isArray(pageObj.imageManifest)) {
                                            for (const imgId of pageObj.imageManifest) {
                                                if (existingImageMap.has(imgId)) {
                                                    resolvedImages.push(existingImageMap.get(imgId));
                                                } else if (window.ImageCacheManager) {
                                                    const cachedImg = await ImageCacheManager.getImage(imgId);
                                                    if (cachedImg) {
                                                        resolvedImages.push(cachedImg);
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

                        if (assembledPages.length > 0 && (forceSync || !AppState.isInitialLoaded || latestTime > AppState.lastUpdated)) {
                            if (!forceSync && AppState.isInitialLoaded && document.activeElement === elements.codeEditor) {
                                AppState.pendingRemoteEnvelope = { lastUpdated: latestTime, pages: assembledPages };
                                elements.syncBanner.classList.add('show');
                            } else {
                                AppState.lastUpdated = latestTime;
                                AppState.pages = assembledPages;
                                AppState.pendingRemoteEnvelope = null;
                                AppState.isInitialLoaded = true;
                                elements.syncBanner.classList.remove('show');
                                renderPageList();
                                updateEditorView();
                                setSyncStatus('updated', 'Remote update synced!');

                                // Trigger on-demand image fetch if active page is an image gallery
                                const activePage = AppState.pages.find(p => p.id === AppState.activePageId) || AppState.pages[0];
                                if (activePage && activePage.type === 'image') {
                                    SyncManager.ensurePageImagesLoaded(activePage, key);
                                }
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
                            if (remoteEnvelope && (forceSync || !AppState.isInitialLoaded || remoteEnvelope.lastUpdated > AppState.lastUpdated)) {
                                AppState.lastUpdated = remoteEnvelope.lastUpdated;
                                AppState.pages = remoteEnvelope.pages;
                                AppState.isInitialLoaded = true;
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
                            if (remoteEnvelope && (forceSync || !AppState.isInitialLoaded || remoteEnvelope.lastUpdated > AppState.lastUpdated)) {
                                AppState.lastUpdated = remoteEnvelope.lastUpdated;
                                AppState.pages = remoteEnvelope.pages;
                                AppState.isInitialLoaded = true;
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

    static async savePage(page) {
        if (!AppState.isUnlocked || !AppState.masterKey) return;
        setSyncStatus('syncing', 'Saving page...');
        const updateTimestamp = Date.now();

        try {
            if (AppState.syncProtocol === 'firebase_rest') {
                const base = (AppState.customUrl || APP_CONFIG.DEFAULT_FIREBASE_URL).trim().replace(/\/+$/, '').replace(/\/rooms\/.*$/, '');
                const pageUrl = `${base}/rooms/${encodeURIComponent(AppState.roomCode)}/pages/${encodeURIComponent(page.id)}.json`;
                const imagesBaseUrl = `${base}/rooms/${encodeURIComponent(AppState.roomCode)}/images`;

                let pageToSave = { ...page };

                if (page.type === 'image' && Array.isArray(page.images)) {
                    const manifest = [];
                    for (const img of page.images) {
                        manifest.push(img.id);
                        if (window.ImageCacheManager) {
                            ImageCacheManager.setImage(img.id, img);
                        }
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
                    pageToSave.imageManifest = manifest;
                    delete pageToSave.images;
                }

                const pageCipher = await CryptoEngine.encryptPayload(JSON.stringify(pageToSave), AppState.masterKey);
                await fetch(pageUrl, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        lastUpdated: updateTimestamp,
                        payload: pageCipher
                    })
                });

                AppState.lastUpdated = updateTimestamp;
            } else {
                SyncManager.broadcastState();
                return;
            }
            setSyncStatus('updated', 'Page synced!');
        } catch (e) {
            console.error("Save page error", e);
            setSyncStatus('connected', 'Sync pending...');
        }
    }

    static async deletePage(pageId, imageIds = []) {
        if (!AppState.isUnlocked || !AppState.masterKey) return;
        setSyncStatus('syncing', 'Deleting page...');
        const updateTimestamp = Date.now();

        try {
            if (AppState.syncProtocol === 'firebase_rest') {
                const base = (AppState.customUrl || APP_CONFIG.DEFAULT_FIREBASE_URL).trim().replace(/\/+$/, '').replace(/\/rooms\/.*$/, '');
                const pageUrl = `${base}/rooms/${encodeURIComponent(AppState.roomCode)}/pages/${encodeURIComponent(pageId)}.json`;
                await fetch(pageUrl, { method: 'DELETE' });

                if (Array.isArray(imageIds) && imageIds.length > 0) {
                    const imagesBaseUrl = `${base}/rooms/${encodeURIComponent(AppState.roomCode)}/images`;
                    for (const imgId of imageIds) {
                        await fetch(`${imagesBaseUrl}/${encodeURIComponent(imgId)}.json`, { method: 'DELETE' });
                    }
                }

                AppState.lastUpdated = updateTimestamp;
            } else {
                SyncManager.broadcastState();
                return;
            }
            setSyncStatus('updated', 'Page deleted!');
        } catch (e) {
            console.error("Delete page error", e);
            setSyncStatus('connected', 'Sync pending...');
        }
    }

    static broadcastState() {
        if (!AppState.isUnlocked || !AppState.masterKey) return;
        
        clearTimeout(AppState.debounceTimer);
        AppState.debounceTimer = setTimeout(async () => {
            const activePage = AppState.pages.find(p => p.id === AppState.activePageId) || AppState.pages[0];
            if (AppState.syncProtocol === 'firebase_rest' && activePage) {
                await SyncManager.savePage(activePage);
            } else if (AppState.syncProtocol === 'websocket') {
                setSyncStatus('syncing', 'Broadcasting changes...');
                const updateTimestamp = Date.now();
                AppState.lastUpdated = updateTimestamp;
                const envelope = { lastUpdated: AppState.lastUpdated, pages: AppState.pages };
                const encryptedB64 = await CryptoEngine.encryptPayload(JSON.stringify(envelope), AppState.masterKey);
                const topic = `secure_clipboard_room_v1/${encodeURIComponent(AppState.roomCode)}`;
                if (AppState.mqttClient) AppState.mqttClient.publish(topic, encryptedB64, { qos: 1 });
                setSyncStatus('updated', 'Synced across devices!');
            } else {
                setSyncStatus('syncing', 'Broadcasting changes...');
                const updateTimestamp = Date.now();
                AppState.lastUpdated = updateTimestamp;
                const envelope = { lastUpdated: AppState.lastUpdated, pages: AppState.pages };
                const encryptedB64 = await CryptoEngine.encryptPayload(JSON.stringify(envelope), AppState.masterKey);
                const endpoint = SyncManager.getEndpointUrl(AppState.roomCode, AppState.syncProtocol);
                await fetch(endpoint, {
                    method: 'POST',
                    body: encryptedB64
                });
                setSyncStatus('updated', 'Synced across devices!');
            }
        }, 400);
    }

    static async ensurePageImagesLoaded(page, key) {
        if (!page || page.type !== 'image' || !page.imageManifest || !Array.isArray(page.imageManifest)) return;
        const decryptionKey = key || AppState.masterKey;
        if (!AppState.isUnlocked || !decryptionKey) return;

        const base = (AppState.customUrl || APP_CONFIG.DEFAULT_FIREBASE_URL).trim().replace(/\/+$/, '').replace(/\/rooms\/.*$/, '');
        const roomCode = AppState.roomCode;
        const imagesBaseUrl = `${base}/rooms/${encodeURIComponent(roomCode)}/images`;

        if (!page.images) page.images = [];
        const loadedIds = new Set(page.images.map(img => img.id));
        let updated = false;

        for (const imgId of page.imageManifest) {
            if (loadedIds.has(imgId)) continue;

            // 1. Check local IndexedDB cache first
            let cachedImg = null;
            if (window.ImageCacheManager) {
                cachedImg = await ImageCacheManager.getImage(imgId);
            }

            if (cachedImg) {
                page.images.push(cachedImg);
                loadedIds.add(imgId);
                updated = true;
            } else {
                // 2. Fetch missing individual image on-demand from remote sub-node
                try {
                    const imgRes = await fetch(`${imagesBaseUrl}/${encodeURIComponent(imgId)}.json`, { cache: 'no-store' });
                    if (imgRes.ok) {
                        const imgNode = await imgRes.json();
                        if (imgNode && imgNode.payload) {
                            const imgStr = await CryptoEngine.decryptPayload(imgNode.payload, decryptionKey);
                            if (imgStr) {
                                try {
                                    const parsedImg = JSON.parse(imgStr);
                                    page.images.push(parsedImg);
                                    loadedIds.add(imgId);
                                    updated = true;
                                    if (window.ImageCacheManager) {
                                        ImageCacheManager.setImage(imgId, parsedImg);
                                    }
                                } catch (e) {}
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`Failed to fetch image ${imgId}`, e);
                }
            }
        }

        if (updated && page.id === AppState.activePageId && typeof renderImageGalleryView === 'function') {
            renderImageGalleryView(page);
        }
    }
}

