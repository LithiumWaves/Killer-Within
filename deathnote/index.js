import {
    autoLearnCharacterNameFromMessage,
    processAssistantNotebookWriteMessage,
    processAssistantNotebookReturnMessage,
    processAssistantShinigamiEyesDealMessage,
    autoLearnQuotedCharacterNamesFromMessage,
    autoTrackDeathNoteMemoryMessage,
    consumePendingIdentityTheftExposureForMessage,
    getSettings,
    reconcileEntriesFromNotebookText,
    syncChatStateCacheFromMetadata,
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
            onChatChanged: () => {
                syncChatStateCacheFromMetadata();
                refreshDeathNoteUi();
            },
            onAssistantMessage: resolveDueEntriesForAssistantMessage,
            onMessageAdded: async (messageIndex, details = {}) => {
                const assistantResult = details && details.assistantResult ? details.assistantResult : null;
                const aiNotebookWriteApplied = details?.kind === 'received'
                    ? processAssistantNotebookWriteMessage(messageIndex)
                    : false;
                const notebookReturnApplied = details?.kind === 'received'
                    ? processAssistantNotebookReturnMessage(messageIndex)
                    : false;
                const eyesDealApplied = details?.kind === 'received'
                    ? processAssistantShinigamiEyesDealMessage(messageIndex)
                    : false;
                const memoryTracked = autoTrackDeathNoteMemoryMessage(messageIndex, {
                    resolvedEntries: assistantResult && Array.isArray(assistantResult.resolvedEntries)
                        ? assistantResult.resolvedEntries
                        : [],
                });
                const nameLearned = autoLearnCharacterNameFromMessage(messageIndex);
                const confessionLearned = autoLearnQuotedCharacterNamesFromMessage(messageIndex);
                let identityIngested = false;
                if (details?.kind === 'received') {
                    try {
                        const investigator = await import('../investigator/core.js');
                        identityIngested = Boolean(
                            investigator.ingestIdentityTheftExposureForMessage(messageIndex),
                        );
                    } catch (error) {
                        console.warn('[killer_within_deathnote] Investigator ID-theft ingest skipped', error);
                    }
                }
                const identityExposureConsumed = details?.kind === 'received'
                    ? consumePendingIdentityTheftExposureForMessage(messageIndex)
                    : false;
                if (memoryTracked) {
                    await syncLinkedShinigamiVisibility();
                }
                return aiNotebookWriteApplied
                    || notebookReturnApplied
                    || eyesDealApplied
                    || memoryTracked
                    || nameLearned
                    || confessionLearned
                    || identityIngested
                    || identityExposureConsumed;
            },
            onAssistantMessageFinalized: async (messageIndex) => {
                return processAssistantNotebookWriteMessage(messageIndex)
                    || processAssistantNotebookReturnMessage(messageIndex)
                    || processAssistantShinigamiEyesDealMessage(messageIndex);
            },
            onUiRefresh: refreshDeathNoteUi,
        });
        refreshDeathNoteUi();
    });
}

