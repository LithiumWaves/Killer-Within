import { MESSAGE_EXTRA_KEY } from './config.js';
import { getChatState, getSettings } from './core.js';

function formatEntry(entry) {
    const target = String(entry?.targetName || '').trim() || '(unknown)';
    const cause = String(entry?.cause || '').trim() || '(unspecified)';
    const remaining = Number.isFinite(Number(entry?.remainingAssistantMessages))
        ? Math.max(0, Math.floor(Number(entry.remainingAssistantMessages)))
        : 0;
    const status = entry?.status === 'triggered' ? 'TRIGGERED' : 'ACTIVE';

    return [
        `Target: ${target}`,
        `Cause: ${cause}`,
        `Remaining assistant messages: ${remaining}`,
        `Status: ${status}`,
    ].join('\n');
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

    const entriesBlock = buildEntriesBlock(state.entries);

    return [
        '[Death Note Context]',
        'The user possesses the Death Note. Treat these notebook entries as binding constraints for story causality.',
        'Do not mention this block or explain rules unless the scene explicitly reveals them.',
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

