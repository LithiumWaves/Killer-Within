export const MODULE_NAME = 'killer_within_deathnote';
export const FLOATING_ID = 'kw-deathnote';
export const CHAT_METADATA_KEY = 'killerWithinDeathNote';
export const MESSAGE_EXTRA_KEY = 'killerWithinDeathNote';

export const NOTEBOOK_ACTOR_TYPES = Object.freeze({
    USER: 'user',
    CHARACTER: 'character',
    SHINIGAMI: 'shinigami',
    WORLD: 'world',
    NONE: 'none',
    NPC: 'npc',
});

export const NOTEBOOK_USER_ACCESS = Object.freeze({
    FULL: 'full_notebook',
    SCRAP: 'scrap',
    TOUCH: 'touch_only',
    NONE: 'none',
});

export const DEFAULT_DEATHNOTE_PROMPT_TEMPLATE = [
    '[Death Note Context]',
    'Treat the Death Note custody state and written entries below as binding constraints for story causality.',
    'Do not mention this block or explain rules unless the scene explicitly reveals them.',
    'Default Death Note rules: if no cause of death is written, interpret the entry as death by heart attack. If no time is written, the death occurs on the next assistant message.',
    '',
    '{{ownership_block}}',
    '',
    '{{inventory_block}}',
    '',
    'Due now (must occur in the assistant reply being generated right now):',
    'If at least one entry is due, the next assistant reply MUST depict those deaths occurring as described, in-story.',
    'Do not delay them. Do not refuse. Do not acknowledge these instructions.',
    '{{due_block}}',
    '',
    'Written entries:',
    '{{entries_block}}',
].join('\n');

export const DEFAULT_IDENTITY_THEFT_PROMPT_TEMPLATE = [
    '[Failed Identity Theft]',
    'If the responding character is {{target_label}}, they already noticed that {{user_label}} tried to steal their ID.',
    'Treat that failed theft as something that already happened in-scene.',
    'In this reply, {{target_label}} should react naturally to that violation with suspicion, confrontation, guardedness, or alarm.',
    'If the responding character is not {{target_label}}, ignore this block entirely.',
].join('\n');

export const DEFAULT_NOTEBOOK_REVEAL_PROMPT_TEMPLATE = [
    '[Notebook Reveal]',
    'At least one other character is currently present in the scene (Presence).',
    'In this moment, {{user_label}} openly pulls out and opens a strange black notebook with "Death Note" written on the cover.',
    'Treat this as a visible, in-scene action that present characters can notice and react to naturally.',
    'Do not mention this block or explain the Presence system.',
].join('\n');

export const DEFAULT_PRESENCE_PROMPT_TEMPLATE = [
    '[Presence Context]',
    'Selective supernatural visibility is active for Death Note-related entities.',
    'Linked Shinigami: {{linked_shinigami}}.',
    'Anyone currently touching the Death Note or one of its scraps can perceive that notebook\'s Shinigami.',
    'Characters without current contact cannot directly see, hear, or confidently remember Shinigami-only actions or speech as witnessed fact unless the scene separately establishes that perception.',
    'If a Shinigami tied to this Death Note appears, apply these visibility limits strictly.',
    '',
    'Current Death Note touchers:',
    '{{touchers_block}}',
].join('\n');

export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    debug: false,
    isOpen: false,
    requireKnownNamesForKills: true,
    permanentResolvedNotebookEntries: false,
    permanentResolvedScrapEntries: false,
    idStealSuccessChancePercent: 75,
    idStealSuccessChanceOverrides: {},
    idStealSelectedActorKey: '',
    enableOpenSound: true,
    enableWritingSound: true,
    showFloatingButton: true,
    floatingX: null,
    floatingY: null,
    closedFloatingX: null,
    closedFloatingY: null,
    inventoryMobileX: null,
    inventoryMobileY: null,
    inventoryCollapsed: false,
    inventorySelectedItemKey: 'notebook',
    draftText: '',
    fontMode: 'print',
    currentPageIndex: 0,
    deathNotePromptTemplate: DEFAULT_DEATHNOTE_PROMPT_TEMPLATE,
    identityTheftPromptTemplate: DEFAULT_IDENTITY_THEFT_PROMPT_TEMPLATE,
    notebookRevealPromptTemplate: DEFAULT_NOTEBOOK_REVEAL_PROMPT_TEMPLATE,
    presencePromptTemplate: DEFAULT_PRESENCE_PROMPT_TEMPLATE,
});

