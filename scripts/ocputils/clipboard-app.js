// ==========================================
// ONLINE CLIPBOARD APP CONTROLLER
// ==========================================

const APP_CONFIG = {
    VERSION: 'v1.9.6',
    BUILD_TIME: '2026-08-05 11:18:00',
    AUTO_LOCK_MINUTES: 30, // Inactivity minutes before auto-locking (Format MM:SS displayed in header)
    POLL_INTERVAL_MS: 10000, // Background HTTPS REST polling interval (10 seconds)
    DEFAULT_ROOM_CODE: 'apilog',
    DEFAULT_FIREBASE_URL: 'https://bdi-online-clipboard-default-rtdb.asia-southeast1.firebasedatabase.app',
    DEFAULT_SUPABASE_URL: 'https://slezydyzcokhfzeifkwa.storage.supabase.co/storage/v1/s3',
    DEFAULT_SUPABASE_ANON_KEY: '1944573cea97e93e36ae1d99052da5f8011854b40bc032034f789852d8f22f71',
    DEFAULT_SUPABASE_BUCKET: 'bdioc-bucket'
};

const VERIFY_MAGIC_TOKEN = "ROOM_VERIFY_VALID_2026";

// Initialize Icons
if (window.lucide) {
    lucide.createIcons();
}

// Initialize Mermaid.js
if (window.mermaid) {
    mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'loose'
    });
}

// Configure Marked.js GFM & Custom Renderer
if (window.marked) {
    marked.use({ gfm: true, breaks: true });
    const renderer = new marked.Renderer();

    renderer.code = function (code, language) {
        const lang = (language || '').trim().toLowerCase();

        if (lang === 'mermaid') {
            const cleanCode = code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
            return `<div class="mermaid-container"><div class="mermaid">${escapeHtml(cleanCode)}</div></div>`;
        }

        if (lang && window.hljs && hljs.getLanguage(lang)) {
            try {
                const highlighted = hljs.highlight(code, { language: lang }).value;
                return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
            } catch (e) { }
        }

        return `<pre><code class="hljs">${escapeHtml(code)}</code></pre>`;
    };

    marked.setOptions({ renderer: renderer });
}

function getSupabaseHeaders(contentType = null) {
    const key = (APP_CONFIG.DEFAULT_SUPABASE_ANON_KEY || '').trim();
    const headers = {};
    if (key) {
        headers['apikey'] = key;
        headers['Authorization'] = `Bearer ${key}`;
    }
    if (contentType) {
        headers['Content-Type'] = contentType;
    }
    return headers;
}

// --- State Management ---
const AppState = {
    isUnlocked: false,
    roomCode: APP_CONFIG.DEFAULT_ROOM_CODE,
    syncProtocol: 'firebase_rest',
    customUrl: APP_CONFIG.DEFAULT_FIREBASE_URL,
    masterKey: null, // CryptoKey
    activePageId: 'page_1',
    lastUpdated: 0,
    lastActivityTime: Date.now(),
    pendingRemoteEnvelope: null,
    pendingRenamePageId: null,
    pendingDeletePageId: null,
    pages: [
        { id: 'page_1', name: 'Page 1 (General)', lang: 'plaintext', content: '' },
        { id: 'page_2', name: 'Page 2 (Snippets)', lang: 'markdown', content: '# Welcome to Markdown & Mermaid!\n\nHere is a GitHub Diff example:\n```diff\n- const oldSecret = "insecure";\n+ const newSecret = "AES-256-GCM";\n```\n\nHere is a Mermaid flowchart:\n```mermaid\ngraph TD;\n    A[Mobile Passkey] --> B(Firebase Database);\n    B --> C[Desktop Clipboard];\n```\n' }
    ],
    mqttClient: null,
    pollTimer: null,
    inactivityTimer: null,
    debounceTimer: null,
    resetBadgeTimer: null,
    tabInactiveTimer: null,
    isTabPollingPaused: false,
    isInitialLoaded: false,
    isFileUploadEnabled: false // Disabled on load for corporate firewall safety
};

// --- DOM Elements ---
const elements = {
    syncBanner: document.getElementById('syncBanner'),
    btnBannerRefresh: document.getElementById('btnBannerRefresh'),
    btnManualRefresh: document.getElementById('btnManualRefresh'),
    btnAddDomainPasskey: document.getElementById('btnAddDomainPasskey'),

    autoLockBadge: document.getElementById('autoLockBadge'),
    autoLockTimerText: document.getElementById('autoLockTimerText'),

    unlockModal: document.getElementById('unlockModal'),
    tabSelectExisting: document.getElementById('tabSelectExisting'),
    tabCreateNew: document.getElementById('tabCreateNew'),
    panelExistingRoom: document.getElementById('panelExistingRoom'),
    panelCreateRoom: document.getElementById('panelCreateRoom'),

    selectExistingRoom: document.getElementById('selectExistingRoom'),
    inputRoomCode: document.getElementById('inputRoomCode'),
    inputPassphrase: document.getElementById('inputPassphrase'),
    btnPasskeyAuthenticate: document.getElementById('btnPasskeyAuthenticate'),
    btnPassphraseAuthenticate: document.getElementById('btnPassphraseAuthenticate'),

    domainWarningContainer: document.getElementById('domainWarningContainer'),
    domainWarningText: document.getElementById('domainWarningText'),

    activeDomainWarningContainer: document.getElementById('activeDomainWarningContainer'),
    activeDomainWarningText: document.getElementById('activeDomainWarningText'),

    inputNewRoomCode: document.getElementById('inputNewRoomCode'),
    inputNewPassphrase: document.getElementById('inputNewPassphrase'),
    btnCreateRoom: document.getElementById('btnCreateRoom'),

    // Active Room Quick Re-Unlock Modal Elements
    activeRoomUnlockModal: document.getElementById('activeRoomUnlockModal'),
    lockedRoomCodeName: document.getElementById('lockedRoomCodeName'),
    btnActivePasskeyUnlock: document.getElementById('btnActivePasskeyUnlock'),
    inputActivePassphrase: document.getElementById('inputActivePassphrase'),
    btnActivePassphraseUnlock: document.getElementById('btnActivePassphraseUnlock'),
    btnSwitchRoomLink: document.getElementById('btnSwitchRoomLink'),

    // Custom Error Modal
    errorModal: document.getElementById('errorModal'),
    errorModalTitle: document.getElementById('errorModalTitle'),
    errorModalMessage: document.getElementById('errorModalMessage'),
    btnDismissError: document.getElementById('btnDismissError'),

    // Custom Modals
    renameModal: document.getElementById('renameModal'),
    inputRenameTitle: document.getElementById('inputRenameTitle'),
    btnCancelRename: document.getElementById('btnCancelRename'),
    btnSaveRename: document.getElementById('btnSaveRename'),

    deleteModal: document.getElementById('deleteModal'),
    deleteModalText: document.getElementById('deleteModalText'),
    btnCancelDelete: document.getElementById('btnCancelDelete'),
    btnConfirmDelete: document.getElementById('btnConfirmDelete'),

    syncProtocolSelect: document.getElementById('syncProtocolSelect'),
    customUrlContainer: document.getElementById('customUrlContainer'),
    customUrlLabel: document.getElementById('customUrlLabel'),
    inputCustomUrl: document.getElementById('inputCustomUrl'),

    btnLockUnlock: document.getElementById('btnLockUnlock'),
    lockIcon: document.getElementById('lockIcon'),
    lockBtnText: document.getElementById('lockBtnText'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    badgeStatus: document.getElementById('badgeStatus'),

    pageList: document.getElementById('pageList'),
    btnAddPage: document.getElementById('btnAddPage'),
    codeEditor: document.getElementById('codeEditor'),
    codeRender: document.getElementById('codeRender'),
    preContainer: document.getElementById('preContainer'),
    markdownRender: document.getElementById('markdownRender'),
    languageSelect: document.getElementById('languageSelect'),

    btnFormatJson: document.getElementById('btnFormatJson'),
    btnCopyContent: document.getElementById('btnCopyContent'),
    btnDownloadContent: document.getElementById('btnDownloadContent'),
    btnClearPage: document.getElementById('btnClearPage'),
    btnRoomConfig: document.getElementById('btnRoomConfig'),

    editorContainer: document.getElementById('editorContainer'),
    btnToggleEdit: document.getElementById('btnToggleEdit'),
    btnToggleCode: document.getElementById('btnToggleCode'),
    btnToggleSidebar: document.getElementById('btnToggleSidebar'),
    sidebar: document.getElementById('sidebar'),
    toast: document.getElementById('toast'),
    toastMsg: document.getElementById('toastMsg'),

    unlockModalVersionTag: document.getElementById('unlockModalVersionTag'),
    activeModalVersionTag: document.getElementById('activeModalVersionTag'),

    // Room Info Modal Elements
    roomInfoModal: document.getElementById('roomInfoModal'),
    btnCloseRoomInfo: document.getElementById('btnCloseRoomInfo'),
    btnDismissRoomInfo: document.getElementById('btnDismissRoomInfo'),
    btnInfoSwitchRoom: document.getElementById('btnInfoSwitchRoom'),
    btnInfoAddPasskey: document.getElementById('btnInfoAddPasskey'),
    btnInfoResetPassphrase: document.getElementById('btnInfoResetPassphrase'),
    infoRoomCode: document.getElementById('infoRoomCode'),
    infoSecurityStatus: document.getElementById('infoSecurityStatus'),
    infoHostDomain: document.getElementById('infoHostDomain'),
    infoPasskeyStatus: document.getElementById('infoPasskeyStatus'),
    infoRelayProtocol: document.getElementById('infoRelayProtocol'),
    infoPageCount: document.getElementById('infoPageCount'),
    infoModalVersionTag: document.getElementById('infoModalVersionTag'),
    debugPasskeyPanel: document.getElementById('debugPasskeyPanel'),
    debugPasskeyContainer: document.getElementById('debugPasskeyContainer'),

    // Reset Passphrase Modal Elements
    resetPassphraseModal: document.getElementById('resetPassphraseModal'),
    resetRoomCodeName: document.getElementById('resetRoomCodeName'),
    inputNewResetPassphrase: document.getElementById('inputNewResetPassphrase'),
    btnCancelResetPassphrase: document.getElementById('btnCancelResetPassphrase'),
    btnSaveResetPassphrase: document.getElementById('btnSaveResetPassphrase'),

    sidebarDbSizeBadge: document.getElementById('sidebarDbSizeBadge'),

    // Image Gallery & Lightbox Elements
    editorPane: document.getElementById('editorPane'),
    renderPane: document.getElementById('renderPane'),
    imageGalleryContainer: document.getElementById('imageGalleryContainer'),
    selectImageTargetRes: document.getElementById('selectImageTargetRes'),
    btnBatchResizeImages: document.getElementById('btnBatchResizeImages'),
    imageDropzoneDesc: document.getElementById('imageDropzoneDesc'),
    imageDropzone: document.getElementById('imageDropzone'),
    imageFileInput: document.getElementById('imageFileInput'),
    imageGalleryGrid: document.getElementById('imageGalleryGrid'),
    createPageTypeModal: document.getElementById('createPageTypeModal'),
    btnChooseTextPage: document.getElementById('btnChooseTextPage'),
    btnChooseImagePage: document.getElementById('btnChooseImagePage'),
    btnChooseFilePage: document.getElementById('btnChooseFilePage'),
    btnCancelCreatePageType: document.getElementById('btnCancelCreatePageType'),

    // File Bucket Elements
    fileBucketContainer: document.getElementById('fileBucketContainer'),
    selectBucketProvider: document.getElementById('selectBucketProvider'),
    badgeBucketProvider: document.getElementById('badgeBucketProvider'),
    btnToggleEnableUploads: document.getElementById('btnToggleEnableUploads'),
    textToggleUploads: document.getElementById('textToggleUploads'),
    iconUploadStatus: document.getElementById('iconUploadStatus'),
    titleFileDropzone: document.getElementById('titleFileDropzone'),
    iconFileDropzone: document.getElementById('iconFileDropzone'),
    fileDropzone: document.getElementById('fileDropzone'),
    fileDropzoneDesc: document.getElementById('fileDropzoneDesc'),
    bucketFileInput: document.getElementById('bucketFileInput'),
    fileBucketGrid: document.getElementById('fileBucketGrid'),

    imageLightboxModal: document.getElementById('imageLightboxModal'),
    btnCloseLightbox: document.getElementById('btnCloseLightbox'),
    lightboxImage: document.getElementById('lightboxImage'),
    lightboxMetaName: document.getElementById('lightboxMetaName'),
    lightboxMetaRes: document.getElementById('lightboxMetaRes'),
    lightboxMetaSize: document.getElementById('lightboxMetaSize'),
    lightboxMetaFormat: document.getElementById('lightboxMetaFormat'),

    // Batch Resize Modal Elements
    resizeImagesModal: document.getElementById('resizeImagesModal'),
    resizeModalImageCount: document.getElementById('resizeModalImageCount'),
    resizeModalTargetRes: document.getElementById('resizeModalTargetRes'),
    btnCancelResizeImages: document.getElementById('btnCancelResizeImages'),
    btnConfirmResizeImages: document.getElementById('btnConfirmResizeImages'),

    // Dynamic Stats Bar Elements
    statCharCount: document.getElementById('statCharCount'),
    statWordCount: document.getElementById('statWordCount'),
    statLineCount: document.getElementById('statLineCount'),
    statLanguage: document.getElementById('statLanguage'),
    statSecurity: document.getElementById('statSecurity')
};

// Render Version & Build Time on Modals
const buildVerString = `${APP_CONFIG.VERSION} • Build: ${APP_CONFIG.BUILD_TIME}`;
if (elements.unlockModalVersionTag) elements.unlockModalVersionTag.textContent = buildVerString;
if (elements.activeModalVersionTag) elements.activeModalVersionTag.textContent = buildVerString;
if (elements.infoModalVersionTag) elements.infoModalVersionTag.textContent = buildVerString;

// --- Custom Error Modal Handler ---
function showErrorModal(title, message) {
    elements.errorModalTitle.textContent = title || "Authentication Error";
    elements.errorModalMessage.textContent = message || "An unexpected error occurred.";
    elements.errorModal.classList.add('active');
    if (window.lucide) lucide.createIcons();
}

if (elements.btnDismissError) {
    elements.btnDismissError.addEventListener('click', () => {
        elements.errorModal.classList.remove('active');
    });
}

// --- Auto-Lock & Inactivity Countdown Manager ---
function resetInactivityTimer() {
    AppState.lastActivityTime = Date.now();
}

// 1-Second Ticker for Inactivity Countdown (mm:ss)
setInterval(() => {
    if (!AppState.isUnlocked) {
        elements.autoLockBadge.style.display = 'none';
        elements.btnAddDomainPasskey.style.display = 'none';
        return;
    }

    elements.autoLockBadge.style.display = 'inline-flex';
    const totalSec = APP_CONFIG.AUTO_LOCK_MINUTES * 60;
    const elapsedSec = Math.floor((Date.now() - AppState.lastActivityTime) / 1000);
    const remainingSec = Math.max(0, totalSec - elapsedSec);

    const m = Math.floor(remainingSec / 60).toString().padStart(2, '0');
    const s = (remainingSec % 60).toString().padStart(2, '0');
    elements.autoLockTimerText.textContent = `${m}:${s}`;

    // Auto-lock when timer reaches 0
    if (remainingSec <= 0 && AppState.isUnlocked) {
        lockClipboard();
        showToast(`Clipboard auto-locked (${APP_CONFIG.AUTO_LOCK_MINUTES}m inactivity)`);
    }
}, 1000);

// --- 30s Tab & Window Inactivity Monitor for Polling Pause ---
function handleTabInactivityStart() {
    if (AppState.tabInactiveTimer) clearTimeout(AppState.tabInactiveTimer);
    AppState.tabInactiveTimer = setTimeout(() => {
        if (AppState.isUnlocked && !AppState.isTabPollingPaused) {
            AppState.isTabPollingPaused = true;
            setSyncStatus('connected', 'Sync Paused (Tab Inactive)');
            console.log("Tab inactive for 30s: Paused background polling.");
        }
    }, 30000);
}

function handleTabActivityResume() {
    if (AppState.tabInactiveTimer) {
        clearTimeout(AppState.tabInactiveTimer);
        AppState.tabInactiveTimer = null;
    }
    if (AppState.isUnlocked && AppState.isTabPollingPaused) {
        AppState.isTabPollingPaused = false;
        setSyncStatus('connected', 'Resuming Sync...');
        console.log("Tab resumed: Restoring sync.");
        if (SyncManager && SyncManager.pollHttpsRest) {
            const endpoint = SyncManager.getEndpointUrl(AppState.roomCode, AppState.syncProtocol);
            SyncManager.pollHttpsRest(endpoint, AppState.masterKey, AppState.syncProtocol, true);
        }
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        handleTabInactivityStart();
    } else {
        handleTabActivityResume();
    }
});
window.addEventListener('blur', handleTabInactivityStart);
window.addEventListener('focus', handleTabActivityResume);

// 2-Panel Switcher Listeners
if (elements.tabSelectExisting) {
    elements.tabSelectExisting.addEventListener('click', () => {
        elements.tabSelectExisting.classList.add('active');
        elements.tabCreateNew.classList.remove('active');
        elements.panelExistingRoom.style.display = 'flex';
        elements.panelCreateRoom.style.display = 'none';
    });
}

if (elements.tabCreateNew) {
    elements.tabCreateNew.addEventListener('click', () => {
        elements.tabCreateNew.classList.add('active');
        elements.tabSelectExisting.classList.remove('active');
        elements.panelCreateRoom.style.display = 'flex';
        elements.panelExistingRoom.style.display = 'none';
    });
}

// UI Status Helper
function setSyncStatus(state, message) {
    clearTimeout(AppState.resetBadgeTimer);
    elements.badgeStatus.className = 'badge-status';

    if (state === 'syncing') {
        elements.badgeStatus.classList.add('syncing');
        elements.badgeStatus.innerHTML = `
            <i data-lucide="refresh-cw" class="spin-icon" style="width: 12px; height: 12px;"></i>
            <span>${message || 'Syncing...'}</span>
        `;
    } else if (state === 'updated') {
        elements.badgeStatus.classList.add('updated');
        elements.badgeStatus.innerHTML = `
            <i data-lucide="check" style="width: 12px; height: 12px; color: var(--accent-green);"></i>
            <span>${message || 'Synced!'}</span>
        `;
        AppState.resetBadgeTimer = setTimeout(() => {
            setSyncStatus('connected', `Synced (${AppState.syncProtocol.split('_')[0].toUpperCase()})`);
        }, 2000);
    } else if (state === 'connected') {
        elements.badgeStatus.innerHTML = `
            <span class="status-dot connected"></span>
            <span>${message || 'Synced'}</span>
        `;
    } else {
        elements.badgeStatus.innerHTML = `
            <span class="status-dot locked"></span>
            <span>${message || 'Locked'}</span>
        `;
    }
    if (window.lucide) lucide.createIcons();
}

// Apply Pending Remote Sync
function applyPendingSync() {
    if (AppState.pendingRemoteEnvelope) {
        const env = AppState.pendingRemoteEnvelope;
        AppState.lastUpdated = env.lastUpdated;
        AppState.pages = env.pages;
        AppState.pendingRemoteEnvelope = null;

        renderPageList();
        updateEditorView();
        elements.syncBanner.classList.remove('show');
        setSyncStatus('updated', 'Remote update synced!');
        showToast("Clipboard synced from remote!");
    }
}

if (elements.btnBannerRefresh) elements.btnBannerRefresh.addEventListener('click', applyPendingSync);
if (elements.btnManualRefresh) {
    elements.btnManualRefresh.addEventListener('click', () => {
        if (AppState.pendingRemoteEnvelope) {
            applyPendingSync();
        } else {
            setSyncStatus('syncing', 'Checking remote...');
            SyncManager.pollHttpsRest(SyncManager.getEndpointUrl(AppState.roomCode, AppState.syncProtocol), AppState.masterKey, AppState.syncProtocol, true);
        }
    });
}

// Fetch Existing Rooms from Database
async function fetchExistingRooms() {
    const base = (elements.inputCustomUrl.value || AppState.customUrl).trim().replace(/\/+$/, '').replace(/\/rooms\/.*$/, '');
    if (!base) return;

    try {
        const res = await fetch(`${base}/rooms.json?shallow=true`, { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            if (data) {
                elements.selectExistingRoom.innerHTML = '<option value="">-- Select Existing Room --</option>';
                Object.keys(data).forEach(room => {
                    const opt = document.createElement('option');
                    opt.value = room;
                    opt.textContent = `Room: ${room}`;
                    if (room === elements.inputRoomCode.value) opt.selected = true;
                    elements.selectExistingRoom.appendChild(opt);
                });
            }
        }
    } catch (e) { }
}

if (elements.selectExistingRoom) {
    elements.selectExistingRoom.addEventListener('change', (e) => {
        if (e.target.value) {
            elements.inputRoomCode.value = e.target.value;
            checkDomainPasskeyRegistration(e.target.value);
        }
    });
}

if (elements.inputRoomCode) {
    elements.inputRoomCode.addEventListener('input', (e) => {
        checkDomainPasskeyRegistration(e.target.value.trim());
    });
}

// Toggle Custom URL Input
function updateProtocolUI() {
    const val = elements.syncProtocolSelect.value;
    if (val === 'firebase_rest') {
        elements.customUrlContainer.style.display = 'flex';
        elements.customUrlLabel.textContent = 'Firebase Database URL';
        if (!elements.inputCustomUrl.value) {
            elements.inputCustomUrl.value = APP_CONFIG.DEFAULT_FIREBASE_URL;
        }
    } else if (val === 'custom_rest') {
        elements.customUrlContainer.style.display = 'flex';
        elements.customUrlLabel.textContent = 'Custom HTTPS Endpoint URL';
        elements.inputCustomUrl.placeholder = 'https://api.mycompany.com/clipboard/{roomCode}';
    } else {
        elements.customUrlContainer.style.display = 'none';
    }
    fetchExistingRooms();
}

if (elements.syncProtocolSelect) elements.syncProtocolSelect.addEventListener('change', updateProtocolUI);
if (elements.inputCustomUrl) elements.inputCustomUrl.addEventListener('change', fetchExistingRooms);

// Check if current domain has a passkey registered for the target room
async function checkDomainPasskeyRegistration(roomCode) {
    if (!roomCode) {
        elements.domainWarningContainer.style.display = 'none';
        elements.activeDomainWarningContainer.style.display = 'none';
        elements.btnAddDomainPasskey.style.display = 'none';
        return;
    }

    const currentDomain = window.location.hostname || "localhost";
    const base = (elements.inputCustomUrl.value || AppState.customUrl).trim().replace(/\/+$/, '').replace(/\/rooms\/.*$/, '');
    const metaEndpoint = `${base}/rooms/${encodeURIComponent(roomCode)}/meta.json`;

    try {
        const res = await fetch(metaEndpoint, { cache: 'no-store' });
        if (res.ok) {
            const roomMeta = await res.json();
            if (roomMeta && roomMeta.passkeys) {
                const validCreds = Object.keys(roomMeta.passkeys).filter(id => {
                    const entry = roomMeta.passkeys[id];
                    return entry.rpId === currentDomain;
                });

                if (validCreds.length === 0) {
                    // Passkey DOES NOT exist for this domain -> show warning & enable + Domain Passkey button if unlocked
                    const msg = `No Passkey registered for domain "${currentDomain}". Unlock via Passphrase below, then click "+ Domain Passkey".`;
                    elements.domainWarningText.textContent = msg;
                    elements.activeDomainWarningText.textContent = msg;
                    elements.domainWarningContainer.style.display = 'flex';
                    elements.activeDomainWarningContainer.style.display = 'flex';
                    if (AppState.isUnlocked) {
                        elements.btnAddDomainPasskey.style.display = 'inline-flex';
                    }
                    if (window.lucide) lucide.createIcons();
                    return false;
                }
            }
        }
    } catch (e) { }

    // Passkey ALREADY exists for this domain -> hide warning box and hide + Domain Passkey button
    elements.domainWarningContainer.style.display = 'none';
    elements.activeDomainWarningContainer.style.display = 'none';
    elements.btnAddDomainPasskey.style.display = 'none';
    return true;
}

// --- Toast Notification ---
function showToast(msg) {
    elements.toastMsg.textContent = msg;
    elements.toast.classList.add('show');
    setTimeout(() => elements.toast.classList.remove('show'), 2500);
}

// --- Page & View Controller ---
function renderPageList() {
    elements.pageList.innerHTML = '';
    AppState.pages.forEach(page => {
        const item = document.createElement('div');
        const isImagePage = page.type === 'image';
        const isFilePage = page.type === 'file';
        let iconName = 'file-text';
        let iconColorStyle = '';

        if (isImagePage) {
            iconName = 'image';
            iconColorStyle = 'color: var(--accent-green);';
        } else if (isFilePage) {
            iconName = 'folder-archive';
            iconColorStyle = 'color: var(--accent-cyan);';
        }

        item.className = `page-item ${page.id === AppState.activePageId ? 'active' : ''}`;
        item.innerHTML = `
            <div class="page-item-info">
                <i data-lucide="${iconName}" style="width: 15px; height: 15px; ${iconColorStyle}"></i>
                <span>${escapeHtml(page.name)}</span>
            </div>
            <div class="page-actions">
                <button class="page-action-btn btn-rename" title="Rename"><i data-lucide="edit-2" style="width: 13px; height: 13px;"></i></button>
                ${AppState.pages.length > 1 ? '<button class="page-action-btn btn-delete" title="Delete"><i data-lucide="trash" style="width: 13px; height: 13px;"></i></button>' : ''}
            </div>
        `;

        item.addEventListener('click', (e) => {
            if (e.target.closest('.btn-rename')) {
                e.stopPropagation();
                openRenameModal(page);
                return;
            }

            if (e.target.closest('.btn-delete')) {
                e.stopPropagation();
                openDeleteModal(page);
                return;
            }

            AppState.activePageId = page.id;
            renderPageList();
            updateEditorView();

            // Auto-close sidebar on mobile after selecting page
            if (window.innerWidth <= 868) {
                elements.sidebar.classList.remove('open');
            }
        });

        elements.pageList.appendChild(item);
    });
    if (window.lucide) lucide.createIcons();
}

// --- Modal Dialog Handlers for Rename & Delete ---
function openRenameModal(page) {
    AppState.pendingRenamePageId = page.id;
    elements.inputRenameTitle.value = page.name;
    elements.renameModal.classList.add('active');
    setTimeout(() => elements.inputRenameTitle.focus(), 100);
}

function closeRenameModal() {
    AppState.pendingRenamePageId = null;
    elements.renameModal.classList.remove('active');
}

if (elements.btnCancelRename) elements.btnCancelRename.addEventListener('click', closeRenameModal);
if (elements.btnSaveRename) {
    elements.btnSaveRename.addEventListener('click', () => {
        if (AppState.pendingRenamePageId) {
            const page = AppState.pages.find(p => p.id === AppState.pendingRenamePageId);
            const newTitle = elements.inputRenameTitle.value.trim();
            if (page && newTitle) {
                page.name = newTitle;
                renderPageList();
                SyncManager.broadcastState();
            }
        }
        closeRenameModal();
    });
}

function openDeleteModal(page) {
    AppState.pendingDeletePageId = page.id;
    elements.deleteModalText.textContent = `Are you sure you want to delete "${page.name}"?`;
    elements.deleteModal.classList.add('active');
}

function closeDeleteModal() {
    AppState.pendingDeletePageId = null;
    elements.deleteModal.classList.remove('active');
}

if (elements.btnCancelDelete) elements.btnCancelDelete.addEventListener('click', closeDeleteModal);
if (elements.btnConfirmDelete) {
    elements.btnConfirmDelete.addEventListener('click', async () => {
        if (AppState.pendingDeletePageId) {
            const pageToDelete = AppState.pages.find(p => p.id === AppState.pendingDeletePageId);
            const imageIds = pageToDelete && pageToDelete.type === 'image' && Array.isArray(pageToDelete.images) ? pageToDelete.images.map(i => i.id) : [];
            const deletedId = AppState.pendingDeletePageId;

            AppState.pages = AppState.pages.filter(p => p.id !== deletedId);
            if (AppState.activePageId === deletedId) {
                AppState.activePageId = AppState.pages.length > 0 ? AppState.pages[0].id : 'page_1';
            }
            renderPageList();
            updateEditorView();

            if (SyncManager.deletePage) {
                await SyncManager.deletePage(deletedId, imageIds);
            } else {
                SyncManager.broadcastState();
            }
        }
        closeDeleteModal();
    });
}

function getActivePage() {
    return AppState.pages.find(p => p.id === AppState.activePageId) || AppState.pages[0];
}

function updateEditorStats() {
    if (!elements.statCharCount) return;
    const text = elements.codeEditor ? elements.codeEditor.value || '' : '';
    const chars = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const lines = text ? text.split('\n').length : 0;
    const selectedOpt = elements.languageSelect ? elements.languageSelect.options[elements.languageSelect.selectedIndex] : null;
    const lang = selectedOpt ? selectedOpt.text : 'Plain Text';

    elements.statCharCount.textContent = chars.toLocaleString();
    elements.statWordCount.textContent = words.toLocaleString();
    elements.statLineCount.textContent = lines.toLocaleString();
    elements.statLanguage.textContent = lang;

    if (elements.statSecurity) {
        if (AppState.isUnlocked) {
            elements.statSecurity.innerHTML = '<span style="color: var(--accent-green); display: inline-flex; align-items: center; gap: 4px;"><i data-lucide="shield-check" style="width: 13px; height: 13px;"></i> Encrypted & Synced</span>';
        } else {
            elements.statSecurity.innerHTML = '<span style="color: var(--accent-rose); display: inline-flex; align-items: center; gap: 4px;"><i data-lucide="shield-alert" style="width: 13px; height: 13px;"></i> Locked</span>';
        }
        if (window.lucide) lucide.createIcons();
    }
}

function updateEditorView() {
    const page = getActivePage();

    if (page.type === 'image') {
        // Full Width Image Mode
        if (elements.editorContainer) elements.editorContainer.classList.add('image-mode');
        if (elements.editorPane) elements.editorPane.style.display = 'none';
        if (elements.renderPane) elements.renderPane.style.display = 'none';
        if (elements.fileBucketContainer) elements.fileBucketContainer.style.display = 'none';
        if (elements.imageGalleryContainer) elements.imageGalleryContainer.style.display = 'flex';
        renderImageGalleryView(page);
        if (window.SyncManager) {
            SyncManager.ensurePageImagesLoaded(page, AppState.masterKey);
        }
    } else if (page.type === 'file') {
        // Full Width File Bucket Mode
        if (elements.editorContainer) elements.editorContainer.classList.add('image-mode');
        if (elements.editorPane) elements.editorPane.style.display = 'none';
        if (elements.renderPane) elements.renderPane.style.display = 'none';
        if (elements.imageGalleryContainer) elements.imageGalleryContainer.style.display = 'none';
        if (elements.fileBucketContainer) elements.fileBucketContainer.style.display = 'flex';
        renderFileBucketView(page);
    } else {
        // Dual Pane Text Editor Mode
        if (elements.editorContainer) elements.editorContainer.classList.remove('image-mode');
        if (elements.imageGalleryContainer) elements.imageGalleryContainer.style.display = 'none';
        if (elements.fileBucketContainer) elements.fileBucketContainer.style.display = 'none';
        if (elements.editorPane) elements.editorPane.style.display = 'flex';
        if (elements.renderPane) elements.renderPane.style.display = 'flex';

        if (document.activeElement !== elements.codeEditor) {
            elements.codeEditor.value = page.content || '';
        }
        elements.languageSelect.value = page.lang || 'plaintext';
        renderSyntaxHighlighting();
        updateEditorStats();
    }
}

// Helper: Calculate & Display Estimated Room DB Payload Size Summary
function updateSidebarDbSizeSummary() {
    if (!elements.sidebarDbSizeBadge) return;
    let totalBytes = 0;

    AppState.pages.forEach(page => {
        if (page.type === 'image') {
            (page.images || []).forEach(img => {
                if (img.dataUrl) totalBytes += img.dataUrl.length;
            });
        } else {
            if (page.content) totalBytes += new TextEncoder().encode(page.content).length;
        }
    });

    let displayStr = '0 KB';
    if (totalBytes < 1024) {
        displayStr = `${totalBytes} B`;
    } else if (totalBytes < 1024 * 1024) {
        displayStr = `${(totalBytes / 1024).toFixed(1)} KB`;
    } else {
        displayStr = `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    elements.sidebarDbSizeBadge.textContent = `Est. DB: ${displayStr}`;
}

// --- Image Compression Engine (Dynamic Aspect Ratio Scaling) ---
function compressImageTo720p(fileOrBlobInput, targetMaxDim = 720) {
    return new Promise((resolve, reject) => {
        const processDataUrl = (dataUrl) => {
            const img = new Image();
            img.onload = () => {
                const MAX_DIM = parseInt(targetMaxDim, 10);
                let width = img.width;
                let height = img.height;

                if (MAX_DIM > 0 && (width > MAX_DIM || height > MAX_DIM)) {
                    if (width > height) {
                        height = Math.round((height * MAX_DIM) / width);
                        width = MAX_DIM;
                    } else {
                        width = Math.round((width * MAX_DIM) / height);
                        height = MAX_DIM;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Feature detect AVIF support, fallback to WebP
                let format = 'image/webp';
                try {
                    const testUrl = canvas.toDataURL('image/avif');
                    if (testUrl.startsWith('data:image/avif')) {
                        format = 'image/avif';
                    }
                } catch (e) { }

                const quality = format === 'image/avif' ? 0.65 : 0.70;
                const compressedDataUrl = canvas.toDataURL(format, quality);
                const sizeKB = Math.round((compressedDataUrl.length * 0.75) / 1024);

                resolve({
                    dataUrl: compressedDataUrl,
                    width: width,
                    height: height,
                    sizeKB: sizeKB
                });
            };
            img.onerror = () => reject(new Error("Failed loading image for processing."));
            img.src = dataUrl;
        };

        if (typeof fileOrBlobInput === 'string') {
            processDataUrl(fileOrBlobInput);
        } else {
            const reader = new FileReader();
            reader.onload = (e) => processDataUrl(e.target.result);
            reader.onerror = () => reject(new Error("Failed reading file."));
            reader.readAsDataURL(fileOrBlobInput);
        }
    });
}

// --- Image Gallery Renderer ---
function renderImageGalleryView(page) {
    if (!elements.imageGalleryGrid) return;
    elements.imageGalleryGrid.innerHTML = '';
    const images = page.images || [];

    // Set resolution dropdown to match page setting
    const targetRes = page.targetRes !== undefined ? page.targetRes : 720;
    if (elements.selectImageTargetRes) elements.selectImageTargetRes.value = String(targetRes);

    const resLabel = targetRes == 0 ? 'Original' : `${targetRes}p`;
    if (elements.imageDropzoneDesc) {
        elements.imageDropzoneDesc.textContent = `Supports PNG, JPG, WebP. Images are automatically scaled to ${resLabel} & encrypted.`;
    }

    if (images.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.style.gridColumn = '1 / -1';
        emptyState.style.textAlign = 'center';
        emptyState.style.padding = '40px 20px';
        emptyState.style.color = 'var(--text-muted)';
        emptyState.style.fontSize = '0.85rem';

        if (page._isLoadingImages) {
            emptyState.innerHTML = `
                <i data-lucide="loader-2" style="width: 36px; height: 36px; margin-bottom: 8px; color: var(--accent-primary); animation: spin 1s linear infinite;"></i>
                <div style="font-weight: 500;">Loading gallery images...</div>
                <div style="font-size: 0.75rem; margin-top: 4px; color: var(--text-dim);">Fetching encrypted image payloads from database</div>
            `;
        } else {
            emptyState.innerHTML = `
                <i data-lucide="image-off" style="width: 36px; height: 36px; margin-bottom: 8px; color: var(--text-dim);"></i>
                <div>No images stored in this gallery yet.</div>
                <div style="font-size: 0.75rem; margin-top: 4px;">Paste an image with <strong>Ctrl+V</strong> or click above to upload.</div>
            `;
        }

        elements.imageGalleryGrid.appendChild(emptyState);
        updateSidebarDbSizeSummary();
        if (window.lucide) lucide.createIcons();
        return;
    }

    images.forEach(imgItem => {
        const card = document.createElement('div');
        card.className = 'image-card';
        const dateStr = imgItem.timestamp ? new Date(imgItem.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const metaStr = `${imgItem.sizeKB ? imgItem.sizeKB + ' KB' : '720p'} • ${dateStr}`;

        card.innerHTML = `
            <div class="image-preview-wrapper" title="Click to enlarge">
                <img src="${imgItem.dataUrl}" alt="${escapeHtml(imgItem.name || 'Gallery Image')}">
            </div>
            <div class="image-card-footer">
                <div class="image-card-info">
                    <span class="image-card-name">${escapeHtml(imgItem.name || 'Pasted Image')}</span>
                    <span class="image-card-meta">${escapeHtml(metaStr)}</span>
                </div>
                <div class="image-card-actions">
                    <button class="image-card-btn btn-copy-img" title="Copy Image to Clipboard"><i data-lucide="copy" style="width: 13px; height: 13px;"></i></button>
                    <button class="image-card-btn btn-download-img" title="Download Image"><i data-lucide="download" style="width: 13px; height: 13px;"></i></button>
                    <button class="image-card-btn btn-delete-img" title="Delete Image"><i data-lucide="trash-2" style="width: 13px; height: 13px;"></i></button>
                </div>
            </div>
        `;

        // Click wrapper -> Open Lightbox & Populate Side Panel Metadata
        card.querySelector('.image-preview-wrapper').addEventListener('click', () => {
            elements.lightboxImage.src = imgItem.dataUrl;
            if (elements.lightboxMetaName) elements.lightboxMetaName.textContent = imgItem.name || 'Pasted Image';
            if (elements.lightboxMetaSize) {
                const bytes = imgItem.dataUrl ? imgItem.dataUrl.length : 0;
                const kbStr = imgItem.sizeKB ? `${imgItem.sizeKB} KB` : `${Math.round(bytes / 1024)} KB`;
                elements.lightboxMetaSize.textContent = `${kbStr} (${bytes.toLocaleString()} bytes)`;
            }

            // Calculate actual image width x height
            if (elements.lightboxMetaRes) {
                elements.lightboxMetaRes.textContent = 'Calculating...';
                const tempImg = new Image();
                tempImg.onload = () => {
                    elements.lightboxMetaRes.textContent = `${tempImg.naturalWidth} x ${tempImg.naturalHeight} px`;
                };
                tempImg.src = imgItem.dataUrl;
            }

            elements.imageLightboxModal.classList.add('active');
        });

        // Copy Image to Clipboard
        card.querySelector('.btn-copy-img').addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const res = await fetch(imgItem.dataUrl);
                const blob = await res.blob();
                await navigator.clipboard.write([
                    new ClipboardItem({ [blob.type]: blob })
                ]);
                showToast("Copied image to clipboard!");
            } catch (err) {
                showToast("Copy failed: Browser permission required.");
            }
        });

        // Download Image
        card.querySelector('.btn-download-img').addEventListener('click', (e) => {
            e.stopPropagation();
            const a = document.createElement('a');
            a.href = imgItem.dataUrl;
            a.download = `${(imgItem.name || 'image').replace(/\s+/g, '_')}_720p.webp`;
            a.click();
        });

        // Delete Image
        card.querySelector('.btn-delete-img').addEventListener('click', (e) => {
            e.stopPropagation();
            page.images = page.images.filter(i => i.id !== imgItem.id);
            renderImageGalleryView(page);
            SyncManager.broadcastState();
            showToast("Deleted image.");
        });

        elements.imageGalleryGrid.appendChild(card);
    });

    if (page._isLoadingImages && page.imageManifest && Array.isArray(page.imageManifest)) {
        const pendingCount = Math.max(0, page.imageManifest.length - images.length);
        for (let i = 0; i < pendingCount; i++) {
            const skeleton = document.createElement('div');
            skeleton.className = 'image-card';
            skeleton.style.opacity = '0.6';
            skeleton.innerHTML = `
                <div class="image-preview-wrapper" style="display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.03);">
                    <i data-lucide="loader-2" style="width: 24px; height: 24px; color: var(--accent-primary); animation: spin 1s linear infinite;"></i>
                </div>
                <div class="image-card-footer">
                    <div class="image-card-info">
                        <span class="image-card-name" style="color: var(--text-dim);">Loading image...</span>
                    </div>
                </div>
            `;
            elements.imageGalleryGrid.appendChild(skeleton);
        }
    }

    updateSidebarDbSizeSummary();
    if (window.lucide) lucide.createIcons();
}

async function addCompressedImageToPage(fileOrBlob, customName = null) {
    const page = getActivePage();
    if (page.type !== 'image') return;
    if (!page.images) page.images = [];

    const targetRes = page.targetRes !== undefined ? page.targetRes : 720;
    const resLabel = targetRes == 0 ? 'Original' : `${targetRes}p`;
    showToast(`Scaling image to ${resLabel}...`);

    try {
        const compressed = await compressImageTo720p(fileOrBlob, targetRes);
        const newImg = {
            id: 'img_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            name: customName || `Image #${page.images.length + 1}`,
            dataUrl: compressed.dataUrl,
            sizeKB: compressed.sizeKB,
            timestamp: Date.now()
        };
        page.images.unshift(newImg); // Prepend to top
        renderImageGalleryView(page);
        SyncManager.broadcastState();
        showToast(`Added image (${resLabel}, ${compressed.sizeKB} KB)!`);
    } catch (err) {
        showErrorModal("Image Processing Error", err.message);
    }
}

// --- File Bucket Renderer & Multi-Provider Uploader ---
function renderFileBucketView(page) {
    if (!elements.fileBucketGrid) return;
    elements.fileBucketGrid.innerHTML = '';
    const files = page.files || [];

    const activeProvider = page.provider || 'supabase_storage';
    if (elements.selectBucketProvider) elements.selectBucketProvider.value = activeProvider;

    if (elements.badgeBucketProvider) {
        const providerNames = {
            firebase_rtdb: 'Firebase RTDB (Inline Sub-nodes)',
            supabase_storage: 'Supabase Storage (Free Plan Bucket)',
            firebase_storage: 'Firebase Storage (GCS Bucket)',
            catbox: 'Catbox.moe (Public Free Host)',
            custom_r2: 'Cloudflare R2 / Custom Presigned API'
        };
        elements.badgeBucketProvider.textContent = `Provider: ${providerNames[activeProvider] || activeProvider}`;
    }

    if (files.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.style.gridColumn = '1 / -1';
        emptyState.style.textAlign = 'center';
        emptyState.style.padding = '40px 20px';
        emptyState.style.color = 'var(--text-muted)';
        emptyState.style.fontSize = '0.85rem';
        emptyState.innerHTML = `
            <i data-lucide="folder-open" style="width: 36px; height: 36px; margin-bottom: 8px; color: var(--text-dim);"></i>
            <div>No files stored in this bucket yet.</div>
            <div style="font-size: 0.75rem; margin-top: 4px;">Drag and drop any file or click above to upload encrypted attachments.</div>
        `;
        elements.fileBucketGrid.appendChild(emptyState);
        updateSidebarDbSizeSummary();
        if (window.lucide) lucide.createIcons();
        return;
    }

    files.forEach(fileItem => {
        const card = document.createElement('div');
        card.className = 'image-card';
        const dateStr = fileItem.timestamp ? new Date(fileItem.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const metaStr = `${fileItem.sizeKB ? fileItem.sizeKB + ' KB' : 'File'} • ${fileItem.provider || 'supabase_storage'} • ${dateStr}`;

        card.innerHTML = `
            <div class="image-preview-wrapper" style="display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.8); gap: 8px;" title="${escapeHtml(fileItem.name)}">
                <i data-lucide="file-archive" style="width: 40px; height: 40px; color: var(--accent-cyan);"></i>
                <span style="font-size: 0.75rem; color: var(--text-muted); max-width: 90%; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(fileItem.mimeType || 'Binary')}</span>
            </div>
            <div class="image-card-footer">
                <div class="image-card-info">
                    <span class="image-card-name">${escapeHtml(fileItem.name || 'Attachment')}</span>
                    <span class="image-card-meta">${escapeHtml(metaStr)}</span>
                </div>
                <div class="image-card-actions">
                    <button class="image-card-btn btn-download-file" title="Download File"><i data-lucide="download" style="width: 13px; height: 13px;"></i></button>
                    <button class="image-card-btn btn-delete-file" title="Delete File"><i data-lucide="trash-2" style="width: 13px; height: 13px;"></i></button>
                </div>
            </div>
        `;

        // Download & Decrypt file item
        card.querySelector('.btn-download-file').addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                if (fileItem.encryptedPayload) {
                    // Decrypt local or inline payload
                    const decryptedStr = await CryptoEngine.decryptPayload(fileItem.encryptedPayload, AppState.masterKey);
                    if (decryptedStr) {
                        const a = document.createElement('a');
                        a.href = decryptedStr;
                        a.download = fileItem.name || 'attachment';
                        a.click();
                    }
                } else if (fileItem.url) {
                    showToast("Downloading & decrypting file...");
                    const res = await fetch(fileItem.url, {
                        headers: fileItem.provider === 'supabase_storage' ? getSupabaseHeaders() : {}
                    });

                    if (!res.ok) throw new Error(`Download failed HTTP ${res.status}`);
                    const encryptedCipher = await res.text();
                    const decryptedDataUrl = await CryptoEngine.decryptPayload(encryptedCipher, AppState.masterKey);

                    if (decryptedDataUrl) {
                        const a = document.createElement('a');
                        a.href = decryptedDataUrl;
                        a.download = fileItem.name || 'attachment';
                        a.click();
                        showToast("Decrypted and saved file!");
                    } else {
                        throw new Error("Decryption failed. Check room key.");
                    }
                } else if (fileItem.dataUrl) {
                    const a = document.createElement('a');
                    a.href = fileItem.dataUrl;
                    a.download = fileItem.name || 'attachment';
                    a.click();
                } else {
                    showToast("File URL unavailable.");
                }
            } catch (err) {
                showErrorModal("Download & Decrypt Error", err.message);
            }
        });

        // Delete file item
        card.querySelector('.btn-delete-file').addEventListener('click', async (e) => {
            e.stopPropagation();

            // Perform remote delete if Supabase Storage
            if (fileItem.provider === 'supabase_storage' && fileItem.remotePath) {
                try {
                    let baseUrl = (APP_CONFIG.DEFAULT_SUPABASE_URL || '').trim().replace(/\/+$/, '');
                    baseUrl = baseUrl.replace(/\.storage\.supabase\.co.*$/, '.supabase.co').replace(/\/storage\/v1\/s3$/, '');
                    const deleteEndpoint = `${baseUrl}/storage/v1/object/${APP_CONFIG.DEFAULT_SUPABASE_BUCKET}/${encodeURIComponent(fileItem.remotePath)}`;
                    await fetch(deleteEndpoint, {
                        method: 'DELETE',
                        headers: getSupabaseHeaders()
                    });
                } catch (e) { }
            }

            page.files = page.files.filter(f => f.id !== fileItem.id);
            renderFileBucketView(page);
            SyncManager.broadcastState();
            showToast("Deleted file attachment.");
        });

        elements.fileBucketGrid.appendChild(card);
    });

    updateSidebarDbSizeSummary();
    if (window.lucide) lucide.createIcons();
}

async function addFileAttachmentToBucket(file) {
    const page = getActivePage();
    if (page.type !== 'file') return;
    if (!page.files) page.files = [];

    const activeProvider = page.provider || 'supabase_storage';
    showToast(`Encrypting & uploading file (${activeProvider})...`);

    try {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const rawDataUrl = e.target.result;
            const sizeKB = Math.round(rawDataUrl.length / 1024);
            const fileId = 'file_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            const fileNameOnStore = `${AppState.roomCode}/${fileId}.bin`;

            // 1. Encrypt raw file DataURL in browser memory with AES-256-GCM
            const encryptedCipher = await CryptoEngine.encryptPayload(rawDataUrl, AppState.masterKey);

            let fileRecord = {
                id: fileId,
                name: file.name,
                mimeType: file.type || 'application/octet-stream',
                sizeKB: sizeKB,
                provider: activeProvider,
                timestamp: Date.now()
            };

            if (activeProvider === 'supabase_storage') {
                // Direct HTTP upload to Supabase REST Storage endpoint (compatible with anon key)
                let baseUrl = (APP_CONFIG.DEFAULT_SUPABASE_URL || '').trim().replace(/\/+$/, '');
                baseUrl = baseUrl.replace(/\.storage\.supabase\.co.*$/, '.supabase.co').replace(/\/storage\/v1\/s3$/, '');
                const uploadEndpoint = `${baseUrl}/storage/v1/object/${APP_CONFIG.DEFAULT_SUPABASE_BUCKET}/${fileNameOnStore}`;

                const uploadHeaders = getSupabaseHeaders('text/plain');
                uploadHeaders['x-upsert'] = 'true';

                const uploadRes = await fetch(uploadEndpoint, {
                    method: 'POST',
                    headers: uploadHeaders,
                    body: encryptedCipher
                });

                if (!uploadRes.ok) {
                    const errText = await uploadRes.text();
                    throw new Error(`Supabase Storage upload failed (${uploadRes.status}): ${errText}`);
                }

                // Construct Public / Signed GET Download URL
                fileRecord.remotePath = fileNameOnStore;
                fileRecord.url = `${baseUrl}/storage/v1/object/public/${APP_CONFIG.DEFAULT_SUPABASE_BUCKET}/${fileNameOnStore}`;
            } else if (activeProvider === 'catbox') {
                // Direct FormData upload to Catbox API
                const formData = new FormData();
                formData.append('reqtype', 'fileupload');
                formData.append('fileToUpload', new Blob([encryptedCipher], { type: 'text/plain' }), `${fileId}.bin`);

                const catboxRes = await fetch('https://catbox.moe/user/api.php', {
                    method: 'POST',
                    body: formData
                });

                if (catboxRes.ok) {
                    fileRecord.url = (await catboxRes.text()).trim();
                } else {
                    fileRecord.encryptedPayload = encryptedCipher;
                }
            } else {
                // Firebase RTDB Inline Payload Fallback
                fileRecord.encryptedPayload = encryptedCipher;
            }

            page.files.unshift(fileRecord);
            renderFileBucketView(page);
            SyncManager.broadcastState();
            showToast(`Uploaded & attached ${file.name} (${sizeKB} KB)!`);
        };
        reader.readAsDataURL(file);
    } catch (err) {
        showErrorModal("File Upload Error", err.message);
    }
}

// Provider Dropdown Change Listener
if (elements.selectBucketProvider) {
    elements.selectBucketProvider.addEventListener('change', (e) => {
        const page = getActivePage();
        if (page && page.type === 'file') {
            page.provider = e.target.value;
            renderFileBucketView(page);
            SyncManager.broadcastState();
            showToast(`Switched storage provider to ${e.target.value}`);
        }
    });
}

function updateFileUploadUIState() {
    if (!elements.fileDropzone) return;

    if (AppState.isFileUploadEnabled) {
        // Uploads Unlocked by User
        elements.fileDropzone.style.borderColor = 'rgba(56, 189, 248, 0.5)';
        elements.fileDropzone.style.background = 'rgba(15, 23, 42, 0.8)';
        elements.fileDropzone.style.cursor = 'pointer';

        if (elements.titleFileDropzone) {
            elements.titleFileDropzone.textContent = 'Drop files here or click to attach';
            elements.titleFileDropzone.style.color = 'var(--text-main)';
        }
        if (elements.fileDropzoneDesc) {
            elements.fileDropzoneDesc.textContent = 'Supports any file up to 50MB. Files are AES-256 encrypted before upload.';
            elements.fileDropzoneDesc.style.color = 'var(--text-muted)';
        }
        if (elements.textToggleUploads) elements.textToggleUploads.textContent = 'Uploads Enabled (Click to Lock)';
        if (elements.btnToggleEnableUploads) {
            elements.btnToggleEnableUploads.style.borderColor = 'rgba(16, 185, 129, 0.4)';
            elements.btnToggleEnableUploads.style.color = 'var(--accent-green)';
        }
        if (elements.iconUploadStatus) elements.iconUploadStatus.setAttribute('data-lucide', 'shield-check');
        if (elements.iconFileDropzone) {
            elements.iconFileDropzone.setAttribute('data-lucide', 'upload-cloud');
            elements.iconFileDropzone.style.color = 'var(--accent-cyan)';
        }
    } else {
        // Uploads Locked (Default on Load)
        elements.fileDropzone.style.borderColor = 'rgba(244, 63, 94, 0.3)';
        elements.fileDropzone.style.background = 'rgba(15, 23, 42, 0.4)';
        elements.fileDropzone.style.cursor = 'not-allowed';

        if (elements.titleFileDropzone) {
            elements.titleFileDropzone.textContent = 'Uploads Disabled for Corporate Compliance';
            elements.titleFileDropzone.style.color = 'var(--text-muted)';
        }
        if (elements.fileDropzoneDesc) {
            elements.fileDropzoneDesc.textContent = 'Click "Enable File Uploads" above to unlock dropzone & attach files.';
            elements.fileDropzoneDesc.style.color = 'var(--text-dim)';
        }
        if (elements.textToggleUploads) elements.textToggleUploads.textContent = 'Enable File Uploads (Disabled by Default)';
        if (elements.btnToggleEnableUploads) {
            elements.btnToggleEnableUploads.style.borderColor = 'rgba(244, 63, 94, 0.4)';
            elements.btnToggleEnableUploads.style.color = 'var(--accent-rose)';
        }
        if (elements.iconUploadStatus) elements.iconUploadStatus.setAttribute('data-lucide', 'shield-alert');
        if (elements.iconFileDropzone) {
            elements.iconFileDropzone.setAttribute('data-lucide', 'lock');
            elements.iconFileDropzone.style.color = 'var(--accent-rose)';
        }
    }
    if (window.lucide) lucide.createIcons();
}

if (elements.btnToggleEnableUploads) {
    elements.btnToggleEnableUploads.addEventListener('click', () => {
        AppState.isFileUploadEnabled = !AppState.isFileUploadEnabled;
        updateFileUploadUIState();
        if (AppState.isFileUploadEnabled) {
            showToast("File uploads enabled for this session.");
        } else {
            showToast("File uploads locked.");
        }
    });
}

// File Bucket Dropzone Listeners
if (elements.fileDropzone && elements.bucketFileInput) {
    elements.fileDropzone.addEventListener('click', () => {
        if (!AppState.isFileUploadEnabled) {
            showToast("Uploads disabled. Click 'Enable File Uploads' above first.");
            return;
        }
        elements.bucketFileInput.click();
    });

    elements.bucketFileInput.addEventListener('change', async (e) => {
        if (!AppState.isFileUploadEnabled) return;
        if (e.target.files && e.target.files.length > 0) {
            for (const file of e.target.files) {
                await addFileAttachmentToBucket(file);
            }
            elements.bucketFileInput.value = '';
        }
    });

    elements.fileDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (AppState.isFileUploadEnabled) {
            elements.fileDropzone.style.borderColor = 'var(--accent-cyan)';
        }
    });

    elements.fileDropzone.addEventListener('dragleave', () => {
        if (AppState.isFileUploadEnabled) {
            elements.fileDropzone.style.borderColor = 'rgba(56, 189, 248, 0.4)';
        }
    });

    elements.fileDropzone.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (!AppState.isFileUploadEnabled) {
            showToast("Uploads disabled. Click 'Enable File Uploads' above first.");
            return;
        }
        elements.fileDropzone.style.borderColor = 'rgba(56, 189, 248, 0.4)';
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            for (const file of e.dataTransfer.files) {
                await addFileAttachmentToBucket(file);
            }
        }
    });
}

function renderSyntaxHighlighting() {
    const page = getActivePage();
    const lang = elements.languageSelect.value;
    page.lang = lang;

    if (lang === 'markdown') {
        elements.preContainer.style.display = 'none';
        elements.markdownRender.style.display = 'block';
        elements.markdownRender.innerHTML = window.marked ? marked.parse(page.content || '_Empty markdown content_') : escapeHtml(page.content);

        if (window.mermaid) {
            setTimeout(() => {
                try {
                    mermaid.run({ querySelector: '.mermaid' });
                } catch (e) { }
            }, 50);
        }
    } else {
        elements.markdownRender.style.display = 'none';
        elements.preContainer.style.display = 'block';
        elements.codeRender.className = `language-${lang}`;
        elements.codeRender.textContent = page.content || '// Empty snippet';
        if (window.hljs) hljs.highlightElement(elements.codeRender);
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Helper to display "Unlocking..." loading indicator on buttons
function setButtonLoadingState(btn, isLoading, loadingText = "Unlocking room...") {
    if (!btn) return;
    if (isLoading) {
        btn.disabled = true;
        btn.dataset.origContent = btn.innerHTML;
        btn.innerHTML = `<i data-lucide="refresh-cw" class="spin-icon" style="width: 14px; height: 14px;"></i> <span>${loadingText}</span>`;
        if (window.lucide) lucide.createIcons();
    } else {
        btn.disabled = false;
        if (btn.dataset.origContent) {
            btn.innerHTML = btn.dataset.origContent;
            if (window.lucide) lucide.createIcons();
        }
    }
}

// --- App Event Handlers ---
async function authenticateWithPasskey(isActiveRoomUnlock = false) {
    const btn = isActiveRoomUnlock ? elements.btnActivePasskeyUnlock : elements.btnPasskeyAuthenticate;
    const roomCode = isActiveRoomUnlock ? AppState.roomCode : (elements.inputRoomCode.value.trim() || 'default-room');
    const protocol = elements.syncProtocolSelect.value;
    const customUrl = elements.inputCustomUrl.value.trim();
    const passphrase = isActiveRoomUnlock ? elements.inputActivePassphrase.value : elements.inputPassphrase.value;

    setButtonLoadingState(btn, true, "Unlocking room...");

    try {
        let passphraseKey = null;
        if (passphrase) {
            passphraseKey = await CryptoEngine.deriveKeyFromPassword(passphrase, roomCode);
        }

        const key = await PasskeyManager.registerOrAuthenticate(roomCode, passphraseKey, false);
        await new Promise(r => setTimeout(r, 1000)); // 1s smooth fetching delay
        completeUnlock(roomCode, key, protocol, customUrl, false);
        showToast("Authenticated via Passkey!");
    } catch (err) {
        const isDomainError = err.message.includes("No Passkey registered for domain");
        if (isDomainError) {
            checkDomainPasskeyRegistration(roomCode);
        } else {
            showErrorModal("Passkey Failed", err.message);
        }
    } finally {
        setButtonLoadingState(btn, false);
    }
}

async function authenticateWithPassphrase(isActiveRoomUnlock = false) {
    const btn = isActiveRoomUnlock ? elements.btnActivePassphraseUnlock : elements.btnPassphraseAuthenticate;
    const roomCode = isActiveRoomUnlock ? AppState.roomCode : (elements.inputRoomCode.value.trim() || 'default-room');
    const protocol = elements.syncProtocolSelect.value;
    const customUrl = elements.inputCustomUrl.value.trim();
    const passphrase = isActiveRoomUnlock ? elements.inputActivePassphrase.value : elements.inputPassphrase.value;

    if (!passphrase) {
        showErrorModal("Passphrase Required", "Please enter a Master Passphrase.");
        return;
    }

    setButtonLoadingState(btn, true, "Unlocking room...");

    try {
        const base = (elements.inputCustomUrl.value || AppState.customUrl).trim().replace(/\/+$/, '').replace(/\/rooms\/.*$/, '');
        const metaEndpoint = `${base}/rooms/${encodeURIComponent(roomCode)}/meta.json`;
        const roomEndpoint = `${base}/rooms/${encodeURIComponent(roomCode)}.json`;

        // 1. Fetch Room Metadata
        let roomMeta = null;
        try {
            const res = await fetch(metaEndpoint, { cache: 'no-store' });
            if (res.ok) roomMeta = await res.json();
        } catch (e) { }

        // 2. Perform Passphrase Verification if verification token exists
        if (roomMeta && roomMeta.passphraseVerify) {
            const isValid = await CryptoEngine.verifyPassphraseToken(passphrase, roomCode, roomMeta.passphraseVerify);
            if (!isValid) {
                showErrorModal("Access Denied", "Incorrect Master Passphrase. Access Denied.");
                return;
            }
        } else {
            // Legacy Room Check: attempt payload decryption directly
            try {
                const res = await fetch(roomEndpoint, { cache: 'no-store' });
                if (res.ok) {
                    const roomData = await res.json();
                    if (roomData && roomData.payload) {
                        const testKey = await CryptoEngine.deriveKeyFromPassword(passphrase, roomCode);
                        const decrypted = await CryptoEngine.decryptPayload(roomData.payload, testKey);
                        if (!decrypted) {
                            showErrorModal("Access Denied", "Incorrect Master Passphrase. Access Denied.");
                            return;
                        }
                    }
                }
            } catch (e) { }

            // Auto-upgrade Legacy Room by saving passphraseVerify to DB
            CryptoEngine.createVerificationToken(passphrase, roomCode).then(verifyToken => {
                fetch(`${base}/rooms/${encodeURIComponent(roomCode)}/meta/passphraseVerify.json`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(verifyToken)
                }).catch(e => console.error("Auto-upgrade verify token error", e));
            });
        }

        await new Promise(r => setTimeout(r, 1000)); // 1s smooth fetching delay
        const key = await CryptoEngine.deriveKeyFromPassword(passphrase, roomCode);
        completeUnlock(roomCode, key, protocol, customUrl, false);
        showToast("Authenticated via Passphrase!");
    } catch (e) {
        showErrorModal("Authentication Error", e.message);
    } finally {
        setButtonLoadingState(btn, false);
    }
}

async function createNewRoom() {
    const roomCode = elements.inputNewRoomCode.value.trim();
    const passphrase = elements.inputNewPassphrase.value;
    const protocol = elements.syncProtocolSelect.value;
    const customUrl = elements.inputCustomUrl.value.trim();

    if (!roomCode) {
        showErrorModal("Missing Room Code", "Please enter a New Room Code.");
        return;
    }

    if (!passphrase) {
        showErrorModal("Missing Passphrase", "Please enter a Master Passphrase for the new room.");
        return;
    }

    try {
        let passphraseKey = await CryptoEngine.deriveKeyFromPassword(passphrase, roomCode);

        // Create and store zero-knowledge verification token
        const verifyToken = await CryptoEngine.createVerificationToken(passphrase, roomCode);
        const base = (elements.inputCustomUrl.value || AppState.customUrl).trim().replace(/\/+$/, '').replace(/\/rooms\/.*$/, '');
        fetch(`${base}/rooms/${encodeURIComponent(roomCode)}/meta/passphraseVerify.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(verifyToken)
        }).catch(e => console.error("Verify token save error", e));

        let key = passphraseKey;
        let passkeyRegistered = false;

        // Attempt optional Passkey registration if supported
        if (window.PublicKeyCredential) {
            try {
                key = await PasskeyManager.registerOrAuthenticate(roomCode, passphraseKey, true);
                passkeyRegistered = true;
            } catch (pErr) {
                console.warn("Passkey registration skipped or failed during room creation:", pErr);
            }
        }

        completeUnlock(roomCode, key, protocol, customUrl, true);
        if (passkeyRegistered) {
            showToast(`Created & Unlocked Room "${roomCode}" with Passkey!`);
        } else {
            showToast(`Created & Unlocked Room "${roomCode}" with Passphrase!`);
        }
    } catch (err) {
        showErrorModal("Room Creation Failed", err.message);
    }
}

async function addDomainPasskey() {
    if (!AppState.isUnlocked || !AppState.masterKey) return;
    const currentDomain = window.location.hostname || "localhost";
    try {
        await PasskeyManager.registerPasskeyForCurrentDomain(AppState.roomCode, AppState.masterKey);
        showToast(`Passkey registered for ${currentDomain}!`);
        checkDomainPasskeyRegistration(AppState.roomCode);
    } catch (e) {
        showErrorModal("Passkey Registration Failed", e.message);
    }
}

function completeUnlock(roomCode, key, protocol, customUrl, isNewRoom = false) {
    AppState.isUnlocked = true;
    AppState.roomCode = roomCode;
    AppState.masterKey = key;
    AppState.lastUpdated = 0;
    resetInactivityTimer();

    elements.unlockModal.classList.remove('active');
    elements.activeRoomUnlockModal.classList.remove('active');
    elements.lockIcon.setAttribute('data-lucide', 'lock-keyhole-open');
    elements.lockBtnText.textContent = 'Lock';
    if (window.lucide) lucide.createIcons();

    renderPageList();
    updateEditorView();
    SyncManager.connect(roomCode, key, protocol, customUrl, isNewRoom);
    checkDomainPasskeyRegistration(roomCode);
}

function lockClipboard() {
    AppState.isUnlocked = false;
    AppState.masterKey = null; // Purge encryption key
    AppState.lastUpdated = 0;

    // Purge all plaintext clipboard content from memory and DOM
    AppState.pages = [
        { id: 'page_1', name: 'Page 1 (General)', lang: 'plaintext', content: '' }
    ];
    AppState.activePageId = 'page_1';

    if (elements.codeEditor) elements.codeEditor.value = '';
    if (elements.codeRender) elements.codeRender.textContent = '';
    if (elements.markdownRender) elements.markdownRender.innerHTML = '';

    if (AppState.mqttClient) {
        AppState.mqttClient.end(true);
        AppState.mqttClient = null;
    }
    if (AppState.pollTimer) {
        clearInterval(AppState.pollTimer);
        AppState.pollTimer = null;
    }

    elements.lockedRoomCodeName.textContent = AppState.roomCode;
    elements.inputActivePassphrase.value = '';
    elements.inputPassphrase.value = '';
    elements.inputNewPassphrase.value = '';
    elements.activeRoomUnlockModal.classList.add('active');
    elements.unlockModal.classList.remove('active');
    elements.autoLockBadge.style.display = 'none';
    elements.btnAddDomainPasskey.style.display = 'none';

    elements.lockIcon.setAttribute('data-lucide', 'lock');
    elements.lockBtnText.textContent = 'Unlock';
    setSyncStatus('locked', 'Locked');
    checkDomainPasskeyRegistration(AppState.roomCode);
    if (window.lucide) lucide.createIcons();
}

// --- Listeners ---
if (elements.btnPasskeyAuthenticate) elements.btnPasskeyAuthenticate.addEventListener('click', () => authenticateWithPasskey(false));
if (elements.btnPassphraseAuthenticate) elements.btnPassphraseAuthenticate.addEventListener('click', () => authenticateWithPassphrase(false));
if (elements.btnActivePasskeyUnlock) elements.btnActivePasskeyUnlock.addEventListener('click', () => authenticateWithPasskey(true));
if (elements.btnActivePassphraseUnlock) elements.btnActivePassphraseUnlock.addEventListener('click', () => authenticateWithPassphrase(true));
if (elements.btnAddDomainPasskey) elements.btnAddDomainPasskey.addEventListener('click', addDomainPasskey);

// Enter key submit handlers for Passphrase input boxes
if (elements.inputPassphrase) {
    elements.inputPassphrase.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            authenticateWithPassphrase(false);
        }
    });
}

if (elements.inputActivePassphrase) {
    elements.inputActivePassphrase.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            authenticateWithPassphrase(true);
        }
    });
}

if (elements.inputNewPassphrase) {
    elements.inputNewPassphrase.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            createNewRoom();
        }
    });
}

if (elements.inputNewResetPassphrase) {
    elements.inputNewResetPassphrase.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (elements.btnSaveResetPassphrase) elements.btnSaveResetPassphrase.click();
        }
    });
}

if (elements.btnSwitchRoomLink) {
    elements.btnSwitchRoomLink.addEventListener('click', () => {
        elements.activeRoomUnlockModal.classList.remove('active');
        elements.unlockModal.classList.add('active');
        fetchExistingRooms();
        checkDomainPasskeyRegistration(elements.inputRoomCode.value);
    });
}

if (elements.btnCreateRoom) elements.btnCreateRoom.addEventListener('click', createNewRoom);

if (elements.btnLockUnlock) {
    elements.btnLockUnlock.addEventListener('click', () => {
        if (AppState.isUnlocked) {
            lockClipboard();
        } else {
            if (AppState.roomCode) {
                elements.lockedRoomCodeName.textContent = AppState.roomCode;
                elements.activeRoomUnlockModal.classList.add('active');
                checkDomainPasskeyRegistration(AppState.roomCode);
            } else {
                elements.unlockModal.classList.add('active');
                fetchExistingRooms();
                checkDomainPasskeyRegistration(elements.inputRoomCode.value);
            }
        }
    });
}

// --- Room Info Modal Controller ---
async function updateRoomInfoModal() {
    const currentDomain = window.location.hostname || "localhost";
    const roomCode = AppState.roomCode || elements.inputRoomCode.value || APP_CONFIG.DEFAULT_ROOM_CODE;

    elements.infoRoomCode.textContent = roomCode;
    elements.infoHostDomain.textContent = currentDomain;
    elements.infoPageCount.textContent = `${AppState.pages.length} Page${AppState.pages.length > 1 ? 's' : ''}`;

    if (AppState.isUnlocked) {
        elements.infoSecurityStatus.innerHTML = '<span style="color: var(--accent-green);">● Unlocked & Authenticated</span>';
    } else {
        elements.infoSecurityStatus.innerHTML = '<span style="color: var(--accent-rose);">● Locked</span>';
    }

    // Transport protocol string
    const proto = elements.syncProtocolSelect.value;
    let protoText = 'Google Firebase Database';
    if (proto === 'websocket') protoText = 'WebSockets (WSS Port 8084)';
    if (proto === 'custom_rest') protoText = 'Custom HTTPS Endpoint';
    elements.infoRelayProtocol.textContent = protoText;

    // Check Passkey registration status for domain & render debug info
    elements.infoPasskeyStatus.textContent = 'Checking...';
    elements.debugPasskeyContainer.innerHTML = '';
    elements.debugPasskeyPanel.style.display = 'none';

    const base = (elements.inputCustomUrl.value || AppState.customUrl).trim().replace(/\/+$/, '').replace(/\/rooms\/.*$/, '');
    const metaEndpoint = `${base}/rooms/${encodeURIComponent(roomCode)}/meta.json`;
    let passkeyEntries = [];

    try {
        const res = await fetch(metaEndpoint, { cache: 'no-store' });
        if (res.ok) {
            const roomMeta = await res.json();
            if (roomMeta && roomMeta.passkeys) {
                Object.keys(roomMeta.passkeys).forEach(id => {
                    const entry = roomMeta.passkeys[id];
                    passkeyEntries.push({ id, ...entry });
                });
            }
        }
    } catch (e) { }

    const validCreds = passkeyEntries.filter(entry => entry.rpId === currentDomain);
    const hasPasskey = validCreds.length > 0;

    if (hasPasskey) {
        elements.infoPasskeyStatus.innerHTML = `<span style="color: var(--accent-green);">Registered (${validCreds.length} Key${validCreds.length > 1 ? 's' : ''})</span>`;
        elements.btnInfoAddPasskey.style.display = 'none';
    } else {
        elements.infoPasskeyStatus.innerHTML = '<span style="color: var(--accent-amber);">Not Registered</span>';
        if (AppState.isUnlocked) {
            elements.btnInfoAddPasskey.style.display = 'inline-flex';
        } else {
            elements.btnInfoAddPasskey.style.display = 'none';
        }
    }

    if (passkeyEntries.length > 0) {
        elements.debugPasskeyPanel.style.display = 'block';
        passkeyEntries.forEach(entry => {
            const maskedId = entry.id ? `${entry.id.substring(0, 4)}...` : 'N/A';
            const isoDate = entry.registeredAt ? new Date(entry.registeredAt).toISOString() : 'N/A';
            const name = entry.name || 'Passkey';
            const rpId = entry.rpId || currentDomain;
            const isMatch = entry.rpId === currentDomain;

            const row = document.createElement('div');
            row.style.background = 'rgba(30, 41, 59, 0.7)';
            row.style.border = '1px solid rgba(255, 255, 255, 0.08)';
            row.style.borderRadius = '4px';
            row.style.padding = '6px 8px';
            row.style.display = 'flex';
            row.style.flexDirection = 'column';
            row.style.gap = '2px';

            row.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: ${isMatch ? 'var(--accent-green)' : 'var(--text-muted)'}; font-weight: 600;">${escapeHtml(name)}</span>
                    <span style="color: var(--text-dim); font-size: 0.68rem;">ID: <strong style="color: #cbd5e1;">${escapeHtml(maskedId)}</strong></span>
                </div>
                <div style="display: flex; justify-content: space-between; color: var(--text-muted); font-size: 0.68rem;">
                    <span>rpId: <strong style="color: #94a3b8;">${escapeHtml(rpId)}</strong></span>
                    <span>Registered: <strong style="color: #94a3b8;">${escapeHtml(isoDate)}</strong></span>
                </div>
            `;
            elements.debugPasskeyContainer.appendChild(row);
        });
    }

    if (window.lucide) lucide.createIcons();
}

function closeRoomInfoModal() {
    elements.roomInfoModal.classList.remove('active');
}

if (elements.btnCloseRoomInfo) elements.btnCloseRoomInfo.addEventListener('click', closeRoomInfoModal);
if (elements.btnDismissRoomInfo) elements.btnDismissRoomInfo.addEventListener('click', closeRoomInfoModal);

if (elements.roomInfoModal) {
    elements.roomInfoModal.addEventListener('click', (e) => {
        if (e.target === elements.roomInfoModal) closeRoomInfoModal();
    });
}

if (elements.btnInfoSwitchRoom) {
    elements.btnInfoSwitchRoom.addEventListener('click', () => {
        closeRoomInfoModal();
        elements.activeRoomUnlockModal.classList.remove('active');
        elements.unlockModal.classList.add('active');
        fetchExistingRooms();
        checkDomainPasskeyRegistration(elements.inputRoomCode.value);
    });
}

if (elements.btnInfoAddPasskey) {
    elements.btnInfoAddPasskey.addEventListener('click', async () => {
        closeRoomInfoModal();
        await addDomainPasskey();
    });
}

if (elements.btnInfoResetPassphrase) {
    elements.btnInfoResetPassphrase.addEventListener('click', () => {
        if (!AppState.isUnlocked) {
            showErrorModal("Room Locked", "You must unlock the room before resetting its passphrase.");
            return;
        }
        closeRoomInfoModal();
        elements.resetRoomCodeName.textContent = AppState.roomCode;
        elements.inputNewResetPassphrase.value = '';
        elements.resetPassphraseModal.classList.add('active');
    });
}

if (elements.btnCancelResetPassphrase) {
    elements.btnCancelResetPassphrase.addEventListener('click', () => {
        elements.resetPassphraseModal.classList.remove('active');
    });
}

if (elements.btnSaveResetPassphrase) {
    elements.btnSaveResetPassphrase.addEventListener('click', async () => {
        const newPassphrase = elements.inputNewResetPassphrase.value.trim();
        if (!newPassphrase) {
            showErrorModal("Passphrase Required", "Please enter a new Master Passphrase.");
            return;
        }

        try {
            setButtonLoadingState(elements.btnSaveResetPassphrase, true, "Updating...");

            // 1. Derive new master encryption key from new passphrase
            const newMasterKey = await CryptoEngine.deriveKeyFromPassword(newPassphrase, AppState.roomCode);

            // 2. Generate and store new zero-knowledge verification token
            const verifyToken = await CryptoEngine.createVerificationToken(newPassphrase, AppState.roomCode);
            const base = (elements.inputCustomUrl.value || AppState.customUrl).trim().replace(/\/+$/, '').replace(/\/rooms\/.*$/, '');
            await fetch(`${base}/rooms/${encodeURIComponent(AppState.roomCode)}/meta/passphraseVerify.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(verifyToken)
            });

            // 3. Update active AppState master key
            AppState.masterKey = newMasterKey;

            // 4. Re-encrypt passkey for current domain if registered
            const currentDomain = window.location.hostname || "localhost";
            const metaEndpoint = `${base}/rooms/${encodeURIComponent(AppState.roomCode)}/meta.json`;
            try {
                const res = await fetch(metaEndpoint, { cache: 'no-store' });
                if (res.ok) {
                    const roomMeta = await res.json();
                    if (roomMeta && roomMeta.passkeys) {
                        const validCreds = Object.keys(roomMeta.passkeys).filter(id => roomMeta.passkeys[id].rpId === currentDomain);
                        if (validCreds.length > 0) {
                            // Re-register domain passkey wrapping the new master key
                            await PasskeyManager.registerPasskeyForCurrentDomain(AppState.roomCode, newMasterKey);
                        }
                    }
                }
            } catch (pErr) {
                console.warn("Passkey re-registration skipped or failed during passphrase reset:", pErr);
            }

            // 5. Broadcast existing pages re-encrypted with new master key
            SyncManager.broadcastState();

            elements.resetPassphraseModal.classList.remove('active');
            showToast("Master Passphrase updated successfully!");
        } catch (e) {
            showErrorModal("Passphrase Reset Error", e.message);
        } finally {
            setButtonLoadingState(elements.btnSaveResetPassphrase, false);
        }
    });
}

if (elements.btnRoomConfig) {
    elements.btnRoomConfig.addEventListener('click', () => {
        updateRoomInfoModal();
        elements.roomInfoModal.classList.add('active');
    });
}

if (elements.codeEditor) {
    elements.codeEditor.addEventListener('input', (e) => {
        resetInactivityTimer();
        const page = getActivePage();
        page.content = e.target.value;
        renderSyntaxHighlighting();
        updateEditorStats();
        updateSidebarDbSizeSummary();
        SyncManager.broadcastState();
    });
}

if (elements.languageSelect) {
    elements.languageSelect.addEventListener('change', () => {
        renderSyntaxHighlighting();
        updateEditorStats();
        SyncManager.broadcastState();
    });
}

if (elements.btnAddPage) {
    elements.btnAddPage.addEventListener('click', () => {
        if (elements.createPageTypeModal) {
            elements.createPageTypeModal.classList.add('active');
        } else {
            createNewTextPage();
        }
    });
}

function createNewTextPage() {
    const id = 'page_' + Date.now();
    const newPage = { id, name: `Page ${AppState.pages.length + 1}`, type: 'text', lang: 'plaintext', content: '' };
    AppState.pages.push(newPage);
    AppState.activePageId = id;
    renderPageList();
    updateEditorView();
    SyncManager.broadcastState();
}

function createNewImagePage() {
    const id = 'page_' + Date.now();
    const newPage = { id, name: `Image Gallery ${AppState.pages.length + 1}`, type: 'image', images: [] };
    AppState.pages.push(newPage);
    AppState.activePageId = id;
    renderPageList();
    updateEditorView();
    SyncManager.broadcastState();
}

function createNewFilePage() {
    const id = 'page_' + Date.now();
    const newPage = { id, name: `File Bucket ${AppState.pages.length + 1}`, type: 'file', files: [], provider: 'catbox' };
    AppState.pages.push(newPage);
    AppState.activePageId = id;
    renderPageList();
    updateEditorView();
    SyncManager.broadcastState();
}

if (elements.btnChooseTextPage) {
    elements.btnChooseTextPage.addEventListener('click', () => {
        elements.createPageTypeModal.classList.remove('active');
        createNewTextPage();
    });
}

if (elements.btnChooseImagePage) {
    elements.btnChooseImagePage.addEventListener('click', () => {
        elements.createPageTypeModal.classList.remove('active');
        createNewImagePage();
    });
}

if (elements.btnChooseFilePage) {
    elements.btnChooseFilePage.addEventListener('click', () => {
        elements.createPageTypeModal.classList.remove('active');
        createNewFilePage();
    });
}

if (elements.btnCancelCreatePageType) {
    elements.btnCancelCreatePageType.addEventListener('click', () => {
        elements.createPageTypeModal.classList.remove('active');
    });
}

// Global Paste Event Listener for Images (Ctrl+V)
document.addEventListener('paste', async (e) => {
    const page = getActivePage();
    if (!page || page.type !== 'image') return;

    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let foundImage = false;

    for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
            foundImage = true;
            const blob = item.getAsFile();
            if (blob) {
                await addCompressedImageToPage(blob, `Pasted Screenshot ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
            }
        }
    }
});

// Dropzone & File Picker Handlers
if (elements.imageDropzone) {
    elements.imageDropzone.addEventListener('click', () => {
        if (elements.imageFileInput) elements.imageFileInput.click();
    });

    elements.imageDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        elements.imageDropzone.classList.add('drag-active');
    });

    elements.imageDropzone.addEventListener('dragleave', () => {
        elements.imageDropzone.classList.remove('drag-active');
    });

    elements.imageDropzone.addEventListener('drop', async (e) => {
        e.preventDefault();
        elements.imageDropzone.classList.remove('drag-active');
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        for (const file of files) {
            await addCompressedImageToPage(file, file.name);
        }
    });
}

if (elements.imageFileInput) {
    elements.imageFileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
        for (const file of files) {
            await addCompressedImageToPage(file, file.name);
        }
        elements.imageFileInput.value = '';
    });
}

// Resolution Select & Batch Resizer Handlers
if (elements.selectImageTargetRes) {
    elements.selectImageTargetRes.addEventListener('change', (e) => {
        const page = getActivePage();
        if (page && page.type === 'image') {
            page.targetRes = parseInt(e.target.value, 10);
            renderImageGalleryView(page);
            SyncManager.broadcastState();
        }
    });
}

if (elements.btnBatchResizeImages) {
    elements.btnBatchResizeImages.addEventListener('click', () => {
        const page = getActivePage();
        if (!page || page.type !== 'image' || !page.images || page.images.length === 0) {
            showErrorModal("No Images", "There are no images in this gallery to resize.");
            return;
        }

        const targetRes = page.targetRes !== undefined ? page.targetRes : 720;
        const resLabel = targetRes == 0 ? 'Original / Uncompressed' : `${targetRes}p Resolution`;

        elements.resizeModalImageCount.textContent = `${page.images.length} Image${page.images.length > 1 ? 's' : ''}`;
        elements.resizeModalTargetRes.textContent = resLabel;
        elements.resizeImagesModal.classList.add('active');
    });
}

if (elements.btnCancelResizeImages) {
    elements.btnCancelResizeImages.addEventListener('click', () => {
        elements.resizeImagesModal.classList.remove('active');
    });
}

if (elements.btnConfirmResizeImages) {
    elements.btnConfirmResizeImages.addEventListener('click', async () => {
        const page = getActivePage();
        if (!page || page.type !== 'image' || !page.images) return;

        const targetRes = page.targetRes !== undefined ? page.targetRes : 720;
        elements.resizeImagesModal.classList.remove('active');
        showToast("Batch resizing all gallery images...");

        try {
            setButtonLoadingState(elements.btnConfirmResizeImages, true, "Resizing...");
            for (let i = 0; i < page.images.length; i++) {
                const img = page.images[i];
                if (img.dataUrl) {
                    const compressed = await compressImageTo720p(img.dataUrl, targetRes);
                    img.dataUrl = compressed.dataUrl;
                    img.sizeKB = compressed.sizeKB;
                }
            }
            renderImageGalleryView(page);
            SyncManager.broadcastState();
            showToast(`Batch resize complete! All ${page.images.length} images resized to ${targetRes == 0 ? 'Original' : targetRes + 'p'}.`);
        } catch (err) {
            showErrorModal("Batch Resize Failed", err.message);
        } finally {
            setButtonLoadingState(elements.btnConfirmResizeImages, false);
        }
    });
}

// Lightbox Close Handlers
if (elements.btnCloseLightbox) {
    elements.btnCloseLightbox.addEventListener('click', () => {
        elements.imageLightboxModal.classList.remove('active');
    });
}

if (elements.imageLightboxModal) {
    elements.imageLightboxModal.addEventListener('click', (e) => {
        if (e.target === elements.imageLightboxModal) {
            elements.imageLightboxModal.classList.remove('active');
        }
    });
}

if (elements.btnFormatJson) {
    elements.btnFormatJson.addEventListener('click', () => {
        const page = getActivePage();
        try {
            const parsed = JSON.parse(page.content);
            page.content = JSON.stringify(parsed, null, 2);
            page.lang = 'json';
            elements.languageSelect.value = 'json';
            updateEditorView();
            SyncManager.broadcastState();
            showToast("Formatted JSON!");
        } catch (err) {
            showErrorModal("Invalid JSON", "Invalid JSON format: " + err.message);
        }
    });
}

if (elements.btnCopyContent) {
    elements.btnCopyContent.addEventListener('click', () => {
        const page = getActivePage();
        navigator.clipboard.writeText(page.content).then(() => {
            showToast("Copied to clipboard!");
        });
    });
}

if (elements.btnDownloadContent) {
    elements.btnDownloadContent.addEventListener('click', () => {
        const page = getActivePage();
        const blob = new Blob([page.content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${page.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.${page.lang || 'txt'}`;
        a.click();
        URL.revokeObjectURL(url);
    });
}

if (elements.btnClearPage) {
    elements.btnClearPage.addEventListener('click', () => {
        const page = getActivePage();
        openDeleteModal({ id: page.id, name: `content of "${page.name}"` });
    });
}

// Mobile View Toggle
if (elements.btnToggleEdit) {
    elements.btnToggleEdit.addEventListener('click', () => {
        elements.editorContainer.classList.remove('view-code');
        elements.editorContainer.classList.add('view-edit');
        elements.btnToggleEdit.classList.add('active');
        elements.btnToggleCode.classList.remove('active');
    });
}

if (elements.btnToggleCode) {
    elements.btnToggleCode.addEventListener('click', () => {
        elements.editorContainer.classList.remove('view-edit');
        elements.editorContainer.classList.add('view-code');
        elements.btnToggleCode.classList.add('active');
        elements.btnToggleEdit.classList.remove('active');
    });
}

if (elements.btnToggleSidebar) {
    elements.btnToggleSidebar.addEventListener('click', (e) => {
        e.stopPropagation();
        elements.sidebar.classList.toggle('open');
    });
}

// Close sidebar on mobile when clicking outside
document.addEventListener('click', (e) => {
    if (window.innerWidth <= 868) {
        if (elements.sidebar && elements.sidebar.classList.contains('open') &&
            !elements.sidebar.contains(e.target) &&
            elements.btnToggleSidebar && !elements.btnToggleSidebar.contains(e.target)) {
            elements.sidebar.classList.remove('open');
        }
    }
});

// Initial fetch of rooms & passkey verification
fetchExistingRooms();
if (elements.inputRoomCode) {
    checkDomainPasskeyRegistration(elements.inputRoomCode.value);
}
