import {
    MESSAGE_EXTRA_KEY,
    NOTEBOOK_ACTOR_TYPES,
    NOTEBOOK_USER_ACCESS,
} from './config.js';
import {
    consumeNotebookPresenceRevealPending,
    getContext,
    getChatState,
    getDeathNoteInventory,
    getNotebookOwnership,
    getPendingIdentityTheftExposure,
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
    const ids = Array.isArray(inventory?.ids) ? inventory.ids : [];
    const scraps = Array.isArray(inventory?.scraps) ? inventory.scraps.filter((scrap) => scrap?.active) : [];
    const userHeldScraps = getUserHeldNotebookScraps();
    const lines = [
        'Inventory state:',
        `Notebook item status: ${notebook.destroyed ? 'destroyed' : notebook.exists ? 'present' : 'missing'}`,
        `Stolen IDs carried by the user: ${ids.length}`,
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

function buildIdentityTheftInjection() {
    const settings = getSettings();
    if (!settings.enabled) {
        return '';
    }

    const pending = getPendingIdentityTheftExposure();
    if (!pending.active) {
        return '';
    }

    const context = getContext();
    let userLabel = 'the user';
    try {
        const resolved = String(context?.substituteParams?.('{{user}}') || '').trim();
        if (resolved && resolved !== '{{user}}') {
            userLabel = resolved;
        }
    } catch (_error) {
        // Ignore macro substitution failures and fall back to a generic label.
    }

    const targetLabel = formatActorLabel(pending.actor, 'that character');
    return [
        '[Failed Identity Theft]',
        `If the responding character is ${targetLabel}, they already noticed that ${userLabel} tried to steal their ID.`,
        'Treat that failed theft as something that already happened in-scene.',
        `In this reply, ${targetLabel} should react naturally to that violation with suspicion, confrontation, guardedness, or alarm.`,
        `If the responding character is not ${targetLabel}, ignore this block entirely.`,
    ].join('\n');
}

function buildNotebookPresenceRevealInjection() {
    const settings = getSettings();
    if (!settings.enabled) {
        return '';
    }

    if (!consumeNotebookPresenceRevealPending()) {
        return '';
    }

    const context = getContext();
    let userLabel = 'the user';
    try {
        const resolved = String(context?.substituteParams?.('{{user}}') || '').trim();
        if (resolved && resolved !== '{{user}}') {
            userLabel = resolved;
        }
    } catch (_error) {
        // Ignore macro substitution failures and fall back to a generic label.
    }

    return [
        '[Notebook Reveal]',
        'At least one other character is currently present in the scene (Presence).',
        `In this moment, ${userLabel} openly pulls out and opens a strange black notebook with "Death Note" written on the cover.`,
        'Treat this as a visible, in-scene action that present characters can notice and react to naturally.',
        'Do not mention this block or explain the Presence system.',
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

export function getIdentityTheftPromptInjectionMessage() {
    const injection = buildIdentityTheftInjection();
    if (!injection) {
        return null;
    }

    return {
        name: 'Failed Identity Theft',
        is_user: false,
        is_system: true,
        send_date: Date.now(),
        mes: injection,
        extra: {
            [MESSAGE_EXTRA_KEY]: {
                injected: true,
                identityTheft: true,
            },
        },
    };
}

export function getNotebookRevealPromptInjectionMessage() {
    const injection = buildNotebookPresenceRevealInjection();
    if (!injection) {
        return null;
    }

    return {
        name: 'Notebook Reveal',
        is_user: false,
        is_system: true,
        send_date: Date.now(),
        mes: injection,
        extra: {
            [MESSAGE_EXTRA_KEY]: {
                injected: true,
                notebookReveal: true,
            },
        },
    };
}

