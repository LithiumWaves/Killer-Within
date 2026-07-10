import { FLOATING_ID, NOTEBOOK_ACTOR_TYPES, NOTEBOOK_USER_ACCESS } from './config.js';
import {
    addNotebookToucher,
    attemptStealCharacterId,
    clearNotebookTouchers,
    createDeathNote,
    createNotebookScrap,
    destroyNotebook,
    forgetCharacterName,
    getActorByTrueName,
    getActorDisplayName,
    getCharacterActorForMessage,
    getChatState,
    getCharacterNameDirectory,
    getContext,
    getCurrentChatCharacterActors,
    getDeathNotes,
    getDeathNoteInventory,
    getIdentityStealAttemptState,
    getIdentityStealSuccessChance,
    getLinkedShinigami,
    getNotebookPages,
    getNotebookOwnership,
    getNotebookReturnRequest,
    getPermanentResolvedLineCounts,
    getRecentChatMemoryCandidates,
    getSelectedNotebookIdState,
    getSettings,
    learnCharacterName,
    linkNotebookShinigami,
    markNotebookPresenceRevealPending,
    notify,
    persistChatChanges,
    requestNotebookReturn,
    removeNotebookScrap,
    sanitizeNotebookPagesForRules,
    sanitizeNotebookPageText,
    sanitizeScrapNoteText,
    scheduleSettingsSave,
    setSelectedNotebookId,
    setDeathNoteMemoryTracked,
    setNotebookOwnership,
    setNotebookPages,
    setUserNotebookAccess,
    syncAllAiNotebookWriteMessageVisibility,
    transferNotebookScrap,
    transferNotebookTo,
    updateNotebookScrapText,
    unlinkNotebookShinigami,
} from './core.js';
import { syncLinkedShinigamiVisibility } from '../presence/index.js';
import { getMessagePresenceTracker, isPresenceActive, resolvePresenceAvatar } from '../presence/core.js';
import {
    bindThoughtSettingsUi,
    renderThoughtManagementSettingsHtml,
    renderThoughtPromptSettingsHtml,
    syncThoughtSettingsUi,
} from '../thoughts/ui.js';

const PAGE_TURN_MS = 240;
const CLOSED_WIDTH = 240;
const CLOSED_HEIGHT = 340;
const MOBILE_VIEWPORT_MAX = 520;
const SETTINGS_PANEL_ID = 'kw-deathnote-settings';
const INVENTORY_ID = 'kw-deathnote-inventory';
const NOTICE_LAYER_ID = 'kw-deathnote-notices';
const INVENTORY_SETTINGS_MODAL_ID = 'kw-deathnote-inventory-settings-modal';
const INVENTORY_MANAGE_MODAL_ID = 'kw-deathnote-inventory-manage-modal';
let pendingFocus = null;
let pageTurnTimer = null;
let pageTurnCleanupTimer = null;
let chatNameMaskObserver = null;
let chatNameMaskQueued = false;
let inventorySettingsOpen = false;
let inventoryManageOpen = false;
let inventoryDragState = {
    dragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    moved: false,
    pointerId: null,
    handlersInstalled: false,
    moveHandler: null,
    upHandler: null,
    ignoreClick: false,
};
const WRITING_SOUND_IDLE_MS = 280;
let deathNoteAudioState = {
    openAudio: null,
    writingAudio: null,
    writingStopTimer: null,
};
let deathNoteNoticeTimer = null;

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getDeathNoteAudio(type) {
    if (type === 'open') {
        if (!deathNoteAudioState.openAudio) {
            deathNoteAudioState.openAudio = new Audio(new URL('../audio/pen-click.mp3', import.meta.url).toString());
            deathNoteAudioState.openAudio.preload = 'auto';
        }
        return deathNoteAudioState.openAudio;
    }

    if (!deathNoteAudioState.writingAudio) {
        const audio = new Audio(new URL('../audio/writing-with-pen.mp3', import.meta.url).toString());
        audio.preload = 'auto';
        audio.loop = true;
        deathNoteAudioState.writingAudio = audio;
    }

    return deathNoteAudioState.writingAudio;
}

function stopWritingSound(reset = true) {
    if (deathNoteAudioState.writingStopTimer) {
        clearTimeout(deathNoteAudioState.writingStopTimer);
        deathNoteAudioState.writingStopTimer = null;
    }

    const audio = deathNoteAudioState.writingAudio;
    if (!audio) {
        return;
    }

    audio.pause();
    if (reset) {
        audio.currentTime = 0;
    }
}

function playNotebookOpenSound() {
    if (!getSettings().enableOpenSound) {
        return;
    }

    const audio = getDeathNoteAudio('open');
    try {
        audio.pause();
        audio.currentTime = 0;
        audio.play().catch(() => {});
    } catch (_error) {
        // Ignore autoplay or decoding failures.
    }
}

function pulseWritingSound() {
    if (!getSettings().enableWritingSound) {
        stopWritingSound();
        return;
    }

    const audio = getDeathNoteAudio('writing');
    if (deathNoteAudioState.writingStopTimer) {
        clearTimeout(deathNoteAudioState.writingStopTimer);
        deathNoteAudioState.writingStopTimer = null;
    }

    try {
        if (audio.paused) {
            audio.play().catch(() => {});
        }
    } catch (_error) {
        // Ignore autoplay or decoding failures.
    }

    deathNoteAudioState.writingStopTimer = setTimeout(() => {
        stopWritingSound(false);
    }, WRITING_SOUND_IDLE_MS);
}

function sanitizeNotebookInputPageValue(value) {
    const source = String(value ?? '');
    const sanitized = sanitizeNotebookPageText(source);
    if (sanitized === source) {
        return {
            value: source,
            blockedName: '',
        };
    }

    const blockedLine = source
        .split('\n')
        .map((line) => String(line || '').trim())
        .find((line) => line && !sanitizeNotebookPageText(line));
    const blockedActor = blockedLine ? getActorByTrueName(blockedLine) : null;
    return {
        value: sanitized,
        blockedName: blockedActor?.name || blockedLine || '',
    };
}

function buildPermanentLineMaskText(sourceType, sourceId, text) {
    const counts = getPermanentResolvedLineCounts(sourceType, sourceId);
    if (!(counts instanceof Map) || !counts.size) {
        return '';
    }

    const lines = String(text ?? '').split(/\r?\n/);
    const remaining = new Map(counts);
    let hasLockedLine = false;
    const maskedLines = lines.map((line) => {
        const rawLine = String(line ?? '');
        const key = rawLine.trim();
        const available = key ? (remaining.get(key) ?? 0) : 0;
        if (available > 0) {
            remaining.set(key, available - 1);
            hasLockedLine = true;
            return rawLine || ' ';
        }

        return '\u200b';
    });

    return hasLockedLine ? maskedLines.join('\n') : '';
}

function renderPermanentLineOverlay(sourceType, sourceId, text, className = '') {
    const overlayText = buildPermanentLineMaskText(sourceType, sourceId, text);
    const classes = ['kw-dn-locked-overlay', className, overlayText ? 'is-visible' : ''].filter(Boolean).join(' ');
    return `
        <div class="${classes}" aria-hidden="true">${escapeHtml(overlayText || '\u200b')}</div>
    `;
}

function syncPermanentLineOverlay(input, sourceType, sourceId, text) {
    if (!(input instanceof HTMLElement) || !input.parentElement) {
        return;
    }

    const overlay = input.parentElement.querySelector('.kw-dn-locked-overlay');
    if (!(overlay instanceof HTMLElement)) {
        return;
    }

    const overlayText = buildPermanentLineMaskText(sourceType, sourceId, text);
    overlay.textContent = overlayText || '\u200b';
    overlay.classList.toggle('is-visible', Boolean(overlayText));
}

function shouldPlayWritingSoundForInputType(inputType) {
    const value = String(inputType || '').trim().toLowerCase();
    if (!value) {
        return true;
    }

    if (value.startsWith('delete')) {
        return false;
    }

    return value.startsWith('insert') || value === 'historyredo';
}

function normalizePresenceToken(value) {
    return String(value || '').trim().replace(/(\.\w+)$/i, '').toLowerCase();
}

function shouldTriggerNotebookPresenceReveal() {
    if (!isPresenceActive()) {
        return false;
    }

    const context = getContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    let tracker = [];
    for (let index = chat.length - 1; index >= 0; index -= 1) {
        const entries = getMessagePresenceTracker(chat[index]);
        if (entries.length) {
            tracker = entries;
            break;
        }
    }

    if (!tracker.length) {
        return false;
    }

    const normalized = new Set(tracker.map((entry) => normalizePresenceToken(entry)).filter(Boolean));
    normalized.delete('presence_universal_tracker');
    if (!normalized.size) {
        return false;
    }

    const actors = getCurrentChatCharacterActors();
    for (const actor of Array.isArray(actors) ? actors : []) {
        const candidate = resolvePresenceAvatar(actor?.name || actor?.id || '');
        if (!candidate) {
            continue;
        }

        if (normalized.has(normalizePresenceToken(candidate))) {
            return true;
        }
    }

    return true;
}

function getNoticeLayer() {
    let layer = document.getElementById(NOTICE_LAYER_ID);
    if (!layer) {
        layer = document.createElement('div');
        layer.id = NOTICE_LAYER_ID;
        document.body.appendChild(layer);
    }

    return layer;
}

function showDeathNoteNotice({ title, message, iconUrl, duration = 3400 } = {}) {
    const layer = getNoticeLayer();
    layer.innerHTML = `
        <div class="kw-dn-notice">
            <div class="kw-dn-notice__icon-wrap">
                <img class="kw-dn-notice__icon" src="${escapeHtml(String(iconUrl || ''))}" alt="" />
            </div>
            <div class="kw-dn-notice__copy">
                <div class="kw-dn-notice__eyebrow">Killer Within</div>
                <div class="kw-dn-notice__title">${escapeHtml(String(title || 'Notification'))}</div>
                <div class="kw-dn-notice__message">${escapeHtml(String(message || ''))}</div>
            </div>
        </div>
    `;
    layer.classList.add('is-visible');

    if (deathNoteNoticeTimer) {
        clearTimeout(deathNoteNoticeTimer);
    }

    deathNoteNoticeTimer = setTimeout(() => {
        layer.classList.remove('is-visible');
        deathNoteNoticeTimer = null;
    }, Math.max(1200, Number(duration) || 3400));
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function isPortraitMobileViewport() {
    return window.innerWidth <= MOBILE_VIEWPORT_MAX && window.innerHeight > window.innerWidth;
}

function resolveInventoryMobilePosition(root = null) {
    const settings = getSettings();
    const margin = window.innerWidth <= 420 ? 8 : 10;
    const width = root ? Math.round(root.getBoundingClientRect().width) : Math.round(Math.min(window.innerWidth - (margin * 2), window.innerWidth <= 420 ? 268 : 296));
    const preferredX = Number.isFinite(settings.inventoryMobileX) ? settings.inventoryMobileX : window.innerWidth - width - margin;
    const preferredY = Number.isFinite(settings.inventoryMobileY)
        ? settings.inventoryMobileY
        : margin + 0;
    return {
        x: clamp(Math.round(preferredX), 0, Math.max(0, window.innerWidth - width)),
        y: clamp(Math.round(preferredY), 0, Math.max(0, window.innerHeight - 44)),
    };
}

function getClosedWidgetSize() {
    if (!isPortraitMobileViewport()) {
        return { width: CLOSED_WIDTH, height: CLOSED_HEIGHT };
    }

    const maxWidth = Math.max(150, Math.min(164, window.innerWidth - 28));
    return {
        width: maxWidth,
        height: Math.round(maxWidth * (CLOSED_HEIGHT / CLOSED_WIDTH)),
    };
}

function getWidgetSize(isOpen) {
    if (!isOpen) {
        return getClosedWidgetSize();
    }

    if (isPortraitMobileViewport()) {
        const width = Math.min(
            Math.max(276, Math.round(window.innerWidth - 42)),
            Math.max(248, window.innerWidth - 24),
        );
        const height = Math.min(
            Math.max(460, Math.round(window.innerHeight * 0.82)),
            Math.max(380, window.innerHeight - 46),
        );
        return {
            width,
            height,
        };
    }

    const aspectRatio = 992 / 744;
    const maxWidth = Math.min(window.innerWidth * 0.9, 960);
    const maxHeight = Math.min(window.innerHeight * 0.78, 720);
    const width = Math.min(maxWidth, maxHeight * aspectRatio);
    const height = width / aspectRatio;
    return { width, height };
}

function getDefaultPosition() {
    const closedSize = getClosedWidgetSize();
    const width = closedSize.width;
    const height = closedSize.height;
    const margin = isPortraitMobileViewport() ? 8 : 16;

    const x = Math.max(margin, window.innerWidth - width - margin);
    const y = Math.max(margin, Math.round(window.innerHeight * 0.22) - Math.round(height / 2));
    return { x, y };
}

function resolvePosition() {
    const settings = getSettings();
    const preferredX = settings.isOpen ? settings.floatingX : settings.closedFloatingX;
    const preferredY = settings.isOpen ? settings.floatingY : settings.closedFloatingY;

    if (Number.isFinite(preferredX) && Number.isFinite(preferredY)) {
        return {
            x: preferredX,
            y: preferredY,
        };
    }

    if (Number.isFinite(settings.floatingX) && Number.isFinite(settings.floatingY)) {
        return {
            x: settings.floatingX,
            y: settings.floatingY,
        };
    }

    if (Number.isFinite(settings.closedFloatingX) && Number.isFinite(settings.closedFloatingY)) {
        return {
            x: settings.closedFloatingX,
            y: settings.closedFloatingY,
        };
    }

    return getDefaultPosition();
}

function setPosition(x, y, options = {}) {
    const settings = getSettings();
    settings.floatingX = x;
    settings.floatingY = y;

    if (options.rememberClosed) {
        settings.closedFloatingX = x;
        settings.closedFloatingY = y;
    }

    scheduleSettingsSave();
}

function getTogglePosition(left, top, isOpening) {
    const nextSize = getWidgetSize(isOpening);
    const nextX = clamp(left, 0, Math.max(0, window.innerWidth - nextSize.width));
    const nextY = clamp(top, 0, Math.max(0, window.innerHeight - nextSize.height));

    return {
        x: Math.round(nextX),
        y: Math.round(nextY),
    };
}

function setNotebookOpenState(nextOpen) {
    const settings = getSettings();
    const root = document.getElementById(FLOATING_ID);
    let anchorX = null;
    let anchorY = null;

    if (root) {
        const rect = root.getBoundingClientRect();
        anchorX = Math.round(rect.left);
        anchorY = Math.round(rect.top);
    }

    if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY)) {
        const resolved = resolvePosition();
        anchorX = Math.round(resolved.x);
        anchorY = Math.round(resolved.y);
    }

    if (nextOpen) {
        settings.closedFloatingX = anchorX;
        settings.closedFloatingY = anchorY;
        const nextPosition = getTogglePosition(anchorX, anchorY, true);
        settings.floatingX = nextPosition.x;
        settings.floatingY = nextPosition.y;
    } else if (Number.isFinite(settings.closedFloatingX) && Number.isFinite(settings.closedFloatingY)) {
        settings.floatingX = settings.closedFloatingX;
        settings.floatingY = settings.closedFloatingY;
    } else {
        settings.floatingX = anchorX;
        settings.floatingY = anchorY;
    }

    settings.isOpen = Boolean(nextOpen);
    scheduleSettingsSave();
    if (nextOpen) {
        playNotebookOpenSound();
        if (shouldTriggerNotebookPresenceReveal()) {
            markNotebookPresenceRevealPending(null, String(settings.selectedNotebookId || getSelectedNotebookIdState() || '').trim());
        }
    } else {
        stopWritingSound();
    }
    refreshDeathNoteUi();
}

function getSpreadCount(pages) {
    const totalPages = Math.max(1, Array.isArray(pages) ? pages.length : 0);
    return Math.max(1, 1 + Math.ceil(Math.max(0, totalPages - 1) / 2));
}

function getClampedSpreadIndex(pages) {
    const settings = getSettings();
    const rawIndex = settings.currentSpreadIndex !== undefined && settings.currentSpreadIndex !== null
        ? settings.currentSpreadIndex
        : settings.currentPageIndex;
    const fallback = Number(rawIndex) || 0;
    const maxIndex = Math.max(0, getSpreadCount(pages) - 1);
    const next = clamp(fallback, 0, maxIndex);
    if (next !== settings.currentSpreadIndex) {
        settings.currentSpreadIndex = next;
        scheduleSettingsSave();
    }
    return next;
}

function ensurePageCapacity(pages, pageIndex) {
    const nextPages = Array.isArray(pages) ? [...pages] : [''];
    while (nextPages.length <= pageIndex) {
        nextPages.push('');
    }
    return nextPages;
}

function getVisiblePageIndices(spreadIndex) {
    if (spreadIndex <= 0) {
        return { leftPageIndex: null, rightPageIndex: 0 };
    }

    const leftPageIndex = (spreadIndex * 2) - 1;
    return {
        leftPageIndex,
        rightPageIndex: leftPageIndex + 1,
    };
}

function getSpreadLabel(spreadIndex, visible) {
    if (spreadIndex <= 0) {
        return 'Rules + Page 1';
    }

    return `Pages ${visible.leftPageIndex + 1}-${visible.rightPageIndex + 1}`;
}

function renderNotebookPage(text, extraClass = '') {
    const content = String(text || '');
    const classes = ['kw-deathnote__paper', extraClass].filter(Boolean).join(' ');

    return `
        <div class="${classes}">
            <div class="kw-deathnote__page-text">${escapeHtml(content)}</div>
        </div>
    `;
}

function renderEditablePage({ notebookId, pageIndex, side, text, extraClass = '' }) {
    const classes = ['kw-deathnote__paper', 'kw-deathnote__paper--editable', extraClass].filter(Boolean).join(' ');
    const sourceId = `notebook:${notebookId}:page:${pageIndex}`;
    return `
        <div class="${classes}">
            <textarea
                class="kw-deathnote__entry-textarea"
                name="entryText"
                data-notebook-id="${escapeHtml(String(notebookId || ''))}"
                data-page-index="${pageIndex}"
                data-page-side="${side}"
                autocomplete="off"
                spellcheck="false"
            >${escapeHtml(String(text || ''))}</textarea>
            ${renderPermanentLineOverlay('notebook', sourceId, text, 'kw-deathnote__locked-overlay')}
        </div>
    `;
}

function queueFocusRestore(pageIndex, side, mode = 'end') {
    pendingFocus = {
        pageIndex,
        side,
        mode,
    };
}

function encodeActorValue(actor) {
    return encodeURIComponent(JSON.stringify({
        type: String(actor && actor.type ? actor.type : NOTEBOOK_ACTOR_TYPES.NONE),
        id: String(actor && actor.id ? actor.id : ''),
        name: String(actor && actor.name ? actor.name : ''),
    }));
}

function decodeActorValue(value, fallback = null) {
    const source = String(value || '').trim();
    if (!source) {
        return fallback;
    }

    try {
        const parsed = JSON.parse(decodeURIComponent(source));
        return {
            type: String(parsed && parsed.type ? parsed.type : NOTEBOOK_ACTOR_TYPES.NONE).trim().toLowerCase() || NOTEBOOK_ACTOR_TYPES.NONE,
            id: String(parsed && parsed.id ? parsed.id : '').trim(),
            name: String(parsed && parsed.name ? parsed.name : '').trim(),
        };
    } catch (_error) {
        return fallback;
    }
}

function actorIdentityKey(actor) {
    const source = actor && typeof actor === 'object' ? actor : {};
    return [
        String(source.type || NOTEBOOK_ACTOR_TYPES.NONE).trim().toLowerCase(),
        String(source.id || '').trim(),
        String(source.name || '').trim(),
    ].join('::');
}

function formatActorLabel(actor) {
    const source = actor && typeof actor === 'object' ? actor : {};
    const type = String(source.type || NOTEBOOK_ACTOR_TYPES.NONE).trim().toLowerCase();
    const name = getActorDisplayName(source, 'Unknown');

    if (type === NOTEBOOK_ACTOR_TYPES.USER) {
        return name || 'User';
    }

    if (type === NOTEBOOK_ACTOR_TYPES.SHINIGAMI) {
        return name ? `${name} (Shinigami)` : 'Shinigami';
    }

    if (type === NOTEBOOK_ACTOR_TYPES.WORLD) {
        return name || 'World';
    }

    if (type === NOTEBOOK_ACTOR_TYPES.CHARACTER) {
        return name || 'Character';
    }

    return name || 'Unknown';
}

function formatActorInventoryLabel(actor) {
    const source = actor && typeof actor === 'object' ? actor : {};
    const type = String(source.type || NOTEBOOK_ACTOR_TYPES.NONE).trim().toLowerCase();
    const name = String(source.name || '').trim();

    if (type === NOTEBOOK_ACTOR_TYPES.USER) {
        return 'User';
    }

    if (type === NOTEBOOK_ACTOR_TYPES.WORLD) {
        return 'World';
    }

    if (type === NOTEBOOK_ACTOR_TYPES.SHINIGAMI) {
        return name ? `${name} (Shinigami)` : 'Shinigami';
    }

    if (type === NOTEBOOK_ACTOR_TYPES.CHARACTER) {
        return name || 'Character';
    }

    return name || 'Unknown';
}

function renderNameKnowledgeManagerHtml() {
    const directory = getCharacterNameDirectory();
    if (!directory.length) {
        return `
            <div class="kw-deathnote-manager">
                <div class="kw-memory-manager__empty">No current chat participants are available for name discovery.</div>
            </div>
        `;
    }

    const settings = getSettings();
    const selectedKey = (() => {
        const requested = String(settings.idStealSelectedActorKey || '').trim();
        if (requested && directory.some((entry) => entry && entry.key === requested)) {
            return requested;
        }
        return String(directory[0]?.key || '').trim();
    })();
    const selectedEntry = directory.find((entry) => entry && entry.key === selectedKey) || directory[0];
    const selectedChance = selectedEntry ? getIdentityStealSuccessChance(selectedEntry.actor) : 75;
    const selectedHasOverride = Boolean(
        selectedEntry
        && settings.idStealSuccessChanceOverrides
        && typeof settings.idStealSuccessChanceOverrides === 'object'
        && Object.hasOwn(settings.idStealSuccessChanceOverrides, selectedEntry.key),
    );

    const rows = directory.map((entry) => {
        const stealState = getIdentityStealAttemptState(entry.actor);
        const successChance = getIdentityStealSuccessChance(entry.actor);
        let primaryActionLabel = entry.known ? 'Hide again' : 'Steal ID';
        let primaryActionClass = entry.known ? 'kw-deathnote-hide-name' : 'kw-deathnote-steal-id';
        let primaryActionDisabled = '';
        let statusDetail = entry.known ? 'Known to the user' : 'Name hidden from the user';

        if (!entry.known && stealState.hasId) {
            primaryActionLabel = 'ID Stolen';
            primaryActionDisabled = 'disabled';
            statusDetail = 'ID card already taken';
        } else if (!entry.known && stealState.onCooldown) {
            primaryActionLabel = `Cooldown ${formatRemainingTime(stealState.cooldownUntil - Date.now())}`;
            primaryActionDisabled = 'disabled';
            statusDetail = 'They are on alert after the last attempt';
        }

        return `
            <div class="kw-deathnote-item">
                <div class="kw-deathnote-item__meta">
                    <b>${escapeHtml(entry.displayName)}</b>
                    <span>${escapeHtml(`${statusDetail} | Steal success: ${successChance}%`)}</span>
                </div>
                <span class="kw-deathnote-name-state">${entry.known ? 'Known' : 'Hidden'}</span>
                <div class="kw-deathnote-item__actions">
                    <button
                        type="button"
                        class="menu_button ${primaryActionClass}"
                        data-actor="${escapeHtml(encodeActorValue(entry.actor))}"
                        ${primaryActionDisabled}
                    >${escapeHtml(primaryActionLabel)}</button>
                    ${entry.known ? '' : `
                        <button
                            type="button"
                            class="menu_button kw-deathnote-force-reveal-name"
                            data-actor="${escapeHtml(encodeActorValue(entry.actor))}"
                        >Force Reveal</button>
                    `}
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="kw-deathnote-manager">
            <div class="kw-deathnote-manager__summary">
                <span><b>Unknown names stay scrambled</b> until they are learned in-scene.</span>
                <span><b>Default steal success chance:</b> ${escapeHtml(String(Math.min(100, Math.max(0, Number(settings.idStealSuccessChancePercent) || 75))))}%</span>
                <span><b>Scope:</b> Current chat participants only</span>
            </div>
            <div class="kw-deathnote-manager__actions">
                <label class="killer-within-settings__field kw-deathnote-manager__grow">
                    <span>Character perception target</span>
                    <select id="kw-deathnote-id-steal-character" class="text_pole">
                        ${directory.map((entry) => `
                            <option value="${escapeHtml(entry.key)}" ${entry.key === selectedKey ? 'selected' : ''}>${escapeHtml(entry.trueName || entry.displayName)}</option>
                        `).join('')}
                    </select>
                </label>
                <label class="killer-within-settings__field">
                    <span>Steal success %</span>
                    <input
                        id="kw-deathnote-id-steal-success-box"
                        class="text_pole"
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value="${escapeHtml(String(selectedChance))}"
                    />
                </label>
                <button
                    type="button"
                    id="kw-deathnote-id-steal-clear"
                    class="menu_button"
                    ${selectedHasOverride ? '' : 'disabled'}
                >Use Default</button>
            </div>
            <div class="kw-deathnote-manager__list">${rows}</div>
        </div>
    `;
}

function formatRemainingTime(milliseconds) {
    const value = Number(milliseconds);
    if (!Number.isFinite(value) || value <= 0) {
        return '0m';
    }

    const totalSeconds = Math.ceil(value / 1000);
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function summarizeMessageBody(text) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value) {
        return '(empty)';
    }

    return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function getMessageAuthorLabel(name) {
    const rawName = String(name || '').trim();
    if (!rawName) {
        return 'Message';
    }

    if (rawName.toLowerCase() === 'user') {
        return 'User';
    }

    const actor = getAvailableCharacterActors().find((entry) => {
        const actorName = String(entry && entry.name ? entry.name : '').trim().toLowerCase();
        const actorId = String(entry && entry.id ? entry.id : '').trim().toLowerCase();
        const target = rawName.toLowerCase();
        return actorName === target || actorId === target;
    });

    if (actor) {
        return formatActorLabel(actor);
    }

    return rawName;
}

function getMessageNameHost($message) {
    const selectors = [
        '.name_text',
        '.ch_name',
        '.mes_name',
        '.mes_name_text',
        '.mes_header_name',
        '.avatar-name',
        '.mes_title',
        '.mes_header .name',
        '.mes_header',
    ];

    for (const selector of selectors) {
        const host = $message.find(selector).first();
        if (host.length) {
            return host;
        }
    }

    return $();
}

function getMessageNameHosts($message) {
    const selectors = [
        '.name_text',
        '.ch_name',
        '.mes_name',
        '.mes_name_text',
        '.mes_header_name',
        '.avatar-name',
        '.mes_title',
        '.mes_header .name',
        '.mes_header',
    ];
    const hosts = [];
    const seen = new Set();

    for (const selector of selectors) {
        $message.find(selector).each((_, element) => {
            if (!element || seen.has(element)) {
                return;
            }

            seen.add(element);
            hosts.push(element);
        });
    }

    if (!hosts.length) {
        const fallback = getMessageNameHost($message);
        fallback.each((_, element) => {
            if (!element || seen.has(element)) {
                return;
            }

            seen.add(element);
            hosts.push(element);
        });
    }

    return hosts;
}

function escapeRegExpForUi(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function maskNameForUi(name) {
    const source = String(name || '').trim();
    if (!source) {
        return '';
    }

    let result = '';
    for (let index = 0; index < source.length; index += 1) {
        const char = source.charAt(index);
        const code = source.charCodeAt(index);
        const isUpper = code >= 65 && code <= 90;
        const isLower = code >= 97 && code <= 122;
        result += isUpper || isLower ? '█' : char;
    }

    return result;
}

function isIgnoredMessageTextNode(node) {
    if (!node || !node.parentElement || typeof node.parentElement.closest !== 'function') {
        return false;
    }

    return Boolean(node.parentElement.closest([
        '.mes_text',
        '.message_text',
        '.mes_block .mes_text',
        '.swipes',
        '.kw-thoughts',
        '.kw-thoughts__body',
        '.mes_reasoning',
        '.mes_timer',
        '.mesIDDisplay',
    ].join(', ')));
}

function replaceLeadingName(text, originalName, displayName) {
    const source = String(text || '');
    const original = String(originalName || '').trim();
    const next = String(displayName || '').trim();
    if (!source || !original || !next || original === next) {
        return source;
    }

    const escaped = escapeRegExpForUi(original).replace(/\s+/g, '\\s+');
    return source.replace(new RegExp(`^(${escaped})(?=\\b|\\s|$)`, 'i'), next);
}

function restoreLeadingMaskedName(text, originalName) {
    const source = String(text || '');
    const original = String(originalName || '').trim();
    const masked = maskNameForUi(original);
    if (!source || !original || !masked || masked === original) {
        return source;
    }

    const escaped = escapeRegExpForUi(masked).replace(/\s+/g, '\\s+');
    return source.replace(new RegExp(`^(${escaped})(?=\\b|\\s|$)`), original);
}

function replaceMatchingTextNodes(root, originalName, displayName) {
    if (!root || !originalName || !displayName || originalName === displayName) {
        return false;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let changed = false;
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = String(node && node.textContent ? node.textContent : '');
        const trimmed = text.trim();
        if (!trimmed) {
            continue;
        }

        if (!trimmed.toLowerCase().startsWith(String(originalName || '').trim().toLowerCase())) {
            continue;
        }

        if (trimmed.length > Math.max(String(originalName || '').trim().length + 48, 80)) {
            continue;
        }

        const replaced = replaceLeadingName(text, originalName, displayName);
        if (replaced !== text) {
            node.textContent = replaced;
            changed = true;
        }
    }

    return changed;
}

function replaceStandaloneMessageNameText($message, originalName, displayName) {
    const messageRoot = $message && $message.length ? $message.get(0) : null;
    if (!messageRoot || !originalName || !displayName || originalName === displayName) {
        return false;
    }

    const walker = document.createTreeWalker(messageRoot, NodeFilter.SHOW_TEXT);
    let changed = false;
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = String(node && node.textContent ? node.textContent : '');
        const trimmed = text.trim();
        if (!trimmed || trimmed !== originalName) {
            continue;
        }

        if (isIgnoredMessageTextNode(node)) {
            continue;
        }

        node.textContent = text.replace(originalName, displayName);
        changed = true;
    }

    return changed;
}

function restoreStandaloneMaskedMessageNameText($message, originalName) {
    const messageRoot = $message && $message.length ? $message.get(0) : null;
    const maskedOriginal = maskNameForUi(originalName);
    if (!messageRoot || !originalName || !maskedOriginal || maskedOriginal === originalName) {
        return false;
    }

    const walker = document.createTreeWalker(messageRoot, NodeFilter.SHOW_TEXT);
    let changed = false;
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = String(node && node.textContent ? node.textContent : '');
        const trimmed = text.trim();
        if (!trimmed || trimmed !== maskedOriginal) {
            continue;
        }

        if (isIgnoredMessageTextNode(node)) {
            continue;
        }

        node.textContent = text.replace(maskedOriginal, originalName);
        changed = true;
    }

    return changed;
}

function renderMaskedChatMessageNames() {
    const context = getContext();
    const chat = context && Array.isArray(context.chat) ? context.chat : [];

    $('.mes').each((_, element) => {
        const $message = $(element);
        const mesIdRaw = $message.attr('mesid') ?? $message.data('mesid');
        const mesId = Number(mesIdRaw);
        if (!Number.isInteger(mesId) || mesId < 0 || mesId >= chat.length) {
            return;
        }

        const message = chat[mesId];
        const actor = getCharacterActorForMessage(message);
        const originalName = String(
            message && (message.name || (actor && actor.name) || '')
                ? (message.name || (actor && actor.name) || '')
                : ''
        ).trim();
        const displayName = actor ? getActorDisplayName(actor, originalName || 'Character') : '';
        const hosts = getMessageNameHosts($message);

        if (!hosts.length) {
            return;
        }

        if (!actor || !displayName || !originalName) {
            for (const node of hosts) {
                const element = node;
                const storedOriginal = String(element && element.getAttribute ? element.getAttribute('data-kw-original-name') || '' : '').trim();
                if (!storedOriginal) {
                    continue;
                }

                const currentText = String(element.textContent || '');
                if (currentText.trim() === storedOriginal) {
                    continue;
                }

                if (displayName && currentText.trim() && currentText.trim().startsWith(displayName)) {
                    element.textContent = replaceLeadingName(currentText, displayName, storedOriginal);
                } else {
                    replaceMatchingTextNodes(element, displayName, storedOriginal);
                }
            }
            return;
        }

        for (const node of hosts) {
            const element = node;
            const storedOriginal = String(element && element.getAttribute ? element.getAttribute('data-kw-original-name') || '' : '').trim();
            const baseline = storedOriginal || originalName;
            if (!storedOriginal && element && element.setAttribute) {
                element.setAttribute('data-kw-original-name', baseline);
            }
            const maskedBaseline = maskNameForUi(baseline);
            if (element && element.setAttribute) {
                element.setAttribute('data-kw-masked-name', maskedBaseline);
            }

            const currentText = String(element && element.textContent ? element.textContent : '');
            if (displayName === baseline) {
                if (currentText.trim() === maskedBaseline) {
                    element.textContent = baseline;
                    continue;
                }

                const restored = restoreLeadingMaskedName(currentText, baseline);
                if (restored !== currentText) {
                    element.textContent = restored;
                    continue;
                }

                replaceMatchingTextNodes(element, maskedBaseline, baseline);
                continue;
            }

            const replaced = replaceLeadingName(currentText, baseline, displayName);
            if (replaced !== currentText) {
                element.textContent = replaced;
                continue;
            }

            replaceMatchingTextNodes(element, baseline, displayName);
        }

        replaceStandaloneMessageNameText($message, originalName, displayName);
        if (displayName === originalName) {
            restoreStandaloneMaskedMessageNameText($message, originalName);
        }
    });
}

function queueMaskedChatNameRender() {
    if (chatNameMaskQueued) {
        return;
    }

    chatNameMaskQueued = true;
    requestAnimationFrame(() => {
        chatNameMaskQueued = false;
        renderMaskedChatMessageNames();
    });
}

function ensureChatNameMaskObserver() {
    if (chatNameMaskObserver) {
        return;
    }

    const root = document.querySelector('#chat') || document.querySelector('#chat_container') || document.body;
    if (!root || typeof MutationObserver === 'undefined') {
        return;
    }

    chatNameMaskObserver = new MutationObserver(() => {
        queueMaskedChatNameRender();
    });

    chatNameMaskObserver.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
    });
}

function teardownChatNameMaskObserver() {
    if (!chatNameMaskObserver) {
        return;
    }

    chatNameMaskObserver.disconnect();
    chatNameMaskObserver = null;
}

function renderMemoryManagerHtml() {
    const messages = getRecentChatMemoryCandidates(10);
    if (!messages.length) {
        return `
            <div class="kw-deathnote-manager">
                <div class="kw-memory-manager__empty">No recent chat messages are available.</div>
            </div>
        `;
    }

    const rows = messages.map((entry) => {
        return `
            <div class="kw-deathnote-item">
                <div class="kw-deathnote-item__meta">
                    <b>Message ${entry.index + 1} | ${escapeHtml(getMessageAuthorLabel(entry.name))}</b>
                    <span>${escapeHtml(summarizeMessageBody(entry.body))}</span>
                </div>
                <span class="kw-deathnote-name-state">${entry.tracked ? 'Tracked' : 'Normal'}</span>
                <button
                    type="button"
                    class="menu_button ${entry.tracked ? 'kw-deathnote-untrack-memory' : 'kw-deathnote-track-memory'}"
                    data-message-index="${entry.index}"
                >${entry.tracked ? 'Untrack' : 'Track'}</button>
            </div>
        `;
    }).join('');

    return `
        <div class="kw-deathnote-manager">
            <div class="kw-deathnote-manager__summary">
                <span><b>Tracked messages</b> are forgotten by characters who no longer touch the notebook or one of its scraps.</span>
            </div>
            <div class="kw-deathnote-manager__list">${rows}</div>
        </div>
    `;
}

function getAvailableCharacterActors() {
    return getCurrentChatCharacterActors();
}

function getActorChoices(options = {}) {
    const includeUser = options.includeUser !== false;
    const includeCharacters = options.includeCharacters !== false;
    const includeWorld = Boolean(options.includeWorld);
    const currentActor = options.currentActor && typeof options.currentActor === 'object' ? options.currentActor : null;
    const seen = new Set();
    const actors = [];

    if (includeUser) {
        actors.push({
            type: NOTEBOOK_ACTOR_TYPES.USER,
            id: '',
            name: 'User',
        });
    }

    if (includeCharacters) {
        actors.push(...getAvailableCharacterActors());
    }

    if (includeWorld) {
        actors.push({
            type: NOTEBOOK_ACTOR_TYPES.WORLD,
            id: '',
            name: 'World',
        });
    }

    if (currentActor) {
        actors.push(currentActor);
    }

    return actors.filter((actor) => {
        const key = actorIdentityKey(actor);
        if (seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
}

function renderActorOptions(actors, selectedActor, includeEmpty = false, emptyLabel = 'None', labelFormatter = formatActorLabel) {
    const options = [];
    if (includeEmpty) {
        options.push(`<option value="">${escapeHtml(emptyLabel)}</option>`);
    }

    const selectedKey = selectedActor ? actorIdentityKey(selectedActor) : '';
    for (const actor of Array.isArray(actors) ? actors : []) {
        const isSelected = selectedKey && actorIdentityKey(actor) === selectedKey;
        options.push(`
            <option value="${escapeHtml(encodeActorValue(actor))}" ${isSelected ? 'selected' : ''}>
                ${escapeHtml(labelFormatter(actor))}
            </option>
        `);
    }

    return options.join('');
}

function formatAccessLabel(access) {
    if (access === NOTEBOOK_USER_ACCESS.FULL) {
        return 'Full notebook';
    }

    if (access === NOTEBOOK_USER_ACCESS.SCRAP) {
        return 'Scrap only';
    }

    if (access === NOTEBOOK_USER_ACCESS.TOUCH) {
        return 'Touch only';
    }

    return 'No access';
}

function getUserActor() {
    return {
        type: NOTEBOOK_ACTOR_TYPES.USER,
        id: '',
        name: 'User',
    };
}

function renderUserAccessOptions(selectedAccess) {
    const options = [
        { value: NOTEBOOK_USER_ACCESS.FULL, label: 'Full notebook' },
        { value: NOTEBOOK_USER_ACCESS.SCRAP, label: 'Scrap only' },
        { value: NOTEBOOK_USER_ACCESS.TOUCH, label: 'Touch only' },
        { value: NOTEBOOK_USER_ACCESS.NONE, label: 'None' },
    ];

    return options.map((option) => {
        return `
            <option value="${option.value}" ${selectedAccess === option.value ? 'selected' : ''}>
                ${option.label}
            </option>
        `;
    }).join('');
}

function getUserHeldNotebookItems(inventory) {
    const notebooks = Array.isArray(inventory?.notebooks) ? inventory.notebooks : [];
    return notebooks.filter((entry) => entry && !entry.destroyed && entry.userAccess === NOTEBOOK_USER_ACCESS.FULL);
}

function getNotebookSummaryById(inventory, notebookId) {
    const targetId = String(notebookId || '').trim();
    return (Array.isArray(inventory?.notebooks) ? inventory.notebooks : []).find((entry) => entry && entry.itemId === targetId) || null;
}

function getSelectedInventoryItemKey(settings, inventory, ownership = getNotebookOwnership()) {
    const scraps = inventory.scraps.filter((scrap) => scrap && scrap.active);
    const ids = Array.isArray(inventory.ids) ? inventory.ids : [];
    const userHeldNotebooks = getUserHeldNotebookItems(inventory);
    const selectedNotebookId = String(settings.selectedNotebookId || getSelectedNotebookIdState() || '').trim();
    const selected = String(settings.inventorySelectedItemKey || 'notebook').trim();
    if (selected.startsWith('notebook:')) {
        const notebookId = selected.slice('notebook:'.length);
        if (userHeldNotebooks.some((entry) => entry.itemId === notebookId)) {
            return selected;
        }
    }

    if ((!selected || selected === 'notebook') && userHeldNotebooks.length) {
        const preferred = userHeldNotebooks.find((entry) => entry.itemId === selectedNotebookId) || userHeldNotebooks[0];
        return preferred ? `notebook:${preferred.itemId}` : '';
    }

    if (selected.startsWith('scrap:')) {
        const scrapId = selected.slice('scrap:'.length);
        if (scraps.some((scrap) => scrap.id === scrapId)) {
            return selected;
        }
    }

    if (selected.startsWith('id:')) {
        const idCardId = selected.slice('id:'.length);
        if (ids.some((entry) => entry && entry.id === idCardId)) {
            return selected;
        }
    }

    if (scraps.length) {
        return `scrap:${scraps[0].id}`;
    }

    if (ids.length) {
        return `id:${ids[0].id}`;
    }

    return userHeldNotebooks.length ? `notebook:${userHeldNotebooks[0].itemId}` : '';
}

function renderInventoryGridSlots(inventory, ownership, selectedKey, coverUrl) {
    const slots = [];
    for (const notebook of getUserHeldNotebookItems(inventory)) {
        const itemKey = `notebook:${notebook.itemId}`;
        slots.push(`
            <button
                type="button"
                class="kw-dn-inventory__slot ${selectedKey === itemKey ? 'is-selected' : ''} ${notebook.destroyed ? 'is-disabled' : ''}"
                data-item-key="${escapeHtml(itemKey)}"
                aria-pressed="${selectedKey === itemKey ? 'true' : 'false'}"
            >
                <img
                    class="kw-dn-inventory__slot-art"
                    src="${coverUrl}"
                    alt="Death Note cover"
                    draggable="false"
                />
                <span class="kw-dn-inventory__slot-label">${escapeHtml(notebook.label || 'Death Note')}</span>
            </button>
        `);
    }

    const scraps = inventory.scraps.filter((scrap) => scrap && scrap.active);
    for (const scrap of scraps) {
        const itemKey = `scrap:${scrap.id}`;
        slots.push(`
            <button
                type="button"
                class="kw-dn-inventory__slot kw-dn-inventory__slot--scrap ${selectedKey === itemKey ? 'is-selected' : ''}"
                data-item-key="${escapeHtml(itemKey)}"
                aria-pressed="${selectedKey === itemKey ? 'true' : 'false'}"
            >
                <span class="kw-dn-inventory__scrap-art" aria-hidden="true"></span>
                <span class="kw-dn-inventory__slot-label">${escapeHtml(scrap.label)}</span>
            </button>
        `);
    }

    const ids = Array.isArray(inventory.ids) ? inventory.ids : [];
    for (const idCard of ids) {
        const itemKey = `id:${idCard.id}`;
        slots.push(`
            <button
                type="button"
                class="kw-dn-inventory__slot kw-dn-inventory__slot--id ${selectedKey === itemKey ? 'is-selected' : ''}"
                data-item-key="${escapeHtml(itemKey)}"
                aria-pressed="${selectedKey === itemKey ? 'true' : 'false'}"
            >
                <span class="kw-dn-inventory__id-art" aria-hidden="true"></span>
                <span class="kw-dn-inventory__slot-label">${escapeHtml(idCard.label)}</span>
            </button>
        `);
    }

    if (!getUserHeldNotebookItems(inventory).length && !scraps.length && !ids.length) {
        slots.push(`
            <div class="kw-dn-inventory__slot kw-dn-inventory__slot--empty" aria-hidden="true">
                <span class="kw-dn-inventory__slot-label">Empty</span>
            </div>
        `);
    }

    return slots.join('');
}

function renderNotebookSelectionPanel({ settings, notebook, ownership, linked }) {
    const notebookAvailable = Boolean(notebook && !notebook.destroyed);
    const canOpenNotebook = notebookAvailable && ownership.userAccess === NOTEBOOK_USER_ACCESS.FULL;
    const canTransferNotebook = notebookAvailable && ownership.userAccess === NOTEBOOK_USER_ACCESS.FULL;
    const linkedLabel = linked.active ? formatActorInventoryLabel(linked.actor) : 'No link';
    const selectedRecipient = ownership.holder && ownership.holder.type === NOTEBOOK_ACTOR_TYPES.CHARACTER
        ? ownership.holder
        : null;
    const transferChoices = getActorChoices({
        currentActor: selectedRecipient,
        includeUser: false,
        includeWorld: false,
    });
    const linkChoices = getActorChoices({
        includeUser: false,
        includeCharacters: true,
        currentActor: linked.active ? {
            type: NOTEBOOK_ACTOR_TYPES.CHARACTER,
            id: linked.avatar || linked.actor.id,
            name: linked.actor.name,
        } : null,
    });
    const selectedLinkActor = linked.active ? {
        type: NOTEBOOK_ACTOR_TYPES.CHARACTER,
        id: linked.avatar || linked.actor.id,
        name: linked.actor.name,
    } : null;

    return `
        <div class="kw-dn-inventory__context-card kw-dn-inventory__context-card--notebook">
            <div class="kw-dn-inventory__context-head">
                <div>
                    <div class="kw-dn-inventory__item-eyebrow">${escapeHtml(notebook?.label || 'Death Note')}</div>
                    <div class="kw-dn-inventory__context-title">${settings.isOpen ? 'Opened' : 'Stored'}</div>
                </div>
                <div class="kw-dn-inventory__context-meta">Linked: ${escapeHtml(linkedLabel)}</div>
            </div>
            <div class="kw-dn-inventory__context-actions">
                <button
                    type="button"
                    id="kw-dn-inventory-open"
                    class="menu_button kw-dn-inventory__context-action"
                    ${canOpenNotebook ? '' : 'disabled'}
                >${settings.isOpen ? 'Put Away' : 'Open Death Note'}</button>
                <button
                    type="button"
                    id="kw-dn-inventory-tear"
                    class="menu_button kw-dn-inventory__context-action"
                    ${canOpenNotebook ? '' : 'disabled'}
                >Tear Off Scrap</button>
                <button
                    type="button"
                    id="kw-dn-inventory-toggle-floating"
                    class="menu_button kw-dn-inventory__context-action"
                >${settings.showFloatingButton ? 'Hide Button' : 'Show Button'}</button>
            </div>
            <details class="kw-dn-inventory__context-advanced">
                <summary class="kw-dn-inventory__context-meta">Transfer And Shinigami</summary>
                <div class="kw-dn-inventory__context-link">
                    <select
                        id="kw-dn-inventory-give-select"
                        class="text_pole kw-dn-inventory__context-select"
                        data-notebook-id="${escapeHtml(notebook?.itemId || '')}"
                        ${canTransferNotebook ? '' : 'disabled'}
                    >
                        ${renderActorOptions(transferChoices, null, true, 'Choose recipient', formatActorInventoryLabel)}
                    </select>
                    <button
                        type="button"
                        id="kw-dn-inventory-give-notebook"
                        class="menu_button kw-dn-inventory__context-action"
                        data-notebook-id="${escapeHtml(notebook?.itemId || '')}"
                        ${canTransferNotebook ? '' : 'disabled'}
                    >Give</button>
                </div>
                <div class="kw-dn-inventory__context-link">
                    <select
                        id="kw-dn-inventory-shinigami-select"
                        class="text_pole kw-dn-inventory__context-select"
                        data-notebook-id="${escapeHtml(notebook?.itemId || '')}"
                    >
                        ${renderActorOptions(linkChoices, selectedLinkActor, true, 'Select Shinigami', formatActorInventoryLabel)}
                    </select>
                    <button
                        type="button"
                        id="kw-dn-inventory-link-shinigami"
                        class="menu_button kw-dn-inventory__context-action"
                        data-notebook-id="${escapeHtml(notebook?.itemId || '')}"
                    >Link Shinigami</button>
                    <button
                        type="button"
                        id="kw-dn-inventory-unlink-shinigami"
                        class="menu_button kw-dn-inventory__context-action"
                        data-notebook-id="${escapeHtml(notebook?.itemId || '')}"
                        ${linked.active ? '' : 'disabled'}
                    >Clear Link</button>
                </div>
            </details>
        </div>
    `;
}

function renderScrapSelectionPanel(scrap) {
    const selectedRecipient = scrap.holder && scrap.holder.type === NOTEBOOK_ACTOR_TYPES.CHARACTER
        ? scrap.holder
        : null;
    const actors = getActorChoices({
        currentActor: selectedRecipient,
        includeUser: false,
        includeWorld: false,
    });

    return `
        <div class="kw-dn-inventory__context-card kw-dn-inventory__context-card--scrap">
            <div class="kw-dn-inventory__context-head">
                <div>
                    <div class="kw-dn-inventory__item-eyebrow">Scrap</div>
                    <div class="kw-dn-inventory__context-title">${escapeHtml(scrap.label)}</div>
                </div>
                <div class="kw-dn-inventory__context-meta">${escapeHtml(formatActorInventoryLabel(scrap.holder))}</div>
            </div>
            <div class="kw-dn-inventory__scrap-paper">
                <div class="kw-dn-inventory__scrap-paper-label">Torn Note</div>
                <div class="kw-dn-inventory__scrap-editor">
                    <textarea
                        class="kw-dn-inventory__scrap-textarea"
                        data-scrap-id="${escapeHtml(scrap.id)}"
                        rows="2"
                        spellcheck="false"
                        placeholder="Write up to two names..."
                    >${escapeHtml(scrap.noteText || '')}</textarea>
                    ${renderPermanentLineOverlay('scrap', `scrap:${scrap.id}`, scrap.noteText || '', 'kw-dn-inventory__locked-overlay')}
                </div>
                <div class="kw-dn-inventory__scrap-paper-note">A scrap can hold no more than two valid Death Note names.</div>
            </div>
            <div class="kw-dn-inventory__context-link">
                <select
                    class="text_pole kw-dn-inventory__context-select kw-dn-inventory__scrap-select"
                    data-scrap-id="${escapeHtml(scrap.id)}"
                >
                    ${renderActorOptions(actors, selectedRecipient, true, 'Choose recipient', formatActorInventoryLabel)}
                </select>
                <button
                    type="button"
                    class="menu_button kw-dn-inventory__context-action kw-dn-inventory__scrap-give"
                    data-scrap-id="${escapeHtml(scrap.id)}"
                >Give</button>
                <button
                    type="button"
                    class="menu_button kw-dn-inventory__context-action kw-dn-inventory__scrap-remove"
                    data-scrap-id="${escapeHtml(scrap.id)}"
                >Destroy</button>
            </div>
        </div>
    `;
}

function renderIdentityCardSelectionPanel(idCard) {
    return `
        <div class="kw-dn-inventory__context-card kw-dn-inventory__context-card--id">
            <div class="kw-dn-inventory__context-head">
                <div>
                    <div class="kw-dn-inventory__item-eyebrow">ID Card</div>
                    <div class="kw-dn-inventory__context-title">${escapeHtml(idCard.actor.name || idCard.label)}</div>
                </div>
                <div class="kw-dn-inventory__context-meta">Held by User</div>
            </div>
            <div class="kw-dn-inventory__context-meta">
                A stolen identification confirming this character's true name.
            </div>
        </div>
    `;
}

function renderInventorySelectionPanel(settings, inventory, ownership, linked) {
    const selectedKey = getSelectedInventoryItemKey(settings, inventory, ownership);
    if (!selectedKey) {
        const notebooksElsewhere = (Array.isArray(inventory.notebooks) ? inventory.notebooks : []).filter((entry) => entry && !entry.destroyed && entry.userAccess !== NOTEBOOK_USER_ACCESS.FULL);
        const notebook = notebooksElsewhere[0] || null;
        const request = notebook ? getNotebookReturnRequest(notebook.itemId) : { active: false, actor: null };
        const holder = notebook?.holder && notebook.holder.type === NOTEBOOK_ACTOR_TYPES.CHARACTER ? notebook.holder : null;
        const requestMatchesHolder = Boolean(
            request.active
            && holder
            && String(request.actor?.name || '').trim().toLowerCase() === String(holder.name || '').trim().toLowerCase(),
        );
        const canRequestReturn = Boolean(
            holder
            && notebook
            && notebook.userAccess !== NOTEBOOK_USER_ACCESS.FULL,
        );
        return `
            <div class="kw-dn-inventory__context-card kw-dn-inventory__context-card--id">
                <div class="kw-dn-inventory__context-head">
                    <div>
                        <div class="kw-dn-inventory__item-eyebrow">Inventory</div>
                        <div class="kw-dn-inventory__context-title">No Death Note Held</div>
                    </div>
                    <div class="kw-dn-inventory__context-meta">Your notebooks are currently elsewhere</div>
                </div>
                ${holder ? `<div class="kw-dn-inventory__context-meta">Holder: ${escapeHtml(formatActorInventoryLabel(holder))}</div>` : ''}
                ${canRequestReturn ? `
                    <div class="kw-dn-inventory__context-actions">
                        <button
                            type="button"
                            id="kw-dn-inventory-request-return"
                            class="menu_button kw-dn-inventory__context-action"
                            data-actor="${escapeHtml(encodeActorValue(holder))}"
                            data-notebook-id="${escapeHtml(notebook.itemId)}"
                            ${requestMatchesHolder ? 'disabled' : ''}
                        >${requestMatchesHolder ? 'Return Requested' : 'Request Return'}</button>
                    </div>
                ` : ''}
            </div>
        `;
    }
    if (selectedKey.startsWith('notebook:')) {
        const notebookId = selectedKey.slice('notebook:'.length);
        const notebook = getNotebookSummaryById(inventory, notebookId);
        const notebookOwnership = getNotebookOwnership(notebookId);
        const notebookLinked = getLinkedShinigami(notebookId);
        return renderNotebookSelectionPanel({ settings, notebook, ownership: notebookOwnership, linked: notebookLinked });
    }

    if (selectedKey.startsWith('id:')) {
        const idCardId = selectedKey.slice('id:'.length);
        const idCard = Array.isArray(inventory.ids)
            ? inventory.ids.find((entry) => entry && entry.id === idCardId)
            : null;
        if (idCard) {
            return renderIdentityCardSelectionPanel(idCard);
        }

        const fallbackNotebook = getUserHeldNotebookItems(inventory)[0] || null;
        return fallbackNotebook
            ? renderNotebookSelectionPanel({
                settings,
                notebook: fallbackNotebook,
                ownership: getNotebookOwnership(fallbackNotebook.itemId),
                linked: getLinkedShinigami(fallbackNotebook.itemId),
            })
            : '';
    }

    const scrapId = selectedKey.slice('scrap:'.length);
    const scrap = inventory.scraps.find((entry) => entry && entry.active && entry.id === scrapId);
    if (!scrap) {
        const fallbackNotebook = getUserHeldNotebookItems(inventory)[0] || null;
        return fallbackNotebook
            ? renderNotebookSelectionPanel({
                settings,
                notebook: fallbackNotebook,
                ownership: getNotebookOwnership(fallbackNotebook.itemId),
                linked: getLinkedShinigami(fallbackNotebook.itemId),
            })
            : '';
    }

    return renderScrapSelectionPanel(scrap);
}

function renderInventoryTrayHtml() {
    const settings = getSettings();
    const ownership = getNotebookOwnership();
    const inventory = getDeathNoteInventory();
    const linked = getLinkedShinigami();
    const coverUrl = new URL('../assets/deathnote/cover.jpg', import.meta.url).toString();
    const itemCount = getUserHeldNotebookItems(inventory).length
        + inventory.scraps.filter((scrap) => scrap && scrap.active).length
        + (Array.isArray(inventory.ids) ? inventory.ids.length : 0);
    const selectedKey = getSelectedInventoryItemKey(settings, inventory, ownership);

    return `
        <div class="kw-dn-inventory__shell ${settings.inventoryCollapsed ? 'is-collapsed' : ''}">
            <button
                type="button"
                id="kw-dn-inventory-toggle"
                class="kw-dn-inventory__toggle"
                aria-expanded="${settings.inventoryCollapsed ? 'false' : 'true'}"
                aria-controls="${INVENTORY_ID}-panel"
            >
                <span class="kw-dn-inventory__toggle-label">Inventory</span>
                <span class="kw-dn-inventory__toggle-count">${itemCount}</span>
            </button>
            <div id="${INVENTORY_ID}-panel" class="kw-dn-inventory__panel">
                <div class="kw-dn-inventory__header">
                    <div>
                        <div class="kw-dn-inventory__eyebrow">Killer Within</div>
                        <h3 class="kw-dn-inventory__title">Inventory</h3>
                    </div>
                    <div class="kw-dn-inventory__header-buttons">
                        <button type="button" id="kw-dn-inventory-manage-open" class="menu_button kw-dn-inventory__header-action">Manage Death Notes</button>
                        <button type="button" id="kw-dn-inventory-settings-open" class="menu_button kw-dn-inventory__header-action">Settings</button>
                    </div>
                </div>

                <div class="kw-dn-inventory__layout">
                    <div class="kw-dn-inventory__grid-wrap">
                        <div class="kw-dn-inventory__grid">
                            ${renderInventoryGridSlots(inventory, ownership, selectedKey, coverUrl)}
                        </div>
                    </div>
                    <section class="kw-dn-inventory__context">
                        ${renderInventorySelectionPanel(settings, inventory, ownership, linked)}
                    </section>
                </div>
            </div>
        </div>
    `;
}

function renderNotebookManagerHtml() {
    const ownership = getNotebookOwnership();
    const inventory = getDeathNoteInventory();
    const actors = getActorChoices({
        currentActor: ownership.holder,
        includeWorld: true,
    });

    return `
        <div class="kw-deathnote-manager">
            <div class="kw-deathnote-manager__summary">
                <span><b>Owner:</b> ${escapeHtml(formatActorLabel(ownership.owner))}</span>
                <span><b>Holder:</b> ${escapeHtml(formatActorLabel(ownership.holder))}</span>
                <span><b>User access:</b> ${escapeHtml(formatAccessLabel(ownership.userAccess))}</span>
                <span><b>Status:</b> ${inventory.notebook.destroyed ? 'Destroyed / missing' : 'In play'}</span>
            </div>
            <div class="kw-deathnote-manager__grid">
                <label class="killer-within-settings__field">
                    <span>Notebook owner</span>
                    <select id="kw-deathnote-owner" class="text_pole">
                        ${renderActorOptions(actors, ownership.owner)}
                    </select>
                </label>
                <label class="killer-within-settings__field">
                    <span>Current holder</span>
                    <select id="kw-deathnote-holder" class="text_pole">
                        ${renderActorOptions(actors, ownership.holder)}
                    </select>
                </label>
                <label class="killer-within-settings__field">
                    <span>User access</span>
                    <select id="kw-deathnote-user-access" class="text_pole">
                        ${renderUserAccessOptions(ownership.userAccess)}
                    </select>
                </label>
            </div>
            <div class="kw-deathnote-manager__actions">
                <button
                    type="button"
                    id="kw-deathnote-toggle-destroyed"
                    class="menu_button"
                >${inventory.notebook.destroyed ? 'Restore notebook' : 'Destroy notebook'}</button>
            </div>
        </div>
    `;
}

function renderLinkManagerHtml() {
    const linked = getLinkedShinigami();
    const actors = getActorChoices({
        includeUser: false,
        includeCharacters: true,
        currentActor: linked.active ? {
            type: NOTEBOOK_ACTOR_TYPES.CHARACTER,
            id: linked.avatar || linked.actor.id,
            name: linked.actor.name,
        } : null,
    });
    const selectedActor = linked.active ? {
        type: NOTEBOOK_ACTOR_TYPES.CHARACTER,
        id: linked.avatar || linked.actor.id,
        name: linked.actor.name,
    } : null;

    return `
        <div class="kw-deathnote-manager">
            <div class="kw-deathnote-manager__summary">
                <span><b>Linked Shinigami:</b> ${escapeHtml(linked.active ? getActorDisplayName(linked.actor, linked.avatar || 'Linked') : 'None')}</span>
            </div>
            <div class="kw-deathnote-manager__actions">
                <label class="killer-within-settings__field kw-deathnote-manager__grow">
                    <span>Character card to link</span>
                    <select id="kw-deathnote-shinigami-select" class="text_pole">
                        ${renderActorOptions(actors, selectedActor, true, 'Select a character')}
                    </select>
                </label>
                <button type="button" id="kw-deathnote-link-shinigami" class="menu_button">Link</button>
                <button type="button" id="kw-deathnote-unlink-shinigami" class="menu_button" ${linked.active ? '' : 'disabled'}>Clear link</button>
            </div>
        </div>
    `;
}

function renderScrapManagerHtml() {
    const inventory = getDeathNoteInventory();
    const actors = getActorChoices({
        currentActor: inventory.scraps.length ? inventory.scraps[0].holder : null,
        includeWorld: true,
    });
    const scraps = inventory.scraps.filter((scrap) => scrap && scrap.active);

    if (!scraps.length) {
        return `
            <div class="kw-deathnote-manager">
                <div class="kw-memory-manager__empty">No active scraps.</div>
                <div class="kw-deathnote-manager__actions">
                    <label class="killer-within-settings__field kw-deathnote-manager__grow">
                        <span>New scrap holder</span>
                        <select id="kw-deathnote-new-scrap-holder" class="text_pole">
                            ${renderActorOptions(actors, null)}
                        </select>
                    </label>
                    <button type="button" id="kw-deathnote-create-scrap" class="menu_button">Create scrap</button>
                </div>
            </div>
        `;
    }

    const rows = scraps.map((scrap) => {
        const choices = getActorChoices({
            currentActor: scrap.holder,
            includeWorld: true,
        });
        return `
            <div class="kw-deathnote-item">
                <div class="kw-deathnote-item__meta">
                    <b>${escapeHtml(scrap.label)}</b>
                    <span>${escapeHtml(scrap.noteText || 'Blank scrap')}</span>
                </div>
                <select
                    class="text_pole kw-deathnote-scrap-holder"
                    data-scrap-id="${escapeHtml(scrap.id)}"
                >
                    ${renderActorOptions(choices, scrap.holder)}
                </select>
                <button
                    type="button"
                    class="menu_button kw-deathnote-remove-scrap"
                    data-scrap-id="${escapeHtml(scrap.id)}"
                >Remove</button>
            </div>
        `;
    }).join('');

    return `
        <div class="kw-deathnote-manager">
            <div class="kw-deathnote-manager__list">${rows}</div>
            <div class="kw-deathnote-manager__actions">
                <label class="killer-within-settings__field kw-deathnote-manager__grow">
                    <span>New scrap holder</span>
                    <select id="kw-deathnote-new-scrap-holder" class="text_pole">
                        ${renderActorOptions(actors, null)}
                    </select>
                </label>
                <button type="button" id="kw-deathnote-create-scrap" class="menu_button">Create scrap</button>
            </div>
        </div>
    `;
}

function renderToucherManagerHtml() {
    const state = getChatState();
    const touchers = state.inventory.touchers.filter((entry) => entry && entry.active);
    const derived = getChatState().inventory.touchers.filter((entry) => entry && entry.active);
    const actors = getActorChoices({
        includeWorld: false,
    });
    const currentTouchers = getNotebookTouchersSummary();
    const manualRows = touchers.length
        ? touchers.map((toucher) => {
            return `
                <div class="kw-deathnote-item">
                    <div class="kw-deathnote-item__meta">
                        <b>${escapeHtml(formatActorLabel(toucher.actor))}</b>
                        <span>${escapeHtml(String(toucher.source || 'manual_touch'))}</span>
                    </div>
                </div>
            `;
        }).join('')
        : '<div class="kw-memory-manager__empty">No explicit manual touchers.</div>';

    return `
        <div class="kw-deathnote-manager">
            <div class="kw-deathnote-manager__summary">
                <span><b>Current viewers:</b> ${escapeHtml(currentTouchers || 'None')}</span>
            </div>
            <div class="kw-deathnote-manager__list">${manualRows}</div>
            <div class="kw-deathnote-manager__actions">
                <label class="killer-within-settings__field kw-deathnote-manager__grow">
                    <span>Add manual toucher</span>
                    <select id="kw-deathnote-new-toucher" class="text_pole">
                        ${renderActorOptions(actors, null, true, 'Select a character')}
                    </select>
                </label>
                <button type="button" id="kw-deathnote-add-toucher" class="menu_button">Add toucher</button>
                <button type="button" id="kw-deathnote-clear-touchers" class="menu_button" ${derived.length ? '' : 'disabled'}>Clear manual touchers</button>
            </div>
        </div>
    `;
}

function getNotebookTouchersSummary() {
    const state = getChatState();
    const touchers = state && state.inventory && Array.isArray(state.inventory.touchers) ? state.inventory.touchers.filter((entry) => entry && entry.active) : [];
    const inventory = getDeathNoteInventory();
    const derived = [];

    if (inventory.notebook && inventory.notebook.exists) {
        derived.push(formatActorLabel(inventory.notebook.holder));
    }

    for (const scrap of inventory.scraps) {
        if (!scrap || !scrap.active) {
            continue;
        }

        derived.push(formatActorLabel(scrap.holder));
    }

    for (const toucher of touchers) {
        derived.push(formatActorLabel(toucher.actor));
    }

    return Array.from(new Set(derived.filter(Boolean))).join(', ');
}

async function commitInventoryMutation(mutate, successMessage = '') {
    try {
        const result = await mutate();
        if (!result) {
            return false;
        }

        await persistChatChanges();
        await syncLinkedShinigamiVisibility();
        refreshDeathNoteUi();
        if (successMessage) {
            notify('success', successMessage);
        }
        return result;
    } catch (error) {
        console.error('[killer_within_deathnote] Inventory manager action failed', error);
        notify('error', 'Death Note manager action failed.');
        return false;
    }
}

function getSettingsHost() {
    return $('#extensions_settings2, #extensions_settings').first();
}

function syncSettingsUi() {
    const settings = getSettings();
    $('#kw-deathnote-font-mode').val(settings.fontMode === 'script' ? 'script' : 'print');
    $('#kw-deathnote-require-known-names').prop('checked', Boolean(settings.requireKnownNamesForKills));
    $('#kw-deathnote-permanent-notebook').prop('checked', Boolean(settings.permanentResolvedNotebookEntries));
    $('#kw-deathnote-permanent-scrap').prop('checked', Boolean(settings.permanentResolvedScrapEntries));
    $('#kw-deathnote-open-sound').prop('checked', Boolean(settings.enableOpenSound));
    $('#kw-deathnote-writing-sound').prop('checked', Boolean(settings.enableWritingSound));
    $('#kw-deathnote-show-ai-write-debug-blocks').prop('checked', Boolean(settings.showAiWriteDebugBlocks));
    $('#kw-deathnote-prompt-template').val(settings.deathNotePromptTemplate);
    $('#kw-deathnote-prompt-theft-template').val(settings.identityTheftPromptTemplate);
    $('#kw-deathnote-prompt-reveal-template').val(settings.notebookRevealPromptTemplate);
    $('#kw-deathnote-prompt-presence-template').val(settings.presencePromptTemplate);
    $('#kw-deathnote-name-manager').html(renderNameKnowledgeManagerHtml());
    $('#kw-deathnote-memory-manager').html(renderMemoryManagerHtml());
    syncThoughtSettingsUi();
}

function bindSettingsUi() {
    $('#kw-deathnote-font-mode').off('input').on('input', (event) => {
        const value = String($(event.currentTarget).val() || 'print').trim().toLowerCase();
        getSettings().fontMode = value === 'script' ? 'script' : 'print';
        scheduleSettingsSave();
        refreshDeathNoteUi();
    });

    $('#kw-deathnote-require-known-names').off('change').on('change', (event) => {
        getSettings().requireKnownNamesForKills = Boolean($(event.currentTarget).prop('checked'));
        scheduleSettingsSave();
        const inventory = getDeathNoteInventory();
        const notebookId = String(getSettings().selectedNotebookId || getSelectedNotebookIdState() || '').trim();
        const sanitizedPages = sanitizeNotebookPagesForRules(getNotebookPages(notebookId));
        let changed = setNotebookPages(sanitizedPages, notebookId);
        for (const scrap of Array.isArray(inventory.scraps) ? inventory.scraps : []) {
            if (!scrap || !scrap.active) {
                continue;
            }

            const sanitizedScrapText = sanitizeScrapNoteText(scrap.noteText || '', 2);
            if (updateNotebookScrapText(scrap.id, sanitizedScrapText, {
                reason: 'Scrap text sanitized after known-name requirement changed.',
            })) {
                changed = true;
            }
        }

        if (changed) {
            persistChatChanges();
            refreshDeathNoteUi();
        }
    });

    $('#kw-deathnote-permanent-notebook').off('change').on('change', async (event) => {
        getSettings().permanentResolvedNotebookEntries = Boolean($(event.currentTarget).prop('checked'));
        scheduleSettingsSave();
        const notebookId = String(getSettings().selectedNotebookId || getSelectedNotebookIdState() || '').trim();
        const changed = setNotebookPages([...getNotebookPages(notebookId)], notebookId);
        if (changed) {
            await persistChatChanges();
        }
        refreshDeathNoteUi();
    });

    $('#kw-deathnote-permanent-scrap').off('change').on('change', async (event) => {
        getSettings().permanentResolvedScrapEntries = Boolean($(event.currentTarget).prop('checked'));
        scheduleSettingsSave();
        const inventory = getDeathNoteInventory();
        let changed = false;
        for (const scrap of Array.isArray(inventory.scraps) ? inventory.scraps : []) {
            if (!scrap || !scrap.active) {
                continue;
            }

            if (updateNotebookScrapText(scrap.id, scrap.noteText || '', {
                reason: 'Scrap permanence setting changed.',
            })) {
                changed = true;
            }
        }

        if (changed) {
            await persistChatChanges();
        }
        refreshDeathNoteUi();
    });

    $('#kw-deathnote-open-sound').off('change').on('change', (event) => {
        getSettings().enableOpenSound = Boolean($(event.currentTarget).prop('checked'));
        scheduleSettingsSave();
    });

    $('#kw-deathnote-writing-sound').off('change').on('change', (event) => {
        getSettings().enableWritingSound = Boolean($(event.currentTarget).prop('checked'));
        scheduleSettingsSave();
        if (!getSettings().enableWritingSound) {
            stopWritingSound();
        }
    });

    $('#kw-deathnote-show-ai-write-debug-blocks').off('change').on('change', async (event) => {
        getSettings().showAiWriteDebugBlocks = Boolean($(event.currentTarget).prop('checked'));
        scheduleSettingsSave();
        if (syncAllAiNotebookWriteMessageVisibility()) {
            await persistChatChanges();
            refreshDeathNoteUi();
        }
    });

    $('#kw-deathnote-debug-retrieve-notebook').off('click').on('click', async (event) => {
        event.preventDefault();
        const inventory = getDeathNoteInventory();
        if (inventory.notebook.destroyed) {
            notify('warning', 'The Death Note is destroyed or missing.');
            return;
        }

        const settings = getSettings();
        const ownership = getNotebookOwnership();
        const retrieved = await commitInventoryMutation(() => transferNotebookTo(getUserActor(), {
            owner: ownership.owner,
            userAccess: NOTEBOOK_USER_ACCESS.FULL,
            exists: true,
            reason: 'Notebook forcibly retrieved via debug settings.',
        }), 'Death Note retrieved.');
        if (retrieved) {
            settings.inventorySelectedItemKey = 'notebook';
            scheduleSettingsSave();
        }
    });

    $('#kw-deathnote-prompt-template').off('input').on('input', (event) => {
        getSettings().deathNotePromptTemplate = String($(event.currentTarget).val() || '').trim();
        scheduleSettingsSave();
    });

    $('#kw-deathnote-prompt-theft-template').off('input').on('input', (event) => {
        getSettings().identityTheftPromptTemplate = String($(event.currentTarget).val() || '').trim();
        scheduleSettingsSave();
    });

    $('#kw-deathnote-prompt-reveal-template').off('input').on('input', (event) => {
        getSettings().notebookRevealPromptTemplate = String($(event.currentTarget).val() || '').trim();
        scheduleSettingsSave();
    });

    $('#kw-deathnote-prompt-presence-template').off('input').on('input', (event) => {
        getSettings().presencePromptTemplate = String($(event.currentTarget).val() || '').trim();
        scheduleSettingsSave();
    });

    bindThoughtSettingsUi();

    $(document)
        .off('change', '#kw-deathnote-owner')
        .on('change', '#kw-deathnote-owner', async (event) => {
            const ownership = getNotebookOwnership();
            const actor = decodeActorValue($(event.currentTarget).val(), ownership.owner);
            await commitInventoryMutation(() => {
                return setNotebookOwnership({
                    owner: actor,
                    holder: ownership.holder,
                    userAccess: ownership.userAccess,
                    lastTransferredAt: ownership.lastTransferredAt,
                });
            }, 'Notebook owner updated.');
        })
        .off('change', '#kw-deathnote-holder')
        .on('change', '#kw-deathnote-holder', async (event) => {
            const ownership = getNotebookOwnership();
            const inventory = getDeathNoteInventory();
            const actor = decodeActorValue($(event.currentTarget).val(), ownership.holder);
            await commitInventoryMutation(() => {
                return transferNotebookTo(actor, {
                    owner: ownership.owner,
                    userAccess: ownership.userAccess,
                    exists: !inventory.notebook.destroyed,
                    reason: `Notebook transferred to ${actor.name || actor.type} via manager.`,
                });
            }, 'Notebook holder updated.');
        })
        .off('change', '#kw-deathnote-user-access')
        .on('change', '#kw-deathnote-user-access', async (event) => {
            const nextAccess = String($(event.currentTarget).val() || NOTEBOOK_USER_ACCESS.NONE).trim().toLowerCase();
            await commitInventoryMutation(() => setUserNotebookAccess(nextAccess, {
                reason: `User access changed to ${nextAccess} via manager.`,
            }), 'User access updated.');
        })
        .off('click', '.kw-deathnote-learn-name')
        .off('click', '.kw-deathnote-steal-id')
        .on('click', '.kw-deathnote-steal-id', async (event) => {
            event.preventDefault();
            const actor = decodeActorValue($(event.currentTarget).data('actor'), null);
            if (!actor) {
                return;
            }

            const result = attemptStealCharacterId(actor);
            if (!result || !result.changed && result.reason !== 'already_owned' && result.reason !== 'cooldown') {
                notify('warning', 'That ID cannot be stolen right now.');
                return;
            }

            if (result.changed) {
                await persistChatChanges();
            }

            if (result.success && result.idItem) {
                const settings = getSettings();
                settings.inventorySelectedItemKey = `id:${result.idItem.id}`;
                scheduleSettingsSave();
                refreshDeathNoteUi();
                showDeathNoteNotice({
                    title: 'Identity Stolen',
                    message: `${actor.name || 'That character'}'s ID is now in your inventory.`,
                    iconUrl: new URL('../assets/kira_k.png', import.meta.url).toString(),
                });
                return;
            }

            refreshDeathNoteUi();
            if (result.reason === 'cooldown') {
                notify('warning', `Too risky right now. Try again in ${formatRemainingTime(result.cooldownUntil - Date.now())}.`);
                return;
            }

            if (result.reason === 'already_owned') {
                notify('info', `You already have ${actor.name || 'that character'}'s ID.`);
                return;
            }

            if (result.reason === 'failed') {
                notify('warning', `${actor.name || 'That character'} noticed the attempt and will react the next time they speak.`);
            }
        })
        .off('click', '.kw-deathnote-hide-name')
        .on('click', '.kw-deathnote-hide-name', async (event) => {
            event.preventDefault();
            const actor = decodeActorValue($(event.currentTarget).data('actor'), null);
            if (!actor) {
                return;
            }

            await commitInventoryMutation(() => forgetCharacterName(actor, {
                reason: `${actor.name || 'Character'} hidden again via manager.`,
            }), 'Character name hidden again.');
        })
        .off('click', '.kw-deathnote-force-reveal-name')
        .on('click', '.kw-deathnote-force-reveal-name', async (event) => {
            event.preventDefault();
            const actor = decodeActorValue($(event.currentTarget).data('actor'), null);
            if (!actor) {
                return;
            }

            await commitInventoryMutation(() => learnCharacterName(actor, {
                source: 'debug_force_reveal',
                reason: `${actor.name || 'Character'} force-revealed via debug manager.`,
            }), 'Character name force-revealed.');
        })
        .off('change', '#kw-deathnote-id-steal-character')
        .on('change', '#kw-deathnote-id-steal-character', (event) => {
            getSettings().idStealSelectedActorKey = String($(event.currentTarget).val() || '').trim();
            scheduleSettingsSave();
            syncSettingsUi();
        })
        .off('input change', '#kw-deathnote-id-steal-success-box')
        .on('input change', '#kw-deathnote-id-steal-success-box', (event) => {
            const settings = getSettings();
            const selectedKey = String(settings.idStealSelectedActorKey || '').trim()
                || String(getCharacterNameDirectory()[0]?.key || '').trim();
            if (!selectedKey) {
                return;
            }

            const raw = Number($(event.currentTarget).val());
            const nextValue = Number.isFinite(raw)
                ? Math.min(100, Math.max(0, Math.round(raw)))
                : getIdentityStealSuccessChance(getCharacterNameDirectory().find((entry) => entry.key === selectedKey)?.actor || null);
            settings.idStealSuccessChanceOverrides = settings.idStealSuccessChanceOverrides && typeof settings.idStealSuccessChanceOverrides === 'object'
                ? settings.idStealSuccessChanceOverrides
                : {};
            settings.idStealSuccessChanceOverrides[selectedKey] = nextValue;
            scheduleSettingsSave();
            syncSettingsUi();
        })
        .off('click', '#kw-deathnote-id-steal-clear')
        .on('click', '#kw-deathnote-id-steal-clear', (event) => {
            event.preventDefault();
            const settings = getSettings();
            const selectedKey = String(settings.idStealSelectedActorKey || '').trim()
                || String(getCharacterNameDirectory()[0]?.key || '').trim();
            if (!selectedKey || !settings.idStealSuccessChanceOverrides || typeof settings.idStealSuccessChanceOverrides !== 'object') {
                return;
            }

            delete settings.idStealSuccessChanceOverrides[selectedKey];
            scheduleSettingsSave();
            syncSettingsUi();
        })
        .off('click', '.kw-deathnote-track-memory')
        .on('click', '.kw-deathnote-track-memory', async (event) => {
            event.preventDefault();
            const messageIndex = Number($(event.currentTarget).data('messageIndex'));
            if (!Number.isInteger(messageIndex)) {
                return;
            }

            await commitInventoryMutation(() => setDeathNoteMemoryTracked(messageIndex, true, {
                source: 'manual',
            }), 'Death Note memory tracking enabled.');
        })
        .off('click', '.kw-deathnote-untrack-memory')
        .on('click', '.kw-deathnote-untrack-memory', async (event) => {
            event.preventDefault();
            const messageIndex = Number($(event.currentTarget).data('messageIndex'));
            if (!Number.isInteger(messageIndex)) {
                return;
            }

            await commitInventoryMutation(() => setDeathNoteMemoryTracked(messageIndex, false, {
                source: 'manual',
            }), 'Death Note memory tracking removed.');
        })
        .off('click', '#kw-deathnote-toggle-destroyed')
        .on('click', '#kw-deathnote-toggle-destroyed', async (event) => {
            event.preventDefault();
            const ownership = getNotebookOwnership();
            const inventory = getDeathNoteInventory();
            if (inventory.notebook.destroyed) {
                await commitInventoryMutation(() => {
                    return transferNotebookTo(ownership.holder, {
                        owner: ownership.owner,
                        userAccess: ownership.userAccess,
                        exists: true,
                        reason: 'Notebook restored via manager.',
                    });
                }, 'Notebook restored.');
                return;
            }

            await commitInventoryMutation(() => destroyNotebook({
                reason: 'Notebook destroyed via manager.',
            }), 'Notebook destroyed.');
        })
        .off('click', '#kw-deathnote-link-shinigami')
        .on('click', '#kw-deathnote-link-shinigami', async (event) => {
            event.preventDefault();
            const actor = decodeActorValue($('#kw-deathnote-shinigami-select').val(), null);
            if (!actor) {
                notify('warning', 'Select a character to link as the notebook Shinigami.');
                return;
            }

            await commitInventoryMutation(() => {
                return linkNotebookShinigami({
                    type: NOTEBOOK_ACTOR_TYPES.SHINIGAMI,
                    id: actor.id,
                    name: actor.name,
                }, {
                    avatar: actor.id,
                    name: actor.name,
                    reason: `${actor.name || 'Selected character'} linked via manager.`,
                });
            }, 'Linked Shinigami updated.');
        })
        .off('click', '#kw-deathnote-unlink-shinigami')
        .on('click', '#kw-deathnote-unlink-shinigami', async (event) => {
            event.preventDefault();
            await commitInventoryMutation(() => unlinkNotebookShinigami({
                reason: 'Linked Shinigami cleared via manager.',
            }), 'Linked Shinigami cleared.');
        })
        .off('click', '#kw-deathnote-create-scrap')
        .on('click', '#kw-deathnote-create-scrap', async (event) => {
            event.preventDefault();
            const holder = decodeActorValue($('#kw-deathnote-new-scrap-holder').val(), getNotebookOwnership().holder);
            await commitInventoryMutation(() => createNotebookScrap({
                holder,
                label: `Scrap ${getDeathNoteInventory().scraps.filter((scrap) => scrap && scrap.active).length + 1}`,
                reason: `Scrap created for ${holder.name || holder.type} via manager.`,
            }), 'Notebook scrap created.');
        })
        .off('change', '.kw-deathnote-scrap-holder')
        .on('change', '.kw-deathnote-scrap-holder', async (event) => {
            const scrapId = String($(event.currentTarget).data('scrapId') || '').trim();
            const holder = decodeActorValue($(event.currentTarget).val(), null);
            if (!scrapId || !holder) {
                return;
            }

            await commitInventoryMutation(() => transferNotebookScrap(scrapId, holder, {
                reason: `${holder.name || holder.type} now holds ${scrapId}.`,
            }), 'Scrap holder updated.');
        })
        .off('click', '.kw-deathnote-remove-scrap')
        .on('click', '.kw-deathnote-remove-scrap', async (event) => {
            event.preventDefault();
            const scrapId = String($(event.currentTarget).data('scrapId') || '').trim();
            if (!scrapId) {
                return;
            }

            await commitInventoryMutation(() => removeNotebookScrap(scrapId, {
                reason: `${scrapId} removed via manager.`,
            }), 'Scrap removed.');
        })
        .off('click', '#kw-deathnote-add-toucher')
        .on('click', '#kw-deathnote-add-toucher', async (event) => {
            event.preventDefault();
            const actor = decodeActorValue($('#kw-deathnote-new-toucher').val(), null);
            if (!actor) {
                notify('warning', 'Select a character to add as a toucher.');
                return;
            }

            await commitInventoryMutation(() => addNotebookToucher(actor, {
                source: 'manual_touch',
                itemId: getDeathNoteInventory().notebook.itemId,
                reason: `${actor.name || actor.type} manually marked as touching the Death Note.`,
            }), 'Manual toucher added.');
        })
        .off('click', '#kw-deathnote-clear-touchers')
        .on('click', '#kw-deathnote-clear-touchers', async (event) => {
            event.preventDefault();
            await commitInventoryMutation(() => clearNotebookTouchers({
                source: 'manual_touch',
                reason: 'Manual Death Note touchers cleared via manager.',
            }), 'Manual touchers cleared.');
        });
}

function renderInventorySettingsContentHtml() {
    return `
        <div class="kw-dn-settings-modal__sections">
            <section class="kw-dn-settings-modal__section">
                <div class="kw-dn-settings-modal__section-head">
                    <div class="kw-dn-settings-modal__eyebrow">Notebook</div>
                    <div class="kw-dn-settings-modal__section-title">Writing And Rules</div>
                </div>
                <div class="kw-dn-settings-modal__section-body">
                    <label class="killer-within-settings__field">
                        <span>Notebook font</span>
                        <select id="kw-deathnote-font-mode" class="text_pole">
                            <option value="print">Print</option>
                            <option value="script">Script</option>
                        </select>
                    </label>
                    <label class="killer-within-settings__row">
                        <input id="kw-deathnote-require-known-names" type="checkbox" />
                        <span>Require discovered names for Death Note kills</span>
                    </label>
                    <div class="killer-within-settings__field">
                        <span>Resolved ink</span>
                        <label class="killer-within-settings__row">
                            <input id="kw-deathnote-permanent-notebook" type="checkbox" />
                            <span>Resolved notebook lines become permanent and darken</span>
                        </label>
                        <label class="killer-within-settings__row">
                            <input id="kw-deathnote-permanent-scrap" type="checkbox" />
                            <span>Resolved scrap lines become permanent and darken</span>
                        </label>
                    </div>
                    <div class="killer-within-settings__field">
                        <span>Notebook sounds</span>
                        <label class="killer-within-settings__row">
                            <input id="kw-deathnote-open-sound" type="checkbox" />
                            <span>Play pen click when opening</span>
                        </label>
                        <label class="killer-within-settings__row">
                            <input id="kw-deathnote-writing-sound" type="checkbox" />
                            <span>Play writing sound while writing</span>
                        </label>
                    </div>
                    <div class="killer-within-settings__field">
                        <span>Notebook defaults</span>
                        <small>If a cause is omitted, Death Note entries default to heart attack. If time is omitted, they trigger on the next assistant message.</small>
                    </div>
                </div>
            </section>
            <section class="kw-dn-settings-modal__section">
                <div class="kw-dn-settings-modal__section-head">
                    <div class="kw-dn-settings-modal__eyebrow">Knowledge</div>
                    <div class="kw-dn-settings-modal__section-title">Name Discovery</div>
                </div>
                <div class="kw-dn-settings-modal__section-body">
                    <div id="kw-deathnote-name-manager"></div>
                </div>
            </section>
            <section class="kw-dn-settings-modal__section">
                <div class="kw-dn-settings-modal__section-head">
                    <div class="kw-dn-settings-modal__eyebrow">Memory</div>
                    <div class="kw-dn-settings-modal__section-title">Death Note Memories</div>
                </div>
                <div class="kw-dn-settings-modal__section-body">
                    <div id="kw-deathnote-memory-manager"></div>
                </div>
            </section>
            <section class="kw-dn-settings-modal__section">
                <details class="kw-dn-settings-modal__foldout">
                    <summary class="kw-dn-settings-modal__foldout-summary">
                        <span class="kw-dn-settings-modal__eyebrow">Thoughts</span>
                        <span class="kw-dn-settings-modal__section-title">Thought Management</span>
                    </summary>
                    <div class="kw-dn-settings-modal__foldout-body">
                        ${renderThoughtManagementSettingsHtml()}
                    </div>
                </details>
            </section>
            <section class="kw-dn-settings-modal__section">
                <details class="kw-dn-settings-modal__foldout">
                    <summary class="kw-dn-settings-modal__foldout-summary">
                        <span class="kw-dn-settings-modal__eyebrow">Prompt Studio</span>
                        <span class="kw-dn-settings-modal__section-title">Prompt Management</span>
                    </summary>
                    <div class="kw-dn-settings-modal__foldout-body">
                    <div class="killer-within-settings__field">
                        <span>Template placeholders</span>
                        <small>Use <code>{{ownership_block}}</code>, <code>{{inventory_block}}</code>, <code>{{due_block}}</code>, <code>{{entries_block}}</code>, <code>{{user_label}}</code>, <code>{{target_label}}</code>, <code>{{linked_shinigami}}</code>, and <code>{{touchers_block}}</code>.</small>
                    </div>
                    <label class="killer-within-settings__field">
                        <span>Death Note context template</span>
                        <textarea id="kw-deathnote-prompt-template" class="text_pole" rows="12"></textarea>
                    </label>
                    <label class="killer-within-settings__field">
                        <span>Failed identity theft template</span>
                        <textarea id="kw-deathnote-prompt-theft-template" class="text_pole" rows="8"></textarea>
                    </label>
                    <label class="killer-within-settings__field">
                        <span>Notebook reveal template</span>
                        <textarea id="kw-deathnote-prompt-reveal-template" class="text_pole" rows="8"></textarea>
                    </label>
                    <label class="killer-within-settings__field">
                        <span>Presence template</span>
                        <textarea id="kw-deathnote-prompt-presence-template" class="text_pole" rows="9"></textarea>
                    </label>
                    <div class="killer-within-settings__field">
                        <span>Hidden thought prompts</span>
                    </div>
                    ${renderThoughtPromptSettingsHtml()}
                    </div>
                </details>
            </section>
            <section class="kw-dn-settings-modal__section">
                <details class="kw-dn-settings-modal__foldout">
                    <summary class="kw-dn-settings-modal__foldout-summary">
                        <span class="kw-dn-settings-modal__eyebrow">Debug</span>
                        <span class="kw-dn-settings-modal__section-title">AI Write Debugging</span>
                    </summary>
                    <div class="kw-dn-settings-modal__foldout-body">
                        <label class="killer-within-settings__row">
                            <input id="kw-deathnote-show-ai-write-debug-blocks" type="checkbox" />
                            <span>Show hidden AI notebook write blocks in assistant messages</span>
                        </label>
                        <div class="killer-within-settings__field">
                            <small>When disabled, the module strips parsed AI write blocks from chat after applying them to the notebook.</small>
                        </div>
                        <div class="killer-within-settings__field">
                            <button type="button" id="kw-deathnote-debug-retrieve-notebook" class="menu_button">Retrieve Death Note</button>
                        </div>
                    </div>
                </details>
            </section>
        </div>
    `;
}

function renderSettingsPanel() {
    const existing = document.getElementById(SETTINGS_PANEL_ID);
    if (existing) {
        existing.remove();
    }
}

function renderInventorySettingsModalHtml() {
    return `
        <div class="kw-dn-settings-modal__backdrop" data-close-modal="true">
            <div class="kw-dn-settings-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="kw-dn-settings-modal-title">
                <div class="kw-dn-settings-modal__header">
                    <div>
                        <div class="kw-dn-settings-modal__eyebrow">Killer Within</div>
                        <h3 id="kw-dn-settings-modal-title" class="kw-dn-settings-modal__title">Inventory Settings</h3>
                    </div>
                    <button type="button" class="menu_button kw-dn-settings-modal__close" aria-label="Close settings">Close</button>
                </div>
                <div class="kw-dn-settings-modal__body">
                    ${renderInventorySettingsContentHtml()}
                </div>
            </div>
        </div>
    `;
}

function renderInventoryManageContentHtml() {
    const settings = getSettings();
    const inventory = getDeathNoteInventory();
    const notebooks = getDeathNotes();
    const createChoices = getActorChoices({
        includeUser: true,
        includeCharacters: true,
        includeWorld: false,
    });
    const activeCount = notebooks.filter((entry) => entry && !entry.destroyed).length;
    const canCreate = activeCount < 7;
    const rows = notebooks.map((notebook) => {
        const ownership = getNotebookOwnership(notebook.itemId);
        const linked = getLinkedShinigami(notebook.itemId);
        const request = getNotebookReturnRequest(notebook.itemId);
        const holder = ownership.holder && ownership.holder.type === NOTEBOOK_ACTOR_TYPES.CHARACTER ? ownership.holder : null;
        const requestMatchesHolder = Boolean(
            request.active
            && holder
            && String(request.actor?.name || '').trim().toLowerCase() === String(holder.name || '').trim().toLowerCase(),
        );
        const statusLabel = notebook.destroyed ? 'Destroyed / missing' : `Held by ${formatActorLabel(ownership.holder)}`;
        return `
            <div class="kw-deathnote-item">
                <div class="kw-deathnote-item__meta">
                    <b>${escapeHtml(notebook.label || 'Death Note')}</b>
                    <span>${escapeHtml(`Belongs to ${formatActorLabel(ownership.owner)} | Held by ${formatActorLabel(ownership.holder)}`)}</span>
                    <span>${escapeHtml(`User access: ${formatAccessLabel(ownership.userAccess)} | Linked Shinigami: ${linked.active ? formatActorLabel(linked.actor) : 'None'}`)}</span>
                </div>
                <span class="kw-deathnote-name-state">${escapeHtml(statusLabel)}</span>
                <div class="kw-deathnote-item__actions">
                    ${holder && ownership.userAccess !== NOTEBOOK_USER_ACCESS.FULL ? `
                        <button
                            type="button"
                            class="menu_button kw-dn-manage-request-return"
                            data-actor="${escapeHtml(encodeActorValue(holder))}"
                            data-notebook-id="${escapeHtml(notebook.itemId)}"
                            ${requestMatchesHolder ? 'disabled' : ''}
                        >${requestMatchesHolder ? 'Return Requested' : 'Request Return'}</button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('') || '<div class="kw-memory-manager__empty">No Death Notes currently exist.</div>';

    return `
        <div class="kw-dn-settings-modal__sections">
            <section class="kw-dn-settings-modal__section">
                <div class="kw-dn-settings-modal__section-head">
                    <div class="kw-dn-settings-modal__eyebrow">Registry</div>
                    <div class="kw-dn-settings-modal__section-title">Death Note Creation & Ownership</div>
                </div>
                <div class="kw-dn-settings-modal__section-body">
                    <div class="kw-deathnote-manager">
                        <div class="kw-deathnote-manager__summary">
                            <span><b>Active notebooks:</b> ${activeCount} / 7</span>
                            <span><b>Purpose:</b> Create distinct Death Notes and keep ownership visible per notebook.</span>
                        </div>
                        <div class="kw-deathnote-manager__actions">
                            <label class="killer-within-settings__field kw-deathnote-manager__grow">
                                <span>Create Death Note for</span>
                                <select id="kw-dn-manage-create-holder" class="text_pole" ${canCreate ? '' : 'disabled'}>
                                    ${renderActorOptions(createChoices, null, true, 'Choose holder', formatActorInventoryLabel)}
                                </select>
                            </label>
                            <button type="button" id="kw-dn-manage-create-notebook" class="menu_button" ${canCreate ? '' : 'disabled'}>Create Death Note</button>
                        </div>
                        <div class="kw-deathnote-manager__list">${rows}</div>
                        <div class="kw-deathnote-manager__actions">
                            <button type="button" id="kw-dn-manage-toggle-floating" class="menu_button">${settings.showFloatingButton ? 'Hide floating button' : 'Show floating button'}</button>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    `;
}

function renderInventoryManageModalHtml() {
    return `
        <div class="kw-dn-settings-modal__backdrop" data-close-manage-modal="true">
            <div class="kw-dn-settings-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="kw-dn-manage-modal-title">
                <div class="kw-dn-settings-modal__header">
                    <div>
                        <div class="kw-dn-settings-modal__eyebrow">Killer Within</div>
                        <h3 id="kw-dn-manage-modal-title" class="kw-dn-settings-modal__title">Manage Death Notes</h3>
                    </div>
                    <button type="button" class="menu_button kw-dn-settings-modal__close" data-close-manage-modal="true" aria-label="Close manager">Close</button>
                </div>
                <div class="kw-dn-settings-modal__body">
                    ${renderInventoryManageContentHtml()}
                </div>
            </div>
        </div>
    `;
}

function ensureInventorySettingsModal() {
    const existing = document.getElementById(INVENTORY_SETTINGS_MODAL_ID);
    if (!getSettings().enabled || !inventorySettingsOpen) {
        if (existing) {
            existing.remove();
        }
        return null;
    }

    let root = existing;
    if (!root) {
        root = document.createElement('div');
        root.id = INVENTORY_SETTINGS_MODAL_ID;
        document.body.append(root);
    }

    root.innerHTML = renderInventorySettingsModalHtml();
    bindSettingsUi();
    syncSettingsUi();
    return root;
}

function ensureInventoryManageModal() {
    const existing = document.getElementById(INVENTORY_MANAGE_MODAL_ID);
    if (!getSettings().enabled || !inventoryManageOpen) {
        if (existing) {
            existing.remove();
        }
        return null;
    }

    let root = existing;
    if (!root) {
        root = document.createElement('div');
        root.id = INVENTORY_MANAGE_MODAL_ID;
        document.body.append(root);
    }

    root.innerHTML = renderInventoryManageModalHtml();
    return root;
}

function ensureInventoryTray() {
    const settings = getSettings();
    const existing = document.getElementById(INVENTORY_ID);

    if (!settings.enabled) {
        if (existing) {
            existing.remove();
        }
        return null;
    }

    let root = existing;
    if (!root) {
        root = document.createElement('div');
        root.id = INVENTORY_ID;
        document.body.append(root);
    }

    root.innerHTML = renderInventoryTrayHtml();
    if (isPortraitMobileViewport()) {
        const position = resolveInventoryMobilePosition(root);
        root.style.left = `${position.x}px`;
        root.style.top = `${position.y}px`;
        root.style.right = 'auto';
        root.style.bottom = 'auto';
    } else {
        root.style.left = '';
        root.style.top = '';
        root.style.right = '';
        root.style.bottom = '';
    }
    return root;
}

function updatePageWithOverflow(textarea, pages, pageIndex, value) {
    const nextPages = ensurePageCapacity(pages, pageIndex);
    const result = [...nextPages];

    if (measureFits(textarea, value)) {
        result[pageIndex] = value;
        return {
            pages: result,
            overflowed: false,
        };
    }

    let cursor = pageIndex;
    let carry = String(value || '');

    while (true) {
        const currentExisting = cursor === pageIndex ? '' : String(result[cursor] || '');
        const combined = `${carry}${currentExisting}`;

        if (measureFits(textarea, combined)) {
            result[cursor] = combined;
            break;
        }

        const splitIndex = findPageBreakIndex(textarea, combined);
        result[cursor] = combined.slice(0, splitIndex);
        carry = combined.slice(splitIndex);
        cursor += 1;
        result.push(...ensurePageCapacity(result, cursor).slice(result.length));
    }

    return {
        pages: result,
        overflowed: cursor > pageIndex,
    };
}

function buildWidgetHtml() {
    const coverUrl = new URL('../assets/deathnote/cover.jpg', import.meta.url).toString();
    const rulesPageUrl = new URL('../assets/deathnote/rulespage1.jpg', import.meta.url).toString();
    const settings = getSettings();
    const notebookId = String(settings.selectedNotebookId || getSelectedNotebookIdState() || '').trim();
    const pages = ensurePageCapacity(getNotebookPages(notebookId), 0);
    const currentSpreadIndex = getClampedSpreadIndex(pages);
    const visible = getVisiblePageIndices(currentSpreadIndex);
    const expandedPages = ensurePageCapacity(pages, visible.rightPageIndex);
    const leftPageHtml = visible.leftPageIndex !== null
        ? renderEditablePage({
            notebookId,
            pageIndex: visible.leftPageIndex,
            side: 'left',
            text: expandedPages[visible.leftPageIndex] || '',
            extraClass: 'kw-deathnote__paper--left',
        })
        : `
            <div class="kw-deathnote__inside-cover-panel">
                <div class="kw-deathnote__inside-cover-sheet">
                    <img
                        class="kw-deathnote__rules-page"
                        src="${rulesPageUrl}"
                        alt="Death Note rules"
                        draggable="false"
                    />
                </div>
            </div>
        `;

    return `
        <div class="kw-deathnote__stage">
            <button
                type="button"
                class="kw-deathnote__cover kw-deathnote__drag-handle kw-deathnote__toggle"
                aria-label="Open Death Note"
            >
                <img
                    class="kw-deathnote__cover-art"
                    src="${coverUrl}"
                    alt="Death Note"
                    draggable="false"
                />
            </button>

            <div
                class="kw-deathnote__spread"
                role="dialog"
                aria-label="Death Note notebook"
            >
                <button
                    type="button"
                    class="kw-deathnote__close-tab kw-deathnote__drag-handle kw-deathnote__toggle"
                    aria-label="Close notebook"
                ></button>
                <div class="kw-deathnote__spine-handle kw-deathnote__drag-handle" aria-hidden="true"></div>
                <div class="kw-deathnote__page-left ${visible.leftPageIndex !== null ? 'kw-deathnote__page-left--paper' : 'kw-deathnote__page-left--cover'}" aria-label="Death Note left page">
                    ${leftPageHtml}
                    <button
                        type="button"
                        class="kw-deathnote__corner-tab kw-deathnote__corner-tab--prev ${currentSpreadIndex <= 0 ? 'is-hidden' : ''}"
                        data-page-nav="prev"
                        aria-label="Previous spread"
                        ${currentSpreadIndex <= 0 ? 'disabled' : ''}
                    ></button>
                </div>
                <div class="kw-deathnote__page-right">
                    ${renderEditablePage({
                        notebookId,
                        pageIndex: visible.rightPageIndex,
                        side: 'right',
                        text: expandedPages[visible.rightPageIndex] || '',
                    })}
                    <button
                        type="button"
                        class="kw-deathnote__corner-tab kw-deathnote__corner-tab--next"
                        data-page-nav="next"
                        aria-label="Next spread"
                    ></button>
                </div>
            </div>
        </div>
    `;
}

function ensureWidget() {
    const settings = getSettings();
    if (!settings.enabled || (!settings.showFloatingButton && !settings.isOpen)) {
        const existing = document.getElementById(FLOATING_ID);
        if (existing) {
            existing.remove();
        }
        return null;
    }

    let root = document.getElementById(FLOATING_ID);
    if (!root) {
        root = document.createElement('div');
        root.id = FLOATING_ID;
        root.className = 'kw-deathnote';
        document.body.append(root);
    }

    const { width, height } = getWidgetSize(Boolean(settings.isOpen));
    const maxX = Math.max(0, window.innerWidth - width);
    const maxY = Math.max(0, window.innerHeight - height);

    const resolved = resolvePosition();
    const x = clamp(resolved.x, 0, maxX);
    const y = clamp(resolved.y, 0, maxY);

    if (resolved.x !== x || resolved.y !== y) {
        setPosition(x, y, { rememberClosed: !settings.isOpen });
    }

    root.style.left = `${Math.round(x)}px`;
    root.style.top = `${Math.round(y)}px`;
    root.style.display = 'block';
    root.style.visibility = 'visible';
    root.style.opacity = '1';
    root.style.pointerEvents = 'auto';
    root.classList.toggle('kw-deathnote--open', Boolean(settings.isOpen));
    root.classList.toggle('kw-deathnote--mobile', isPortraitMobileViewport());
    root.classList.toggle('kw-deathnote--font-print', settings.fontMode !== 'script');
    root.classList.toggle('kw-deathnote--font-script', settings.fontMode === 'script');

    root.innerHTML = buildWidgetHtml();
    restorePendingFocus(root);
    renderSettingsPanel();
    syncSettingsUi();
    return root;
}

function restorePendingFocus(root) {
    if (!pendingFocus || !root) {
        return;
    }

    const target = root.querySelector(`.kw-deathnote__entry-textarea[data-page-index="${pendingFocus.pageIndex}"]`);
    if (!(target instanceof HTMLTextAreaElement)) {
        return;
    }

    requestAnimationFrame(() => {
        target.focus({ preventScroll: true });
        const valueLength = target.value.length;
        const position = pendingFocus.mode === 'start' ? 0 : valueLength;
        target.setSelectionRange(position, position);
        pendingFocus = null;
    });
}

function scheduleChatSave(state) {
    if (state.saveTimer) {
        clearTimeout(state.saveTimer);
    }

    state.saveTimer = setTimeout(async () => {
        state.saveTimer = null;
        await persistChatChanges();
    }, 450);
}

function getVisibleTexts(pages, spreadIndex) {
    const visible = getVisiblePageIndices(spreadIndex);
    return {
        left: visible.leftPageIndex === null ? null : String(pages[visible.leftPageIndex] || ''),
        right: String(pages[visible.rightPageIndex] || ''),
    };
}

function runPageTurn(direction, callback) {
    const root = document.getElementById(FLOATING_ID);
    if (!root) {
        callback();
        refreshDeathNoteUi();
        return;
    }

    clearTimeout(pageTurnTimer);
    clearTimeout(pageTurnCleanupTimer);
    root.classList.remove('kw-deathnote--turn-prev', 'kw-deathnote--turn-next', 'kw-deathnote--turn-prev-in', 'kw-deathnote--turn-next-in');
    root.classList.add(direction === 'prev' ? 'kw-deathnote--turn-prev' : 'kw-deathnote--turn-next');

    pageTurnTimer = setTimeout(() => {
        callback();
        refreshDeathNoteUi();
        const nextRoot = document.getElementById(FLOATING_ID);
        if (!nextRoot) {
            return;
        }

        nextRoot.classList.remove('kw-deathnote--turn-prev', 'kw-deathnote--turn-next');
        nextRoot.classList.add(direction === 'prev' ? 'kw-deathnote--turn-prev-in' : 'kw-deathnote--turn-next-in');

        pageTurnCleanupTimer = setTimeout(() => {
            nextRoot.classList.remove('kw-deathnote--turn-prev-in', 'kw-deathnote--turn-next-in');
        }, PAGE_TURN_MS);
    }, PAGE_TURN_MS);
}

function bindWidgetUi() {
    const state = {
        dragging: false,
        startX: 0,
        startY: 0,
        originX: 0,
        originY: 0,
        moved: false,
        toggleOnTap: false,
        pointerId: null,
        handlersInstalled: false,
        moveHandler: null,
        upHandler: null,
        saveTimer: null,
    };

    $(document)
        .off('pointerdown', `#${FLOATING_ID} .kw-deathnote__drag-handle`)
        .on('pointerdown', `#${FLOATING_ID} .kw-deathnote__drag-handle`, (event) => {
            const root = document.getElementById(FLOATING_ID);
            if (!root) {
                return;
            }

            const e = event.originalEvent || event;
            if (!e || !e.isPrimary) {
                return;
            }

            event.preventDefault();
            const rect = root.getBoundingClientRect();
            state.dragging = true;
            state.moved = false;
            state.toggleOnTap = Boolean($(event.currentTarget).closest('.kw-deathnote__toggle').length);
            state.pointerId = e.pointerId;
            state.startX = e.clientX;
            state.startY = e.clientY;
            state.originX = rect.left;
            state.originY = rect.top;

            const installHandlers = () => {
                if (state.handlersInstalled) {
                    return;
                }

                state.handlersInstalled = true;

                state.moveHandler = (rawEvent) => {
                    if (!state.dragging) {
                        return;
                    }

                    const root = document.getElementById(FLOATING_ID);
                    if (!root) {
                        return;
                    }

                    const eMove = rawEvent;
                    if (state.pointerId !== null && eMove.pointerId !== state.pointerId) {
                        return;
                    }

                    const dx = eMove.clientX - state.startX;
                    const dy = eMove.clientY - state.startY;
                    const moved = Math.abs(dx) + Math.abs(dy) > 4;
                    if (moved) {
                        state.moved = true;
                    }

                    const rectNow = root.getBoundingClientRect();
                    const maxX = Math.max(0, window.innerWidth - rectNow.width);
                    const maxY = Math.max(0, window.innerHeight - rectNow.height);

                    const nextX = clamp(state.originX + dx, 0, maxX);
                    const nextY = clamp(state.originY + dy, 0, maxY);

                    root.style.left = `${Math.round(nextX)}px`;
                    root.style.top = `${Math.round(nextY)}px`;
                };

                state.upHandler = async (rawEvent) => {
                    if (!state.dragging) {
                        return;
                    }

                    const eUp = rawEvent;
                    if (state.pointerId !== null && eUp.pointerId !== state.pointerId) {
                        return;
                    }

                    const root = document.getElementById(FLOATING_ID);

                    state.dragging = false;
                    state.pointerId = null;

                    if (root) {
                        const rectFinal = root.getBoundingClientRect();
                        setPosition(Math.round(rectFinal.left), Math.round(rectFinal.top), {
                            rememberClosed: !getSettings().isOpen,
                        });
                    }

                    window.removeEventListener('pointermove', state.moveHandler, true);
                    window.removeEventListener('pointerup', state.upHandler, true);
                    window.removeEventListener('pointercancel', state.upHandler, true);
                    state.handlersInstalled = false;

                    if (!state.moved && state.toggleOnTap) {
                        const settings = getSettings();
                        setNotebookOpenState(!settings.isOpen);
                    }
                };

                window.addEventListener('pointermove', state.moveHandler, true);
                window.addEventListener('pointerup', state.upHandler, true);
                window.addEventListener('pointercancel', state.upHandler, true);
            };

            installHandlers();
        })
        .off('input', `#${FLOATING_ID} .kw-deathnote__entry-textarea`)
        .on('input', `#${FLOATING_ID} .kw-deathnote__entry-textarea`, (event) => {
            const textarea = event.currentTarget;
            if (!(textarea instanceof HTMLTextAreaElement)) {
                return;
            }

            const pageIndex = Number(textarea.dataset.pageIndex);
            const notebookId = String(textarea.dataset.notebookId || getSettings().selectedNotebookId || '').trim();
            const pageSide = String(textarea.dataset.pageSide || 'right').trim().toLowerCase();
            if (!Number.isFinite(pageIndex) || pageIndex < 0) {
                return;
            }

            const pages = ensurePageCapacity(getNotebookPages(notebookId), pageIndex);
            const settings = getSettings();
            const currentSpreadIndex = getClampedSpreadIndex(pages);
            const beforeVisible = getVisibleTexts(pages, currentSpreadIndex);
            const rawValue = $(textarea).val();
            const inputValue = String(rawValue === undefined || rawValue === null ? '' : rawValue);
            const sanitizedInput = sanitizeNotebookInputPageValue(inputValue);
            const value = sanitizedInput.value;
            const inputType = String(event.originalEvent && event.originalEvent.inputType ? event.originalEvent.inputType : '');
            if (shouldPlayWritingSoundForInputType(inputType)) {
                pulseWritingSound();
            }
            syncPermanentLineOverlay(textarea, 'notebook', `notebook:${notebookId}:page:${pageIndex}`, value);
            const update = updatePageWithOverflow(textarea, pages, pageIndex, value);
            const nextPages = sanitizeNotebookPagesForRules(update.pages);
            const changed = setNotebookPages(nextPages, notebookId);

            if (!changed) {
                if (value !== inputValue) {
                    textarea.value = value;
                }
                return;
            }
            if (sanitizedInput.blockedName) {
                notify('warning', `You cannot kill ${sanitizedInput.blockedName} until you have discovered their name.`);
            }

            if (value !== inputValue) {
                queueFocusRestore(pageIndex, pageSide, 'end');
                refreshDeathNoteUi();
                scheduleSettingsSave();
                scheduleChatSave(state);
                return;
            }

            const activePageChanged = String(nextPages[pageIndex] || '') !== value;
            const afterVisible = getVisibleTexts(nextPages, currentSpreadIndex);
            const otherSideChanged = pageSide === 'left'
                ? beforeVisible.right !== afterVisible.right
                : beforeVisible.left !== afterVisible.left;

            if (update.overflowed) {
                const nextPageIndex = pageIndex + 1;
                const nextSpreadIndex = nextPageIndex === 0 ? 0 : Math.floor((nextPageIndex + 1) / 2);
                settings.currentSpreadIndex = nextSpreadIndex;
                queueFocusRestore(nextPageIndex, nextPageIndex % 2 === 1 ? 'left' : 'right', 'start');
                scheduleSettingsSave();
                refreshDeathNoteUi();
                scheduleChatSave(state);
                return;
            }

            if (activePageChanged) {
                queueFocusRestore(pageIndex, pageSide, 'end');
                refreshDeathNoteUi();
                scheduleSettingsSave();
                scheduleChatSave(state);
                return;
            }

            if (otherSideChanged) {
                queueFocusRestore(pageIndex, pageSide, 'end');
                refreshDeathNoteUi();
            } else {
                textarea.dataset.pageIndex = String(pageIndex);
            }

            scheduleSettingsSave();
            scheduleChatSave(state);
        })
        .off('keydown', '.kw-dn-inventory__scrap-textarea')
        .on('keydown', '.kw-dn-inventory__scrap-textarea', (event) => {
            const textarea = event.currentTarget;
            if (!(textarea instanceof HTMLTextAreaElement)) {
                return;
            }

            if (event.key !== 'Enter') {
                return;
            }

            const lines = String(textarea.value || '').split(/\r?\n/);
            if (lines.length >= 2) {
                event.preventDefault();
            }
        })
        .off('input', '.kw-dn-inventory__scrap-textarea')
        .on('input', '.kw-dn-inventory__scrap-textarea', async (event) => {
            const textarea = event.currentTarget;
            if (!(textarea instanceof HTMLTextAreaElement)) {
                return;
            }

            const scrapId = String(textarea.dataset.scrapId || '').trim();
            if (!scrapId) {
                return;
            }

            const rawValue = textarea.value;
            const trimmedToHeight = trimTextareaValueToFit(textarea, rawValue);
            const sanitizedValue = sanitizeScrapNoteText(trimmedToHeight, 2);
            syncPermanentLineOverlay(textarea, 'scrap', `scrap:${scrapId}`, sanitizedValue);
            const inputType = String(event.originalEvent && event.originalEvent.inputType ? event.originalEvent.inputType : '');
            if (shouldPlayWritingSoundForInputType(inputType)) {
                pulseWritingSound();
            }

            const changed = updateNotebookScrapText(scrapId, sanitizedValue, {
                reason: 'A notebook scrap was updated from inventory.',
            });
            if (sanitizedValue !== rawValue) {
                const selectionStart = textarea.selectionStart;
                const selectionEnd = textarea.selectionEnd;
                textarea.value = sanitizedValue;
                const nextLength = sanitizedValue.length;
                const safeStart = Math.min(selectionStart, nextLength);
                const safeEnd = Math.min(selectionEnd, nextLength);
                textarea.setSelectionRange(safeStart, safeEnd);
            }

            const actualScrapText = String(getDeathNoteInventory().scraps.find((entry) => entry?.id === scrapId)?.noteText || '');
            if (textarea.value !== actualScrapText) {
                const selectionStart = textarea.selectionStart;
                const selectionEnd = textarea.selectionEnd;
                textarea.value = actualScrapText;
                const nextLength = actualScrapText.length;
                const safeStart = Math.min(selectionStart, nextLength);
                const safeEnd = Math.min(selectionEnd, nextLength);
                textarea.setSelectionRange(safeStart, safeEnd);
            }
            syncPermanentLineOverlay(textarea, 'scrap', `scrap:${scrapId}`, actualScrapText);

            if (!changed) {
                return;
            }

            scheduleChatSave(state);
        })
        .off('click', `#${FLOATING_ID} .kw-deathnote__corner-tab`)
        .on('click', `#${FLOATING_ID} .kw-deathnote__corner-tab`, (event) => {
            event.preventDefault();
            const direction = String($(event.currentTarget).data('pageNav') || '').trim().toLowerCase();
            const notebookId = String(getSettings().selectedNotebookId || getSelectedNotebookIdState() || '').trim();
            const pages = getNotebookPages(notebookId);
            const settings = getSettings();
            const currentSpreadIndex = getClampedSpreadIndex(pages);

            if (direction === 'prev' && currentSpreadIndex > 0) {
                runPageTurn('prev', () => {
                    settings.currentSpreadIndex = Math.max(0, currentSpreadIndex - 1);
                    queueFocusRestore(getVisiblePageIndices(settings.currentSpreadIndex).rightPageIndex, 'right', 'end');
                    scheduleSettingsSave();
                });
                return;
            }

            if (direction === 'next') {
                const nextSpreadIndex = currentSpreadIndex + 1;
                const nextVisible = getVisiblePageIndices(nextSpreadIndex);
                const expanded = ensurePageCapacity(pages, nextVisible.rightPageIndex);

                runPageTurn('next', () => {
                    setNotebookPages(expanded, notebookId);
                    settings.currentSpreadIndex = nextSpreadIndex;
                    queueFocusRestore(
                        nextVisible.leftPageIndex === null ? nextVisible.rightPageIndex : nextVisible.leftPageIndex,
                        nextVisible.leftPageIndex === null ? 'right' : 'left',
                        'end',
                    );
                    scheduleSettingsSave();
                    persistChatChanges();
                });
            }
        });
}

function bindInventoryUi() {
    $(document)
        .off('pointerdown', '#kw-dn-inventory-toggle')
        .on('pointerdown', '#kw-dn-inventory-toggle', (event) => {
            if (!isPortraitMobileViewport()) {
                return;
            }

            const root = document.getElementById(INVENTORY_ID);
            if (!root) {
                return;
            }

            const e = event.originalEvent || event;
            if (!e || !e.isPrimary) {
                return;
            }

            event.preventDefault();
            const rect = root.getBoundingClientRect();
            inventoryDragState.dragging = true;
            inventoryDragState.moved = false;
            inventoryDragState.pointerId = e.pointerId;
            inventoryDragState.startX = e.clientX;
            inventoryDragState.startY = e.clientY;
            inventoryDragState.originX = rect.left;
            inventoryDragState.originY = rect.top;

            if (!inventoryDragState.handlersInstalled) {
                inventoryDragState.handlersInstalled = true;

                inventoryDragState.moveHandler = (rawEvent) => {
                    if (!inventoryDragState.dragging) {
                        return;
                    }

                    const activeRoot = document.getElementById(INVENTORY_ID);
                    if (!activeRoot) {
                        return;
                    }

                    const eMove = rawEvent;
                    if (inventoryDragState.pointerId !== null && eMove.pointerId !== inventoryDragState.pointerId) {
                        return;
                    }

                    const dx = eMove.clientX - inventoryDragState.startX;
                    const dy = eMove.clientY - inventoryDragState.startY;
                    if (Math.abs(dx) + Math.abs(dy) > 4) {
                        inventoryDragState.moved = true;
                    }

                    const rectNow = activeRoot.getBoundingClientRect();
                    const maxX = Math.max(0, window.innerWidth - rectNow.width);
                    const maxY = Math.max(0, window.innerHeight - Math.min(rectNow.height, 64));
                    const nextX = clamp(inventoryDragState.originX + dx, 0, maxX);
                    const nextY = clamp(inventoryDragState.originY + dy, 0, maxY);
                    activeRoot.style.left = `${Math.round(nextX)}px`;
                    activeRoot.style.top = `${Math.round(nextY)}px`;
                    activeRoot.style.right = 'auto';
                    activeRoot.style.bottom = 'auto';
                };

                inventoryDragState.upHandler = (rawEvent) => {
                    if (!inventoryDragState.dragging) {
                        return;
                    }

                    const eUp = rawEvent;
                    if (inventoryDragState.pointerId !== null && eUp.pointerId !== inventoryDragState.pointerId) {
                        return;
                    }

                    const activeRoot = document.getElementById(INVENTORY_ID);
                    inventoryDragState.dragging = false;
                    inventoryDragState.pointerId = null;
                    inventoryDragState.ignoreClick = true;

                    if (activeRoot) {
                        const rectFinal = activeRoot.getBoundingClientRect();
                        const settings = getSettings();
                        settings.inventoryMobileX = Math.round(rectFinal.left);
                        settings.inventoryMobileY = Math.round(rectFinal.top);
                        scheduleSettingsSave();
                    }

                    window.removeEventListener('pointermove', inventoryDragState.moveHandler, true);
                    window.removeEventListener('pointerup', inventoryDragState.upHandler, true);
                    window.removeEventListener('pointercancel', inventoryDragState.upHandler, true);
                    inventoryDragState.handlersInstalled = false;

                    if (!inventoryDragState.moved) {
                        const settings = getSettings();
                        settings.inventoryCollapsed = !settings.inventoryCollapsed;
                        scheduleSettingsSave();
                        refreshDeathNoteUi();
                    }
                };

                window.addEventListener('pointermove', inventoryDragState.moveHandler, true);
                window.addEventListener('pointerup', inventoryDragState.upHandler, true);
                window.addEventListener('pointercancel', inventoryDragState.upHandler, true);
            }
        })
        .off('click', '#kw-dn-inventory-toggle')
        .on('click', '#kw-dn-inventory-toggle', (event) => {
            if (inventoryDragState.ignoreClick) {
                inventoryDragState.ignoreClick = false;
                event.preventDefault();
                return;
            }

            event.preventDefault();
            const settings = getSettings();
            settings.inventoryCollapsed = !settings.inventoryCollapsed;
            scheduleSettingsSave();
            refreshDeathNoteUi();
        })
        .off('click', '#kw-dn-inventory-settings-open')
        .on('click', '#kw-dn-inventory-settings-open', (event) => {
            event.preventDefault();
            inventorySettingsOpen = true;
            refreshDeathNoteUi();
        })
        .off('click', '#kw-dn-inventory-manage-open')
        .on('click', '#kw-dn-inventory-manage-open', (event) => {
            event.preventDefault();
            inventoryManageOpen = true;
            refreshDeathNoteUi();
        })
        .off('click', '#kw-deathnote-settings-open-drawer')
        .on('click', '#kw-deathnote-settings-open-drawer', (event) => {
            event.preventDefault();
            inventorySettingsOpen = true;
            refreshDeathNoteUi();
        })
        .off('click', `#${INVENTORY_SETTINGS_MODAL_ID} [data-close-modal="true"]`)
        .on('click', `#${INVENTORY_SETTINGS_MODAL_ID} [data-close-modal="true"]`, (event) => {
            if (event.target !== event.currentTarget) {
                return;
            }

            event.preventDefault();
            inventorySettingsOpen = false;
            refreshDeathNoteUi();
        })
        .off('click', `#${INVENTORY_SETTINGS_MODAL_ID} .kw-dn-settings-modal__close`)
        .on('click', `#${INVENTORY_SETTINGS_MODAL_ID} .kw-dn-settings-modal__close`, (event) => {
            event.preventDefault();
            inventorySettingsOpen = false;
            refreshDeathNoteUi();
        })
        .off('click', `#${INVENTORY_MANAGE_MODAL_ID} [data-close-manage-modal="true"]`)
        .on('click', `#${INVENTORY_MANAGE_MODAL_ID} [data-close-manage-modal="true"]`, (event) => {
            if (event.target !== event.currentTarget) {
                return;
            }

            event.preventDefault();
            inventoryManageOpen = false;
            refreshDeathNoteUi();
        })
        .off('click', `#${INVENTORY_MANAGE_MODAL_ID} .kw-dn-settings-modal__close`)
        .on('click', `#${INVENTORY_MANAGE_MODAL_ID} .kw-dn-settings-modal__close`, (event) => {
            event.preventDefault();
            inventoryManageOpen = false;
            refreshDeathNoteUi();
        })
        .off('click', '.kw-dn-inventory__slot[data-item-key]')
        .on('click', '.kw-dn-inventory__slot[data-item-key]', (event) => {
            event.preventDefault();
            const settings = getSettings();
            settings.inventorySelectedItemKey = String($(event.currentTarget).data('itemKey') || 'notebook').trim() || 'notebook';
            if (settings.inventorySelectedItemKey.startsWith('notebook:')) {
                settings.selectedNotebookId = settings.inventorySelectedItemKey.slice('notebook:'.length);
                setSelectedNotebookId(settings.selectedNotebookId);
            }
            scheduleSettingsSave();
            refreshDeathNoteUi();
        })
        .off('click', '#kw-dn-inventory-open')
        .on('click', '#kw-dn-inventory-open', (event) => {
            event.preventDefault();
            const settings = getSettings();
            const notebookId = String(settings.selectedNotebookId || getSelectedNotebookIdState() || '').trim();
            const notebook = getNotebookSummaryById(getDeathNoteInventory(), notebookId);
            const ownership = getNotebookOwnership(notebookId);
            if (!notebook || notebook.destroyed || ownership.userAccess !== NOTEBOOK_USER_ACCESS.FULL) {
                notify('warning', 'You need full notebook access to open the Death Note from inventory.');
                return;
            }

            setNotebookOpenState(!settings.isOpen);
        })
        .off('click', '#kw-dn-inventory-tear')
        .on('click', '#kw-dn-inventory-tear', async (event) => {
            event.preventDefault();
            const settings = getSettings();
            const notebookId = String(settings.selectedNotebookId || getSelectedNotebookIdState() || '').trim();
            const notebook = getNotebookSummaryById(getDeathNoteInventory(), notebookId);
            const ownership = getNotebookOwnership(notebookId);
            if (!notebook || notebook.destroyed || ownership.userAccess !== NOTEBOOK_USER_ACCESS.FULL) {
                notify('warning', 'You need full notebook access to tear off a scrap.');
                return;
            }

            const createdScrap = await commitInventoryMutation(() => createNotebookScrap({
                holder: getUserActor(),
                notebookItemId: notebookId,
                reason: 'A notebook scrap was torn off from the inventory tray.',
            }), 'Notebook scrap created.');
            if (createdScrap && createdScrap.id) {
                const settings = getSettings();
                settings.inventorySelectedItemKey = `scrap:${createdScrap.id}`;
                scheduleSettingsSave();
                refreshDeathNoteUi();
            }
        })
        .off('click', '#kw-dn-inventory-toggle-floating')
        .on('click', '#kw-dn-inventory-toggle-floating', (event) => {
            event.preventDefault();
            getSettings().showFloatingButton = !getSettings().showFloatingButton;
            scheduleSettingsSave();
            refreshDeathNoteUi();
        })
        .off('click', '#kw-dn-manage-toggle-floating')
        .on('click', '#kw-dn-manage-toggle-floating', (event) => {
            event.preventDefault();
            getSettings().showFloatingButton = !getSettings().showFloatingButton;
            scheduleSettingsSave();
            refreshDeathNoteUi();
        })
        .off('click', '#kw-dn-inventory-give-notebook')
        .on('click', '#kw-dn-inventory-give-notebook', async (event) => {
            event.preventDefault();
            const notebookId = String($(event.currentTarget).data('notebookId') || getSettings().selectedNotebookId || getSelectedNotebookIdState() || '').trim();
            const notebook = getNotebookSummaryById(getDeathNoteInventory(), notebookId);
            const ownership = getNotebookOwnership(notebookId);
            if (!notebook || notebook.destroyed || ownership.userAccess !== NOTEBOOK_USER_ACCESS.FULL) {
                notify('warning', 'You need full notebook access to hand the Death Note to someone else.');
                return;
            }

            const actor = decodeActorValue($('#kw-dn-inventory-give-select').val(), null);
            if (!actor) {
                notify('warning', 'Select an active character to receive the Death Note.');
                return;
            }

            const transferred = await commitInventoryMutation(() => transferNotebookTo(actor, {
                owner: ownership.owner,
                userAccess: ownership.userAccess,
                exists: !notebook.destroyed,
                notebookItemId: notebookId,
                reason: `Notebook handed to ${actor.name || actor.type} from inventory.`,
            }), 'Death Note transferred.');
            if (transferred) {
                setNotebookOpenState(false);
            }
        })
        .off('click', '#kw-dn-inventory-request-return')
        .on('click', '#kw-dn-inventory-request-return', async (event) => {
            event.preventDefault();
            const actor = decodeActorValue($(event.currentTarget).data('actor'), null);
            const notebookId = String($(event.currentTarget).data('notebookId') || '').trim();
            if (!actor) {
                return;
            }

            const created = await commitInventoryMutation(() => requestNotebookReturn(actor, {
                notebookItemId: notebookId,
                reason: `${actor.name || 'A character'} was asked to return the Death Note.`,
            }), 'Return request queued.');
            if (created) {
                refreshDeathNoteUi();
            }
        })
        .off('click', '.kw-dn-manage-request-return')
        .on('click', '.kw-dn-manage-request-return', async (event) => {
            event.preventDefault();
            const actor = decodeActorValue($(event.currentTarget).data('actor'), null);
            const notebookId = String($(event.currentTarget).data('notebookId') || '').trim();
            if (!actor) {
                return;
            }

            const created = await commitInventoryMutation(() => requestNotebookReturn(actor, {
                notebookItemId: notebookId,
                reason: `${actor.name || 'A character'} was asked to return the Death Note.`,
            }), 'Return request queued.');
            if (created) {
                refreshDeathNoteUi();
            }
        })
        .off('click', '#kw-dn-inventory-link-shinigami')
        .on('click', '#kw-dn-inventory-link-shinigami', async (event) => {
            event.preventDefault();
            const actor = decodeActorValue($('#kw-dn-inventory-shinigami-select').val(), null);
            if (!actor) {
                notify('warning', 'Select a character to link as the notebook Shinigami.');
                return;
            }

            await commitInventoryMutation(() => linkNotebookShinigami({
                type: NOTEBOOK_ACTOR_TYPES.SHINIGAMI,
                id: actor.id,
                name: actor.name,
            }, {
                avatar: actor.id,
                name: actor.name,
                notebookItemId: String($(event.currentTarget).data('notebookId') || getSettings().selectedNotebookId || '').trim(),
                reason: `${actor.name || 'Selected character'} linked via inventory.`,
            }), 'Linked Shinigami updated.');
        })
        .off('click', '#kw-dn-inventory-unlink-shinigami')
        .on('click', '#kw-dn-inventory-unlink-shinigami', async (event) => {
            event.preventDefault();
            await commitInventoryMutation(() => unlinkNotebookShinigami({
                notebookItemId: String($(event.currentTarget).data('notebookId') || getSettings().selectedNotebookId || '').trim(),
                reason: 'Linked Shinigami cleared via inventory.',
            }), 'Linked Shinigami cleared.');
        })
        .off('click', '#kw-dn-manage-create-notebook')
        .on('click', '#kw-dn-manage-create-notebook', async (event) => {
            event.preventDefault();
            const actor = decodeActorValue($('#kw-dn-manage-create-holder').val(), null);
            if (!actor) {
                notify('warning', 'Choose who should receive the new Death Note.');
                return;
            }
            const created = await commitInventoryMutation(() => createDeathNote({
                owner: actor,
                holder: actor,
                userAccess: actor.type === NOTEBOOK_ACTOR_TYPES.USER ? NOTEBOOK_USER_ACCESS.FULL : NOTEBOOK_USER_ACCESS.NONE,
                reason: `${actor.name || actor.type} received a newly created Death Note.`,
            }), 'Death Note created.');
            if (created?.itemId) {
                const settings = getSettings();
                settings.selectedNotebookId = created.itemId;
                settings.inventorySelectedItemKey = actor.type === NOTEBOOK_ACTOR_TYPES.USER ? `notebook:${created.itemId}` : settings.inventorySelectedItemKey;
                setSelectedNotebookId(created.itemId);
                scheduleSettingsSave();
                refreshDeathNoteUi();
            }
        })
        .off('click', '#kw-dn-manage-link-shinigami')
        .on('click', '#kw-dn-manage-link-shinigami', async (event) => {
            event.preventDefault();
            const actor = decodeActorValue($('#kw-dn-manage-shinigami-select').val(), null);
            if (!actor) {
                notify('warning', 'Select a character to link as the notebook Shinigami.');
                return;
            }

            await commitInventoryMutation(() => linkNotebookShinigami({
                type: NOTEBOOK_ACTOR_TYPES.SHINIGAMI,
                id: actor.id,
                name: actor.name,
            }, {
                avatar: actor.id,
                name: actor.name,
                reason: `${actor.name || 'Selected character'} linked via manager.`,
            }), 'Linked Shinigami updated.');
        })
        .off('click', '#kw-dn-manage-unlink-shinigami')
        .on('click', '#kw-dn-manage-unlink-shinigami', async (event) => {
            event.preventDefault();
            await commitInventoryMutation(() => unlinkNotebookShinigami({
                reason: 'Linked Shinigami cleared via manager.',
            }), 'Linked Shinigami cleared.');
        })
        .off('click', '.kw-dn-inventory__scrap-give')
        .on('click', '.kw-dn-inventory__scrap-give', async (event) => {
            event.preventDefault();
            const scrapId = String($(event.currentTarget).data('scrapId') || '').trim();
            if (!scrapId) {
                return;
            }

            const select = $(`.kw-dn-inventory__scrap-select[data-scrap-id="${scrapId}"]`).first();
            const actor = decodeActorValue(select.val(), null);
            if (!actor) {
                notify('warning', 'Choose who should receive the scrap.');
                return;
            }

            await commitInventoryMutation(() => transferNotebookScrap(scrapId, actor, {
                reason: `${actor.name || actor.type} received a Death Note scrap via inventory.`,
            }), 'Notebook scrap transferred.');
        })
        .off('click', '.kw-dn-inventory__scrap-remove')
        .on('click', '.kw-dn-inventory__scrap-remove', async (event) => {
            event.preventDefault();
            const scrapId = String($(event.currentTarget).data('scrapId') || '').trim();
            if (!scrapId) {
                return;
            }

            const removed = await commitInventoryMutation(() => removeNotebookScrap(scrapId, {
                reason: 'Notebook scrap destroyed from inventory.',
            }), 'Notebook scrap destroyed.');
            if (removed) {
                const settings = getSettings();
                if (String(settings.inventorySelectedItemKey || '').trim() === `scrap:${scrapId}`) {
                    settings.inventorySelectedItemKey = 'notebook';
                    scheduleSettingsSave();
                    refreshDeathNoteUi();
                }
            }
        });

    $(document)
        .off('keydown.kw-deathnote-settings-modal')
        .on('keydown.kw-deathnote-settings-modal', (event) => {
            if ((!inventorySettingsOpen && !inventoryManageOpen) || event.key !== 'Escape') {
                return;
            }

            inventorySettingsOpen = false;
            inventoryManageOpen = false;
            refreshDeathNoteUi();
        });
}

let measureElement = null;

function getMeasureElement() {
    if (measureElement && measureElement.isConnected) {
        return measureElement;
    }

    measureElement = document.createElement('div');
    measureElement.className = 'kw-deathnote__measure';
    document.body.append(measureElement);
    return measureElement;
}

function measureFits(textarea, value) {
    const styles = window.getComputedStyle(textarea);
    const measure = getMeasureElement();

    measure.style.width = `${textarea.clientWidth}px`;
    measure.style.minHeight = `${textarea.clientHeight}px`;
    measure.style.fontFamily = styles.fontFamily;
    measure.style.fontSize = styles.fontSize;
    measure.style.fontWeight = styles.fontWeight;
    measure.style.fontStyle = styles.fontStyle;
    measure.style.lineHeight = styles.lineHeight;
    measure.style.letterSpacing = styles.letterSpacing;
    measure.style.padding = styles.padding;
    measure.style.whiteSpace = 'pre-wrap';
    measure.style.overflowWrap = 'break-word';
    measure.style.wordBreak = 'break-word';
    measure.textContent = value || '\u200b';

    return measure.scrollHeight <= textarea.clientHeight + 1;
}

function trimTextareaValueToFit(textarea, value) {
    const source = String(value ?? '');
    if (!source || measureFits(textarea, source)) {
        return source;
    }

    let low = 0;
    let high = source.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const sample = source.slice(0, mid);
        if (measureFits(textarea, sample)) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }

    return source.slice(0, Math.max(0, low)).trimEnd();
}

function findPageBreakIndex(textarea, text) {
    if (!text) {
        return 0;
    }

    if (measureFits(textarea, text)) {
        return text.length;
    }

    let low = 0;
    let high = text.length;

    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const sample = text.slice(0, mid);
        if (measureFits(textarea, sample)) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }

    let index = Math.max(1, low);
    if (index < text.length) {
        const boundary = Math.max(
            text.lastIndexOf('\n', index - 1),
            text.lastIndexOf(' ', index - 1),
        );

        if (boundary > Math.floor(index * 0.6)) {
            index = boundary + 1;
        }
    }

    return Math.max(1, index);
}

function paginateNotebookText(textarea, text) {
    const source = String(text === undefined || text === null ? '' : text);
    if (!source) {
        return [''];
    }

    const pages = [];
    let remaining = source;

    while (remaining.length) {
        const endIndex = findPageBreakIndex(textarea, remaining);
        const pageText = remaining.slice(0, endIndex);
        pages.push(pageText);
        remaining = remaining.slice(endIndex);

        if (!remaining) {
            break;
        }
    }

    return pages.length ? pages : [''];
}

export function refreshDeathNoteUi() {
    renderSettingsPanel();
    syncSettingsUi();
    ensureInventoryTray();
    ensureInventorySettingsModal();
    ensureInventoryManageModal();
    ensureWidget();
    ensureChatNameMaskObserver();
    queueMaskedChatNameRender();
}

export function setupDeathNoteUi() {
    renderSettingsPanel();
    syncSettingsUi();
    ensureInventoryTray();
    ensureInventorySettingsModal();
    ensureInventoryManageModal();
    ensureWidget();
    bindWidgetUi();
    bindInventoryUi();
    ensureChatNameMaskObserver();
    queueMaskedChatNameRender();
}

