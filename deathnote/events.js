import { getContext, persistChatChanges } from './core.js';

export function registerEventHandlers({
    onChatChanged,
    onAssistantMessage,
    onMessageAdded,
    onAssistantMessageFinalized,
    onUiRefresh,
} = {}) {
    const context = globalThis.SillyTavern?.getContext?.() ?? null;
    const { eventSource, event_types } = context ?? {};

    if (!eventSource || !event_types) {
        return;
    }

    const refresh = () => {
        onUiRefresh?.();
    };

    eventSource.on(event_types.APP_READY, refresh);

    eventSource.on(event_types.CHAT_CHANGED, async () => {
        onChatChanged?.();
        refresh();
    });

    eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
        const latestContext = getContext();
        const chat = Array.isArray(latestContext?.chat) ? latestContext.chat : [];
        const lastMessage = chat.length ? chat[chat.length - 1] : null;
        const signature = Number(lastMessage?.send_date) || chat.length - 1;
        const result = onAssistantMessage?.(signature);
        const autoTracked = await onMessageAdded?.(chat.length - 1, {
            kind: 'received',
            message: lastMessage,
            assistantResult: result,
        });

        if (result?.resolved || autoTracked) {
            await persistChatChanges();
            refresh();
        }
    });

    eventSource.on(event_types.MESSAGE_SENT, async () => {
        const latestContext = getContext();
        const chat = Array.isArray(latestContext?.chat) ? latestContext.chat : [];
        const lastMessage = chat.length ? chat[chat.length - 1] : null;
        const autoTracked = await onMessageAdded?.(chat.length - 1, {
            kind: 'sent',
            message: lastMessage,
        });

        if (autoTracked) {
            await persistChatChanges();
            refresh();
        }
    });

    const finalizeAssistantMessage = async () => {
        const latestContext = getContext();
        const chat = Array.isArray(latestContext?.chat) ? latestContext.chat : [];
        const lastIndex = chat.length - 1;
        const lastMessage = lastIndex >= 0 ? chat[lastIndex] : null;
        if (!lastMessage || lastMessage.is_system || lastMessage.is_user) {
            return;
        }

        const changed = await onAssistantMessageFinalized?.(lastIndex, {
            kind: 'received_finalized',
            message: lastMessage,
        });
        if (changed) {
            await persistChatChanges();
            refresh();
        }
    };

    eventSource.on(event_types.GENERATION_ENDED, finalizeAssistantMessage);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, finalizeAssistantMessage);
}

