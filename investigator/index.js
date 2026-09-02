import {
    getInvestigatorSettings,
    syncDeathReportsIntoTimelineEvidence,
} from './core.js';
import {
    refreshInvestigatorUi,
    registerDeathNoteUiRefresh,
    setupInvestigatorUi,
} from './ui.js';

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
    eventSource.on(event_types.MESSAGE_RECEIVED, refresh);
    eventSource.on(event_types.MESSAGE_SENT, () => refreshInvestigatorUi());
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
