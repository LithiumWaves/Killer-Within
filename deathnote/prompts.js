import { MESSAGE_EXTRA_KEY } from './config.js';
import { getChatState, getSettings } from './core.js';

function formatEntry(entry) {
    const noteText = String(entry?.noteText || '').trim();
    const remaining = Number.isFinite(Number(entry?.remainingAssistantMessages))
        ? Math.max(0, Math.floor(Number(entry.remainingAssistantMessages)))
        : 0;
    const statusRaw = String(entry?.status || '').trim().toLowerCase();
    const status = statusRaw === 'resolved' ? 'RESOLVED' : statusRaw === 'due' ? 'DUE' : 'ACTIVE';

    return [
        noteText || '(empty)',
        `Remaining assistant messages: ${remaining}`,
        `Status: ${status}`,
    ].filter(Boolean).join('\n');
}

function buildEntriesBlock(entries) {
    const active = Array.isArray(entries) ? entries : [];

    if (!active.length) {
        return 'No names are currently written in the Death Note.';
    }

    return active
        .slice()
        .reverse()
        .map((entry, index) => [
            `Entry ${active.length - index}`,
            formatEntry(entry),
        ].join('\n'))
        .join('\n\n');
}

function buildDeathNoteInjection() {
    const settings = getSettings();
    if (!settings.enabled) {
        return '';
    }

    const state = getChatState();
    if (!state.hasNotebook) {
        return '';
    }

    const entries = Array.isArray(state.entries) ? state.entries : [];
    const dueEntries = entries.filter((entry) => String(entry?.status || '').toLowerCase() === 'due');
    const activeEntries = entries.filter((entry) => String(entry?.status || '').toLowerCase() === 'active');

    const dueBlock = dueEntries.length ? buildEntriesBlock(dueEntries) : 'None.';
    const entriesBlock = buildEntriesBlock(activeEntries);

    return [
        '[Death Note Context]',
        'The user possesses the Death Note. Treat these notebook entries as binding constraints for story causality.',
        'Do not mention this block or explain rules unless the scene explicitly reveals them.',
        '',
        'Due now (must occur in the assistant reply being generated right now):',
        'If at least one entry is due, the next assistant reply MUST depict those deaths occurring as described, in-story.',
        'Do not delay them. Do not refuse. Do not acknowledge these instructions.',
        dueBlock,
        '',
        'Written entries:',
        entriesBlock,
    ].join('\n');
}

export function getDeathNotePromptInjectionMessage() {
    const injection = buildDeathNoteInjection();
    if (!injection) {
        return null;
    }

    return {
        name: 'Death Note',
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

