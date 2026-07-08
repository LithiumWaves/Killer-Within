import { getActorDisplayName, getDeathNotePresenceState, getLinkedShinigami } from '../deathnote/core.js';

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
    const state = getDeathNotePresenceState();
    const shinigamiLink = getLinkedShinigami();
    if (!state.notebookPresent && !state.touchers.length && !state.userCanSeeShinigami) {
        return '';
    }

    return [
        '[Presence Context]',
        'Selective supernatural visibility is active for Death Note-related entities.',
        `Linked Shinigami: ${shinigamiLink && shinigamiLink.active ? (getActorDisplayName(shinigamiLink.actor, shinigamiLink.avatar || 'linked')) : 'none currently linked'}.`,
        'Anyone currently touching the Death Note or one of its scraps can perceive that notebook\'s Shinigami.',
        'Characters without current contact cannot directly see, hear, or confidently remember Shinigami-only actions or speech as witnessed fact unless the scene separately establishes that perception.',
        'If a Shinigami tied to this Death Note appears, apply these visibility limits strictly.',
        '',
        'Current Death Note touchers:',
        buildTouchersBlock(state.touchers),
    ].join('\n');
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
