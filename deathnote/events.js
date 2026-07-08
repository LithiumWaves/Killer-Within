import { persistChatChanges } from './core.js';

export function registerEventHandlers({
    onChatChanged,
    onTick,
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
        const result = onTick?.();
        if (result?.ticked) {
            await persistChatChanges();
            refresh();
        }
    });
}

