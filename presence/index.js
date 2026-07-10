import {
    getDeathNoteMemoryAudienceActors,
    getLinkedShinigamiPresenceBindings,
    isDeathNoteMemoryMessage,
} from '../deathnote/core.js';
import {
    getPresenceContext,
    isMessageAuthoredByPresenceCharacter,
    isPresenceActive,
    setMessagePresenceAudience,
} from './core.js';

const NO_MEMORY_VIEWER_ID = 'killer_within_no_memory_viewer';

function getShinigamiAudience(binding) {
    const audience = [];
    const shinigamiId = String(binding?.shinigami?.avatar || binding?.shinigami?.actor?.id || binding?.shinigami?.actor?.name || '').trim();
    if (shinigamiId) {
        audience.push(shinigamiId);
    }

    const visibleActors = Array.isArray(binding?.visibleActors) ? binding.visibleActors : [];
    for (const actor of visibleActors) {
        const identity = String(actor?.id || actor?.name || '').trim();
        if (!identity) {
            continue;
        }

        if (!audience.includes(identity)) {
            audience.push(identity);
        }
    }

    return audience;
}

async function syncLinkedShinigamiMessage(messageIndex) {
    if (!isPresenceActive()) {
        return false;
    }

    const bindings = getLinkedShinigamiPresenceBindings();
    if (!bindings.length) {
        return false;
    }

    const context = getPresenceContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    const index = Number(messageIndex);
    if (!Number.isInteger(index) || index < 0 || index >= chat.length) {
        return false;
    }

    const message = chat[index];
    if (!message) {
        return false;
    }

    for (const binding of bindings) {
        const shinigamiIdentity = String(binding.shinigami.avatar || binding.shinigami.actor.id || binding.shinigami.actor.name || '').trim();
        if (!shinigamiIdentity || !isMessageAuthoredByPresenceCharacter(message, shinigamiIdentity)) {
            continue;
        }
        return await setMessagePresenceAudience(index, getShinigamiAudience(binding));
    }

    return false;
}

function getDeathNoteMemoryAudience() {
    const actors = getDeathNoteMemoryAudienceActors();
    const audience = [];
    for (const actor of actors) {
        const identity = String(actor && (actor.id || actor.name) ? (actor.id || actor.name) : '').trim();
        if (!identity || audience.includes(identity)) {
            continue;
        }

        audience.push(identity);
    }

    if (!audience.length) {
        audience.push(NO_MEMORY_VIEWER_ID);
    }

    return audience;
}

async function syncTrackedDeathNoteMemoryMessage(messageIndex) {
    if (!isPresenceActive()) {
        return false;
    }

    const context = getPresenceContext();
    const chat = Array.isArray(context && context.chat ? context.chat : null) ? context.chat : [];
    const index = Number(messageIndex);
    if (!Number.isInteger(index) || index < 0 || index >= chat.length) {
        return false;
    }

    const message = chat[index];
    if (!message || !isDeathNoteMemoryMessage(message)) {
        return false;
    }

    return await setMessagePresenceAudience(index, getDeathNoteMemoryAudience());
}

async function syncAllLinkedShinigamiMessages() {
    if (!isPresenceActive()) {
        return false;
    }

    const context = getPresenceContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    let changed = false;
    for (let index = 0; index < chat.length; index += 1) {
        const didChange = await syncLinkedShinigamiMessage(index);
        if (didChange) {
            changed = true;
        }
    }

    return changed;
}

export async function syncLinkedShinigamiVisibility() {
    if (!isPresenceActive()) {
        return false;
    }

    const context = getPresenceContext();
    const chat = Array.isArray(context && context.chat ? context.chat : null) ? context.chat : [];
    let changed = false;
    for (let index = 0; index < chat.length; index += 1) {
        const linkedChange = await syncLinkedShinigamiMessage(index);
        const memoryChange = await syncTrackedDeathNoteMemoryMessage(index);
        if (linkedChange || memoryChange) {
            changed = true;
        }
    }

    return changed;
}

export function setupPresenceExtension() {
    const context = getPresenceContext();
    const eventSource = context?.eventSource;
    const eventTypes = context?.event_types;
    if (!eventSource || !eventTypes) {
        return;
    }

    eventSource.on(eventTypes.APP_READY, async () => {
        await syncLinkedShinigamiVisibility();
    });

    eventSource.on(eventTypes.CHAT_CHANGED, async () => {
        await syncLinkedShinigamiVisibility();
    });

    eventSource.on(eventTypes.MESSAGE_RECEIVED, async (messageIndex) => {
        await syncLinkedShinigamiMessage(messageIndex);
        await syncTrackedDeathNoteMemoryMessage(messageIndex);
    });

    eventSource.on(eventTypes.MESSAGE_SENT, async (messageIndex) => {
        await syncLinkedShinigamiMessage(messageIndex);
        await syncTrackedDeathNoteMemoryMessage(messageIndex);
    });
}
