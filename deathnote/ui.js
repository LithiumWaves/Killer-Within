import { FLOATING_ID, NOTEBOOK_ACTOR_TYPES, NOTEBOOK_USER_ACCESS } from './config.js';
import {
    addNotebookToucher,
    attemptStealCharacterId,
    clearNotebookTouchers,
    createNotebookScrap,
    destroyNotebook,
    forgetCharacterName,
    getActorDisplayName,
    getCharacterActorForMessage,
    getChatState,
    getCharacterNameDirectory,
    getContext,
    getCurrentChatCharacterActors,
    getDeathNoteInventory,
    getIdentityStealAttemptState,
    getLinkedShinigami,
    getNotebookPages,
    getNotebookOwnership,
    getRecentChatMemoryCandidates,
    getSettings,
    linkNotebookShinigami,
    notify,
    persistChatChanges,
    removeNotebookScrap,
    scheduleSettingsSave,
    setDeathNoteMemoryTracked,
    setNotebookOwnership,
    setNotebookPages,
    setUserNotebookAccess,
    transferNotebookScrap,
    transferNotebookTo,
    unlinkNotebookShinigami,
} from './core.js';
import { syncLinkedShinigamiVisibility } from '../presence/index.js';

const PAGE_TURN_MS = 240;
const CLOSED_WIDTH = 240;
const CLOSED_HEIGHT = 340;
const MOBILE_VIEWPORT_MAX = 520;
const SETTINGS_PANEL_ID = 'kw-deathnote-settings';
const INVENTORY_ID = 'kw-deathnote-inventory';
let pendingFocus = null;
let pageTurnTimer = null;
let pageTurnCleanupTimer = null;
let chatNameMaskObserver = null;
let chatNameMaskQueued = false;

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function isPortraitMobileViewport() {
    return window.innerWidth <= MOBILE_VIEWPORT_MAX && window.innerHeight > window.innerWidth;
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

function renderEditablePage({ pageIndex, side, text, extraClass = '' }) {
    const classes = ['kw-deathnote__paper', 'kw-deathnote__paper--editable', extraClass].filter(Boolean).join(' ');
    return `
        <div class="${classes}">
            <textarea
                class="kw-deathnote__entry-textarea"
                name="entryText"
                data-page-index="${pageIndex}"
                data-page-side="${side}"
                autocomplete="off"
                spellcheck="false"
            >${escapeHtml(String(text || ''))}</textarea>
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

    const rows = directory.map((entry) => {
        const stealState = getIdentityStealAttemptState(entry.actor);
        let actionLabel = entry.known ? 'Hide again' : 'Steal ID';
        let actionClass = entry.known ? 'kw-deathnote-hide-name' : 'kw-deathnote-steal-id';
        let actionDisabled = '';
        let statusDetail = entry.known ? 'Known to the user' : 'Name hidden from the user';

        if (!entry.known && stealState.hasId) {
            actionLabel = 'ID Stolen';
            actionDisabled = 'disabled';
            statusDetail = 'ID card already taken';
        } else if (!entry.known && stealState.onCooldown) {
            actionLabel = `Cooldown ${formatRemainingTime(stealState.cooldownUntil - Date.now())}`;
            actionDisabled = 'disabled';
            statusDetail = 'They are on alert after the last attempt';
        }

        return `
            <div class="kw-deathnote-item">
                <div class="kw-deathnote-item__meta">
                    <b>${escapeHtml(entry.displayName)}</b>
                    <span>${escapeHtml(statusDetail)}</span>
                </div>
                <span class="kw-deathnote-name-state">${entry.known ? 'Known' : 'Hidden'}</span>
                <div class="kw-deathnote-item__actions">
                    <button
                        type="button"
                        class="menu_button ${actionClass}"
                        data-actor="${escapeHtml(encodeActorValue(entry.actor))}"
                        ${actionDisabled}
                    >${escapeHtml(actionLabel)}</button>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="kw-deathnote-manager">
            <div class="kw-deathnote-manager__summary">
                <span><b>Unknown names stay scrambled</b> until they are learned in-scene.</span>
                <span><b>Steal ID:</b> risky, can fail, and puts the target on alert.</span>
                <span><b>Scope:</b> Current chat participants only</span>
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

            const currentText = String(element && element.textContent ? element.textContent : '');
            const replaced = replaceLeadingName(currentText, baseline, displayName);
            if (replaced !== currentText) {
                element.textContent = replaced;
                continue;
            }

            replaceMatchingTextNodes(element, baseline, displayName);
        }

        replaceStandaloneMessageNameText($message, originalName, displayName);
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

function getSelectedInventoryItemKey(settings, inventory) {
    const scraps = inventory.scraps.filter((scrap) => scrap && scrap.active);
    const ids = Array.isArray(inventory.ids) ? inventory.ids : [];
    const selected = String(settings.inventorySelectedItemKey || 'notebook').trim();
    if (!selected || selected === 'notebook') {
        return 'notebook';
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

    return 'notebook';
}

function renderInventoryGridSlots(inventory, selectedKey, coverUrl) {
    const slots = [];
    slots.push(`
        <button
            type="button"
            class="kw-dn-inventory__slot ${selectedKey === 'notebook' ? 'is-selected' : ''} ${inventory.notebook.destroyed ? 'is-disabled' : ''}"
            data-item-key="notebook"
            aria-pressed="${selectedKey === 'notebook' ? 'true' : 'false'}"
        >
            <img
                class="kw-dn-inventory__slot-art"
                src="${coverUrl}"
                alt="Death Note cover"
                draggable="false"
            />
            <span class="kw-dn-inventory__slot-label">Death Note</span>
        </button>
    `);

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

    if (!scraps.length && !ids.length) {
        slots.push(`
            <div class="kw-dn-inventory__slot kw-dn-inventory__slot--empty" aria-hidden="true">
                <span class="kw-dn-inventory__slot-label">Empty</span>
            </div>
        `);
    }

    return slots.join('');
}

function renderNotebookSelectionPanel({ settings, inventory, ownership, linked }) {
    const notebookAvailable = !inventory.notebook.destroyed;
    const canOpenNotebook = notebookAvailable && ownership.userAccess === NOTEBOOK_USER_ACCESS.FULL;
    const linkedLabel = linked.active ? formatActorInventoryLabel(linked.actor) : 'No link';
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
                    <div class="kw-dn-inventory__item-eyebrow">Death Note</div>
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
            <div class="kw-dn-inventory__context-link">
                <select
                    id="kw-dn-inventory-shinigami-select"
                    class="text_pole kw-dn-inventory__context-select"
                >
                    ${renderActorOptions(linkChoices, selectedLinkActor, true, 'Select Shinigami', formatActorInventoryLabel)}
                </select>
                <button
                    type="button"
                    id="kw-dn-inventory-link-shinigami"
                    class="menu_button kw-dn-inventory__context-action"
                >Link Shinigami</button>
                <button
                    type="button"
                    id="kw-dn-inventory-unlink-shinigami"
                    class="menu_button kw-dn-inventory__context-action"
                    ${linked.active ? '' : 'disabled'}
                >Clear Link</button>
            </div>
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
    const selectedKey = getSelectedInventoryItemKey(settings, inventory);
    if (selectedKey === 'notebook') {
        return renderNotebookSelectionPanel({ settings, inventory, ownership, linked });
    }

    if (selectedKey.startsWith('id:')) {
        const idCardId = selectedKey.slice('id:'.length);
        const idCard = Array.isArray(inventory.ids)
            ? inventory.ids.find((entry) => entry && entry.id === idCardId)
            : null;
        if (idCard) {
            return renderIdentityCardSelectionPanel(idCard);
        }

        return renderNotebookSelectionPanel({ settings, inventory, ownership, linked });
    }

    const scrapId = selectedKey.slice('scrap:'.length);
    const scrap = inventory.scraps.find((entry) => entry && entry.active && entry.id === scrapId);
    if (!scrap) {
        return renderNotebookSelectionPanel({ settings, inventory, ownership, linked });
    }

    return renderScrapSelectionPanel(scrap);
}

function renderInventoryTrayHtml() {
    const settings = getSettings();
    const ownership = getNotebookOwnership();
    const inventory = getDeathNoteInventory();
    const linked = getLinkedShinigami();
    const coverUrl = new URL('../assets/deathnote/cover.jpg', import.meta.url).toString();
    const itemCount = (inventory.notebook.destroyed ? 0 : 1)
        + inventory.scraps.filter((scrap) => scrap && scrap.active).length
        + (Array.isArray(inventory.ids) ? inventory.ids.length : 0);
    const selectedKey = getSelectedInventoryItemKey(settings, inventory);

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
                </div>

                <div class="kw-dn-inventory__layout">
                    <div class="kw-dn-inventory__grid-wrap">
                        <div class="kw-dn-inventory__grid">
                            ${renderInventoryGridSlots(inventory, selectedKey, coverUrl)}
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
    $('#kw-deathnote-name-manager').html(renderNameKnowledgeManagerHtml());
    $('#kw-deathnote-memory-manager').html(renderMemoryManagerHtml());
    $('#kw-deathnote-notebook-manager').html(renderNotebookManagerHtml());
    $('#kw-deathnote-link-manager').html(renderLinkManagerHtml());
    $('#kw-deathnote-scrap-manager').html(renderScrapManagerHtml());
    $('#kw-deathnote-toucher-manager').html(renderToucherManagerHtml());
}

function bindSettingsUi() {
    $('#kw-deathnote-font-mode').off('input').on('input', (event) => {
        const value = String($(event.currentTarget).val() || 'print').trim().toLowerCase();
        getSettings().fontMode = value === 'script' ? 'script' : 'print';
        scheduleSettingsSave();
        refreshDeathNoteUi();
    });

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
                notify('success', `${actor.name || 'That character'}'s ID was stolen.`);
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

function renderSettingsPanel() {
    const host = getSettingsHost();
    if (!host.length || document.getElementById(SETTINGS_PANEL_ID)) {
        return;
    }

    host.append(`
        <div id="${SETTINGS_PANEL_ID}" class="killer-within-settings inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Killer Within Death Note</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="killer-within-settings__field">
                    <span>Notebook font</span>
                    <select id="kw-deathnote-font-mode" class="text_pole">
                        <option value="print">Print</option>
                        <option value="script">Script</option>
                    </select>
                </label>
                <div class="killer-within-settings__field">
                    <span>Notebook defaults</span>
                    <small>If a cause is omitted, Death Note entries default to heart attack. If time is omitted, they trigger on the next assistant message.</small>
                </div>
                <div class="killer-within-settings__field">
                    <span>Name discovery</span>
                    <div id="kw-deathnote-name-manager"></div>
                </div>
                <div class="killer-within-settings__field">
                    <span>Death Note memories</span>
                    <div id="kw-deathnote-memory-manager"></div>
                </div>
                <div class="killer-within-settings__field">
                    <span>Notebook inventory</span>
                    <div id="kw-deathnote-notebook-manager"></div>
                </div>
                <div class="killer-within-settings__field">
                    <span>Linked Shinigami</span>
                    <div id="kw-deathnote-link-manager"></div>
                </div>
                <div class="killer-within-settings__field">
                    <span>Notebook scraps</span>
                    <div id="kw-deathnote-scrap-manager"></div>
                </div>
                <div class="killer-within-settings__field">
                    <span>Touchers and visibility</span>
                    <div id="kw-deathnote-toucher-manager"></div>
                </div>
            </div>
        </div>
    `);

    bindSettingsUi();
    syncSettingsUi();
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
    const pages = ensurePageCapacity(getNotebookPages(), 0);
    const currentSpreadIndex = getClampedSpreadIndex(pages);
    const visible = getVisiblePageIndices(currentSpreadIndex);
    const expandedPages = ensurePageCapacity(pages, visible.rightPageIndex);
    const leftPageHtml = visible.leftPageIndex !== null
        ? renderEditablePage({
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
            const pageSide = String(textarea.dataset.pageSide || 'right').trim().toLowerCase();
            if (!Number.isFinite(pageIndex) || pageIndex < 0) {
                return;
            }

            const pages = ensurePageCapacity(getNotebookPages(), pageIndex);
            const settings = getSettings();
            const currentSpreadIndex = getClampedSpreadIndex(pages);
            const beforeVisible = getVisibleTexts(pages, currentSpreadIndex);
            const rawValue = $(textarea).val();
            const value = String(rawValue === undefined || rawValue === null ? '' : rawValue);
            const update = updatePageWithOverflow(textarea, pages, pageIndex, value);
            const nextPages = update.pages;
            const changed = setNotebookPages(nextPages);

            if (!changed) {
                return;
            }

            const activeTrimmed = String(nextPages[pageIndex] || '') !== value;
            const afterVisible = getVisibleTexts(nextPages, currentSpreadIndex);
            const otherSideChanged = pageSide === 'left'
                ? beforeVisible.right !== afterVisible.right
                : beforeVisible.left !== afterVisible.left;

            if (activeTrimmed) {
                const nextPageIndex = pageIndex + 1;
                const nextSpreadIndex = nextPageIndex === 0 ? 0 : Math.floor((nextPageIndex + 1) / 2);
                settings.currentSpreadIndex = nextSpreadIndex;
                queueFocusRestore(nextPageIndex, nextPageIndex % 2 === 1 ? 'left' : 'right', 'start');
                scheduleSettingsSave();
                refreshDeathNoteUi();
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
        .off('click', `#${FLOATING_ID} .kw-deathnote__corner-tab`)
        .on('click', `#${FLOATING_ID} .kw-deathnote__corner-tab`, (event) => {
            event.preventDefault();
            const direction = String($(event.currentTarget).data('pageNav') || '').trim().toLowerCase();
            const pages = getNotebookPages();
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
                    setNotebookPages(expanded);
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
        .off('click', '#kw-dn-inventory-toggle')
        .on('click', '#kw-dn-inventory-toggle', (event) => {
            event.preventDefault();
            const settings = getSettings();
            settings.inventoryCollapsed = !settings.inventoryCollapsed;
            scheduleSettingsSave();
            refreshDeathNoteUi();
        })
        .off('click', '.kw-dn-inventory__slot[data-item-key]')
        .on('click', '.kw-dn-inventory__slot[data-item-key]', (event) => {
            event.preventDefault();
            const settings = getSettings();
            settings.inventorySelectedItemKey = String($(event.currentTarget).data('itemKey') || 'notebook').trim() || 'notebook';
            scheduleSettingsSave();
            refreshDeathNoteUi();
        })
        .off('click', '#kw-dn-inventory-open')
        .on('click', '#kw-dn-inventory-open', (event) => {
            event.preventDefault();
            const settings = getSettings();
            const inventory = getDeathNoteInventory();
            const ownership = getNotebookOwnership();
            if (inventory.notebook.destroyed || ownership.userAccess !== NOTEBOOK_USER_ACCESS.FULL) {
                notify('warning', 'You need full notebook access to open the Death Note from inventory.');
                return;
            }

            setNotebookOpenState(!settings.isOpen);
        })
        .off('click', '#kw-dn-inventory-tear')
        .on('click', '#kw-dn-inventory-tear', async (event) => {
            event.preventDefault();
            const inventory = getDeathNoteInventory();
            const ownership = getNotebookOwnership();
            if (inventory.notebook.destroyed || ownership.userAccess !== NOTEBOOK_USER_ACCESS.FULL) {
                notify('warning', 'You need full notebook access to tear off a scrap.');
                return;
            }

            const createdScrap = await commitInventoryMutation(() => createNotebookScrap({
                holder: getUserActor(),
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
                reason: `${actor.name || 'Selected character'} linked via inventory.`,
            }), 'Linked Shinigami updated.');
        })
        .off('click', '#kw-dn-inventory-unlink-shinigami')
        .on('click', '#kw-dn-inventory-unlink-shinigami', async (event) => {
            event.preventDefault();
            await commitInventoryMutation(() => unlinkNotebookShinigami({
                reason: 'Linked Shinigami cleared via inventory.',
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
    ensureWidget();
    ensureChatNameMaskObserver();
    queueMaskedChatNameRender();
}

export function setupDeathNoteUi() {
    renderSettingsPanel();
    syncSettingsUi();
    ensureInventoryTray();
    ensureWidget();
    bindWidgetUi();
    bindInventoryUi();
    ensureChatNameMaskObserver();
    queueMaskedChatNameRender();
}

