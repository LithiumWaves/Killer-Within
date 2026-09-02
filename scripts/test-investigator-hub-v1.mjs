/**
 * Headless checks for Investigator Hub V1:
 * play role firewall data, restrain→seize custody, write lock, timeline sync.
 */
import assert from 'node:assert/strict';
import {
    MODULE_NAME,
    NOTEBOOK_ACTOR_TYPES,
    NOTEBOOK_USER_ACCESS,
    PLAY_ROLES,
} from '../deathnote/config.js';
import { INVESTIGATOR_CHAT_METADATA_KEY } from '../investigator/config.js';

const metadataByChatId = new Map();
const extensionSettings = {
    [MODULE_NAME]: {
        playRole: PLAY_ROLES.INVESTIGATOR,
        enabled: true,
    },
};

let chatId = 'investigator-test-chat';
let characterId = 0;

function ensureChatMetadata(id) {
    if (!metadataByChatId.has(id)) {
        metadataByChatId.set(id, {});
    }
    return metadataByChatId.get(id);
}

globalThis.SillyTavern = {
    getContext() {
        return {
            chatId,
            chatMetadata: ensureChatMetadata(chatId),
            extensionSettings,
            chat: [],
            characters: [
                { avatar: 'light.png', name: 'Light Yagami', description: '' },
                { avatar: 'misa.png', name: 'Misa Amane', description: '' },
                { avatar: 'l.png', name: 'L Lawliet', description: '' },
            ],
            groups: null,
            characterId,
            saveSettingsDebounced() {},
            saveChat: async () => {},
        };
    },
};

const {
    createDeathNote,
    createNotebookScrap,
    getChatState,
    getDeathNotes,
    getNotebookPages,
    getSettings,
    setNotebookPages,
    syncChatStateCacheFromMetadata,
} = await import('../deathnote/core.js');

const {
    getInvestigatorState,
    getInvestigatorVictimTimeline,
    getPlayRole,
    isInvestigatorRole,
    pinSuspect,
    restrainActor,
    seizeNotebook,
    seizeScrap,
    setPlayRole,
    syncDeathReportsIntoTimelineEvidence,
} = await import('../investigator/core.js');

function switchChat(nextChatId) {
    chatId = String(nextChatId);
    syncChatStateCacheFromMetadata();
}

function reset() {
    metadataByChatId.clear();
    extensionSettings[MODULE_NAME] = {
        playRole: PLAY_ROLES.INVESTIGATOR,
        enabled: true,
    };
    switchChat(`investigator-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

reset();

// Play role defaults / switch
{
    assert.equal(getPlayRole(), PLAY_ROLES.INVESTIGATOR);
    assert.equal(isInvestigatorRole(), true);
    setPlayRole(PLAY_ROLES.KIRA);
    assert.equal(getPlayRole(), PLAY_ROLES.KIRA);
    assert.equal(getSettings().playRole, PLAY_ROLES.KIRA);
    setPlayRole(PLAY_ROLES.INVESTIGATOR);
    assert.equal(isInvestigatorRole(), true);
}

// Seize requires restraint
{
    reset();
    setPlayRole(PLAY_ROLES.INVESTIGATOR);
    const holder = {
        type: NOTEBOOK_ACTOR_TYPES.CHARACTER,
        id: 'light.png',
        name: 'Light Yagami',
    };
    const notebook = createDeathNote({
        holder,
        owner: holder,
        userAccess: NOTEBOOK_USER_ACCESS.NONE,
    });
    assert.ok(notebook?.itemId);
    setNotebookPages(['Light Yagami dies of a heart attack'], notebook.itemId);

    const blocked = seizeNotebook(notebook.itemId);
    assert.equal(blocked.applied, false);
    assert.equal(blocked.reason, 'not_restrained');

    restrainActor(holder, { reason: 'Taken into custody' });
    const seized = seizeNotebook(notebook.itemId);
    assert.equal(seized.applied, true, `expected seize success, got ${JSON.stringify(seized)}`);

    const live = getDeathNotes().find((entry) => entry.itemId === notebook.itemId);
    assert.ok(live);
    assert.equal(live.evidenceCustody, true);
    assert.equal(live.holder?.type, NOTEBOOK_ACTOR_TYPES.WORLD);
    assert.equal(live.userAccess, NOTEBOOK_USER_ACCESS.NONE);

    // Writes blocked while in evidence custody
    const writeBlocked = setNotebookPages(['should not write'], notebook.itemId);
    assert.equal(writeBlocked, false);
    assert.equal(getNotebookPages(notebook.itemId).join(''), 'Light Yagami dies of a heart attack');

    const state = getInvestigatorState();
    assert.ok(state.seizedNotebookIds.includes(notebook.itemId));
    assert.ok(state.evidence.some((entry) => entry.type === 'notebook' && entry.itemRef?.id === notebook.itemId));
    assert.ok(state.suspects.some((entry) => entry.actor?.name === 'Light Yagami'));
}

// Scrap seize path
{
    reset();
    setPlayRole(PLAY_ROLES.INVESTIGATOR);
    const holder = {
        type: NOTEBOOK_ACTOR_TYPES.CHARACTER,
        id: 'misa.png',
        name: 'Misa Amane',
    };
    const notebook = createDeathNote({
        holder,
        owner: holder,
        userAccess: NOTEBOOK_USER_ACCESS.NONE,
    });
    const scrap = createNotebookScrap({
        notebookItemId: notebook.itemId,
        holder,
        owner: holder,
        noteText: 'Misa scrap line',
    });
    assert.ok(scrap?.id);
    restrainActor(holder);
    const seized = seizeScrap(scrap.id);
    assert.equal(seized.applied, true, `scrap seize failed: ${JSON.stringify(seized)}`);
    const state = getInvestigatorState();
    assert.ok(state.seizedScrapIds.includes(scrap.id));
}

// Victim timeline from resolved entries
{
    reset();
    setPlayRole(PLAY_ROLES.INVESTIGATOR);
    const deathState = getChatState();
    deathState.entries = [
        {
            id: 'e1',
            status: 'resolved',
            targetName: 'Victim One',
            targetType: NOTEBOOK_ACTOR_TYPES.NPC,
            cause: 'heart attack',
            noteText: 'Victim One',
            resolvedAt: 1000,
            createdAt: 500,
        },
        {
            id: 'e2',
            status: 'pending',
            targetName: 'Not Yet',
            targetType: NOTEBOOK_ACTOR_TYPES.NPC,
            cause: 'heart attack',
            resolvedAt: null,
        },
    ];
    const timeline = getInvestigatorVictimTimeline();
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].targetName, 'Victim One');
    const synced = syncDeathReportsIntoTimelineEvidence();
    assert.equal(synced.added, 1);
    const again = syncDeathReportsIntoTimelineEvidence();
    assert.equal(again.added, 0);
    assert.ok(getInvestigatorState().evidence.some((entry) => entry.type === 'death_report'));
}

// Pin suspect
{
    reset();
    pinSuspect({ type: NOTEBOOK_ACTOR_TYPES.CHARACTER, id: 'l.png', name: 'L Lawliet' }, { notes: 'Watching' });
    const state = getInvestigatorState();
    assert.equal(state.suspects.length, 1);
    assert.equal(state.suspects[0].actor.name, 'L Lawliet');
}

// Chat-scoped investigator metadata isolation
{
    reset();
    pinSuspect({ type: NOTEBOOK_ACTOR_TYPES.CHARACTER, id: 'l.png', name: 'L Lawliet' });
    const firstChat = chatId;
    assert.equal(getInvestigatorState().suspects.length, 1);
    switchChat(`investigator-other-${Date.now()}`);
    assert.equal(getInvestigatorState().suspects.length, 0);
    assert.ok(ensureChatMetadata(firstChat)[INVESTIGATOR_CHAT_METADATA_KEY]?.suspects?.length === 1);
}

console.log('investigator hub v1 tests passed');
