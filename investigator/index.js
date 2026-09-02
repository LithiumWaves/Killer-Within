import {
    getInvestigatorSettings,
    ingestIdentityTheftExposureForMessage,
    processAssistantCaseActionMessage,
    processInterrogationMessage,
    syncDeathReportsIntoTimelineEvidence,
} from './core.js';
import { persistChatChanges } from '../deathnote/core.js';
import {
    refreshInvestigatorUi,
    registerDeathNoteUiRefresh,
    setupInvestigatorUi,
} from './ui.js';

function processLatestInvestigatorEffects() {
    const context = globalThis.SillyTavern?.getContext?.() ?? null;
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    const lastIndex = chat.length - 1;
    if (lastIndex < 0) {
        return false;
    }
    const ingested = ingestIdentityTheftExposureForMessage(lastIndex);
    const caseChanged = processAssistantCaseActionMessage(lastIndex);
    const clipped = processInterrogationMessage(lastIndex);
    return ingested || clipped || caseChanged;
}

function registerInvestigatorEvents() {
    const context = globalThis.SillyTavern?.getContext?.() ?? null;
    const { eventSource, event_types } = context ?? {};
    if (!eventSource || !event_types) {
        return;
    }

    const refresh = () => {
        syncDeathReportsIntoTimelineEvidence();
        refreshInvestigatorUi();
    };

    eventSource.on(event_types.APP_READY, refresh);
    eventSource.on(event_types.CHAT_CHANGED, refresh);
    eventSource.on(event_types.MESSAGE_SENT, () => refreshInvestigatorUi());

    eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
        const changed = processLatestInvestigatorEffects();
        if (changed) {
            await persistChatChanges();
        }
        refresh();
    });

    const finalizeAssistantMessage = async () => {
        const changed = processLatestInvestigatorEffects();
        if (changed) {
            await persistChatChanges();
            refresh();
        }
    };

    eventSource.on(event_types.GENERATION_ENDED, finalizeAssistantMessage);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, finalizeAssistantMessage);
}

export function setupInvestigatorExtension() {
    jQuery(() => {
        getInvestigatorSettings();
        setupInvestigatorUi();
        registerInvestigatorEvents();
        refreshInvestigatorUi();

        // Late-bind Death Note UI refresh so role switches tear down Kira widgets.
        void import('../deathnote/ui.js')
            .then((module) => {
                if (typeof module.refreshDeathNoteUi === 'function') {
                    registerDeathNoteUiRefresh(module.refreshDeathNoteUi);
                }
            })
            .catch((error) => {
                console.warn('[killer_within_investigator] Could not bind Death Note UI refresh', error);
            });
    });
}

export { refreshInvestigatorUi };
