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
import {
    getDeathNotePromptInjectionMessage,
    getIdentityTheftPromptInjectionMessage,
    getNotebookRevealPromptInjectionMessage,
} from '../deathnote/prompts.js';
import { getPresencePromptInjectionMessage } from '../presence/prompts.js';
import { persistChatChanges as persistDeathNoteChatChanges, tickDeathNoteCountdownForGeneration } from '../deathnote/core.js';
import { state } from './state.js';

function normalizeOpenRouterModel(value) {
    const source = String(value || '').trim();
    if (!source) {
        return '';
    }

    if (!/^https?:\/\//i.test(source)) {
        return source;
    }

    try {
        const url = new URL(source);
        const segments = String(url.pathname || '')
            .split('/')
            .map((segment) => String(segment || '').trim())
            .filter(Boolean);
        if (!segments.length) {
            return '';
        }

        if (segments[0].toLowerCase() === 'models') {
            segments.shift();
        }

        return segments.join('/');
    } catch (_error) {
        return source;
    }
}

async function requestOpenRouterThought(rawRequest, settings) {
    const apiKey = String(settings?.openRouterApiKey || '').trim();
    const model = normalizeOpenRouterModel(settings?.openRouterModel);
    if (!apiKey || !model) {
        return '';
    }

    const systemPrompt = String(rawRequest?.systemPrompt || '').trim();
    const prompt = String(rawRequest?.prompt || '').trim();
    if (!systemPrompt || !prompt) {
        return '';
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt },
            ],
        }),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`OpenRouter request failed (${response.status}): ${errorText || response.statusText}`);
    }

    const payload = await response.json();
    return normalizeThoughtResult(
        payload?.choices?.[0]?.message?.content
        || payload?.choices?.[0]?.text
        || payload
    );
}

async function requestThoughtGeneration(context, settings, rawRequest, hybridPrompt) {
    const provider = String(settings?.thoughtGenerationProvider || 'main').trim().toLowerCase();
    if (provider === 'openrouter') {
        return requestOpenRouterThought(rawRequest, settings);
    }

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
        if (type === 'quiet' || !Array.isArray(chat)) {
            return;
        }

        const deathNoteTick = tickDeathNoteCountdownForGeneration(chat.length);
        if (deathNoteTick?.ticked) {
            await persistDeathNoteChatChanges();
        }

        const deathNoteInjection = getDeathNotePromptInjectionMessage();
        if (deathNoteInjection) {
            const insertAt = Math.max(chat.length - 1, 0);
            chat.splice(insertAt, 0, deathNoteInjection);
        }

        const notebookRevealInjection = getNotebookRevealPromptInjectionMessage();
        if (notebookRevealInjection) {
            const insertAt = Math.max(chat.length - 1, 0);
            chat.splice(insertAt, 0, notebookRevealInjection);
        }

        const identityTheftInjection = getIdentityTheftPromptInjectionMessage();
        if (identityTheftInjection) {
            const insertAt = Math.max(chat.length - 1, 0);
            chat.splice(insertAt, 0, identityTheftInjection);
        }

        const presenceInjection = getPresencePromptInjectionMessage();
        if (presenceInjection) {
            const insertAt = Math.max(chat.length - 1, 0);
            chat.splice(insertAt, 0, presenceInjection);
        }

        const settings = getSettings();

        if (settings.enabled && !state.isGeneratingThought) {
            if (!state.autoThoughtInFlight) {
                state.autoThoughtInFlight = true;
                try {
                    await generatePendingThought();
                } finally {
                    state.autoThoughtInFlight = false;
                }
            }
        }

        if (settings.enabled) {
            const thoughtsInjection = getPromptInjectionMessage();
            if (thoughtsInjection) {
                const insertAt = Math.max(chat.length - 1, 0);
                chat.splice(insertAt, 0, thoughtsInjection);
            }
        }
    };
}
