import {
    CHAT_METADATA_KEY,
    DEFAULT_SETTINGS,
    MODULE_NAME,
} from './config.js';

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
        version: 1,
        hasNotebook: true,
        entries: [],
        lastAssistantMessageCountedAt: null,
    };
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

    return state;
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
} = {}) {
    const state = getChatState();

    const entry = {
        id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        targetName: String(targetName || '').trim(),
        cause: String(cause || '').trim(),
        remainingAssistantMessages: normalizeRemaining(remainingAssistantMessages),
        status: 'active',
        createdAt: Date.now(),
        resolvedAt: null,
    };

    if (!entry.targetName) {
        return null;
    }

    state.entries.push(entry);
    return entry;
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

export function tickDeathNoteCountdown() {
    const context = getContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    if (!chat.length) {
        return { ticked: false, triggered: [] };
    }

    const lastMessage = chat[chat.length - 1];
    if (!isAssistantMessage(lastMessage)) {
        return { ticked: false, triggered: [] };
    }

    const state = getChatState();
    const lastDate = Number(lastMessage?.send_date) || null;
    const signature = lastDate ?? chat.length - 1;

    if (state.lastAssistantMessageCountedAt === signature) {
        return { ticked: false, triggered: [] };
    }

    state.lastAssistantMessageCountedAt = signature;

    const triggered = [];
    for (const entry of state.entries) {
        if (!entry || entry.status !== 'active') {
            continue;
        }

        const remaining = normalizeRemaining(entry.remainingAssistantMessages);
        const next = Math.max(0, remaining - 1);
        entry.remainingAssistantMessages = next;

        if (next === 0) {
            entry.status = 'triggered';
            entry.resolvedAt = Date.now();
            triggered.push(entry);
        }
    }

    return { ticked: true, triggered };
}

export function isDebugEnabled() {
    return Boolean(getSettings().debug);
}

