export const MODULE_NAME = 'killer_within_deathnote';
export const FLOATING_ID = 'kw-deathnote';
export const CHAT_METADATA_KEY = 'killerWithinDeathNote';
export const MESSAGE_EXTRA_KEY = 'killerWithinDeathNote';

export const NOTEBOOK_ACTOR_TYPES = Object.freeze({
    NONE: 'none',
    USER: 'user',
    CHARACTER: 'character',
    SHINIGAMI: 'shinigami',
    WORLD: 'world',
});

export const NOTEBOOK_USER_ACCESS = Object.freeze({
    FULL: 'full_notebook',
    SCRAP: 'scrap',
    TOUCH: 'touch_only',
    NONE: 'none',
});

export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    debug: false,
    isOpen: false,
    requireKnownNamesForKills: true,
    idStealSuccessChancePercent: 75,
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
});

