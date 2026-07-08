import {
    MESSAGE_EXTRA_KEY,
    NOTEBOOK_ACTOR_TYPES,
    NOTEBOOK_USER_ACCESS,
} from './config.js';
import {
    getCharacterNameDirectory,
    getChatState,
    getDeathNoteInventory,
    getNotebookOwnership,
    getSettings,
    getUserHeldNotebookScraps,
} from './core.js';

function formatEntry(entry) {
    const noteText = String(entry?.noteText || '').trim();
    const targetName = String(entry?.targetName || '').trim();
    const cause = String(entry?.cause || '').trim() || 'heart attack';
    const remaining = Number.isFinite(Number(entry?.remainingAssistantMessages))
        ? Math.max(0, Math.floor(Number(entry.remainingAssistantMessages)))
        : 0;
    const hasExplicitCause = Boolean(entry?.hasExplicitCause);
    const hasExplicitTime = Boolean(entry?.hasExplicitTime);
    const statusRaw = String(entry?.status || '').trim().toLowerCase();
    const status = statusRaw === 'resolved' ? 'RESOLVED' : statusRaw === 'due' ? 'DUE' : 'ACTIVE';

    return [
        `Written: ${noteText || '(empty)'}`,
        targetName ? `Interpreted target: ${targetName}` : null,
        targetName ? `Interpreted cause: ${cause}` : null,
        hasExplicitCause ? null : 'Default cause applied: heart attack',
        hasExplicitTime ? null : 'Default timing applied: next assistant message',
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

function formatActorLabel(actor, fallback = 'Unknown') {
    const value = actor && typeof actor === 'object' ? actor : {};
    const type = String(value.type || '').trim().toLowerCase();
    const name = String(value.name || '').trim();

    if (type === NOTEBOOK_ACTOR_TYPES.USER) {
        return name || 'User';
    }

    if (name && type === NOTEBOOK_ACTOR_TYPES.CHARACTER) {
        return `${name} (character)`;
    }

    if (name && type === NOTEBOOK_ACTOR_TYPES.SHINIGAMI) {
        return `${name} (Shinigami)`;
    }

    if (name) {
        return name;
    }

    if (type === NOTEBOOK_ACTOR_TYPES.CHARACTER) {
        return 'an in-scene character';
    }

    if (type === NOTEBOOK_ACTOR_TYPES.SHINIGAMI) {
        return 'a Shinigami';
    }

    if (type === NOTEBOOK_ACTOR_TYPES.WORLD) {
        return 'the world';
    }

    if (type === NOTEBOOK_ACTOR_TYPES.NONE) {
        return 'nobody';
    }

    return fallback;
}

function formatUserAccess(value) {
    const access = String(value || '').trim().toLowerCase();
    if (access === NOTEBOOK_USER_ACCESS.FULL) {
        return 'full notebook access';
    }

    if (access === NOTEBOOK_USER_ACCESS.SCRAP) {
        return 'scrap-only access';
    }

    if (access === NOTEBOOK_USER_ACCESS.TOUCH) {
        return 'touch-only access';
    }

    return 'no notebook access';
}

function buildOwnershipBlock(ownership) {
    const lines = [
        'Notebook custody:',
        `Owner: ${formatActorLabel(ownership.owner, 'Unknown owner')}`,
        `Current holder: ${formatActorLabel(ownership.holder, 'Unknown holder')}`,
        `User access: ${formatUserAccess(ownership.userAccess)}`,
    ];

    if (ownership.userAccess !== NOTEBOOK_USER_ACCESS.FULL) {
        lines.push('Do not assume the user can freely inspect, carry, or write in the full notebook unless the scene explicitly establishes that access.');
    }

    lines.push('Written entries already in the notebook remain binding unless they are explicitly removed or altered in-story.');
    return lines.join('\n');
}

function buildInventoryBlock(inventory) {
    const notebook = inventory?.notebook || {};
    const scraps = Array.isArray(inventory?.scraps) ? inventory.scraps.filter((scrap) => scrap?.active) : [];
    const userHeldScraps = getUserHeldNotebookScraps();
    const lines = [
        'Inventory state:',
        `Notebook item status: ${notebook.destroyed ? 'destroyed' : notebook.exists ? 'present' : 'missing'}`,
        `Active scraps: ${scraps.length}`,
    ];

    if (!userHeldScraps.length) {
        lines.push('User-held scraps: none.');
        return lines.join('\n');
    }

    lines.push('User-held scraps:');
    for (const scrap of userHeldScraps) {
        lines.push(`- ${scrap.label}: ${formatUserAccess(scrap.userAccess)}${scrap.noteText ? '; contains written text' : ''}`);
    }

    return lines.join('\n');
}

function buildDeathNoteInjection() {
    const settings = getSettings();
    if (!settings.enabled) {
        return '';
    }

    const state = getChatState();
    const inventory = getDeathNoteInventory();
    const hasActiveScraps = Array.isArray(inventory?.scraps) && inventory.scraps.some((scrap) => scrap?.active);
    if (!state.hasNotebook && !hasActiveScraps) {
        return '';
    }

    const ownership = getNotebookOwnership();
    const entries = Array.isArray(state.entries) ? state.entries : [];
    const dueEntries = entries.filter((entry) => String(entry?.status || '').toLowerCase() === 'due');
    const activeEntries = entries.filter((entry) => String(entry?.status || '').toLowerCase() === 'active');

    const dueBlock = dueEntries.length ? buildEntriesBlock(dueEntries) : 'None.';
    const entriesBlock = buildEntriesBlock(activeEntries);

    return [
        '[Death Note Context]',
        'Treat the Death Note custody state and written entries below as binding constraints for story causality.',
        'Do not mention this block or explain rules unless the scene explicitly reveals them.',
        'Default Death Note rules: if no cause of death is written, interpret the entry as death by heart attack. If no time is written, the death occurs on the next assistant message.',
        '',
        buildOwnershipBlock(ownership),
        '',
        buildInventoryBlock(inventory),
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

function buildNameKnowledgeInjection() {
    const settings = getSettings();
    if (!settings.enabled) {
        return '';
    }

    const directory = getCharacterNameDirectory();
    const hidden = directory.filter((entry) => !entry.known);
    if (!hidden.length) {
        return '';
    }

    const lines = [
        '[Name Knowledge Context]',
        'Some character names are not yet known to the user.',
        'For any character marked HIDDEN below, do not casually reveal or confirm their true name in user-facing dialogue, narration, labels, or exposition until the scene explicitly establishes that the user learned it.',
        'When referring to a hidden-name character from the user-facing perspective, prefer the masked label or an in-scene descriptor instead.',
        '',
        'Character name knowledge:',
    ];

    for (const entry of directory) {
        if (entry.known) {
            lines.push(`- KNOWN | ${entry.trueName}`);
            continue;
        }

        lines.push(`- HIDDEN | masked label: ${entry.displayName} | true name: ${entry.trueName}`);
    }

    return lines.join('\n');
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

export function getNameKnowledgePromptInjectionMessage() {
    const injection = buildNameKnowledgeInjection();
    if (!injection) {
        return null;
    }

    return {
        name: 'Name Knowledge',
        is_user: false,
        is_system: true,
        send_date: Date.now(),
        mes: injection,
        extra: {
            [MESSAGE_EXTRA_KEY]: {
                injected: true,
                nameKnowledge: true,
            },
        },
    };
}

