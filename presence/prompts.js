import { getActorDisplayName, getDeathNotePresenceState, getLinkedShinigami, getSettings } from '../deathnote/core.js';

function renderPromptTemplate(template, replacements = {}) {
    return String(template || '').replace(/\{\{([a-z0-9_]+)\}\}/gi, (_match, key) => {
        return Object.hasOwn(replacements, key) ? String(replacements[key] ?? '') : '';
    });
}

function formatActor(actor) {
    const value = actor && typeof actor === 'object' ? actor : {};
    const type = String(value.type || '').trim().toLowerCase();
    const name = getActorDisplayName(value, '');

    if (type === 'user') {
        return name || 'User';
    }

    if (name && type === 'character') {
        return `${name} (character)`;
    }

    if (name && type === 'shinigami') {
        return `${name} (Shinigami)`;
    }

    if (name) {
        return name;
    }

    if (type === 'character') {
        return 'an in-scene character';
    }

    if (type === 'shinigami') {
        return 'a Shinigami';
    }

    return 'an unknown observer';
}

function formatTouchSource(source) {
    const value = String(source || '').trim().toLowerCase();
    if (value === 'notebook_holder') {
        return 'holding the notebook';
    }

    if (value === 'scrap_holder') {
        return 'holding a notebook scrap';
    }

    if (value === 'user_full_access') {
        return 'full notebook access';
    }

    if (value === 'user_touch_access') {
        return 'touch access';
    }

    if (value === 'manual_touch') {
        return 'direct touch';
    }

    return value || 'contact';
}

function buildTouchersBlock(touchers) {
    const list = Array.isArray(touchers) ? touchers : [];
    if (!list.length) {
        return 'None currently established.';
    }

    return list
        .map((entry) => {
            const sources = Array.isArray(entry.sources) ? entry.sources : [];
            const detail = sources.length
                ? sources.map((source) => formatTouchSource(source.source)).join(', ')
                : 'contact';
            return `- ${formatActor(entry.actor)}: ${detail}`;
        })
        .join('\n');
}

function buildPresenceInjection() {
    const settings = getSettings();
    const state = getDeathNotePresenceState();
    const shinigamiLink = getLinkedShinigami();
    if (!state.notebookPresent && !state.touchers.length && !state.userCanSeeShinigami) {
        return '';
    }

    return renderPromptTemplate(settings.presencePromptTemplate, {
        linked_shinigami: shinigamiLink && shinigamiLink.active
            ? getActorDisplayName(shinigamiLink.actor, shinigamiLink.avatar || 'linked')
            : 'none currently linked',
        touchers_block: buildTouchersBlock(state.touchers),
    }).trim();
}

export function getPresencePromptInjectionMessage() {
    const injection = buildPresenceInjection();
    if (!injection) {
        return null;
    }

    return {
        name: 'Presence',
        is_user: false,
        is_system: true,
        send_date: Date.now(),
        mes: injection,
        extra: {
            killerWithinPresence: {
                injected: true,
            },
        },
    };
}
