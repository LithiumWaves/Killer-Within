import { MESSAGE_EXTRA_KEY } from './config.js';
import {
    getActiveCharacterKey,
    getContext,
    getLastAssistantMessage,
    getMessageCharacterKey,
    getSettings,
    persistChatChanges,
} from './core.js';
import {
    buildManualThoughtHybridPrompt,
    buildManualThoughtRawRequest,
    buildThoughtHybridPrompt,
    buildThoughtRawRequest,
    getPromptInjectionMessage,
    normalizeThoughtResult,
} from './prompts.js';
import { getDeathNotePromptInjectionMessage } from '../deathnote/prompts.js';
import { state } from './state.js';

async function requestThoughtGeneration(context, settings, rawRequest, hybridPrompt) {
    const mode = settings?.generationMode === 'hybrid' ? 'hybrid' : 'raw';

    if (mode === 'hybrid' && typeof context?.generateQuietPrompt === 'function') {
        return normalizeThoughtResult(await context.generateQuietPrompt({
            quietPrompt: hybridPrompt,
        }));
    }

    if (typeof context?.generateRaw === 'function') {
        return normalizeThoughtResult(await context.generateRaw(rawRequest));
    }

    return '';
}

export async function generatePendingThought() {
    const context = getContext();
    const settings = getSettings();

    if (!settings.enabled || state.isGeneratingThought) {
        return;
    }

    state.isGeneratingThought = true;
    state.pendingThought = null;

    try {
        const characterKey = getActiveCharacterKey();
        const thought = await requestThoughtGeneration(
            context,
            settings,
            buildThoughtRawRequest(),
            buildThoughtHybridPrompt(),
        );

        if (!thought) {
            return;
        }

        state.pendingThought = {
            text: thought,
            createdAt: Date.now(),
            characterKey,
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

    if (!settings.enabled || state.isGeneratingThought) {
        return '';
    }

    if (!message || message.is_user || message.is_system) {
        return '';
    }

    state.isGeneratingThought = true;

    try {
        const thought = await requestThoughtGeneration(
            context,
            settings,
            buildManualThoughtRawRequest(messageIndex),
            buildManualThoughtHybridPrompt(messageIndex),
        );

        if (!thought) {
            return '';
        }

        message.extra ??= {};
        message.extra[MESSAGE_EXTRA_KEY] = {
            thought,
            createdAt: Date.now(),
            characterName: message?.name || '',
            enabledInContext: true,
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

    if (
        state.pendingThought.characterKey
        && getMessageCharacterKey(match.message)
        && getMessageCharacterKey(match.message) !== state.pendingThought.characterKey
    ) {
        state.pendingThought = null;
        return;
    }

    match.message.extra ??= {};
    match.message.extra[MESSAGE_EXTRA_KEY] = {
        thought: state.pendingThought.text,
        createdAt: state.pendingThought.createdAt,
        characterName: match.message?.name || '',
        enabledInContext: true,
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

        const deathNoteInjection = getDeathNotePromptInjectionMessage();
        if (deathNoteInjection) {
            const insertAt = Math.max(chat.length - 1, 0);
            chat.splice(insertAt, 0, deathNoteInjection);
        }

        const thoughtsInjection = getPromptInjectionMessage();
        if (thoughtsInjection) {
            const insertAt = Math.max(chat.length - 1, 0);
            chat.splice(insertAt, 0, thoughtsInjection);
        }
    };
}
