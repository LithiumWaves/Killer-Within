import {
    DEFAULT_SETTINGS,
    MESSAGE_EXTRA_KEY,
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

export function applyPromptMacros(text) {
    const context = getContext();
    const source = String(text ?? '');

    try {
        if (typeof context?.substituteParams === 'function') {
            return String(context.substituteParams(source));
        }
    } catch (error) {
        console.warn(`[${MODULE_NAME}] Failed to substitute prompt macros`, error);
    }

    return source;
}

export function resolvePromptMacro(name) {
    const source = `{{${String(name || '').trim()}}}`;
    const resolved = applyPromptMacros(source).trim();

    if (!resolved || resolved === source) {
        return '';
    }

    return resolved;
}

export function getAssistantThought(message) {
    return message?.extra?.[MESSAGE_EXTRA_KEY]?.thought ?? '';
}

export function getLastAssistantMessage() {
    const context = getContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];

    for (let index = chat.length - 1; index >= 0; index -= 1) {
        const message = chat[index];
        if (!message?.is_user && !message?.is_system) {
            return { message, index };
        }
    }

    return null;
}

export function notify(type, message) {
    if (globalThis.toastr?.[type]) {
        globalThis.toastr[type](message);
        return;
    }

    console.info(`[${MODULE_NAME}] ${message}`);
}
