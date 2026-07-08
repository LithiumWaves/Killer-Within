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
        version: 2,
        hasNotebook: true,
        notebookText: '',
        notebookPages: [''],
        entries: [],
        lastAssistantMessageCountedAt: null,
        lastGenerationCountedAt: null,
    };
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

    if (!Object.hasOwn(state, 'notebookText')) {
        state.notebookText = '';
    }

    state.notebookPages = normalizeNotebookPages(state.notebookPages, state.notebookText ?? '');
    syncNotebookTextFromPages(state);

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
    noteText,
} = {}) {
    const state = getChatState();

    const entry = {
        id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        targetName: String(targetName || '').trim(),
        cause: String(cause || '').trim(),
        noteText: String(noteText || '').trim(),
        remainingAssistantMessages: normalizeRemaining(remainingAssistantMessages),
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

function parseNotebookLine(line) {
    const raw = String(line || '').trim();
    if (!raw) {
        return null;
    }

    let remainingAssistantMessages = 1;
    let body = raw;
    const timeMatch = body.match(/\s+(\d+)\s*$/);
    if (timeMatch) {
        remainingAssistantMessages = Math.max(0, Number(timeMatch[1]) || 0);
        body = body.slice(0, Math.max(0, timeMatch.index)).trim();
    }

    return {
        noteText: raw,
        targetName: '',
        cause: body,
        remainingAssistantMessages,
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

