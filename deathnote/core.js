import {
    AI_NOTEBOOK_WRITE_BLOCK_TAG,
    CHAT_METADATA_KEY,
    DEFAULT_SETTINGS,
    MESSAGE_EXTRA_KEY,
    MODULE_NAME,
    NOTEBOOK_ACTOR_TYPES,
    NOTEBOOK_USER_ACCESS,
} from './config.js';

const INVENTORY_HISTORY_LIMIT = 40;
const ID_THEFT_COOLDOWN_MS = 5 * 60 * 1000;

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
        version: 4,
        hasNotebook: true,
        ownership: createDefaultOwnershipState(),
        shinigamiLink: createDefaultShinigamiLinkState(),
        nameKnowledge: createDefaultNameKnowledgeState(),
        identityTheft: createDefaultIdentityTheftState(),
        notebookPresenceReveal: {
            pending: false,
            openedAt: null,
        },
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

function createDefaultShinigamiLinkState() {
    return {
        active: false,
        actor: createActorRef(NOTEBOOK_ACTOR_TYPES.SHINIGAMI, ''),
        avatar: '',
        notebookItemId: 'death-note-main',
        linkedAt: null,
    };
}

function createDefaultNameKnowledgeState() {
    return {
        known: [],
    };
}

function createDefaultIdentityTheftState() {
    return {
        cooldowns: [],
        pendingExposure: {
            active: false,
            actor: createActorRef(NOTEBOOK_ACTOR_TYPES.NONE, ''),
            createdAt: null,
        },
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
        ids: [],
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
        || type === NOTEBOOK_ACTOR_TYPES.NPC
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

function normalizeKnowledgeKey(value) {
    return String(value || '').trim().toLowerCase();
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function getActorKnowledgeKey(actor) {
    const normalized = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.NONE, '');
    const id = normalizeKnowledgeKey(normalized.id);
    if (id) {
        return `id:${id}`;
    }

    const name = normalizeKnowledgeKey(normalized.name);
    if (name) {
        return `name:${name}`;
    }

    return '';
}

function resolveContextMacro(name) {
    const context = getContext();
    const macro = `{{${String(name || '').trim()}}}`;
    try {
        if (typeof context?.substituteParams === 'function') {
            const resolved = String(context.substituteParams(macro) || '').trim();
            if (resolved && resolved !== macro) {
                return resolved;
            }
        }
    } catch (_error) {
        // Ignore macro resolution failures and fall back to empty.
    }

    return '';
}

function normalizeKnownNameEntry(value, index) {
    const entry = value && typeof value === 'object' ? value : {};
    const actor = normalizeActorRef(entry.actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const key = String(entry.key || getActorKnowledgeKey(actor) || `known-name-${index + 1}`).trim();
    return {
        key,
        actor,
        source: String(entry.source || 'manual').trim().toLowerCase() || 'manual',
        learnedAt: normalizeTransferredAt(entry.learnedAt),
    };
}

function normalizeNameKnowledgeState(value) {
    const knowledge = value && typeof value === 'object' ? value : {};
    const knownRaw = Array.isArray(knowledge.known) ? knowledge.known : [];
    const seen = new Set();
    const known = [];

    for (let index = 0; index < knownRaw.length; index += 1) {
        const entry = normalizeKnownNameEntry(knownRaw[index], index);
        if (!entry.key || seen.has(entry.key)) {
            continue;
        }

        seen.add(entry.key);
        known.push(entry);
    }

    return {
        known,
    };
}

function normalizeShinigamiLinkState(value) {
    const defaults = createDefaultShinigamiLinkState();
    const link = value && typeof value === 'object' ? value : {};
    const actor = normalizeActorRef(link.actor, defaults.actor.type, defaults.actor.name);
    const avatar = String(link.avatar || actor.id || '').trim();
    return {
        active: Boolean(link.active) && Boolean(actor.name || avatar),
        actor: {
            ...actor,
            id: String(actor.id || avatar).trim(),
        },
        avatar,
        notebookItemId: String(link.notebookItemId || defaults.notebookItemId).trim() || defaults.notebookItemId,
        linkedAt: normalizeTransferredAt(link.linkedAt),
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

function hashNameSeed(value) {
    const source = String(value || '');
    let hash = 0;
    for (let index = 0; index < source.length; index += 1) {
        hash = ((hash * 31) + source.charCodeAt(index)) >>> 0;
    }

    return hash >>> 0;
}

function scrambleCharacterName(name, seedValue) {
    const source = String(name || '').trim();
    if (!source) {
        return 'Unknown person';
    }

    let result = '';

    for (let index = 0; index < source.length; index += 1) {
        const char = source.charAt(index);
        const code = source.charCodeAt(index);
        const isUpper = code >= 65 && code <= 90; // A-Z
        const isLower = code >= 97 && code <= 122; // a-z

        if (isUpper || isLower) {
            result += '█'; // Replace alphabetic characters with a block
        } else {
            result += char; // Keep non-alphabetic characters (spaces, hyphens, etc.)
        }
    }

    return result || 'Unknown person';
}

function actorRefsMatch(left, right) {
    return left.type === right.type
        && left.id === right.id
        && left.name === right.name;
}

function getCharacterRosterActors() {
    const context = getContext();
    const characters = context && Array.isArray(context.characters) ? context.characters : [];
    const roster = [];
    const seen = new Set();

    for (let index = 0; index < characters.length; index += 1) {
        const character = characters[index];
        const actor = normalizeActorRef({
            type: NOTEBOOK_ACTOR_TYPES.CHARACTER,
            id: character && character.avatar ? character.avatar : '',
            name: character && character.name ? character.name : '',
        }, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
        const key = getActorKnowledgeKey(actor);
        if (!key || seen.has(key)) {
            continue;
        }

        seen.add(key);
        roster.push(actor);
    }

    return roster;
}

function getCurrentChatActorByName(name) {
    const search = normalizeKnowledgeKey(name);
    if (!search) {
        return null;
    }

    const roster = collectCurrentChatActors();
    return roster.find((actor) => normalizeKnowledgeKey(actor.name) === search) || null;
}

function getMessageForceAvatarFile(message) {
    const raw = String(message && message.force_avatar ? message.force_avatar : '').trim();
    if (!raw) {
        return '';
    }

    try {
        const url = new URL(raw, globalThis.window && globalThis.window.location ? globalThis.window.location.origin : 'http://localhost');
        return String(url.searchParams.get('file') || '').trim();
    } catch (_error) {
        return '';
    }
}

function matchRosterActor(roster, identity) {
    const search = normalizeKnowledgeKey(identity);
    if (!search) {
        return null;
    }

    return roster.find((actor) => {
        const actorName = normalizeKnowledgeKey(actor && actor.name ? actor.name : '');
        const actorId = normalizeKnowledgeKey(actor && actor.id ? actor.id : '');
        return actorName === search || actorId === search;
    }) || null;
}

function collectCurrentChatActors() {
    const context = getContext();
    const roster = getCharacterRosterActors();
    const collected = [];
    const seen = new Set();

    const pushActor = (actor) => {
        const normalized = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
        const key = getActorIdentityKey(normalized);
        if (!key || seen.has(key) || (!normalized.name && !normalized.id)) {
            return;
        }

        seen.add(key);
        collected.push(normalized);
    };

    const activeCharacter = resolveContextMacro('char');
    const activeMatch = matchRosterActor(roster, activeCharacter);
    if (activeMatch) {
        pushActor(activeMatch);
    }

    const groupId = context && context.groupId != null ? String(context.groupId) : '';
    const groups = context && Array.isArray(context.groups) ? context.groups : [];
    const activeGroup = groups.find((group) => String(group && group.id != null ? group.id : '') === groupId);
    const groupMembers = activeGroup && Array.isArray(activeGroup.members) ? activeGroup.members : [];
    for (const member of groupMembers) {
        if (typeof member === 'string') {
            const match = matchRosterActor(roster, member);
            if (match) {
                pushActor(match);
            }
            continue;
        }

        const candidate = member && typeof member === 'object' ? member : {};
        const match = matchRosterActor(roster, candidate.avatar || candidate.id || candidate.name || '');
        if (match) {
            pushActor(match);
            continue;
        }

        pushActor({
            type: NOTEBOOK_ACTOR_TYPES.CHARACTER,
            id: String(candidate.avatar || candidate.id || '').trim(),
            name: String(candidate.name || '').trim(),
        });
    }

    const chat = context && Array.isArray(context.chat) ? context.chat : [];
    for (const message of chat) {
        if (!message || message.is_user || message.is_system) {
            continue;
        }

        const searches = [
            String(message.original_avatar || '').trim(),
            getMessageForceAvatarFile(message),
            String(message.name || '').trim(),
        ];

        let matched = null;
        for (const search of searches) {
            matched = matchRosterActor(roster, search);
            if (matched) {
                pushActor(matched);
                break;
            }
        }

        if (matched) {
            continue;
        }

        pushActor({
            type: NOTEBOOK_ACTOR_TYPES.CHARACTER,
            id: String(message.original_avatar || getMessageForceAvatarFile(message) || '').trim(),
            name: String(message.name || '').trim(),
        });
    }

    return collected;
}

function buildFlexibleNamePattern(name) {
    return escapeRegExp(String(name || '').trim()).replace(/\s+/g, '\\s+');
}

function getExplicitSelfIntroductionReason(message, actor) {
    const name = String(actor && actor.name ? actor.name : '').trim();
    if (!name) {
        return '';
    }

    const quotedSections = getQuotedDialogueSections(message && message.mes ? message.mes : '');
    if (!quotedSections.length) {
        return '';
    }

    const namePattern = buildFlexibleNamePattern(name);
    for (const section of quotedSections) {
        if (new RegExp(`\\b${namePattern}\\b`, 'i').test(section)) {
            return 'quoted_display_name';
        }
    }

    return '';
}

function getQuotedDialogueSections(text) {
    const body = String(text || '').trim();
    if (!body) {
        return [];
    }

    const sections = [];
    const pattern = /"([^"\n]+)"|“([^”\n]+)”/g;
    let match = pattern.exec(body);
    while (match) {
        const section = String(match[1] || match[2] || '').trim();
        if (section) {
            sections.push(section);
        }
        match = pattern.exec(body);
    }

    return sections;
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

function normalizeInventoryIdCard(value, index) {
    const entry = value && typeof value === 'object' ? value : {};
    const actor = normalizeActorRef(entry.actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const fallbackLabel = actor.name ? `${actor.name} ID` : `ID Card ${index + 1}`;
    return {
        id: String(entry.id || `death-note-id-${index + 1}`).trim() || `death-note-id-${index + 1}`,
        kind: 'id_card',
        label: String(entry.label || fallbackLabel).trim() || fallbackLabel,
        actor,
        createdAt: normalizeTransferredAt(entry.createdAt),
        updatedAt: normalizeTransferredAt(entry.updatedAt),
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

function normalizeIdentityTheftCooldown(value, index) {
    const entry = value && typeof value === 'object' ? value : {};
    const actor = normalizeActorRef(entry.actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const key = String(entry.key || getActorKnowledgeKey(actor) || `identity-theft-cooldown-${index + 1}`).trim();
    return {
        key,
        actor,
        availableAt: normalizeTransferredAt(entry.availableAt),
    };
}

function normalizeIdentityTheftPendingExposure(value) {
    const defaults = createDefaultIdentityTheftState().pendingExposure;
    const entry = value && typeof value === 'object' ? value : {};
    const actor = normalizeActorRef(entry.actor, defaults.actor.type, defaults.actor.name);
    const createdAt = normalizeTransferredAt(entry.createdAt);
    return {
        active: Boolean(entry.active) && Boolean(getActorKnowledgeKey(actor)),
        actor,
        createdAt,
    };
}

function normalizeIdentityTheftState(value) {
    const state = value && typeof value === 'object' ? value : {};
    const seen = new Set();
    const now = Date.now();
    const cooldownsRaw = Array.isArray(state.cooldowns) ? state.cooldowns : [];
    const cooldowns = [];

    for (let index = 0; index < cooldownsRaw.length; index += 1) {
        const entry = normalizeIdentityTheftCooldown(cooldownsRaw[index], index);
        if (!entry.key || seen.has(entry.key) || entry.availableAt === null || entry.availableAt <= now) {
            continue;
        }

        seen.add(entry.key);
        cooldowns.push(entry);
    }

    return {
        cooldowns,
        pendingExposure: normalizeIdentityTheftPendingExposure(state.pendingExposure),
    };
}

function normalizeDeathEntrySourceType(value) {
    const sourceType = String(value || '').trim().toLowerCase();
    if (sourceType === 'notebook' || sourceType === 'scrap') {
        return sourceType;
    }

    return 'notebook';
}

function normalizeDeathEntrySourceId(value, fallback = '') {
    return String(value || fallback || '').trim();
}

function normalizeDeathEntryTargetType(value) {
    const targetType = String(value || '').trim().toLowerCase();
    if (targetType === NOTEBOOK_ACTOR_TYPES.CHARACTER || targetType === NOTEBOOK_ACTOR_TYPES.NPC) {
        return targetType;
    }

    return '';
}

function resolveDeathEntryTargetType(targetName) {
    const name = String(targetName || '').trim();
    if (!name) {
        return '';
    }

    return getCurrentChatActorByName(name) ? NOTEBOOK_ACTOR_TYPES.CHARACTER : NOTEBOOK_ACTOR_TYPES.NPC;
}

function getDeathEntrySourceKey(sourceType, sourceId, noteText) {
    return [
        normalizeDeathEntrySourceType(sourceType),
        normalizeDeathEntrySourceId(sourceId),
        String(noteText || '').trim(),
    ].join('::');
}

function getIdentityTheftActorKey(actor) {
    return getActorKnowledgeKey(normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, ''));
}

function findInventoryIdCardByActor(state, actor) {
    const key = getIdentityTheftActorKey(actor);
    if (!key) {
        return null;
    }

    return state.inventory.ids.find((entry) => getIdentityTheftActorKey(entry.actor) === key) || null;
}

function upsertIdentityTheftCooldown(state, actor, availableAt) {
    const key = getIdentityTheftActorKey(actor);
    if (!key) {
        return null;
    }

    const nextAvailableAt = normalizeTransferredAt(availableAt);
    const existing = state.identityTheft.cooldowns.find((entry) => entry.key === key);
    if (existing) {
        existing.actor = cloneActorRef(actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
        existing.availableAt = nextAvailableAt;
        return existing;
    }

    const entry = normalizeIdentityTheftCooldown({
        key,
        actor,
        availableAt: nextAvailableAt,
    }, state.identityTheft.cooldowns.length);
    state.identityTheft.cooldowns.push(entry);
    return entry;
}

function clearIdentityTheftCooldown(state, actor) {
    const key = getIdentityTheftActorKey(actor);
    if (!key) {
        return;
    }

    state.identityTheft.cooldowns = state.identityTheft.cooldowns.filter((entry) => entry.key !== key);
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
        ids: Array.isArray(inventory.ids)
            ? inventory.ids.map((entry, index) => normalizeInventoryIdCard(entry, index))
            : [],
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

function ensureMessageExtraState(message) {
    if (!message || typeof message !== 'object') {
        return null;
    }

    message.extra = message.extra && typeof message.extra === 'object' ? message.extra : {};
    message.extra[MESSAGE_EXTRA_KEY] = message.extra[MESSAGE_EXTRA_KEY] && typeof message.extra[MESSAGE_EXTRA_KEY] === 'object'
        ? message.extra[MESSAGE_EXTRA_KEY]
        : {};
    return message.extra[MESSAGE_EXTRA_KEY];
}

function cleanupMessageExtraState(message) {
    if (!message?.extra || typeof message.extra !== 'object') {
        return;
    }

    if (message.extra[MESSAGE_EXTRA_KEY] && !Object.keys(message.extra[MESSAGE_EXTRA_KEY]).length) {
        delete message.extra[MESSAGE_EXTRA_KEY];
    }

    if (!Object.keys(message.extra).length) {
        delete message.extra;
    }
}

function extractAiNotebookWriteBlocks(text) {
    const source = String(text ?? '');
    if (!source) {
        return {
            blocks: [],
            strippedText: source,
        };
    }

    const tag = escapeRegExp(AI_NOTEBOOK_WRITE_BLOCK_TAG);
    const regex = new RegExp(`(?:<${tag}>|\\[${tag}\\])\\s*([\\s\\S]*?)\\s*(?:<\\/${tag}>|\\[\\/${tag}\\])`, 'gi');
    const blocks = [];
    let match = regex.exec(source);
    while (match) {
        blocks.push({
            rawBlock: String(match[0] || ''),
            body: String(match[1] || ''),
        });
        match = regex.exec(source);
    }

    if (blocks.length) {
        const strippedText = source
            .replace(new RegExp(`\\s*(?:<${tag}>|\\[${tag}\\])\\s*[\\s\\S]*?\\s*(?:<\\/${tag}>|\\[\\/${tag}\\])`, 'gi'), '')
            .replace(/\n{3,}/g, '\n\n')
            .trimEnd();

        return {
            blocks,
            strippedText,
        };
    }

    const unwrappedMatch = source.match(/(?:\r?\n|\n|^)\s*writer\s*:\s*([^\r\n]+?)\s*(?:\r?\n\s*|\s+)entry\s*:\s*(.+?)\s*$/is);
    if (unwrappedMatch) {
        const writer = String(unwrappedMatch[1] || '').trim();
        const entry = String(unwrappedMatch[2] || '').trim();
        const rawBlock = String(unwrappedMatch[0] || '');
        const strippedText = source
            .slice(0, Math.max(0, source.length - rawBlock.length))
            .replace(/\n{3,}/g, '\n\n')
            .trimEnd();

        return {
            blocks: [{
                rawBlock,
                body: `writer: ${writer}\nentry: ${entry}`,
            }],
            strippedText,
        };
    }

    return {
        blocks,
        strippedText: source,
    };
}

function parseAiNotebookWriteBlock(blockBody) {
    const body = String(blockBody ?? '');
    let writer = '';
    let entry = '';

    const inlineMatch = body.match(/writer\s*:\s*(.+?)\s+entry\s*:\s*(.+?)\s*$/is);
    if (inlineMatch) {
        return {
            writer: String(inlineMatch[1] || '').trim(),
            entry: String(inlineMatch[2] || '').trim(),
        };
    }

    const lines = body.split(/\r?\n/);

    for (const line of lines) {
        if (!writer) {
            const writerMatch = line.match(/^\s*writer\s*:\s*(.+?)\s*$/i);
            if (writerMatch) {
                writer = String(writerMatch[1] || '').trim();
                continue;
            }
        }

        if (!entry) {
            const entryMatch = line.match(/^\s*entry\s*:\s*(.+?)\s*$/i);
            if (entryMatch) {
                entry = String(entryMatch[1] || '').trim();
            }
        }
    }

    return {
        writer,
        entry,
    };
}

function canAiHolderWriteNotebook(actor) {
    const normalized = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.NONE, '');
    return Boolean(
        normalized.name
        && (
            normalized.type === NOTEBOOK_ACTOR_TYPES.CHARACTER
            || normalized.type === NOTEBOOK_ACTOR_TYPES.NPC
        )
    );
}

function appendAiNotebookLine(entryLine, actor, options = {}) {
    const state = getChatState();
    syncInventoryWithOwnership(state);
    const line = String(entryLine ?? '').trim();
    // #region debug-point C:append-entry-start
    fetch("http://127.0.0.1:7778/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"ai-note-write",runId:"pre-fix",hypothesisId:"C",location:"deathnote/core.js:appendAiNotebookLine:start",msg:"[DEBUG] appendAiNotebookLine start",data:{line,holder:String(actor?.name||actor?.type||""),pageCount:Array.isArray(state.notebookPages)?state.notebookPages.length:0,pagesPreview:(Array.isArray(state.notebookPages)?state.notebookPages:[]).map((page,index)=>({index,length:String(page||"").length,trimmed:Boolean(String(page||"").trim())})).slice(0,6)},ts:Date.now()})}).catch(()=>{});
    // #endregion
    if (!line) {
        return { applied: false, reason: 'empty_entry' };
    }

    if (!state.hasNotebook || state.inventory?.notebook?.destroyed) {
        return { applied: false, reason: 'notebook_unavailable' };
    }

    const writer = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.NONE, '');
    if (!canAiHolderWriteNotebook(writer)) {
        return { applied: false, reason: 'invalid_holder' };
    }

    if (/[\r\n]/.test(line)) {
        return { applied: false, reason: 'invalid_entry' };
    }

    const pages = normalizeNotebookPages(state.notebookPages, state.notebookText ?? '');
    const nextPages = pages.slice();
    while (nextPages.length > 1 && !String(nextPages[nextPages.length - 1] || '').trim()) {
        nextPages.pop();
    }
    if (!nextPages.length) {
        nextPages.push('');
    }

    const lastIndex = nextPages.length - 1;
    const separator = nextPages[lastIndex] && !nextPages[lastIndex].endsWith('\n') ? '\n' : '';
    nextPages[lastIndex] = `${nextPages[lastIndex]}${separator}${line}`;

    const parsedEntry = parseNotebookLine(line);
    // #region debug-point C:append-entry-target
    fetch("http://127.0.0.1:7778/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"ai-note-write",runId:"pre-fix",hypothesisId:"C",location:"deathnote/core.js:appendAiNotebookLine:target",msg:"[DEBUG] appendAiNotebookLine target page prepared",data:{lastIndex,separatorApplied:Boolean(separator),parsedEntry:Boolean(parsedEntry),targetPageLength:String(nextPages[lastIndex]||"").length,targetPageTail:String(nextPages[lastIndex]||"").slice(-160)},ts:Date.now()})}).catch(()=>{});
    // #endregion
    const changed = setNotebookPages(nextPages);
    // #region debug-point C:append-entry-after-set
    fetch("http://127.0.0.1:7778/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"ai-note-write",runId:"pre-fix",hypothesisId:"C",location:"deathnote/core.js:appendAiNotebookLine:afterSet",msg:"[DEBUG] appendAiNotebookLine after setNotebookPages",data:{changed,pageCount:Array.isArray(state.notebookPages)?state.notebookPages.length:0,pagesPreview:(Array.isArray(state.notebookPages)?state.notebookPages:[]).map((page,index)=>({index,length:String(page||"").length,trimmed:Boolean(String(page||"").trim()),tail:String(page||"").slice(-120)})).slice(0,6)},ts:Date.now()})}).catch(()=>{});
    // #endregion
    if (!changed) {
        return { applied: false, reason: 'no_change' };
    }

    const timestamp = normalizeTransferredAt(options.timestamp) ?? Date.now();
    pushInventoryHistory(state, {
        action: 'write_notebook',
        itemId: state.inventory.notebook.itemId,
        detail: String(options.reason || '').trim() || `${writer.name || writer.type} wrote in the Death Note.`,
        actor: writer,
        target: state.ownership.owner,
        timestamp,
    });

    return {
        applied: true,
        reason: parsedEntry ? 'applied' : 'written_only',
    };
}

function syncAiNotebookWriteMessageVisibility(message, metadata = null) {
    const extra = ensureMessageExtraState(message);
    const aiWrite = metadata || extra?.aiNotebookWrite;
    if (!aiWrite?.processed) {
        return false;
    }

    const rawMessage = String(aiWrite.rawMessage || '');
    const strippedText = String(aiWrite.strippedText || '');
    if (!rawMessage && !strippedText) {
        return false;
    }

    const showBlock = Boolean(getSettings().showAiWriteDebugBlocks);
    const nextText = showBlock ? (rawMessage || String(message.mes ?? '')) : (strippedText || String(message.mes ?? ''));
    // #region debug-point D:visibility-sync
    fetch("http://127.0.0.1:7778/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"ai-note-write",runId:"pre-fix",hypothesisId:"D",location:"deathnote/core.js:syncAiNotebookWriteMessageVisibility",msg:"[DEBUG] syncAiNotebookWriteMessageVisibility",data:{showBlock,currentLength:String(message.mes||"").length,nextLength:String(nextText||"").length,rawLength:rawMessage.length,strippedLength:strippedText.length,hasBracketBlock:rawMessage.includes("[kwNoteWrite]")},ts:Date.now()})}).catch(()=>{});
    // #endregion
    if (String(message.mes ?? '') === nextText) {
        aiWrite.stripped = !showBlock;
        return false;
    }

    message.mes = nextText;
    aiWrite.stripped = !showBlock;
    aiWrite.updatedAt = Date.now();
    return true;
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
    state.entries = state.entries
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
            ...entry,
            targetType: normalizeDeathEntryTargetType(entry.targetType) || resolveDeathEntryTargetType(entry.targetName),
            sourceType: normalizeDeathEntrySourceType(entry.sourceType),
            sourceId: normalizeDeathEntrySourceId(entry.sourceId),
            sourceLineIndex: Number.isFinite(Number(entry.sourceLineIndex)) ? Math.max(0, Math.floor(Number(entry.sourceLineIndex))) : null,
        }));

    if (!Object.hasOwn(state, 'hasNotebook')) {
        state.hasNotebook = true;
    }

    state.ownership = normalizeOwnershipState(state.ownership);
    state.shinigamiLink = normalizeShinigamiLinkState(state.shinigamiLink);
    state.nameKnowledge = normalizeNameKnowledgeState(state.nameKnowledge);
    state.identityTheft = normalizeIdentityTheftState(state.identityTheft);
    state.inventory = normalizeInventoryState(state.inventory, state.ownership, state.hasNotebook);
    if (!state.notebookPresenceReveal || typeof state.notebookPresenceReveal !== 'object') {
        state.notebookPresenceReveal = {
            pending: false,
            openedAt: null,
        };
    } else {
        state.notebookPresenceReveal.pending = Boolean(state.notebookPresenceReveal.pending);
        state.notebookPresenceReveal.openedAt = normalizeTransferredAt(state.notebookPresenceReveal.openedAt);
    }

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

export function markNotebookPresenceRevealPending(timestamp = null) {
    const state = getChatState();
    state.notebookPresenceReveal ??= { pending: false, openedAt: null };
    state.notebookPresenceReveal.pending = true;
    state.notebookPresenceReveal.openedAt = normalizeTransferredAt(timestamp) ?? Date.now();
    return true;
}

export function consumeNotebookPresenceRevealPending() {
    const state = getChatState();
    const pending = Boolean(state?.notebookPresenceReveal?.pending);
    if (!pending) {
        return false;
    }

    state.notebookPresenceReveal.pending = false;
    return true;
}

export function getNotebookOwnership() {
    const state = getChatState();
    state.ownership = normalizeOwnershipState(state.ownership);
    return state.ownership;
}

export function getNameKnowledgeState() {
    const state = getChatState();
    state.nameKnowledge = normalizeNameKnowledgeState(state.nameKnowledge);
    return state.nameKnowledge;
}

export function getLinkedShinigami() {
    const state = getChatState();
    state.shinigamiLink = normalizeShinigamiLinkState(state.shinigamiLink);
    return state.shinigamiLink;
}

export function isActorNameKnown(actor) {
    const normalized = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.NONE, '');
    if (
        normalized.type === NOTEBOOK_ACTOR_TYPES.USER
        || normalized.type === NOTEBOOK_ACTOR_TYPES.NPC
        || normalized.type === NOTEBOOK_ACTOR_TYPES.WORLD
        || normalized.type === NOTEBOOK_ACTOR_TYPES.NONE
    ) {
        return true;
    }

    const key = getActorKnowledgeKey(normalized);
    if (!key) {
        return true;
    }

    const knowledge = getNameKnowledgeState();
    return knowledge.known.some((entry) => entry.key === key);
}

export function getActorDisplayName(actor, fallback = 'Unknown') {
    const normalized = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.NONE, '');
    if (!normalized.name) {
        if (normalized.type === NOTEBOOK_ACTOR_TYPES.USER) {
            return 'User';
        }

        if (normalized.type === NOTEBOOK_ACTOR_TYPES.WORLD) {
            return 'World';
        }

        return fallback;
    }

    if (isActorNameKnown(normalized)) {
        return normalized.name;
    }

    return scrambleCharacterName(normalized.name, normalized.id || normalized.name);
}

export function getCharacterNameDirectory() {
    const roster = collectCurrentChatActors();
    return roster.map((actor) => {
        return {
            actor,
            key: getActorKnowledgeKey(actor),
            known: isActorNameKnown(actor),
            displayName: getActorDisplayName(actor, 'Unknown character'),
            trueName: String(actor.name || '').trim(),
        };
    });
}

export function getCurrentChatCharacterActors() {
    return collectCurrentChatActors();
}

export function getActorByTrueName(name) {
    const match = getCurrentChatActorByName(name);
    if (match) {
        return match;
    }

    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
        return null;
    }

    return normalizeActorRef({
        type: NOTEBOOK_ACTOR_TYPES.NPC,
        id: '',
        name: normalizedName,
    }, NOTEBOOK_ACTOR_TYPES.NPC, normalizedName);
}

export function getCharacterActorForMessage(message) {
    if (!message || message.is_user || message.is_system) {
        return null;
    }

    const roster = collectCurrentChatActors();
    const searches = [
        String(message.original_avatar || '').trim(),
        getMessageForceAvatarFile(message),
        String(message.name || '').trim(),
    ];

    for (const search of searches) {
        const match = matchRosterActor(roster, search);
        if (match) {
            return match;
        }
    }

    const fallback = normalizeActorRef({
        type: NOTEBOOK_ACTOR_TYPES.CHARACTER,
        id: String(message.original_avatar || getMessageForceAvatarFile(message) || '').trim(),
        name: String(message.name || '').trim(),
    }, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    return fallback.name || fallback.id ? fallback : null;
}

export function learnCharacterName(actor, options = {}) {
    const state = getChatState();
    const normalized = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const key = getActorKnowledgeKey(normalized);
    if (!key) {
        return false;
    }

    const existing = state.nameKnowledge.known.find((entry) => entry.key === key);
    if (existing) {
        const nextLearnedAt = normalizeTransferredAt(options.timestamp);
        existing.learnedAt = nextLearnedAt === null
            ? (existing.learnedAt === null ? Date.now() : existing.learnedAt)
            : nextLearnedAt;
        return false;
    }

    const learnedAt = normalizeTransferredAt(options.timestamp);
    const timestamp = learnedAt === null ? Date.now() : learnedAt;

    state.nameKnowledge.known.push(normalizeKnownNameEntry({
        key,
        actor: normalized,
        source: options.source || 'manual',
        learnedAt: timestamp,
    }, state.nameKnowledge.known.length));

    pushInventoryHistory(state, {
        action: 'learn_name',
        itemId: key,
        detail: String(options.reason || '').trim() || `${normalized.name || 'A character'}'s true name was learned.`,
        actor: normalized,
        target: state.ownership.holder,
        timestamp,
    });
    return true;
}

export function forgetCharacterName(actor, options = {}) {
    const state = getChatState();
    const normalized = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const key = getActorKnowledgeKey(normalized);
    if (!key) {
        return false;
    }

    const before = state.nameKnowledge.known.length;
    state.nameKnowledge.known = state.nameKnowledge.known.filter((entry) => entry.key !== key);
    if (state.nameKnowledge.known.length === before) {
        return false;
    }

    pushInventoryHistory(state, {
        action: 'forget_name',
        itemId: key,
        detail: String(options.reason || '').trim() || `${normalized.name || 'A character'}'s name was hidden again.`,
        actor: normalized,
        target: state.ownership.holder,
        timestamp: (() => {
            const value = normalizeTransferredAt(options.timestamp);
            return value === null ? Date.now() : value;
        })(),
    });
    return true;
}

export function autoLearnCharacterNameFromMessage(messageIndex, options = {}) {
    const context = getContext();
    const chat = context && Array.isArray(context.chat) ? context.chat : [];
    const index = Number(messageIndex);
    if (!Number.isInteger(index) || index < 0 || index >= chat.length) {
        return false;
    }

    const message = chat[index];
    const actor = getCharacterActorForMessage(message);
    if (!actor || isActorNameKnown(actor)) {
        return false;
    }

    const reason = getExplicitSelfIntroductionReason(message, actor);
    if (!reason) {
        return false;
    }

    return learnCharacterName(actor, {
        source: 'auto',
        timestamp: options.timestamp,
        reason: `${actor.name || 'Character'} said their displayed name in quoted dialogue.`,
    });
}

export function autoLearnQuotedCharacterNamesFromMessage(messageIndex, options = {}) {
    const context = getContext();
    const chat = context && Array.isArray(context.chat) ? context.chat : [];
    const index = Number(messageIndex);
    if (!Number.isInteger(index) || index < 0 || index >= chat.length) {
        return false;
    }

    const message = chat[index];
    const speaker = getCharacterActorForMessage(message);
    if (!speaker) {
        return false;
    }

    const quotedSections = getQuotedDialogueSections(message?.mes);
    if (!quotedSections.length) {
        return false;
    }

    const speakerKey = getActorKnowledgeKey(speaker);
    let learnedAny = false;
    const directory = getCharacterNameDirectory();
    for (const entry of directory) {
        if (!entry || entry.known || !entry.trueName) {
            continue;
        }

        if (entry.key && speakerKey && entry.key === speakerKey) {
            continue;
        }

        const namePattern = new RegExp(`\\b${buildFlexibleNamePattern(entry.trueName)}\\b`, 'i');
        if (!quotedSections.some((section) => namePattern.test(section))) {
            continue;
        }

        const learned = learnCharacterName(entry.actor, {
            source: 'quoted_confession',
            timestamp: options.timestamp,
            reason: `${speaker.name || 'A character'} explicitly said ${entry.trueName} in quoted dialogue.`,
        });
        learnedAny = learned || learnedAny;
    }

    return learnedAny;
}

export function getIdentityStealAttemptState(actor) {
    const state = getChatState();
    const normalized = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const key = getIdentityTheftActorKey(normalized);
    const existingId = findInventoryIdCardByActor(state, normalized);
    const cooldown = state.identityTheft.cooldowns.find((entry) => entry.key === key) || null;
    const now = Date.now();
    const cooldownUntil = cooldown && cooldown.availableAt && cooldown.availableAt > now ? cooldown.availableAt : null;
    return {
        key,
        hasId: Boolean(existingId),
        idItem: existingId,
        cooldownUntil,
        onCooldown: Boolean(cooldownUntil),
        canAttempt: Boolean(key) && !existingId && !cooldownUntil,
    };
}

export function getIdentityStealSuccessChance(actor) {
    const settings = getSettings();
    const normalized = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const key = getIdentityTheftActorKey(normalized);
    const overrides = settings && settings.idStealSuccessChanceOverrides && typeof settings.idStealSuccessChanceOverrides === 'object'
        ? settings.idStealSuccessChanceOverrides
        : {};
    const overrideRaw = key && Object.hasOwn(overrides, key) ? Number(overrides[key]) : NaN;
    const defaultRaw = Number(settings.idStealSuccessChancePercent);
    const resolved = Number.isFinite(overrideRaw)
        ? overrideRaw
        : (Number.isFinite(defaultRaw) ? defaultRaw : 75);
    return Math.min(100, Math.max(0, Math.round(resolved)));
}

export function attemptStealCharacterId(actor, options = {}) {
    const state = getChatState();
    const target = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const targetKey = getIdentityTheftActorKey(target);
    if (!targetKey || target.type !== NOTEBOOK_ACTOR_TYPES.CHARACTER) {
        return { changed: false, success: false, reason: 'invalid_target' };
    }

    const currentState = getIdentityStealAttemptState(target);
    if (currentState.hasId) {
        return {
            changed: false,
            success: false,
            reason: 'already_owned',
            idItem: currentState.idItem,
        };
    }

    if (currentState.onCooldown) {
        return {
            changed: false,
            success: false,
            reason: 'cooldown',
            cooldownUntil: currentState.cooldownUntil,
        };
    }

    const timestamp = normalizeTransferredAt(options.timestamp) ?? Date.now();
    const userActor = normalizeActorRef(options.actor, NOTEBOOK_ACTOR_TYPES.USER, 'User');
    const successChancePercent = getIdentityStealSuccessChance(target);
    if (Math.random() >= (successChancePercent / 100)) {
        const cooldownUntil = timestamp + ID_THEFT_COOLDOWN_MS;
        upsertIdentityTheftCooldown(state, target, cooldownUntil);
        state.identityTheft.pendingExposure = normalizeIdentityTheftPendingExposure({
            active: true,
            actor: target,
            createdAt: timestamp,
        });
        pushInventoryHistory(state, {
            action: 'steal_id_failed',
            itemId: targetKey,
            detail: String(options.failureReason || '').trim() || `${userActor.name || 'User'} failed to steal ${target.name || 'that character'}'s ID.`,
            actor: userActor,
            target,
            timestamp,
        });
        return {
            changed: true,
            success: false,
            reason: 'failed',
            cooldownUntil,
        };
    }

    const idItem = normalizeInventoryIdCard({
        id: `death-note-id-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`,
        label: `${target.name || 'Unknown'} ID`,
        actor: target,
        createdAt: timestamp,
        updatedAt: timestamp,
    }, state.inventory.ids.length);
    state.inventory.ids.push(idItem);
    clearIdentityTheftCooldown(state, target);
    state.identityTheft.pendingExposure = normalizeIdentityTheftPendingExposure(null);
    const learned = learnCharacterName(target, {
        source: 'stolen_id',
        timestamp,
        reason: `${target.name || 'Character'}'s ID was stolen.`,
    });
    pushInventoryHistory(state, {
        action: 'steal_id_success',
        itemId: idItem.id,
        detail: String(options.successReason || '').trim() || `${userActor.name || 'User'} successfully stole ${target.name || 'that character'}'s ID.`,
        actor: userActor,
        target,
        timestamp,
    });
    return {
        changed: true,
        success: true,
        reason: 'success',
        learned,
        idItem,
    };
}

export function getPendingIdentityTheftExposure() {
    const state = getChatState();
    return normalizeIdentityTheftPendingExposure(state.identityTheft?.pendingExposure);
}

export function consumePendingIdentityTheftExposureForMessage(messageIndex) {
    const context = getContext();
    const chat = context && Array.isArray(context.chat) ? context.chat : [];
    const index = Number(messageIndex);
    if (!Number.isInteger(index) || index < 0 || index >= chat.length) {
        return false;
    }

    const state = getChatState();
    const pending = normalizeIdentityTheftPendingExposure(state.identityTheft?.pendingExposure);
    if (!pending.active) {
        return false;
    }

    const actor = getCharacterActorForMessage(chat[index]);
    if (!actor || getIdentityTheftActorKey(actor) !== getIdentityTheftActorKey(pending.actor)) {
        return false;
    }

    state.identityTheft.pendingExposure = normalizeIdentityTheftPendingExposure(null);
    return true;
}

export function getDeathNoteInventory() {
    const state = getChatState();
    state.inventory = normalizeInventoryState(state.inventory, state.ownership, state.hasNotebook);
    syncInventoryWithOwnership(state);
    return state.inventory;
}

export function linkNotebookShinigami(actor, options = {}) {
    const state = getChatState();
    const normalizedActor = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.SHINIGAMI, '');
    const avatar = String(options.avatar || normalizedActor.id || '').trim();
    const name = String(options.name || normalizedActor.name || '').trim();
    if (!name && !avatar) {
        return false;
    }

    state.shinigamiLink = normalizeShinigamiLinkState({
        active: true,
        actor: {
            ...normalizedActor,
            type: NOTEBOOK_ACTOR_TYPES.SHINIGAMI,
            id: avatar || normalizedActor.id,
            name,
        },
        avatar,
        notebookItemId: String(options.notebookItemId || state.inventory.notebook.itemId || 'death-note-main').trim(),
        linkedAt: (() => {
            const value = normalizeTransferredAt(options.linkedAt);
            return value === null ? Date.now() : value;
        })(),
    });

    if (isUserActor(state.ownership.owner)) {
        learnCharacterName(state.shinigamiLink.actor, {
            source: 'linked_shinigami',
            timestamp: state.shinigamiLink.linkedAt,
            reason: `${state.shinigamiLink.actor.name || 'The linked Shinigami'} became known when linked to the user's Death Note.`,
        });
    }

    pushInventoryHistory(state, {
        action: 'link_shinigami',
        itemId: state.shinigamiLink.notebookItemId,
        detail: String(options.reason || '').trim() || `${state.shinigamiLink.actor.name || 'Shinigami'} linked to the notebook.`,
        actor: state.shinigamiLink.actor,
        target: state.ownership.holder,
        timestamp: state.shinigamiLink.linkedAt || Date.now(),
    });
    return true;
}

export function unlinkNotebookShinigami(options = {}) {
    const state = getChatState();
    const current = normalizeShinigamiLinkState(state.shinigamiLink);
    if (!current.active && !current.actor.name && !current.avatar) {
        return false;
    }

    state.shinigamiLink = createDefaultShinigamiLinkState();
    pushInventoryHistory(state, {
        action: 'unlink_shinigami',
        itemId: current.notebookItemId,
        detail: String(options.reason || '').trim() || `${current.actor.name || 'Linked Shinigami'} unlinked from the notebook.`,
        actor: current.actor,
        target: state.ownership.holder,
        timestamp: (() => {
            const value = normalizeTransferredAt(options.timestamp);
            return value === null ? Date.now() : value;
        })(),
    });
    return true;
}

export function getNotebookTouchers() {
    const state = getChatState();
    return buildDeathNotePresenceParticipants(state);
}

export function getLinkedShinigamiPresenceBinding() {
    const state = getChatState();
    const shinigamiLink = normalizeShinigamiLinkState(state.shinigamiLink);
    const touchers = buildDeathNotePresenceParticipants(state);
    const visibleActors = touchers
        .map((entry) => entry?.actor)
        .filter((actor) => actor && (actor.type === NOTEBOOK_ACTOR_TYPES.CHARACTER || actor.type === NOTEBOOK_ACTOR_TYPES.SHINIGAMI));

    return {
        linked: Boolean(shinigamiLink.active && (shinigamiLink.avatar || shinigamiLink.actor.name)),
        shinigami: shinigamiLink,
        visibleActors,
        touchers,
    };
}

export function getDeathNoteMemoryAudienceActors() {
    const state = getChatState();
    return buildDeathNotePresenceParticipants(state)
        .map((entry) => entry && entry.actor ? entry.actor : null)
        .filter((actor) => {
            return actor
                && (
                    actor.type === NOTEBOOK_ACTOR_TYPES.CHARACTER
                    || actor.type === NOTEBOOK_ACTOR_TYPES.SHINIGAMI
                );
        });
}

export function isDeathNoteMemoryMessage(message) {
    const extra = message && message.extra ? message.extra[MESSAGE_EXTRA_KEY] : null;
    return Boolean(extra && extra.memoryTracked && extra.memoryTracked.tracked);
}

function isMessageAuthoredByLinkedShinigami(message, shinigamiLink) {
    if (!message || !shinigamiLink || !shinigamiLink.active) {
        return false;
    }

    const messageName = normalizeKnowledgeKey(message.name);
    const linkName = normalizeKnowledgeKey(shinigamiLink.actor && shinigamiLink.actor.name);
    const linkAvatar = normalizeKnowledgeKey(shinigamiLink.avatar || (shinigamiLink.actor && shinigamiLink.actor.id));

    if (!messageName) {
        return false;
    }

    return Boolean(
        (linkName && messageName === linkName)
        || (linkAvatar && messageName === linkAvatar)
    );
}

function getAutoTrackKeywordMatch(text) {
    const source = String(text || '').trim();
    if (!source) {
        return '';
    }

    const patterns = [
        { reason: 'death_note_keyword', regex: /\bdeath\s+note\b/i },
        { reason: 'shinigami_keyword', regex: /\bshinigami\b/i },
        { reason: 'notebook_contact_keyword', regex: /\b(?:touched?|holding|held|picked up|grasped|took)\b[\s\S]{0,40}\b(?:notebook|death note|scrap|page)\b/i },
        { reason: 'scrap_keyword', regex: /\b(?:scrap|torn page|page scrap)\b/i },
    ];

    for (const pattern of patterns) {
        if (pattern.regex.test(source)) {
            return pattern.reason;
        }
    }

    return '';
}

export function getAutoTrackDeathNoteMemoryReason(messageIndex, options = {}) {
    const context = getContext();
    const chat = context && Array.isArray(context.chat) ? context.chat : [];
    const index = Number(messageIndex);
    if (!Number.isInteger(index) || index < 0 || index >= chat.length) {
        return '';
    }

    const message = chat[index];
    if (!message || message.is_system || isDeathNoteMemoryMessage(message)) {
        return '';
    }

    const state = getChatState();
    const resolvedEntries = Array.isArray(options.resolvedEntries) ? options.resolvedEntries : [];
    if (resolvedEntries.length > 0) {
        return 'resolved_entry';
    }

    if (isMessageAuthoredByLinkedShinigami(message, state.shinigamiLink)) {
        return 'linked_shinigami';
    }

    return getAutoTrackKeywordMatch(message.mes);
}

export function setDeathNoteMemoryTracked(messageIndex, tracked = true, options = {}) {
    const context = getContext();
    const chat = context && Array.isArray(context.chat) ? context.chat : [];
    const index = Number(messageIndex);
    if (!Number.isInteger(index) || index < 0 || index >= chat.length) {
        return false;
    }

    const message = chat[index];
    if (!message || message.is_system) {
        return false;
    }

    ensureMessageExtraState(message);

    if (tracked) {
        const timestamp = normalizeTransferredAt(options.timestamp);
        message.extra[MESSAGE_EXTRA_KEY].memoryTracked = {
            tracked: true,
            source: String(options.source || 'manual').trim().toLowerCase() || 'manual',
            reason: String(options.reason || '').trim().toLowerCase(),
            updatedAt: timestamp === null ? Date.now() : timestamp,
        };
        return true;
    }

    if (!message.extra[MESSAGE_EXTRA_KEY].memoryTracked) {
        return false;
    }

    delete message.extra[MESSAGE_EXTRA_KEY].memoryTracked;
    cleanupMessageExtraState(message);

    return true;
}

export function processAssistantNotebookWriteMessage(messageIndex) {
    const context = getContext();
    const chat = context && Array.isArray(context.chat) ? context.chat : [];
    const index = Number(messageIndex);
    if (!Number.isInteger(index) || index < 0 || index >= chat.length) {
        return false;
    }

    const message = chat[index];
    if (!message || message.is_system) {
        return false;
    }

    const extra = ensureMessageExtraState(message);
    if (extra?.aiNotebookWrite?.processed) {
        return syncAiNotebookWriteMessageVisibility(message, extra.aiNotebookWrite);
    }

    const rawText = String(message.mes ?? '');
    // #region debug-point A:process-start
    fetch("http://127.0.0.1:7778/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"ai-note-write",runId:"pre-fix",hypothesisId:"A",location:"deathnote/core.js:processAssistantNotebookWriteMessage:start",msg:"[DEBUG] processAssistantNotebookWriteMessage start",data:{messageIndex,showDebug:Boolean(getSettings().showAiWriteDebugBlocks),messageLength:rawText.length,hasBracketBlock:rawText.includes("[kwNoteWrite]"),hasAngleBlock:rawText.includes("<kwNoteWrite>"),tail:rawText.slice(-220)},ts:Date.now()})}).catch(()=>{});
    // #endregion
    const extracted = extractAiNotebookWriteBlocks(rawText);
    // #region debug-point B:extraction
    fetch("http://127.0.0.1:7778/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"ai-note-write",runId:"pre-fix",hypothesisId:"B",location:"deathnote/core.js:processAssistantNotebookWriteMessage:extracted",msg:"[DEBUG] AI write block extraction result",data:{blockCount:extracted.blocks.length,strippedLength:String(extracted.strippedText||"").length,rawBlock:String(extracted.blocks[0]?.rawBlock||""),body:String(extracted.blocks[0]?.body||"")},ts:Date.now()})}).catch(()=>{});
    // #endregion
    if (!extracted.blocks.length) {
        cleanupMessageExtraState(message);
        return false;
    }

    const settings = getSettings();
    const state = getChatState();
    syncInventoryWithOwnership(state);
    const timestamp = Date.now();
    const metadata = {
        processed: true,
        rawMessage: rawText,
        strippedText: extracted.strippedText,
        rawBlock: extracted.blocks[0].rawBlock,
        blockCount: extracted.blocks.length,
        writer: '',
        entry: '',
        applied: false,
        reason: '',
        stripped: !settings.showAiWriteDebugBlocks,
        updatedAt: timestamp,
    };

    const holder = normalizeActorRef(state.ownership?.holder, NOTEBOOK_ACTOR_TYPES.NONE, '');
    if (!state.hasNotebook || state.inventory?.notebook?.destroyed) {
        metadata.reason = 'notebook_unavailable';
    } else if (!canAiHolderWriteNotebook(holder)) {
        metadata.reason = 'invalid_holder';
    } else {
        const parsed = parseAiNotebookWriteBlock(extracted.blocks[0].body);
        metadata.writer = parsed.writer;
        metadata.entry = parsed.entry;
        // #region debug-point B:parsed
        fetch("http://127.0.0.1:7778/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"ai-note-write",runId:"pre-fix",hypothesisId:"B",location:"deathnote/core.js:processAssistantNotebookWriteMessage:parsed",msg:"[DEBUG] AI write block parsed",data:{holder:String(holder?.name||holder?.type||""),writer:parsed.writer,entry:parsed.entry},ts:Date.now()})}).catch(()=>{});
        // #endregion

        if (!parsed.writer || !parsed.entry) {
            metadata.reason = 'missing_fields';
        } else if (normalizeKnowledgeKey(parsed.writer) !== normalizeKnowledgeKey(holder.name)) {
            metadata.reason = 'writer_mismatch';
        } else {
            const appended = appendAiNotebookLine(parsed.entry, holder, {
                timestamp,
                reason: `${holder.name || holder.type} wrote "${parsed.entry}" during an assistant reply.`,
            });
            metadata.applied = appended.applied;
            metadata.reason = appended.reason;
        }
    }

    extra.aiNotebookWrite = metadata;
    const visibilityChanged = syncAiNotebookWriteMessageVisibility(message, metadata);
    return visibilityChanged || metadata.applied;
}

export function syncAllAiNotebookWriteMessageVisibility() {
    const context = getContext();
    const chat = context && Array.isArray(context.chat) ? context.chat : [];
    let changed = false;
    for (const message of chat) {
        if (!message || message.is_system) {
            continue;
        }

        if (syncAiNotebookWriteMessageVisibility(message)) {
            changed = true;
        }
    }

    return changed;
}

export function autoTrackDeathNoteMemoryMessage(messageIndex, options = {}) {
    const reason = getAutoTrackDeathNoteMemoryReason(messageIndex, options);
    if (!reason) {
        return false;
    }

    return setDeathNoteMemoryTracked(messageIndex, true, {
        source: 'auto',
        reason,
        timestamp: options.timestamp,
    });
}

export function getTrackedDeathNoteMemories(limit = 12) {
    const context = getContext();
    const chat = context && Array.isArray(context.chat) ? context.chat : [];
    const entries = [];
    for (let index = 0; index < chat.length; index += 1) {
        const message = chat[index];
        if (!isDeathNoteMemoryMessage(message)) {
            continue;
        }

        entries.push({
            index,
            name: String(message && message.name ? message.name : '').trim() || (message && message.is_user ? 'User' : 'Message'),
            body: String(message && message.mes ? message.mes : '').trim(),
        });
    }

    const max = Math.max(0, Number(limit) || 0);
    return max ? entries.slice(-max) : entries;
}

export function getRecentChatMemoryCandidates(limit = 12) {
    const context = getContext();
    const chat = context && Array.isArray(context.chat) ? context.chat : [];
    const entries = [];
    for (let index = 0; index < chat.length; index += 1) {
        const message = chat[index];
        if (!message || message.is_system) {
            continue;
        }

        entries.push({
            index,
            name: String(message && message.name ? message.name : '').trim() || (message && message.is_user ? 'User' : 'Message'),
            body: String(message && message.mes ? message.mes : '').trim(),
            tracked: isDeathNoteMemoryMessage(message),
        });
    }

    const max = Math.max(0, Number(limit) || 0);
    return max ? entries.slice(-max).reverse() : entries.reverse();
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
    sourceType = 'notebook',
    sourceId = '',
    sourceLineIndex = null,
} = {}) {
    const state = getChatState();

    const entry = {
        id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        targetName: String(targetName || '').trim(),
        targetType: '',
        cause: String(cause || '').trim(),
        noteText: String(noteText || '').trim(),
        remainingAssistantMessages: normalizeRemaining(remainingAssistantMessages),
        hasExplicitCause: Boolean(hasExplicitCause),
        hasExplicitTime: Boolean(hasExplicitTime),
        sourceType: normalizeDeathEntrySourceType(sourceType),
        sourceId: normalizeDeathEntrySourceId(sourceId),
        sourceLineIndex: Number.isFinite(Number(sourceLineIndex)) ? Math.max(0, Math.floor(Number(sourceLineIndex))) : null,
        status: 'active',
        createdAt: Date.now(),
        resolvedAt: null,
    };
    entry.targetType = normalizeDeathEntryTargetType(entry.targetType) || resolveDeathEntryTargetType(entry.targetName);

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

    if (targetName) {
        const settings = getSettings();
        if (settings.requireKnownNamesForKills) {
            const actor = getCurrentChatActorByName(targetName);
            if (actor && !isActorNameKnown(actor)) {
                return null;
            }
        }
    }

    return {
        noteText: raw,
        targetName,
        cause,
        remainingAssistantMessages,
        hasExplicitCause,
        hasExplicitTime,
    };
}

export function sanitizeNotebookPageText(pageText) {
    const source = String(pageText ?? '');
    if (!source) {
        return source;
    }

    return source
        .split('\n')
        .filter((line) => {
            const trimmed = String(line || '').trim();
            if (!trimmed) {
                return true;
            }

            return parseNotebookLine(trimmed) !== null;
        })
        .join('\n');
}

export function sanitizeNotebookPagesForRules(pages) {
    const normalized = normalizeNotebookPages(pages, '');
    return normalized.map((page) => sanitizeNotebookPageText(page));
}

export function sanitizeScrapNoteText(text, maxNames = 2) {
    const source = String(text ?? '');
    if (!source) {
        return '';
    }

    const limitedMax = Number.isFinite(Number(maxNames))
        ? Math.max(0, Math.floor(Number(maxNames)))
        : 2;
    if (limitedMax <= 0) {
        return '';
    }

    const lines = source
        .split(/\r?\n/)
        .slice(0, limitedMax)
        .map((line) => String(line ?? ''));
    return lines.join('\n').trimEnd();
}

function collectActiveDeathNoteSourceLines(state) {
    const notebookLines = normalizeNotebookPages(state.notebookPages, state.notebookText ?? '')
        .flatMap((page, pageIndex) => String(page || '')
            .split('\n')
            .map((line, lineIndex) => ({
                line: String(line || '').trim(),
                sourceType: 'notebook',
                sourceId: `page:${pageIndex}`,
                sourceLineIndex: lineIndex,
            }))
            .filter((entry) => entry.line));
    const scrapLines = Array.isArray(state.inventory?.scraps)
        ? state.inventory.scraps
            .filter((scrap) => scrap?.active)
            .flatMap((scrap) => String(scrap.noteText || '')
                .split('\n')
                .map((line, lineIndex) => ({
                    line: String(line || '').trim(),
                    sourceType: 'scrap',
                    sourceId: `scrap:${scrap.id}`,
                    sourceLineIndex: lineIndex,
                }))
                .filter((entry) => entry.line))
        : [];

    return [...notebookLines, ...scrapLines];
}

function buildLineCounts(lines) {
    const counts = new Map();
    for (const line of lines) {
        const key = getDeathEntrySourceKey(line?.sourceType, line?.sourceId, line?.line);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
}

function isPermanentResolvedEntryEnabledForSourceType(sourceType) {
    const settings = getSettings();
    const normalized = normalizeDeathEntrySourceType(sourceType);
    if (normalized === 'scrap') {
        return Boolean(settings.permanentResolvedScrapEntries);
    }

    return Boolean(settings.permanentResolvedNotebookEntries);
}

function getPermanentResolvedEntriesForSource(sourceType, sourceId) {
    if (!isPermanentResolvedEntryEnabledForSourceType(sourceType)) {
        return [];
    }

    const state = getChatState();
    const normalizedType = normalizeDeathEntrySourceType(sourceType);
    const normalizedId = normalizeDeathEntrySourceId(sourceId);
    return state.entries.filter((entry) => {
        if (!entry) {
            return false;
        }

        if (String(entry.status || '').trim().toLowerCase() !== 'resolved') {
            return false;
        }

        if (normalizeDeathEntrySourceType(entry.sourceType) !== normalizedType) {
            return false;
        }

        return normalizeDeathEntrySourceId(entry.sourceId) === normalizedId && String(entry.noteText || '').trim();
    });
}

function enforcePermanentLinesForSource(text, sourceType, sourceId, maxLines = null) {
    const source = String(text ?? '');
    const lines = source ? source.split(/\r?\n/).map((line) => String(line ?? '')) : [];
    const lockedEntries = getPermanentResolvedEntriesForSource(sourceType, sourceId);
    if (!lockedEntries.length) {
        if (!Number.isFinite(Number(maxLines))) {
            return source;
        }

        const limited = lines.slice(0, Math.max(0, Math.floor(Number(maxLines))));
        return limited.join('\n').trimEnd();
    }

    const lineCounts = new Map();
    for (const line of lines) {
        const key = String(line || '').trim();
        if (!key) {
            continue;
        }

        lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1);
    }

    const missingLockedLines = [];
    const lockedCounts = new Map();
    for (const entry of lockedEntries) {
        const key = String(entry.noteText || '').trim();
        if (!key) {
            continue;
        }

        lockedCounts.set(key, (lockedCounts.get(key) ?? 0) + 1);
    }

    for (const [key, requiredCount] of lockedCounts.entries()) {
        const currentCount = lineCounts.get(key) ?? 0;
        for (let index = currentCount; index < requiredCount; index += 1) {
            missingLockedLines.push(key);
        }
    }

    let nextLines = [...lines, ...missingLockedLines];
    if (Number.isFinite(Number(maxLines))) {
        const limit = Math.max(0, Math.floor(Number(maxLines)));
        if (missingLockedLines.length >= limit) {
            nextLines = missingLockedLines.slice(0, limit);
        } else {
            nextLines = [...nextLines.slice(0, Math.max(0, limit - missingLockedLines.length)), ...missingLockedLines];
        }
    }

    return nextLines.join('\n').trimEnd();
}

export function enforcePermanentNotebookPages(pages) {
    const normalized = normalizeNotebookPages(pages, '');
    return normalized.map((page, pageIndex) => enforcePermanentLinesForSource(page, 'notebook', `page:${pageIndex}`));
}

export function enforcePermanentScrapText(scrapId, text, maxLines = 2) {
    const sourceId = `scrap:${String(scrapId || '').trim()}`;
    return enforcePermanentLinesForSource(sanitizeScrapNoteText(text, maxLines), 'scrap', sourceId, maxLines);
}

export function getPermanentResolvedLineCounts(sourceType, sourceId) {
    const counts = new Map();
    for (const entry of getPermanentResolvedEntriesForSource(sourceType, sourceId)) {
        const key = String(entry.noteText || '').trim();
        if (!key) {
            continue;
        }

        counts.set(key, (counts.get(key) ?? 0) + 1);
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
    const normalized = enforcePermanentNotebookPages(normalizeNotebookPages(pages, state.notebookText ?? ''));
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

export function updateNotebookScrapText(scrapId, noteText, options = {}) {
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

    const sanitized = enforcePermanentScrapText(id, noteText, 2);
    if (scrap.noteText === sanitized) {
        return false;
    }

    const timestamp = normalizeTransferredAt(options.timestamp) ?? Date.now();
    scrap.noteText = sanitized;
    scrap.updatedAt = timestamp;
    pushInventoryHistory(state, {
        action: 'write_scrap',
        itemId: scrap.id,
        detail: String(options.reason || '').trim() || `${scrap.label} was written on.`,
        actor: scrap.holder,
        target: scrap.owner,
        timestamp,
    });
    reconcileEntriesFromNotebookText();
    return true;
}

export function reconcileEntriesFromNotebookPages() {
    const state = getChatState();
    syncNotebookTextFromPages(state);
    const lines = collectActiveDeathNoteSourceLines(state);

    const counts = buildLineCounts(lines);
    const retained = [];

    for (const entry of state.entries) {
        const key = String(entry?.noteText || '').trim();
        if (!key) {
            continue;
        }

        entry.status = normalizeEntryStatus(entry.status);
        if (entry.status === 'resolved') {
            retained.push(entry);
            continue;
        }

        const available = counts.get(getDeathEntrySourceKey(entry.sourceType, entry.sourceId, key)) ?? 0;
        if (available <= 0) {
            continue;
        }

        counts.set(getDeathEntrySourceKey(entry.sourceType, entry.sourceId, key), available - 1);
        retained.push(entry);
    }

    for (const lineEntry of lines) {
        const key = getDeathEntrySourceKey(lineEntry.sourceType, lineEntry.sourceId, lineEntry.line);
        const available = counts.get(key) ?? 0;
        if (available <= 0) {
            continue;
        }

        const parsed = parseNotebookLine(lineEntry.line);
        if (!parsed) {
            continue;
        }

        const entry = addDeathEntry({
            ...parsed,
            sourceType: lineEntry.sourceType,
            sourceId: lineEntry.sourceId,
            sourceLineIndex: lineEntry.sourceLineIndex,
        });
        if (entry) {
            retained.push(entry);
            counts.set(key, available - 1);
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
