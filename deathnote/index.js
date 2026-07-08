import { getSettings, reconcileEntriesFromNotebookText } from './core.js';
import { registerEventHandlers } from './events.js';
import { resolveDueEntriesForAssistantMessage } from './core.js';
import { refreshDeathNoteUi, setupDeathNoteUi } from './ui.js';

export function setupDeathNoteExtension() {
    jQuery(() => {
        getSettings();
        reconcileEntriesFromNotebookText();
        setupDeathNoteUi();
        registerEventHandlers({
            onChatChanged: refreshDeathNoteUi,
            onAssistantMessage: resolveDueEntriesForAssistantMessage,
            onUiRefresh: refreshDeathNoteUi,
        });
        refreshDeathNoteUi();
    });
}

