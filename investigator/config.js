export const INVESTIGATOR_MODULE_NAME = 'killer_within_investigator';
export const INVESTIGATOR_CHAT_METADATA_KEY = 'killerWithinInvestigator';
export const INVESTIGATOR_HUB_ID = 'kw-investigator-hub';
export const INVESTIGATOR_DOCK_ID = 'kw-investigator-dock';

export const PLAY_ROLES = Object.freeze({
    KIRA: 'kira',
    INVESTIGATOR: 'investigator',
});

export const SUSPECT_STATUSES = Object.freeze({
    PERSON_OF_INTEREST: 'poi',
    PRIME: 'prime',
    CLEARED: 'cleared',
    DECEASED: 'deceased',
});

export const EVIDENCE_TYPES = Object.freeze({
    DEATH_REPORT: 'death_report',
    MANUAL_LOG: 'manual_log',
    NOTEBOOK: 'notebook',
    SCRAP: 'scrap',
    SIGHTING: 'sighting',
    STATEMENT: 'statement',
    OTHER: 'other',
});

export const DEFAULT_INVESTIGATOR_SETTINGS = Object.freeze({
    hubOpen: false,
    hubCollapsed: false,
    activeScreen: 'board',
    hubX: null,
    hubY: null,
});
