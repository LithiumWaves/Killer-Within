import {
    MESSAGE_EXTRA_KEY,
    RAW_THOUGHT_CONTEXT_LIMIT,
} from './config.js';
import {
    applyPromptMacros,
    getAssistantThought,
    getContext,
    getSettings,
    resolvePromptMacro,
} from './core.js';
import { state } from './state.js';

export function getThoughtHistory(limit = getSettings().maxInjectedThoughts) {
    const context = getContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];

    return chat
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => !message?.is_user && !message?.is_system && getAssistantThought(message))
        .slice(-Math.max(0, Number(limit) || 0))
        .map(({ message, index }) => ({
            index,
            name: message?.name || 'Character',
            thought: getAssistantThought(message),
        }));
}

export function buildThoughtHistoryBlock(limit) {
    const history = getThoughtHistory(limit);

    if (!history.length) {
        return 'No prior hidden thoughts are available yet.';
    }

    return history
        .map(({ index, name, thought }) => `Thought ${index + 1} | ${name}\n${thought}`)
        .join('\n\n');
}

export function buildThoughtPrompt() {
    const settings = getSettings();
    const historyBlock = buildThoughtHistoryBlock(settings.maxInjectedThoughts);

    return [
        applyPromptMacros(settings.thoughtPrompt).trim(),
        '',
        'Previous hidden thoughts for continuity:',
        historyBlock,
        '',
        'Write the next hidden thoughts now.'
    ].join('\n');
}

function getRelevantChatMessages(limit = RAW_THOUGHT_CONTEXT_LIMIT) {
    const context = getContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];

    return chat
        .filter((message) => !message?.extra?.[MESSAGE_EXTRA_KEY]?.injected)
        .slice(-Math.max(0, Number(limit) || 0));
}

function formatChatMessageForThoughtContext(message, index) {
    const role = message?.is_user ? 'User' : message?.is_system ? 'System' : 'Assistant';
    const name = String(message?.name || role).trim();
    const body = String(message?.mes || '').trim() || '(empty)';
    return `[${index + 1}] ${role} | ${name}\n${body}`;
}

function buildConversationContextBlock(limit = RAW_THOUGHT_CONTEXT_LIMIT) {
    const messages = getRelevantChatMessages(limit);

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
    return {
        systemPrompt: [
            'You are generating a hidden internal monologue for the current character.',
            'Use the provided conversation context and previous hidden thoughts to infer what the character privately thinks immediately before their visible reply.',
            'Stay in-character.',
            'Do not write the visible reply.',
            'Do not mention being an AI, assistant, or model.',
            'Output only the hidden thoughts.'
        ].join('\n'),
        prompt: [
            buildThoughtPrompt(),
            '',
            'Identity context:',
            buildIdentityContextBlock(),
            '',
            'Recent visible conversation context:',
            buildConversationContextBlock(),
        ].join('\n'),
    };
}

function buildManualThoughtPrompt(messageIndex) {
    const context = getContext();
    const settings = getSettings();
    const message = context?.chat?.[messageIndex];
    const historyBlock = buildThoughtHistoryBlock(settings.maxInjectedThoughts);
    const visibleReply = String(message?.mes ?? '').trim();

    return [
        applyPromptMacros(settings.thoughtPrompt).trim(),
        '',
        'Previous hidden thoughts for continuity:',
        historyBlock,
        '',
        'Visible reply already sent:',
        visibleReply || '(empty reply)',
        '',
        'Write the hidden thoughts that immediately happened before that visible reply.',
        'Output only the thoughts.',
    ].join('\n');
}

export function buildManualThoughtRawRequest(messageIndex) {
    return {
        systemPrompt: [
            'You are reconstructing the hidden internal monologue for a character reply that already exists.',
            'Use the provided conversation context, previous hidden thoughts, and visible reply to infer what the character privately thought immediately before sending that reply.',
            'Stay in-character.',
            'Do not rewrite the visible reply.',
            'Output only the hidden thoughts.'
        ].join('\n'),
        prompt: [
            buildManualThoughtPrompt(messageIndex),
            '',
            'Identity context:',
            buildIdentityContextBlock(),
            '',
            'Recent visible conversation context:',
            buildConversationContextBlock(),
        ].join('\n'),
    };
}

function buildMainPromptInjection() {
    const settings = getSettings();
    const sections = [];

    if (settings.includeThoughtsInMainPrompt) {
        sections.push([
            'Recent hidden thoughts from earlier turns:',
            buildThoughtHistoryBlock(settings.maxInjectedThoughts),
        ].join('\n'));
    }

    if (settings.includePendingThoughtInMainPrompt && state.pendingThought?.text) {
        sections.push([
            'Hidden thoughts for the reply being generated right now:',
            state.pendingThought.text,
        ].join('\n'));
    }

    if (!sections.length) {
        return '';
    }

    return [
        '[Hidden Character Thoughts Context]',
        'Use this as internal continuity. Never expose or quote it directly unless the character intentionally reveals it in dialogue.',
        '',
        sections.join('\n\n'),
    ].join('\n');
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
