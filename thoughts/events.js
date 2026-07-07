export function registerEventHandlers({
    attachPendingThoughtToLatestMessage,
    clearPendingThought,
    refreshThoughtUi,
    queueThoughtRender,
}) {
    const context = globalThis.SillyTavern?.getContext?.() ?? null;
    const { eventSource, event_types } = context ?? {};

    if (!eventSource || !event_types) {
        return;
    }

    eventSource.on(event_types.APP_READY, refreshThoughtUi);

    eventSource.on(event_types.CHAT_CHANGED, () => {
        clearPendingThought();
        refreshThoughtUi();
    });

    eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
        await attachPendingThoughtToLatestMessage(queueThoughtRender);
    });

    eventSource.on(event_types.GENERATION_STOPPED, clearPendingThought);
    eventSource.on(event_types.GENERATION_ENDED, queueThoughtRender);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, queueThoughtRender);
}
