import { getLinkedShinigamiPresenceBinding } from '../deathnote/core.js';
import {
    getPresenceContext,
    isMessageAuthoredByPresenceCharacter,
    isPresenceActive,
    setMessagePresenceAudience,
} from './core.js';

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

    const binding = getLinkedShinigamiPresenceBinding();
    if (!binding?.linked) {
        return false;
    }

    const context = getPresenceContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    const index = Number(messageIndex);
    if (!Number.isInteger(index) || index < 0 || index >= chat.length) {
        return false;
    }

    const message = chat[index];
    const shinigamiIdentity = String(binding.shinigami.avatar || binding.shinigami.actor.id || binding.shinigami.actor.name || '').trim();
    if (!message || !shinigamiIdentity || !isMessageAuthoredByPresenceCharacter(message, shinigamiIdentity)) {
        return false;
    }

    return await setMessagePresenceAudience(index, getShinigamiAudience(binding));
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
    return await syncAllLinkedShinigamiMessages();
}

export function setupPresenceExtension() {
    const context = getPresenceContext();
    const eventSource = context?.eventSource;
    const eventTypes = context?.event_types;
    if (!eventSource || !eventTypes) {
        return;
    }

    eventSource.on(eventTypes.APP_READY, async () => {
        await syncAllLinkedShinigamiMessages();
    });

    eventSource.on(eventTypes.CHAT_CHANGED, async () => {
        await syncAllLinkedShinigamiMessages();
    });

    eventSource.on(eventTypes.MESSAGE_RECEIVED, async (messageIndex) => {
        await syncLinkedShinigamiMessage(messageIndex);
    });

    eventSource.on(eventTypes.MESSAGE_SENT, async (messageIndex) => {
        await syncLinkedShinigamiMessage(messageIndex);
    });
}
