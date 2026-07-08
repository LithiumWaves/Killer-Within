import {
    CHAT_METADATA_KEY,
    DEFAULT_SETTINGS,
    MODULE_NAME,
    NOTEBOOK_ACTOR_TYPES,
    NOTEBOOK_USER_ACCESS,
} from './config.js';

const INVENTORY_HISTORY_LIMIT = 40;

export function getContext() {
    return globalThis.SillyTavern?.getContext?.() ?? null;
}

export function getSettings() {
    const context = getContext();
    if (!context) {
        return structuredClone(DEFAULT_SETTINGS);
    }

    context.extensionSettings[MODULE_NAME] ??= {};
    const settings = context.extensionSettings[MODULE_NAME];

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = value;
        }
    }

    return settings;
}

export function scheduleSettingsSave() {
    const context = getContext();
    try {
        context?.saveSettingsDebounced?.();
    } catch (error) {
        console.warn(`[${MODULE_NAME}] Failed to save settings`, error);
    }
}

export async function persistChatChanges() {
    const context = getContext();

    try {
        if (typeof context?.saveChat === 'function') {
            await context.saveChat();
            return;
        }

        if (typeof context?.saveChatConditional === 'function') {
            await context.saveChatConditional();
            return;
        }

        if (typeof context?.saveChatDebounced === 'function') {
            context.saveChatDebounced();
            return;
        }

        if (typeof context?.saveMetadata === 'function') {
            await context.saveMetadata();
        }
    } catch (error) {
        console.warn(`[${MODULE_NAME}] Failed to persist chat changes`, error);
    }
}

export function notify(type, message) {
    if (globalThis.toastr?.[type]) {
        globalThis.toastr[type](message);
        return;
    }

    console.info(`[${MODULE_NAME}] ${message}`);
}

function createDefaultChatState() {
    return {
        version: 3,
        hasNotebook: true,
        ownership: createDefaultOwnershipState(),
        inventory: createDefaultInventoryState(),
        notebookText: '',
        notebookPages: [''],
        entries: [],
        lastAssistantMessageCountedAt: null,
        lastGenerationCountedAt: null,
    };
}

function createActorRef(type, name = '') {
    return {
        type,
        id: '',
        name,
    };
}

function createDefaultOwnershipState() {
    return {
        owner: createActorRef(NOTEBOOK_ACTOR_TYPES.USER, 'User'),
        holder: createActorRef(NOTEBOOK_ACTOR_TYPES.USER, 'User'),
        userAccess: NOTEBOOK_USER_ACCESS.FULL,
        lastTransferredAt: null,
    };
}

function createDefaultInventoryState() {
    return {
        notebook: {
            itemId: 'death-note-main',
            kind: 'notebook',
            label: 'Death Note',
            exists: true,
            destroyed: false,
            owner: createActorRef(NOTEBOOK_ACTOR_TYPES.USER, 'User'),
            holder: createActorRef(NOTEBOOK_ACTOR_TYPES.USER, 'User'),
            updatedAt: null,
        },
        scraps: [],
        touchers: [],
        history: [],
    };
}

function normalizeActorType(value, fallbackType = NOTEBOOK_ACTOR_TYPES.NONE) {
    const type = String(value || '').trim().toLowerCase();
    if (
        type === NOTEBOOK_ACTOR_TYPES.USER
        || type === NOTEBOOK_ACTOR_TYPES.CHARACTER
        || type === NOTEBOOK_ACTOR_TYPES.SHINIGAMI
        || type === NOTEBOOK_ACTOR_TYPES.WORLD
        || type === NOTEBOOK_ACTOR_TYPES.NONE
    ) {
        return type;
    }

    return fallbackType;
}

function normalizeActorRef(value, fallbackType = NOTEBOOK_ACTOR_TYPES.NONE, fallbackName = '') {
    const actor = value && typeof value === 'object' ? value : {};
    const type = normalizeActorType(actor.type, fallbackType);
    return {
        type,
        id: String(actor.id || '').trim(),
        name: String(actor.name || fallbackName || '').trim(),
    };
}

function normalizeUserAccess(value, fallback = NOTEBOOK_USER_ACCESS.FULL) {
    const access = String(value || '').trim().toLowerCase();
    if (
        access === NOTEBOOK_USER_ACCESS.FULL
        || access === NOTEBOOK_USER_ACCESS.SCRAP
        || access === NOTEBOOK_USER_ACCESS.TOUCH
        || access === NOTEBOOK_USER_ACCESS.NONE
    ) {
        return access;
    }

    return fallback;
}

function normalizeTransferredAt(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return null;
    }

    return parsed;
}

function normalizeOwnershipState(value) {
    const defaults = createDefaultOwnershipState();
    const ownership = value && typeof value === 'object' ? value : {};

    return {
        owner: normalizeActorRef(ownership.owner, defaults.owner.type, defaults.owner.name),
        holder: normalizeActorRef(ownership.holder, defaults.holder.type, defaults.holder.name),
        userAccess: normalizeUserAccess(ownership.userAccess, defaults.userAccess),
        lastTransferredAt: normalizeTransferredAt(ownership.lastTransferredAt),
    };
}

function cloneActorRef(actor, fallbackType = NOTEBOOK_ACTOR_TYPES.NONE, fallbackName = '') {
    const normalized = normalizeActorRef(actor, fallbackType, fallbackName);
    return {
        type: normalized.type,
        id: normalized.id,
        name: normalized.name,
    };
}

function actorRefsMatch(left, right) {
    return left.type === right.type
        && left.id === right.id
        && left.name === right.name;
}

function normalizeInventoryScrap(value, index, fallbackOwner, fallbackHolder) {
    const defaults = {
        id: `death-note-scrap-${index + 1}`,
        label: `Scrap ${index + 1}`,
    };
    const scrap = value && typeof value === 'object' ? value : {};
    const holder = normalizeActorRef(scrap.holder, fallbackHolder.type, fallbackHolder.name);
    const accessFallback = holder.type === NOTEBOOK_ACTOR_TYPES.USER
        ? NOTEBOOK_USER_ACCESS.SCRAP
        : NOTEBOOK_USER_ACCESS.NONE;

    return {
        id: String(scrap.id || defaults.id).trim() || defaults.id,
        kind: 'scrap',
        label: String(scrap.label || defaults.label).trim() || defaults.label,
        noteText: String(scrap.noteText || '').trim(),
        owner: normalizeActorRef(scrap.owner, fallbackOwner.type, fallbackOwner.name),
        holder,
        userAccess: normalizeUserAccess(scrap.userAccess, accessFallback),
        active: scrap.active !== false,
        createdAt: normalizeTransferredAt(scrap.createdAt),
        updatedAt: normalizeTransferredAt(scrap.updatedAt),
    };
}

function normalizeInventoryHistoryEntry(value, index) {
    const entry = value && typeof value === 'object' ? value : {};
    const timestamp = normalizeTransferredAt(entry.timestamp);
    return {
        id: String(entry.id || `death-note-history-${index + 1}`).trim() || `death-note-history-${index + 1}`,
        action: String(entry.action || 'update').trim() || 'update',
        itemId: String(entry.itemId || '').trim(),
        detail: String(entry.detail || '').trim(),
        actor: normalizeActorRef(entry.actor, NOTEBOOK_ACTOR_TYPES.NONE, ''),
        target: normalizeActorRef(entry.target, NOTEBOOK_ACTOR_TYPES.NONE, ''),
        timestamp: timestamp === null ? Date.now() : timestamp,
    };
}

function normalizeInventoryToucher(value, index) {
    const toucher = value && typeof value === 'object' ? value : {};
    const actor = normalizeActorRef(toucher.actor, NOTEBOOK_ACTOR_TYPES.NONE, '');
    const source = String(toucher.source || 'manual').trim().toLowerCase();
    const itemId = String(toucher.itemId || '').trim();
    const active = toucher.active !== false;
    return {
        id: String(toucher.id || `death-note-toucher-${index + 1}`).trim() || `death-note-toucher-${index + 1}`,
        actor,
        source: source || 'manual',
        itemId,
        active,
        createdAt: normalizeTransferredAt(toucher.createdAt),
        updatedAt: normalizeTransferredAt(toucher.updatedAt),
    };
}

function normalizeInventoryState(value, ownership, hasNotebook) {
    const defaults = createDefaultInventoryState();
    const inventory = value && typeof value === 'object' ? value : {};
    const notebook = inventory.notebook && typeof inventory.notebook === 'object' ? inventory.notebook : {};
    const fallbackOwner = ownership?.owner || defaults.notebook.owner;
    const fallbackHolder = ownership?.holder || defaults.notebook.holder;
    const exists = Object.hasOwn(notebook, 'exists') ? Boolean(notebook.exists) : Boolean(hasNotebook);

    return {
        notebook: {
            itemId: String(notebook.itemId || defaults.notebook.itemId).trim() || defaults.notebook.itemId,
            kind: 'notebook',
            label: String(notebook.label || defaults.notebook.label).trim() || defaults.notebook.label,
            exists,
            destroyed: Boolean(notebook.destroyed),
            owner: normalizeActorRef(notebook.owner, fallbackOwner.type, fallbackOwner.name),
            holder: normalizeActorRef(notebook.holder, fallbackHolder.type, fallbackHolder.name),
            updatedAt: normalizeTransferredAt(notebook.updatedAt),
        },
        scraps: Array.isArray(inventory.scraps)
            ? inventory.scraps.map((scrap, index) => normalizeInventoryScrap(scrap, index, fallbackOwner, fallbackHolder))
            : [],
        touchers: Array.isArray(inventory.touchers)
            ? inventory.touchers.map((toucher, index) => normalizeInventoryToucher(toucher, index))
            : [],
        history: Array.isArray(inventory.history)
            ? inventory.history
                .slice(-INVENTORY_HISTORY_LIMIT)
                .map((entry, index) => normalizeInventoryHistoryEntry(entry, index))
            : [],
    };
}

function isUserActor(actor) {
    return normalizeActorType(actor?.type, NOTEBOOK_ACTOR_TYPES.NONE) === NOTEBOOK_ACTOR_TYPES.USER;
}

function isValidActorRef(actor) {
    const normalized = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.NONE, '');
    return normalized.type !== NOTEBOOK_ACTOR_TYPES.NONE || Boolean(normalized.name) || Boolean(normalized.id);
}

function getUserAccessRank(value) {
    const access = normalizeUserAccess(value, NOTEBOOK_USER_ACCESS.NONE);
    if (access === NOTEBOOK_USER_ACCESS.FULL) {
        return 3;
    }

    if (access === NOTEBOOK_USER_ACCESS.SCRAP) {
        return 2;
    }

    if (access === NOTEBOOK_USER_ACCESS.TOUCH) {
        return 1;
    }

    return 0;
}

function getHigherUserAccess(left, right) {
    return getUserAccessRank(left) >= getUserAccessRank(right) ? left : right;
}

function syncInventoryWithOwnership(state) {
    state.inventory = normalizeInventoryState(state.inventory, state.ownership, state.hasNotebook);
    state.inventory.notebook.exists = Boolean(state.hasNotebook) && !state.inventory.notebook.destroyed;
    state.inventory.notebook.owner = cloneActorRef(state.ownership.owner, state.ownership.owner.type, state.ownership.owner.name);
    state.inventory.notebook.holder = cloneActorRef(state.ownership.holder, state.ownership.holder.type, state.ownership.holder.name);
}

function deriveUserNotebookAccess(state, preferredAccess = NOTEBOOK_USER_ACCESS.NONE) {
    const preserved = normalizeUserAccess(preferredAccess, NOTEBOOK_USER_ACCESS.NONE);
    let access = preserved === NOTEBOOK_USER_ACCESS.FULL ? NOTEBOOK_USER_ACCESS.NONE : preserved;

    if (state.hasNotebook && isUserActor(state.ownership.holder)) {
        return NOTEBOOK_USER_ACCESS.FULL;
    }

    for (const scrap of state.inventory.scraps) {
        if (!scrap?.active || !isUserActor(scrap.holder)) {
            continue;
        }

        access = getHigherUserAccess(access, normalizeUserAccess(scrap.userAccess, NOTEBOOK_USER_ACCESS.SCRAP));
    }

    return access;
}

function refreshUserNotebookAccess(state, preferredAccess = NOTEBOOK_USER_ACCESS.NONE) {
    state.ownership.userAccess = deriveUserNotebookAccess(state, preferredAccess);
}

function pushInventoryHistory(state, {
    action,
    itemId = '',
    detail = '',
    actor = null,
    target = null,
    timestamp = Date.now(),
} = {}) {
    state.inventory = normalizeInventoryState(state.inventory, state.ownership, state.hasNotebook);
    state.inventory.history.push({
        id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        action: String(action || 'update').trim() || 'update',
        itemId: String(itemId || '').trim(),
        detail: String(detail || '').trim(),
        actor: normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.NONE, ''),
        target: normalizeActorRef(target, NOTEBOOK_ACTOR_TYPES.NONE, ''),
        timestamp: Number.isFinite(Number(timestamp)) ? Number(timestamp) : Date.now(),
    });

    if (state.inventory.history.length > INVENTORY_HISTORY_LIMIT) {
        state.inventory.history = state.inventory.history.slice(-INVENTORY_HISTORY_LIMIT);
    }
}

function getActorIdentityKey(actor) {
    const normalized = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.NONE, '');
    return [
        normalized.type || NOTEBOOK_ACTOR_TYPES.NONE,
        normalized.id || '',
        normalized.name || '',
    ].join('::');
}

function pushPresenceParticipant(collection, actor, source, itemId) {
    const normalizedActor = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.NONE, '');
    if (!isValidActorRef(normalizedActor)) {
        return;
    }

    const key = getActorIdentityKey(normalizedActor);
    if (!collection.has(key)) {
        collection.set(key, {
            actor: cloneActorRef(normalizedActor, normalizedActor.type, normalizedActor.name),
            sources: [],
            canSeeShinigami: true,
        });
    }

    const participant = collection.get(key);
    const sourceValue = String(source || 'contact').trim() || 'contact';
    const normalizedItemId = String(itemId || '').trim();
    const duplicate = participant.sources.some((entry) => entry.source === sourceValue && entry.itemId === normalizedItemId);
    if (!duplicate) {
        participant.sources.push({
            source: sourceValue,
            itemId: normalizedItemId,
        });
    }
}

function buildDeathNotePresenceParticipants(state) {
    const participants = new Map();
    syncInventoryWithOwnership(state);

    if (state.hasNotebook) {
        pushPresenceParticipant(
            participants,
            state.ownership.holder,
            'notebook_holder',
            state.inventory.notebook.itemId,
        );
    }

    if (
        state.ownership.userAccess === NOTEBOOK_USER_ACCESS.FULL
        || state.ownership.userAccess === NOTEBOOK_USER_ACCESS.TOUCH
    ) {
        pushPresenceParticipant(
            participants,
            {
                type: NOTEBOOK_ACTOR_TYPES.USER,
                id: '',
                name: 'User',
            },
            state.ownership.userAccess === NOTEBOOK_USER_ACCESS.FULL ? 'user_full_access' : 'user_touch_access',
            state.inventory.notebook.itemId,
        );
    }

    for (const scrap of state.inventory.scraps) {
        if (!scrap || !scrap.active) {
            continue;
        }

        pushPresenceParticipant(participants, scrap.holder, 'scrap_holder', scrap.id);
    }

    for (const toucher of state.inventory.touchers) {
        if (!toucher || !toucher.active) {
            continue;
        }

        pushPresenceParticipant(participants, toucher.actor, toucher.source || 'manual_touch', toucher.itemId);
    }

    return Array.from(participants.values());
}

function buildNextOwnership(current, raw) {
    const nextRaw = raw && typeof raw === 'object' ? raw : {};
    const next = {
        owner: Object.hasOwn(nextRaw, 'owner')
            ? normalizeActorRef(nextRaw.owner, current.owner.type, current.owner.name)
            : current.owner,
        holder: Object.hasOwn(nextRaw, 'holder')
            ? normalizeActorRef(nextRaw.holder, current.holder.type, current.holder.name)
            : current.holder,
        userAccess: Object.hasOwn(nextRaw, 'userAccess')
            ? normalizeUserAccess(nextRaw.userAccess, current.userAccess)
            : current.userAccess,
        lastTransferredAt: Object.hasOwn(nextRaw, 'lastTransferredAt')
            ? normalizeTransferredAt(nextRaw.lastTransferredAt)
            : current.lastTransferredAt,
    };

    const transferred = !actorRefsMatch(current.owner, next.owner) || !actorRefsMatch(current.holder, next.holder);
    if (transferred && next.lastTransferredAt === null) {
        next.lastTransferredAt = Date.now();
    }

    return { next, transferred };
}

function normalizeNotebookPages(pages, fallbackText = '') {
    if (!Array.isArray(pages) || !pages.length) {
        return [String(fallbackText ?? '')];
    }

    const normalized = pages.map((page) => String(page ?? ''));
    return normalized.length ? normalized : [String(fallbackText ?? '')];
}

function syncNotebookTextFromPages(state) {
    state.notebookPages = normalizeNotebookPages(state.notebookPages, state.notebookText ?? '');
    state.notebookText = state.notebookPages.join('');
}

export function getChatState() {
    const context = getContext();
    if (!context) {
        return createDefaultChatState();
    }

    context.chatMetadata ??= {};
    context.chatMetadata[CHAT_METADATA_KEY] ??= createDefaultChatState();
    const state = context.chatMetadata[CHAT_METADATA_KEY];

    if (!Array.isArray(state.entries)) {
        state.entries = [];
    }

    if (!Object.hasOwn(state, 'hasNotebook')) {
        state.hasNotebook = true;
    }

    state.ownership = normalizeOwnershipState(state.ownership);
    state.inventory = normalizeInventoryState(state.inventory, state.ownership, state.hasNotebook);

    if (state.inventory.notebook.destroyed) {
        state.hasNotebook = false;
    }

    if (!state.hasNotebook && state.ownership.userAccess === NOTEBOOK_USER_ACCESS.FULL) {
        state.ownership.userAccess = NOTEBOOK_USER_ACCESS.NONE;
    }

    syncInventoryWithOwnership(state);
    refreshUserNotebookAccess(state, state.ownership.userAccess);

    if (!Object.hasOwn(state, 'notebookText')) {
        state.notebookText = '';
    }

    state.notebookPages = normalizeNotebookPages(state.notebookPages, state.notebookText ?? '');
    syncNotebookTextFromPages(state);

    return state;
}

export function getNotebookOwnership() {
    const state = getChatState();
    state.ownership = normalizeOwnershipState(state.ownership);
    return state.ownership;
}

export function getDeathNoteInventory() {
    const state = getChatState();
    state.inventory = normalizeInventoryState(state.inventory, state.ownership, state.hasNotebook);
    syncInventoryWithOwnership(state);
    return state.inventory;
}

export function getNotebookTouchers() {
    const state = getChatState();
    return buildDeathNotePresenceParticipants(state);
}

export function setNotebookOwnership(nextOwnership = {}) {
    const state = getChatState();
    const current = normalizeOwnershipState(state.ownership);
    const { next, transferred } = buildNextOwnership(current, nextOwnership);

    const changed = transferred
        || current.userAccess !== next.userAccess
        || current.lastTransferredAt !== next.lastTransferredAt;

    if (!changed) {
        return false;
    }

    state.ownership = next;
    syncInventoryWithOwnership(state);
    refreshUserNotebookAccess(state, next.userAccess);
    return true;
}

export function userHasFullNotebookAccess() {
    return getNotebookOwnership().userAccess === NOTEBOOK_USER_ACCESS.FULL;
}

export function setUserNotebookAccess(access, options = {}) {
    const state = getChatState();
    const nextAccess = normalizeUserAccess(access, state.ownership.userAccess);
    const previousAccess = state.ownership.userAccess;
    const changed = setNotebookOwnership({
        userAccess: nextAccess,
        lastTransferredAt: state.ownership.lastTransferredAt,
    });

    if (!changed) {
        return false;
    }

    pushInventoryHistory(state, {
        action: 'set_user_access',
        itemId: state.inventory.notebook.itemId,
        detail: String(options.reason || '').trim() || `User access changed from ${previousAccess} to ${state.ownership.userAccess}.`,
        actor: state.ownership.holder,
        target: state.ownership.owner,
    });
    return true;
}

export function transferNotebookTo(holder, options = {}) {
    const state = getChatState();
    const current = normalizeOwnershipState(state.ownership);
    const nextHolder = normalizeActorRef(holder, current.holder.type, current.holder.name);
    const nextOwner = Object.hasOwn(options, 'owner')
        ? normalizeActorRef(options.owner, current.owner.type, current.owner.name)
        : current.owner;
    const preferredAccess = Object.hasOwn(options, 'userAccess')
        ? normalizeUserAccess(options.userAccess, current.userAccess)
        : current.userAccess;
    const timestamp = normalizeTransferredAt(options.timestamp) ?? Date.now();
    const { next, transferred } = buildNextOwnership(current, {
        owner: nextOwner,
        holder: nextHolder,
        userAccess: preferredAccess,
        lastTransferredAt: timestamp,
    });
    const changed = transferred
        || current.userAccess !== next.userAccess
        || current.lastTransferredAt !== next.lastTransferredAt;

    if (!changed) {
        return false;
    }

    state.hasNotebook = options.exists !== false;
    state.ownership = next;
    syncInventoryWithOwnership(state);
    state.inventory.notebook.destroyed = false;
    state.inventory.notebook.exists = Boolean(state.hasNotebook);
    state.inventory.notebook.updatedAt = timestamp;
    refreshUserNotebookAccess(state, preferredAccess);
    pushInventoryHistory(state, {
        action: 'transfer_notebook',
        itemId: state.inventory.notebook.itemId,
        detail: String(options.reason || '').trim() || `Notebook transferred to ${nextHolder.name || nextHolder.type}.`,
        actor: current.holder,
        target: nextHolder,
        timestamp,
    });
    return true;
}

export function destroyNotebook(options = {}) {
    const state = getChatState();
    const timestamp = normalizeTransferredAt(options.timestamp) ?? Date.now();
    const wasAvailable = Boolean(state.hasNotebook) || !state.inventory?.notebook?.destroyed;
    if (!wasAvailable) {
        return false;
    }

    state.hasNotebook = false;
    state.ownership = normalizeOwnershipState({
        ...state.ownership,
        userAccess: NOTEBOOK_USER_ACCESS.NONE,
        lastTransferredAt: timestamp,
    });
    syncInventoryWithOwnership(state);
    state.inventory.notebook.exists = false;
    state.inventory.notebook.destroyed = true;
    state.inventory.notebook.updatedAt = timestamp;
    refreshUserNotebookAccess(state, NOTEBOOK_USER_ACCESS.NONE);
    pushInventoryHistory(state, {
        action: 'destroy_notebook',
        itemId: state.inventory.notebook.itemId,
        detail: String(options.reason || '').trim() || 'Notebook destroyed or removed from play.',
        actor: state.ownership.holder,
        target: state.ownership.owner,
        timestamp,
    });
    return true;
}

export function createNotebookScrap(options = {}) {
    const state = getChatState();
    syncInventoryWithOwnership(state);
    const timestamp = normalizeTransferredAt(options.timestamp) ?? Date.now();
    const current = normalizeOwnershipState(state.ownership);
    const holder = normalizeActorRef(
        options.holder,
        current.holder.type,
        current.holder.name,
    );
    const owner = Object.hasOwn(options, 'owner')
        ? normalizeActorRef(options.owner, current.owner.type, current.owner.name)
        : current.owner;
    const accessDefault = isUserActor(holder) ? NOTEBOOK_USER_ACCESS.SCRAP : NOTEBOOK_USER_ACCESS.NONE;
    const userAccess = normalizeUserAccess(options.userAccess, accessDefault);
    const scrapId = String(options.id || '').trim()
        || (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const scrap = normalizeInventoryScrap({
        id: scrapId,
        label: options.label,
        noteText: options.noteText,
        owner,
        holder,
        userAccess,
        active: options.active !== false,
        createdAt: timestamp,
        updatedAt: timestamp,
    }, state.inventory.scraps.length, owner, holder);

    state.inventory.scraps.push(scrap);
    refreshUserNotebookAccess(state, state.ownership.userAccess);
    pushInventoryHistory(state, {
        action: 'create_scrap',
        itemId: scrap.id,
        detail: String(options.reason || '').trim() || `${scrap.label} created.`,
        actor: owner,
        target: holder,
        timestamp,
    });
    return scrap;
}

export function transferNotebookScrap(scrapId, holder, options = {}) {
    const state = getChatState();
    syncInventoryWithOwnership(state);
    const id = String(scrapId || '').trim();
    if (!id) {
        return false;
    }

    const scrap = state.inventory.scraps.find((entry) => entry?.id === id);
    if (!scrap) {
        return false;
    }

    const previousHolder = cloneActorRef(scrap.holder, scrap.holder.type, scrap.holder.name);
    const nextHolder = normalizeActorRef(holder, scrap.holder.type, scrap.holder.name);
    const nextOwner = Object.hasOwn(options, 'owner')
        ? normalizeActorRef(options.owner, scrap.owner.type, scrap.owner.name)
        : scrap.owner;
    const timestamp = normalizeTransferredAt(options.timestamp) ?? Date.now();
    const accessDefault = isUserActor(nextHolder) ? NOTEBOOK_USER_ACCESS.SCRAP : NOTEBOOK_USER_ACCESS.NONE;

    scrap.holder = nextHolder;
    scrap.owner = nextOwner;
    scrap.userAccess = Object.hasOwn(options, 'userAccess')
        ? normalizeUserAccess(options.userAccess, scrap.userAccess)
        : normalizeUserAccess(scrap.userAccess, accessDefault);
    scrap.active = options.active === undefined ? scrap.active : options.active !== false;
    scrap.updatedAt = timestamp;

    refreshUserNotebookAccess(state, state.ownership.userAccess);
    pushInventoryHistory(state, {
        action: 'transfer_scrap',
        itemId: scrap.id,
        detail: String(options.reason || '').trim() || `${scrap.label} transferred.`,
        actor: previousHolder,
        target: nextHolder,
        timestamp,
    });
    return true;
}

export function removeNotebookScrap(scrapId, options = {}) {
    const state = getChatState();
    syncInventoryWithOwnership(state);
    const id = String(scrapId || '').trim();
    if (!id) {
        return false;
    }

    const index = state.inventory.scraps.findIndex((entry) => entry?.id === id);
    if (index < 0) {
        return false;
    }

    const [removed] = state.inventory.scraps.splice(index, 1);
    refreshUserNotebookAccess(state, state.ownership.userAccess);
    pushInventoryHistory(state, {
        action: 'remove_scrap',
        itemId: removed.id,
        detail: String(options.reason || '').trim() || `${removed.label} removed from play.`,
        actor: removed.holder,
        target: removed.owner,
        timestamp: normalizeTransferredAt(options.timestamp) ?? Date.now(),
    });
    return true;
}

export function getUserHeldNotebookScraps() {
    return getDeathNoteInventory().scraps.filter((scrap) => scrap?.active && isUserActor(scrap.holder));
}

export function addNotebookToucher(actor, options = {}) {
    const state = getChatState();
    syncInventoryWithOwnership(state);
    const normalizedActor = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.NONE, '');
    if (!isValidActorRef(normalizedActor)) {
        return null;
    }

    const source = String(options.source || 'manual_touch').trim().toLowerCase() || 'manual_touch';
    const itemId = String(options.itemId || '').trim();
    const timestamp = normalizeTransferredAt(options.timestamp) ?? Date.now();
    const existing = state.inventory.touchers.find((entry) => {
        return entry
            && entry.active
            && getActorIdentityKey(entry.actor) === getActorIdentityKey(normalizedActor)
            && String(entry.source || '').trim().toLowerCase() === source
            && String(entry.itemId || '').trim() === itemId;
    });

    if (existing) {
        existing.updatedAt = timestamp;
        return existing;
    }

    const toucher = normalizeInventoryToucher({
        id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        actor: normalizedActor,
        source,
        itemId,
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
    }, state.inventory.touchers.length);

    state.inventory.touchers.push(toucher);
    refreshUserNotebookAccess(state, state.ownership.userAccess);
    pushInventoryHistory(state, {
        action: 'add_toucher',
        itemId,
        detail: String(options.reason || '').trim() || `${normalizedActor.name || normalizedActor.type} touched the Death Note.`,
        actor: normalizedActor,
        target: state.ownership.holder,
        timestamp,
    });
    return toucher;
}

export function removeNotebookToucher(actor, options = {}) {
    const state = getChatState();
    syncInventoryWithOwnership(state);
    const normalizedActor = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.NONE, '');
    if (!isValidActorRef(normalizedActor)) {
        return false;
    }

    const sourceFilter = String(options.source || '').trim().toLowerCase();
    const itemIdFilter = String(options.itemId || '').trim();
    let changed = false;
    for (const toucher of state.inventory.touchers) {
        if (!toucher || !toucher.active) {
            continue;
        }

        if (getActorIdentityKey(toucher.actor) !== getActorIdentityKey(normalizedActor)) {
            continue;
        }

        if (sourceFilter && String(toucher.source || '').trim().toLowerCase() !== sourceFilter) {
            continue;
        }

        if (itemIdFilter && String(toucher.itemId || '').trim() !== itemIdFilter) {
            continue;
        }

        toucher.active = false;
        toucher.updatedAt = normalizeTransferredAt(options.timestamp) ?? Date.now();
        changed = true;
    }

    if (!changed) {
        return false;
    }

    refreshUserNotebookAccess(state, state.ownership.userAccess);
    pushInventoryHistory(state, {
        action: 'remove_toucher',
        itemId: itemIdFilter,
        detail: String(options.reason || '').trim() || `${normalizedActor.name || normalizedActor.type} no longer touches the Death Note.`,
        actor: normalizedActor,
        target: state.ownership.holder,
        timestamp: normalizeTransferredAt(options.timestamp) ?? Date.now(),
    });
    return true;
}

export function clearNotebookTouchers(options = {}) {
    const state = getChatState();
    syncInventoryWithOwnership(state);
    let changed = false;
    const sourceFilter = String(options.source || '').trim().toLowerCase();
    const itemIdFilter = String(options.itemId || '').trim();

    for (const toucher of state.inventory.touchers) {
        if (!toucher || !toucher.active) {
            continue;
        }

        if (sourceFilter && String(toucher.source || '').trim().toLowerCase() !== sourceFilter) {
            continue;
        }

        if (itemIdFilter && String(toucher.itemId || '').trim() !== itemIdFilter) {
            continue;
        }

        toucher.active = false;
        toucher.updatedAt = normalizeTransferredAt(options.timestamp) ?? Date.now();
        changed = true;
    }

    if (!changed) {
        return false;
    }

    refreshUserNotebookAccess(state, state.ownership.userAccess);
    pushInventoryHistory(state, {
        action: 'clear_touchers',
        itemId: itemIdFilter,
        detail: String(options.reason || '').trim() || 'Cleared active Death Note touchers.',
        actor: state.ownership.holder,
        target: state.ownership.owner,
        timestamp: normalizeTransferredAt(options.timestamp) ?? Date.now(),
    });
    return true;
}

export function getDeathNotePresenceState() {
    const state = getChatState();
    const inventory = getDeathNoteInventory();
    const touchers = buildDeathNotePresenceParticipants(state);
    const userToucher = touchers.find((entry) => isUserActor(entry.actor));

    return {
        notebookPresent: Boolean(state.hasNotebook),
        notebookDestroyed: Boolean(inventory.notebook.destroyed),
        touchers,
        userCanSeeShinigami: Boolean(userToucher),
        userTouchSources: userToucher ? userToucher.sources : [],
    };
}

function normalizeRemaining(value) {
    if (value === null || value === undefined) {
        return 0;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return 0;
    }

    return Math.max(0, Math.floor(parsed));
}

export function addDeathEntry({
    targetName,
    cause,
    remainingAssistantMessages,
    noteText,
    hasExplicitCause,
    hasExplicitTime,
} = {}) {
    const state = getChatState();

    const entry = {
        id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        targetName: String(targetName || '').trim(),
        cause: String(cause || '').trim(),
        noteText: String(noteText || '').trim(),
        remainingAssistantMessages: normalizeRemaining(remainingAssistantMessages),
        hasExplicitCause: Boolean(hasExplicitCause),
        hasExplicitTime: Boolean(hasExplicitTime),
        status: 'active',
        createdAt: Date.now(),
        resolvedAt: null,
    };

    if (!entry.targetName && !entry.noteText) {
        return null;
    }

    state.entries.push(entry);
    return entry;
}

function looksLikeNameOnly(text) {
    const value = String(text || '').trim();
    if (!value) {
        return false;
    }

    if (/[,:;.!?]/.test(value)) {
        return false;
    }

    const lowered = value.toLowerCase();
    const explicitTerms = [
        ' will ',
        ' die',
        ' dies',
        ' died',
        ' killed',
        ' kill',
        ' heart attack',
        ' poison',
        ' poisoned',
        ' stabbed',
        ' shot',
        ' burned',
        ' drowned',
        ' strangle',
        ' suicide',
        ' accident',
        ' truck',
        ' car',
        ' next message',
        ' minute',
        ' hour',
        ' day',
    ];

    if (explicitTerms.some((term) => lowered.includes(term.trim()) || lowered.includes(term))) {
        return false;
    }

    const words = value.split(/\s+/).filter(Boolean);
    return words.length > 0 && words.length <= 5;
}

function parseNotebookLine(line) {
    const raw = String(line || '').trim();
    if (!raw) {
        return null;
    }

    let remainingAssistantMessages = 1;
    let body = raw;
    let hasExplicitTime = false;
    const timeMatch = body.match(/\s+(\d+)\s*$/);
    if (timeMatch) {
        remainingAssistantMessages = Math.max(0, Number(timeMatch[1]) || 0);
        body = body.slice(0, Math.max(0, timeMatch.index)).trim();
        hasExplicitTime = true;
    }

    const hasExplicitCause = !looksLikeNameOnly(body);
    const cause = hasExplicitCause ? body : 'heart attack';
    const targetName = hasExplicitCause ? '' : body;

    return {
        noteText: raw,
        targetName,
        cause,
        remainingAssistantMessages,
        hasExplicitCause,
        hasExplicitTime,
    };
}

function buildLineCounts(lines) {
    const counts = new Map();
    for (const line of lines) {
        counts.set(line, (counts.get(line) ?? 0) + 1);
    }
    return counts;
}

export function setNotebookText(text) {
    const state = getChatState();
    const value = String(text ?? '');

    if (state.notebookText === value && Array.isArray(state.notebookPages) && state.notebookPages.length === 1 && state.notebookPages[0] === value) {
        return false;
    }

    state.notebookText = value;
    state.notebookPages = [value];
    reconcileEntriesFromNotebookPages();
    return true;
}

export function getNotebookPages() {
    const state = getChatState();
    state.notebookPages = normalizeNotebookPages(state.notebookPages, state.notebookText ?? '');
    return state.notebookPages;
}

export function setNotebookPages(pages) {
    const state = getChatState();
    const normalized = normalizeNotebookPages(pages, state.notebookText ?? '');
    const nextText = normalized.join('');
    const sameLength = Array.isArray(state.notebookPages) && state.notebookPages.length === normalized.length;
    const samePages = sameLength && normalized.every((page, index) => state.notebookPages[index] === page);

    if (samePages && state.notebookText === nextText) {
        return false;
    }

    state.notebookPages = normalized;
    state.notebookText = nextText;
    reconcileEntriesFromNotebookText();
    return true;
}

export function reconcileEntriesFromNotebookPages() {
    const state = getChatState();
    syncNotebookTextFromPages(state);
    const lines = String(state.notebookText ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const counts = buildLineCounts(lines);
    const retained = [];

    for (const entry of state.entries) {
        const key = String(entry?.noteText || '').trim();
        if (!key) {
            continue;
        }

        const available = counts.get(key) ?? 0;
        if (available <= 0) {
            continue;
        }

        counts.set(key, available - 1);
        retained.push(entry);
    }

    for (const [line, count] of counts.entries()) {
        for (let i = 0; i < count; i += 1) {
            const parsed = parseNotebookLine(line);
            if (!parsed) {
                continue;
            }

            const entry = addDeathEntry(parsed);
            if (entry) {
                retained.push(entry);
            }
        }
    }

    state.entries = retained;
}

export function reconcileEntriesFromNotebookText() {
    reconcileEntriesFromNotebookPages();
}

export function removeDeathEntry(entryId) {
    const state = getChatState();
    const id = String(entryId || '').trim();
    if (!id) {
        return false;
    }

    const before = state.entries.length;
    state.entries = state.entries.filter((entry) => entry?.id !== id);
    return state.entries.length !== before;
}

export function clearDeathEntries() {
    const state = getChatState();
    state.entries = [];
}

function isAssistantMessage(message) {
    if (!message) {
        return false;
    }

    if (message.is_user || message.is_system) {
        return false;
    }

    const text = String(message.mes ?? '').trim();
    return Boolean(text);
}

function normalizeEntryStatus(value) {
    const status = String(value || '').trim().toLowerCase();
    if (status === 'due' || status === 'resolved' || status === 'active') {
        return status;
    }
    return 'active';
}

export function tickDeathNoteCountdownForGeneration(signature) {
    const settings = getSettings();
    const state = getChatState();

    if (!settings.enabled) {
        return { ticked: false, due: [] };
    }

    if (!state.hasNotebook) {
        return { ticked: false, due: [] };
    }

    const key = Number.isFinite(Number(signature)) ? Number(signature) : null;
    if (key === null) {
        return { ticked: false, due: [] };
    }

    if (state.lastGenerationCountedAt === key) {
        return { ticked: false, due: [] };
    }

    state.lastGenerationCountedAt = key;

    const due = [];
    for (const entry of state.entries) {
        if (!entry) {
            continue;
        }

        entry.status = normalizeEntryStatus(entry.status);

        if (entry.status !== 'active') {
            continue;
        }

        const remaining = normalizeRemaining(entry.remainingAssistantMessages);
        const next = Math.max(0, remaining - 1);
        entry.remainingAssistantMessages = next;

        if (next === 0) {
            entry.status = 'due';
            due.push(entry);
        }
    }

    return { ticked: true, due };
}

export function resolveDueEntriesForAssistantMessage(signature) {
    const settings = getSettings();
    const state = getChatState();
    const key = Number.isFinite(Number(signature)) ? Number(signature) : null;
    if (key === null) {
        return { resolved: false, resolvedEntries: [] };
    }

    if (!settings.enabled) {
        return { resolved: false, resolvedEntries: [] };
    }

    if (state.lastAssistantMessageCountedAt === key) {
        return { resolved: false, resolvedEntries: [] };
    }

    state.lastAssistantMessageCountedAt = key;

    const resolvedEntries = [];
    for (const entry of state.entries) {
        if (!entry) {
            continue;
        }

        entry.status = normalizeEntryStatus(entry.status);

        if (entry.status !== 'due') {
            continue;
        }

        entry.status = 'resolved';
        entry.resolvedAt = Date.now();
        resolvedEntries.push(entry);
    }

    return { resolved: resolvedEntries.length > 0, resolvedEntries };
}

export function isDebugEnabled() {
    return Boolean(getSettings().debug);
}

