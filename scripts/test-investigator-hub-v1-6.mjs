/**
 * Headless checks for Investigator missing loop:
 * interrogate → statement clip, failed ID-theft ingest, evidence release, trust meter.
 */
import assert from 'node:assert/strict';
import {
    MODULE_NAME,
    NOTEBOOK_ACTOR_TYPES,
    NOTEBOOK_USER_ACCESS,
    PLAY_ROLES,
} from '../deathnote/config.js';
import {
    CASE_ACTION_BLOCK_TAG,
    EVIDENCE_CUSTODY,
    EVIDENCE_TYPES,
    INTERROGATION_STATUS,
    INVESTIGATOR_MODULE_NAME,
    OFFICER_CLEARANCE,
    SUSPECT_STATUSES,
    TASK_FORCE_TRUST_BLOCK,
} from '../investigator/config.js';

const metadataByChatId = new Map();
const extensionSettings = {
    [MODULE_NAME]: {
        playRole: PLAY_ROLES.INVESTIGATOR,
        enabled: true,
    },
    [INVESTIGATOR_MODULE_NAME]: {},
};

let chatId = 'investigator-v16-chat';
let characterId = 0;
let chat = [];

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
            chat,
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
    getChatState,
    getDeathNotes,
    setNotebookPages,
    syncChatStateCacheFromMetadata,
} = await import('../deathnote/core.js');

const {
    adjustTaskForceTrust,
    applyCaseAction,
    assignOfficer,
    buildCasePromptReplacements,
    confrontSuspect,
    endInterrogation,
    fileWarrant,
    getInvestigatorState,
    getTaskForceTrust,
    ingestIdentityTheftExposureForMessage,
    isTaskForceTrustBlocked,
    linkEvidenceToSuspect,
    logEvidence,
    pinSuspect,
    processInterrogationMessage,
    releaseSeizedEvidence,
    restrainActor,
    seizeNotebook,
    setPlayRole,
    startInterrogation,
} = await import('../investigator/core.js');

function switchChat(nextChatId) {
    chatId = String(nextChatId);
    chat = [];
    syncChatStateCacheFromMetadata();
}

function reset() {
    metadataByChatId.clear();
    extensionSettings[MODULE_NAME] = {
        playRole: PLAY_ROLES.INVESTIGATOR,
        enabled: true,
    };
    extensionSettings[INVESTIGATOR_MODULE_NAME] = {};
    switchChat(`investigator-v16-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function officerActor(name = 'L Lawliet', id = 'l.png') {
    return {
        type: NOTEBOOK_ACTOR_TYPES.CHARACTER,
        id,
        name,
    };
}

function suspectActor(name = 'Light Yagami', id = 'light.png') {
    return {
        type: NOTEBOOK_ACTOR_TYPES.CHARACTER,
        id,
        name,
    };
}

function addLinkedEvidence(target, count = 2) {
    pinSuspect(target, { status: SUSPECT_STATUSES.PERSON_OF_INTEREST });
    const key = getInvestigatorState().suspects[0].key;
    for (let index = 0; index < count; index += 1) {
        const evidence = logEvidence({
            type: EVIDENCE_TYPES.STATEMENT,
            title: `Lead ${index + 1}`,
            detail: `Strength filler ${index + 1}`,
            source: 'test',
        }).evidence;
        linkEvidenceToSuspect(evidence.id, key);
    }
    return key;
}

reset();

// Interrogate → statement clip loop, with dedupe
{
    const target = suspectActor();
    const started = startInterrogation(target);
    assert.equal(started.applied, true);
    assert.equal(started.interrogation.status, INTERROGATION_STATUS.ACTIVE);
    assert.equal(getInvestigatorState().interrogations.length, 1);

    chat = [{
        name: 'Light Yagami',
        original_avatar: 'light.png',
        is_user: false,
        is_system: false,
        send_date: 9001,
        mes: `I was at school. ${'x'.repeat(600)}`,
        extra: {},
    }];

    assert.equal(processInterrogationMessage(0), true);
    const statements = getInvestigatorState().evidence.filter((entry) => entry.type === EVIDENCE_TYPES.STATEMENT);
    assert.equal(statements.length, 1);
    assert.equal(statements[0].title, 'Statement: Light Yagami');
    assert.ok(statements[0].detail.length <= 500);
    assert.ok(getInvestigatorState().suspects.some((entry) => (
        entry.linkedEvidenceIds.includes(statements[0].id)
    )));

    assert.equal(processInterrogationMessage(0), false, 'duplicate clip should no-op');
    assert.equal(getInvestigatorState().evidence.filter((entry) => entry.type === EVIDENCE_TYPES.STATEMENT).length, 1);

    assert.equal(endInterrogation(target).applied, true);
    chat.push({
        name: 'Light Yagami',
        original_avatar: 'light.png',
        is_user: false,
        is_system: false,
        send_date: 9002,
        mes: 'This should not clip after interrogation ended.',
        extra: {},
    });
    assert.equal(processInterrogationMessage(1), false);
}

reset();

// Officer kwCaseAction interrogate start/end; field clearance blocked
{
    const speaker = officerActor();
    assignOfficer(speaker, { rank: 'Officer', clearance: OFFICER_CLEARANCE.FIELD });
    const blocked = applyCaseAction({
        officer: 'L Lawliet',
        action: 'interrogate',
        target: 'Light Yagami',
    }, speaker);
    assert.equal(blocked.applied, false);
    assert.equal(blocked.reason, 'insufficient_clearance');

    assignOfficer(speaker, { clearance: OFFICER_CLEARANCE.DETECTIVE });
    const started = applyCaseAction({
        officer: 'L Lawliet',
        action: 'interrogate',
        target: 'Light Yagami',
    }, speaker);
    assert.equal(started.applied, true);
    assert.equal(getInvestigatorState().interrogations[0].status, INTERROGATION_STATUS.ACTIVE);

    const ended = applyCaseAction({
        officer: 'L Lawliet',
        action: 'interrogate',
        target: 'Light Yagami',
        note: 'end',
    }, speaker);
    assert.equal(ended.applied, true);
    assert.equal(getInvestigatorState().interrogations[0].status, INTERROGATION_STATUS.ENDED);
}

reset();

// Failed ID-theft ingest logs sighting, pins POI, then bumps to prime
{
    const target = suspectActor();
    const createdAt = 424242;
    getChatState().identityTheft.pendingExposure = {
        active: true,
        actor: target,
        createdAt,
    };
    chat = [{
        name: 'Light Yagami',
        original_avatar: 'light.png',
        is_user: false,
        is_system: false,
        mes: 'Who just tried that?',
        extra: {},
    }];

    assert.equal(ingestIdentityTheftExposureForMessage(0), true);
    const state = getInvestigatorState();
    assert.equal(state.idTheftIngestedAt, createdAt);
    assert.ok(state.evidence.some((entry) => (
        entry.type === EVIDENCE_TYPES.SIGHTING
        && entry.source === 'id_theft_exposure'
        && entry.title.includes('Light Yagami')
    )));
    assert.equal(state.suspects[0].status, SUSPECT_STATUSES.PERSON_OF_INTEREST);
    assert.equal(ingestIdentityTheftExposureForMessage(0), false);

    getChatState().identityTheft.pendingExposure = {
        active: true,
        actor: target,
        createdAt: createdAt + 10,
    };
    chat[0].mes = 'That was you.';
    assert.equal(ingestIdentityTheftExposureForMessage(0), true);
    assert.equal(getInvestigatorState().suspects[0].status, SUSPECT_STATUSES.PRIME);
}

reset();

// Evidence release returns seized notebook and keeps locker row as released
{
    setPlayRole(PLAY_ROLES.INVESTIGATOR);
    const holder = suspectActor();
    const notebook = createDeathNote({
        holder,
        owner: holder,
        userAccess: NOTEBOOK_USER_ACCESS.NONE,
    });
    setNotebookPages(['Light Yagami dies of a heart attack'], notebook.itemId);
    restrainActor(holder, { reason: 'Custody' });
    const seized = seizeNotebook(notebook.itemId);
    assert.equal(seized.applied, true);
    assert.equal(seized.evidence.custody, EVIDENCE_CUSTODY.HELD);

    const released = releaseSeizedEvidence(seized.evidence.id);
    assert.equal(released.applied, true, `release failed: ${JSON.stringify(released)}`);
    assert.equal(released.evidence.custody, EVIDENCE_CUSTODY.RELEASED);
    assert.equal(released.target?.name, 'Light Yagami');

    const live = getDeathNotes().find((entry) => entry.itemId === notebook.itemId);
    assert.ok(live);
    assert.equal(live.evidenceCustody, false);
    assert.equal(live.holder?.type, NOTEBOOK_ACTOR_TYPES.CHARACTER);
    assert.equal(live.holder?.name, 'Light Yagami');
    assert.equal(getInvestigatorState().seizedNotebookIds.includes(notebook.itemId), false);
    assert.ok(getInvestigatorState().evidence.some((entry) => (
        entry.id === seized.evidence.id && entry.custody === EVIDENCE_CUSTODY.RELEASED
    )));

    const rewrite = setNotebookPages(['rewritten after release'], notebook.itemId);
    assert.equal(rewrite, true);
}

reset();

// Trust meter: default 70, overreach drops, block < 25
{
    assert.equal(getTaskForceTrust(), 70);
    assert.equal(isTaskForceTrustBlocked(), false);

    const target = suspectActor();
    addLinkedEvidence(target, 2);
    pinSuspect(target, { status: SUSPECT_STATUSES.PERSON_OF_INTEREST });
    const overreach = confrontSuspect(target, { note: 'Noise' });
    assert.equal(overreach.applied, true);
    assert.equal(overreach.outcome, 'overreach');
    assert.equal(getTaskForceTrust(), 55);

    adjustTaskForceTrust(-40, 'test drain');
    assert.equal(getTaskForceTrust(), 15);
    assert.equal(isTaskForceTrustBlocked(), true);

    const warrant = fileWarrant(target, { generations: 1, note: 'Should block' });
    assert.equal(warrant.applied, false);
    assert.equal(warrant.reason, 'trust_blocked');

    const confront = confrontSuspect(target, { note: 'Should block' });
    assert.equal(confront.applied, false);
    assert.equal(confront.reason, 'trust_blocked');
    assert.ok(getTaskForceTrust() < TASK_FORCE_TRUST_BLOCK);
}

reset();

// Prompt replacements include trust + interrogations
{
    startInterrogation(suspectActor());
    const replacements = buildCasePromptReplacements();
    assert.equal(replacements.tf_trust, '70');
    assert.match(replacements.interrogations_block, /Light Yagami/);
    assert.match(replacements.interrogations_block, /clip:on/);
}

reset();

{
    assignOfficer(officerActor(), { rank: 'Lead', clearance: OFFICER_CLEARANCE.LEAD });
    const replacements = buildCasePromptReplacements();
    assert.match(replacements.officers_block, /clearance:lead/i);
    assert.equal(replacements.interrogations_block, 'No active interrogations.');
}

console.log('investigator-hub-v1-6 tests passed');
