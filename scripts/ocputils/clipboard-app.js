// ==========================================
// ONLINE CLIPBOARD APP CONTROLLER
// ==========================================

const APP_CONFIG = {
    VERSION: 'v1.7',
    BUILD_TIME: '2026-07-30 19:30:00',
    AUTO_LOCK_MINUTES: 20, // Inactivity minutes before auto-locking (Format MM:SS displayed in header)
    POLL_INTERVAL_MS: 10000, // Background HTTPS REST polling interval (10 seconds)
    DEFAULT_ROOM_CODE: 'apilog',
    DEFAULT_FIREBASE_URL: 'https://bdi-online-clipboard-default-rtdb.asia-southeast1.firebasedatabase.app'
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
    
    renderer.code = function(code, language) {
        const lang = (language || '').trim().toLowerCase();

        if (lang === 'mermaid') {
            const cleanCode = code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
            return `<div class="mermaid-container"><div class="mermaid">${escapeHtml(cleanCode)}</div></div>`;
        }

        if (lang && window.hljs && hljs.getLanguage(lang)) {
            try {
                const highlighted = hljs.highlight(code, { language: lang }).value;
                return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
            } catch(e){}
        }

        return `<pre><code class="hljs">${escapeHtml(code)}</code></pre>`;
    };

    marked.setOptions({ renderer: renderer });
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
    resetBadgeTimer: null
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
    } catch(e) {}
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
    } catch(e){}

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
        item.className = `page-item ${page.id === AppState.activePageId ? 'active' : ''}`;
        item.innerHTML = `
            <div class="page-item-info">
                <i data-lucide="file-text" style="width: 15px; height: 15px;"></i>
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
    elements.btnConfirmDelete.addEventListener('click', () => {
        if (AppState.pendingDeletePageId) {
            AppState.pages = AppState.pages.filter(p => p.id !== AppState.pendingDeletePageId);
            if (AppState.activePageId === AppState.pendingDeletePageId) {
                AppState.activePageId = AppState.pages[0].id;
            }
            renderPageList();
            updateEditorView();
            SyncManager.broadcastState();
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
    if (document.activeElement !== elements.codeEditor) {
        elements.codeEditor.value = page.content;
    }
    elements.languageSelect.value = page.lang || 'plaintext';
    renderSyntaxHighlighting();
    updateEditorStats();
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
                } catch(e) {}
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
        } catch(e){}

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
            } catch(e){}

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
    } catch(e) {
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

        const key = await PasskeyManager.registerOrAuthenticate(roomCode, passphraseKey, true);
        completeUnlock(roomCode, key, protocol, customUrl, true);
        showToast(`Created & Unlocked Room "${roomCode}"!`);
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
    } catch(e) {
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
    } catch(e){}

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
        const id = 'page_' + Date.now();
        const newPage = { id, name: `Page ${AppState.pages.length + 1}`, lang: 'plaintext', content: '' };
        AppState.pages.push(newPage);
        AppState.activePageId = id;
        renderPageList();
        updateEditorView();
        SyncManager.broadcastState();
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
