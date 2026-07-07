import { MESSAGE_EXTRA_KEY } from './config.js';
import {
    getContext,
    getLastAssistantMessage,
    getSettings,
    persistChatChanges,
} from './core.js';
import {
    buildManualThoughtRawRequest,
    buildThoughtRawRequest,
    getPromptInjectionMessage,
    normalizeThoughtResult,
} from './prompts.js';
import { state } from './state.js';

export async function generatePendingThought() {
    const context = getContext();
    const settings = getSettings();

    if (!settings.enabled || state.isGeneratingThought || typeof context?.generateRaw !== 'function') {
        return;
    }

    state.isGeneratingThought = true;
    state.pendingThought = null;

    try {
        const thought = normalizeThoughtResult(await context.generateRaw(buildThoughtRawRequest()));

        if (!thought) {
            return;
        }

        state.pendingThought = {
            text: thought,
            createdAt: Date.now(),
        };
    } catch (error) {
        console.warn('[killer_within_thoughts] Thought generation failed', error);
    } finally {
        state.isGeneratingThought = false;
    }
}

export async function generateThoughtForMessage(messageIndex, afterChange) {
    const context = getContext();
    const settings = getSettings();
    const message = context?.chat?.[messageIndex];

    if (!settings.enabled || state.isGeneratingThought || typeof context?.generateRaw !== 'function') {
        return '';
    }

    if (!message || message.is_user || message.is_system) {
        return '';
    }

    state.isGeneratingThought = true;

    try {
        const thought = normalizeThoughtResult(await context.generateRaw(buildManualThoughtRawRequest(messageIndex)));

        if (!thought) {
            return '';
        }

        message.extra ??= {};
        message.extra[MESSAGE_EXTRA_KEY] = {
            thought,
            createdAt: Date.now(),
            generatedManually: true,
        };

        await persistChatChanges();
        afterChange?.();
        return thought;
    } catch (error) {
        console.warn('[killer_within_thoughts] Manual thought generation failed', error);
        return '';
    } finally {
        state.isGeneratingThought = false;
    }
}

export async function attachPendingThoughtToLatestMessage(afterChange) {
    if (!state.pendingThought?.text) {
        return;
    }

    const match = getLastAssistantMessage();
    if (!match?.message) {
        return;
    }

    match.message.extra ??= {};
    match.message.extra[MESSAGE_EXTRA_KEY] = {
        thought: state.pendingThought.text,
        createdAt: state.pendingThought.createdAt,
    };

    state.pendingThought = null;
    await persistChatChanges();
    afterChange?.();
}

export function clearPendingThought() {
    state.pendingThought = null;
}

export function installInterceptor() {
    globalThis.killerWithinThoughtsInterceptor = async function killerWithinThoughtsInterceptor(chat, _contextSize, _abort, type) {
        const settings = getSettings();

        if (!settings.enabled || state.isGeneratingThought || type === 'quiet' || !Array.isArray(chat)) {
            return;
        }

        if (!state.autoThoughtInFlight) {
            state.autoThoughtInFlight = true;
            try {
                await generatePendingThought();
            } finally {
                state.autoThoughtInFlight = false;
            }
        }

        const injectionMessage = getPromptInjectionMessage();
        if (!injectionMessage) {
            return;
        }

        const insertAt = Math.max(chat.length - 1, 0);
        chat.splice(insertAt, 0, injectionMessage);
    };
}
