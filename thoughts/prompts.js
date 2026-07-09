import {
    MESSAGE_EXTRA_KEY,
    RAW_THOUGHT_CONTEXT_LIMIT,
} from './config.js';
import {
    applyPromptMacros,
    getActiveCharacterKey,
    getAssistantThought,
    getContext,
    getMessageCharacterKey,
    getSettings,
    isThoughtEnabledInContext,
    normalizeCharacterKey,
    resolvePromptMacro,
} from './core.js';
import { filterMessagesVisibleToPresenceCharacter } from '../presence/core.js';
import { state } from './state.js';

function renderPromptTemplate(template, replacements = {}) {
    return String(template || '').replace(/\{\{([a-z0-9_]+)\}\}/gi, (_match, key) => {
        return Object.hasOwn(replacements, key) ? String(replacements[key] ?? '') : '';
    });
}

export function getThoughtEntries({
    limit = Number.MAX_SAFE_INTEGER,
    characterKey = '',
    selectedOnly = true,
} = {}) {
    const context = getContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    const targetCharacterKey = normalizeCharacterKey(characterKey);
    const countsByCharacter = new Map();

    return chat
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => {
            if (message?.is_user || message?.is_system || !getAssistantThought(message)) {
                return false;
            }

            if (selectedOnly && !isThoughtEnabledInContext(message)) {
                return false;
            }

            if (!targetCharacterKey) {
                return true;
            }

            return getMessageCharacterKey(message) === targetCharacterKey;
        })
        .map(({ message, index }) => {
            const entryCharacterKey = getMessageCharacterKey(message) || normalizeCharacterKey(message?.name || '') || '__unknown_character__';
            const characterThoughtNumber = (countsByCharacter.get(entryCharacterKey) ?? 0) + 1;
            countsByCharacter.set(entryCharacterKey, characterThoughtNumber);

            return {
                index,
                name: message?.name || 'Character',
                characterKey: getMessageCharacterKey(message),
                thought: getAssistantThought(message),
                selected: isThoughtEnabledInContext(message),
                characterThoughtNumber,
            };
        })
        .slice(-Math.max(0, Number(limit) || 0));
}

export function getThoughtHistory(limit = getSettings().maxInjectedThoughts, characterKey = getActiveCharacterKey()) {
    return getThoughtEntries({
        limit,
        characterKey,
        selectedOnly: true,
    });
}

export function buildThoughtHistoryBlock(limit, characterKey = getActiveCharacterKey()) {
    const history = getThoughtHistory(limit, characterKey);

    if (!history.length) {
        return 'No prior hidden thoughts are available yet.';
    }

    return history
        .map(({ characterThoughtNumber, name, thought }) => `Thought ${characterThoughtNumber} | ${name}\n${thought}`)
        .join('\n\n');
}

export function buildThoughtPrompt() {
    const settings = getSettings();
    const historyBlock = buildThoughtHistoryBlock(settings.maxInjectedThoughts, getActiveCharacterKey());

    return applyPromptMacros(renderPromptTemplate(settings.thoughtWrapperTemplate, {
        thought_prompt: settings.thoughtPrompt,
        history_block: historyBlock,
    })).trim();
}

function getRelevantChatMessages(limit = RAW_THOUGHT_CONTEXT_LIMIT, characterName = '') {
    const context = getContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    const filtered = chat
        .filter((message) => !message?.extra?.[MESSAGE_EXTRA_KEY]?.injected)
        .slice(-Math.max(0, Number(limit) || 0));
    return filterMessagesVisibleToPresenceCharacter(filtered, characterName);
}

function formatChatMessageForThoughtContext(message, index) {
    const role = message?.is_user ? 'User' : message?.is_system ? 'System' : 'Assistant';
    const name = String(message?.name || role).trim();
    const body = String(message?.mes || '').trim() || '(empty)';
    return `[${index + 1}] ${role} | ${name}\n${body}`;
}

function buildConversationContextBlock(limit = RAW_THOUGHT_CONTEXT_LIMIT, characterName = '') {
    const messages = getRelevantChatMessages(limit, characterName);

    if (!messages.length) {
        return 'No recent visible chat messages are available yet.';
    }

    return messages
        .map((message, index) => formatChatMessageForThoughtContext(message, index))
        .join('\n\n');
}

function buildIdentityContextBlock() {
    const characterDescription = resolvePromptMacro('description');
    const userPersona = resolvePromptMacro('persona');
    const sections = [];

    if (characterDescription) {
        sections.push([
            "Active character card description:",
            characterDescription,
        ].join('\n'));
    }

    if (userPersona) {
        sections.push([
            "Active user persona:",
            userPersona,
        ].join('\n'));
    }

    if (!sections.length) {
        return 'No additional character card description or user persona context is available.';
    }

    return sections.join('\n\n');
}

export function buildThoughtRawRequest() {
    const activeCharacterName = resolvePromptMacro('char');
    return {
        systemPrompt: applyPromptMacros(getSettings().thoughtRawSystemPrompt).trim(),
        prompt: applyPromptMacros(renderPromptTemplate(getSettings().thoughtContextTemplate, {
            thought_prompt_block: buildThoughtPrompt(),
            identity_context_block: buildIdentityContextBlock(),
            conversation_context_block: buildConversationContextBlock(RAW_THOUGHT_CONTEXT_LIMIT, activeCharacterName),
        })).trim(),
    };
}

export function buildThoughtHybridPrompt() {
    const activeCharacterName = resolvePromptMacro('char');
    return applyPromptMacros(renderPromptTemplate(getSettings().thoughtContextTemplate, {
        thought_prompt_block: buildThoughtPrompt(),
        identity_context_block: buildIdentityContextBlock(),
        conversation_context_block: buildConversationContextBlock(RAW_THOUGHT_CONTEXT_LIMIT, activeCharacterName),
    })).trim();
}

function buildManualThoughtPrompt(messageIndex) {
    const context = getContext();
    const settings = getSettings();
    const message = context?.chat?.[messageIndex];
    const historyBlock = buildThoughtHistoryBlock(settings.maxInjectedThoughts, getMessageCharacterKey(message));
    const visibleReply = String(message?.mes ?? '').trim();

    return applyPromptMacros(renderPromptTemplate(settings.manualThoughtWrapperTemplate, {
        thought_prompt: settings.thoughtPrompt,
        history_block: historyBlock,
        visible_reply: visibleReply || '(empty reply)',
    })).trim();
}

export function buildManualThoughtRawRequest(messageIndex) {
    const context = getContext();
    const message = context?.chat?.[messageIndex];
    const characterName = String(message?.name || '').trim();
    return {
        systemPrompt: applyPromptMacros(getSettings().manualThoughtRawSystemPrompt).trim(),
        prompt: applyPromptMacros(renderPromptTemplate(getSettings().thoughtContextTemplate, {
            thought_prompt_block: buildManualThoughtPrompt(messageIndex),
            identity_context_block: buildIdentityContextBlock(),
            conversation_context_block: buildConversationContextBlock(RAW_THOUGHT_CONTEXT_LIMIT, characterName),
        })).trim(),
    };
}

export function buildManualThoughtHybridPrompt(messageIndex) {
    const context = getContext();
    const message = context?.chat?.[messageIndex];
    const characterName = String(message?.name || '').trim();
    return applyPromptMacros(renderPromptTemplate(getSettings().thoughtContextTemplate, {
        thought_prompt_block: buildManualThoughtPrompt(messageIndex),
        identity_context_block: buildIdentityContextBlock(),
        conversation_context_block: buildConversationContextBlock(RAW_THOUGHT_CONTEXT_LIMIT, characterName),
    })).trim();
}

function buildMainPromptInjection() {
    const settings = getSettings();
    const sections = [];
    const activeCharacterKey = getActiveCharacterKey();

    if (settings.includeThoughtsInMainPrompt) {
        sections.push([
            'Recent hidden thoughts from earlier turns:',
            buildThoughtHistoryBlock(settings.maxInjectedThoughts, activeCharacterKey),
        ].join('\n'));
    }

    if (
        settings.includePendingThoughtInMainPrompt
        && state.pendingThought?.text
        && (!activeCharacterKey || state.pendingThought.characterKey === activeCharacterKey)
    ) {
        sections.push([
            'Hidden thoughts for the reply being generated right now:',
            state.pendingThought.text,
        ].join('\n'));
    }

    if (!sections.length) {
        return '';
    }

    return applyPromptMacros(renderPromptTemplate(settings.thoughtMainInjectionTemplate, {
        sections: sections.join('\n\n'),
    })).trim();
}

export function getPromptInjectionMessage() {
    const injection = buildMainPromptInjection();

    if (!injection) {
        return null;
    }

    return {
        name: 'Thought Context',
        is_user: false,
        is_system: true,
        send_date: Date.now(),
        mes: injection,
        extra: {
            [MESSAGE_EXTRA_KEY]: {
                injected: true,
            },
        },
    };
}

export function normalizeThoughtResult(result) {
    if (typeof result === 'string') {
        return result.trim();
    }

    if (typeof result?.content === 'string') {
        return result.content.trim();
    }

    if (typeof result?.message === 'string') {
        return result.message.trim();
    }

    return '';
}
