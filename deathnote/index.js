import {
    autoLearnCharacterNameFromMessage,
    processAssistantNotebookWriteMessage,
    autoLearnQuotedCharacterNamesFromMessage,
    autoTrackDeathNoteMemoryMessage,
    consumePendingIdentityTheftExposureForMessage,
    getSettings,
    reconcileEntriesFromNotebookText,
} from './core.js';
import { registerEventHandlers } from './events.js';
import { resolveDueEntriesForAssistantMessage } from './core.js';
import { syncLinkedShinigamiVisibility } from '../presence/index.js';
import { refreshDeathNoteUi, setupDeathNoteUi } from './ui.js';

export function setupDeathNoteExtension() {
    jQuery(() => {
        getSettings();
        reconcileEntriesFromNotebookText();
        setupDeathNoteUi();
        registerEventHandlers({
            onChatChanged: refreshDeathNoteUi,
            onAssistantMessage: resolveDueEntriesForAssistantMessage,
            onMessageAdded: async (messageIndex, details = {}) => {
                const assistantResult = details && details.assistantResult ? details.assistantResult : null;
                const aiNotebookWriteApplied = details?.kind === 'received'
                    ? processAssistantNotebookWriteMessage(messageIndex)
                    : false;
                const memoryTracked = autoTrackDeathNoteMemoryMessage(messageIndex, {
                    resolvedEntries: assistantResult && Array.isArray(assistantResult.resolvedEntries)
                        ? assistantResult.resolvedEntries
                        : [],
                });
                const nameLearned = autoLearnCharacterNameFromMessage(messageIndex);
                const confessionLearned = autoLearnQuotedCharacterNamesFromMessage(messageIndex);
                const identityExposureConsumed = details?.kind === 'received'
                    ? consumePendingIdentityTheftExposureForMessage(messageIndex)
                    : false;
                if (memoryTracked) {
                    await syncLinkedShinigamiVisibility();
                }
                return aiNotebookWriteApplied || memoryTracked || nameLearned || confessionLearned || identityExposureConsumed;
            },
            onUiRefresh: refreshDeathNoteUi,
        });
        refreshDeathNoteUi();
    });
}

