const PRESENCE_EXTENSION_NAME = 'Presence';
const UNIVERSAL_TRACKER_ID = 'presence_universal_tracker';

function normalizeString(value) {
    return String(value || '').trim();
}

function normalizePresenceId(value) {
    return normalizeString(value).replace(/(\.\w+)$/i, '');
}

export function getPresenceContext() {
    return globalThis.SillyTavern?.getContext?.() ?? null;
}

async function persistPresenceChatChanges() {
    const context = getPresenceContext();
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
        }
    } catch (error) {
        console.warn('[killer_within_presence] Failed to persist presence changes', error);
    }
}

export function getPresenceSettings() {
    const context = getPresenceContext();
    const settings = context?.extensionSettings;
    if (!settings || typeof settings !== 'object') {
        return null;
    }

    return settings[PRESENCE_EXTENSION_NAME] || null;
}

export function isPresenceInstalled() {
    return Boolean(getPresenceSettings());
}

export function isPresenceActive() {
    const context = getPresenceContext();
    const settings = getPresenceSettings();
    return Boolean(context && context.groupId != null && settings?.enabled);
}

export function resolvePresenceAvatar(characterNameOrAvatar) {
    const context = getPresenceContext();
    const characters = Array.isArray(context?.characters) ? context.characters : [];
    const search = normalizeString(characterNameOrAvatar);
    if (!search) {
        return '';
    }

    const normalizedSearch = normalizePresenceId(search);
    const match = characters.find((character) => {
        const name = normalizeString(character?.name);
        const avatar = normalizeString(character?.avatar);
        return normalizePresenceId(name) === normalizedSearch || normalizePresenceId(avatar) === normalizedSearch;
    });

    if (match?.avatar) {
        return String(match.avatar);
    }

    return search;
}

export function getMessagePresenceTracker(message) {
    if (!Array.isArray(message?.present)) {
        return [];
    }

    return message.present
        .map((entry) => normalizeString(entry))
        .filter(Boolean);
}

function uniquePresenceEntries(entries) {
    return Array.from(new Set((Array.isArray(entries) ? entries : []).map((entry) => normalizeString(entry)).filter(Boolean)));
}

function normalizeMessageIndexes(messageIndexes, chatLength) {
    if (Array.isArray(messageIndexes)) {
        return messageIndexes
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 0 && value < chatLength);
    }

    if (Number.isInteger(Number(messageIndexes))) {
        const value = Number(messageIndexes);
        return value >= 0 && value < chatLength ? [value] : [];
    }

    return Array.from({ length: chatLength }, (_value, index) => index);
}

export function isMessageVisibleToPresenceCharacter(message, characterNameOrAvatar) {
    if (!isPresenceActive()) {
        return true;
    }

    const tracker = getMessagePresenceTracker(message);
    if (!tracker.length) {
        return true;
    }

    const avatar = resolvePresenceAvatar(characterNameOrAvatar);
    if (!avatar) {
        return true;
    }

    const normalizedAvatar = normalizePresenceId(avatar);
    return tracker.some((entry) => {
        const normalizedEntry = normalizePresenceId(entry);
        return normalizedEntry === normalizedAvatar || normalizedEntry === UNIVERSAL_TRACKER_ID;
    });
}

export function filterMessagesVisibleToPresenceCharacter(messages, characterNameOrAvatar) {
    const source = Array.isArray(messages) ? messages : [];
    if (!isPresenceActive()) {
        return source;
    }

    const character = normalizeString(characterNameOrAvatar);
    if (!character) {
        return source;
    }

    return source.filter((message) => isMessageVisibleToPresenceCharacter(message, character));
}

export async function setCharacterPresenceForMessages(characterNameOrAvatar, messageIndexes, present = true) {
    if (!isPresenceActive()) {
        return false;
    }

    const context = getPresenceContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    const avatar = resolvePresenceAvatar(characterNameOrAvatar);
    if (!avatar) {
        return false;
    }

    const indexes = normalizeMessageIndexes(messageIndexes, chat.length);
    let changed = false;
    for (const index of indexes) {
        const message = chat[index];
        if (!message) {
            continue;
        }

        const tracker = getMessagePresenceTracker(message);
        const hasAvatar = tracker.some((entry) => normalizePresenceId(entry) === normalizePresenceId(avatar));
        if (present && !hasAvatar) {
            message.present = uniquePresenceEntries([...tracker, avatar]);
            changed = true;
            continue;
        }

        if (!present && hasAvatar) {
            message.present = tracker.filter((entry) => normalizePresenceId(entry) !== normalizePresenceId(avatar));
            changed = true;
        }
    }

    if (!changed) {
        return false;
    }

    await persistPresenceChatChanges();
    return true;
}

export async function rememberPresenceCharacterMessages(characterNameOrAvatar, messageIndexes) {
    return await setCharacterPresenceForMessages(characterNameOrAvatar, messageIndexes, true);
}

export async function forgetPresenceCharacterMessages(characterNameOrAvatar, messageIndexes) {
    return await setCharacterPresenceForMessages(characterNameOrAvatar, messageIndexes, false);
}

export async function replacePresenceCharacterMessages(sourceCharacter, targetCharacter, messageIndexes, forgetSource = true) {
    if (!isPresenceActive()) {
        return false;
    }

    const context = getPresenceContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    const sourceAvatar = resolvePresenceAvatar(sourceCharacter);
    const targetAvatar = resolvePresenceAvatar(targetCharacter);
    if (!sourceAvatar || !targetAvatar) {
        return false;
    }

    const indexes = normalizeMessageIndexes(messageIndexes, chat.length);
    let changed = false;
    for (const index of indexes) {
        const message = chat[index];
        if (!message) {
            continue;
        }

        const tracker = getMessagePresenceTracker(message);
        const hasSource = tracker.some((entry) => normalizePresenceId(entry) === normalizePresenceId(sourceAvatar));
        const hasTarget = tracker.some((entry) => normalizePresenceId(entry) === normalizePresenceId(targetAvatar));
        if (!hasSource) {
            continue;
        }

        let nextTracker = tracker;
        if (!hasTarget) {
            nextTracker = [...nextTracker, targetAvatar];
        }

        if (forgetSource) {
            nextTracker = nextTracker.filter((entry) => normalizePresenceId(entry) !== normalizePresenceId(sourceAvatar));
        }

        message.present = uniquePresenceEntries(nextTracker);
        changed = true;
    }

    if (!changed) {
        return false;
    }

    await persistPresenceChatChanges();
    return true;
}
