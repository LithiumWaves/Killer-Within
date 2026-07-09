import {
    MESSAGE_EXTRA_KEY,
    NOTEBOOK_ACTOR_TYPES,
    NOTEBOOK_USER_ACCESS,
} from './config.js';
import {
    consumeNotebookPresenceRevealPending,
    getContext,
    getChatState,
    getCurrentChatCharacterActors,
    getDeathNoteInventory,
    getNotebookOwnership,
    getPendingIdentityTheftExposure,
    getSettings,
    getUserHeldNotebookScraps,
} from './core.js';

function renderPromptTemplate(template, replacements = {}) {
    return String(template || '').replace(/\{\{([a-z0-9_]+)\}\}/gi, (_match, key) => {
        return Object.hasOwn(replacements, key) ? String(replacements[key] ?? '') : '';
    });
}

function formatEntry(entry) {
    const noteText = String(entry?.noteText || '').trim();
    const targetName = String(entry?.targetName || '').trim();
    const targetType = String(entry?.targetType || '').trim().toLowerCase();
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
        targetType === NOTEBOOK_ACTOR_TYPES.CHARACTER ? 'Target class: active character card' : null,
        targetType === NOTEBOOK_ACTOR_TYPES.NPC ? 'Target class: off-card NPC / story-world person' : null,
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

    if (name && type === NOTEBOOK_ACTOR_TYPES.NPC) {
        return `${name} (NPC)`;
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

    if (type === NOTEBOOK_ACTOR_TYPES.NPC) {
        return 'an off-card NPC';
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

function buildCurrentCharacterCardNamesBlock() {
    const actors = getCurrentChatCharacterActors();
    const names = Array.isArray(actors)
        ? actors
            .map((actor) => String(actor?.name || '').trim())
            .filter(Boolean)
        : [];

    if (!names.length) {
        return 'There are no active character cards in this chat right now.';
    }

    return `Active character-card names in this chat: ${names.join(', ')}.`;
}

function buildNpcDueGuidance(dueEntries) {
    if (!Array.isArray(dueEntries) || !dueEntries.length) {
        return '';
    }

    return [
        '[Off-Card NPC Rule]',
        buildCurrentCharacterCardNamesBlock(),
        'If a due Death Note entry names someone who is not one of those active character cards, treat that person as an off-card NPC, reported criminal, broadcaster, victim, or other story-world person rather than ignoring the entry.',
        'Their Death Note death must still occur on this reply as binding story causality.',
        'Depict that off-card death naturally in prose, reported media, background events, witness reactions, or scene fallout, whichever best fits the ongoing scene.',
    ].join('\n');
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

    const injection = renderPromptTemplate(settings.deathNotePromptTemplate, {
        ownership_block: buildOwnershipBlock(ownership),
        inventory_block: buildInventoryBlock(inventory),
        due_block: dueBlock,
        entries_block: entriesBlock,
    }).trim();
    const npcGuidance = buildNpcDueGuidance(dueEntries);
    if (!npcGuidance) {
        return injection;
    }

    return `${injection}\n\n${npcGuidance}`.trim();
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
    return renderPromptTemplate(settings.identityTheftPromptTemplate, {
        user_label: userLabel,
        target_label: targetLabel,
    }).trim();
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

    return renderPromptTemplate(settings.notebookRevealPromptTemplate, {
        user_label: userLabel,
    }).trim();
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
