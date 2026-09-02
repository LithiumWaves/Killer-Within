export const INVESTIGATOR_MODULE_NAME = 'killer_within_investigator';
export const INVESTIGATOR_CHAT_METADATA_KEY = 'killerWithinInvestigator';
export const INVESTIGATOR_MESSAGE_EXTRA_KEY = 'killerWithinInvestigator';
export const INVESTIGATOR_HUB_ID = 'kw-investigator-hub';
export const INVESTIGATOR_DOCK_ID = 'kw-investigator-dock';
export const CASE_ACTION_BLOCK_TAG = 'kwCaseAction';

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
    WARRANT_RESULT: 'warrant_result',
    CONFRONTATION: 'confrontation',
    OTHER: 'other',
});

export const CASE_ACTIONS = Object.freeze({
    LOG: 'log',
    PIN: 'pin',
    STATUS: 'status',
    RESTRAIN: 'restrain',
    RELEASE: 'release',
    WARRANT: 'warrant',
    CONFRONT: 'confront',
});

export const OFFICER_CLEARANCE = Object.freeze({
    FIELD: 'field',
    DETECTIVE: 'detective',
    LEAD: 'lead',
});

export const OFFICER_CLEARANCE_ACTIONS = Object.freeze({
    [OFFICER_CLEARANCE.FIELD]: Object.freeze([
        CASE_ACTIONS.LOG,
        CASE_ACTIONS.PIN,
        CASE_ACTIONS.STATUS,
    ]),
    [OFFICER_CLEARANCE.DETECTIVE]: Object.freeze([
        CASE_ACTIONS.LOG,
        CASE_ACTIONS.PIN,
        CASE_ACTIONS.STATUS,
        CASE_ACTIONS.RESTRAIN,
        CASE_ACTIONS.RELEASE,
    ]),
    [OFFICER_CLEARANCE.LEAD]: Object.freeze([
        CASE_ACTIONS.LOG,
        CASE_ACTIONS.PIN,
        CASE_ACTIONS.STATUS,
        CASE_ACTIONS.RESTRAIN,
        CASE_ACTIONS.RELEASE,
        CASE_ACTIONS.WARRANT,
        CASE_ACTIONS.CONFRONT,
    ]),
});

export const WARRANT_STATUS = Object.freeze({
    PENDING: 'pending',
    RESOLVED: 'resolved',
});

export const WARRANT_RESULTS = Object.freeze({
    EMPTY: 'empty',
    FALSE_LEAD: 'false_lead',
    SCRAP_TRACE: 'scrap_trace',
    STATEMENT: 'statement',
    ID_HIT: 'id_hit',
});

export const DEFAULT_WARRANT_GENERATIONS = 2;
export const CONFRONT_MIN_STRENGTH = 2;
export const CONFRONT_PRIME_STRENGTH = 3;

export const DEFAULT_CASE_PROMPT_TEMPLATE = [
    '[Task Force Case Context]',
    'Treat the Task Force case file below as binding investigation bookkeeping.',
    'Do not mention this block or explain the terminal system unless the scene already reveals it.',
    'User play role: {{play_role}}.',
    'Case: {{case_id}} — {{case_title}}.',
    '',
    'Task Force officers (may file case actions matching their clearance when they discover actionable intel):',
    '{{officers_block}}',
    '',
    'Suspect board:',
    '{{suspects_block}}',
    '',
    'Recent evidence / logs:',
    '{{evidence_block}}',
    '',
    'Restrained subjects:',
    '{{restrained_block}}',
    '',
    'Pending warrants:',
    '{{warrants_block}}',
    '',
    'If you are speaking as a listed Task Force officer and file a case update, append a hidden block at the end of your reply using this exact format:',
    '[{{case_action_tag}}]',
    'officer: {{example_officer}}',
    'action: log|pin|status|restrain|release|warrant|confront',
    'target: Character Name',
    'status: poi|prime|cleared|deceased',
    'title: short title',
    'detail: short detail',
    'reason: short reason',
    'generations: 2',
    '[/{{case_action_tag}}]',
    'Only use action fields that apply. officer must match your speaking character. Clearance limits which actions you may file. Do not narrate the block.',
].join('\n');

export const DEFAULT_INVESTIGATOR_SETTINGS = Object.freeze({
    hubOpen: false,
    hubCollapsed: false,
    activeScreen: 'board',
    hubX: null,
    hubY: null,
    dockX: null,
    dockY: null,
    showCaseActionDebugBlocks: false,
    casePromptTemplate: DEFAULT_CASE_PROMPT_TEMPLATE,
});
