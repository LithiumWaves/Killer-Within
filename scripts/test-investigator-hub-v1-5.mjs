/**
 * Headless checks for Investigator Hub V1.5:
 * officers, clearance, warrants, confront, kwCaseAction, case prompt injection.
 */
import assert from 'node:assert/strict';
import {
    MODULE_NAME,
    NOTEBOOK_ACTOR_TYPES,
    PLAY_ROLES,
} from '../deathnote/config.js';
import {
    CASE_ACTION_BLOCK_TAG,
    INVESTIGATOR_MODULE_NAME,
    OFFICER_CLEARANCE,
    WARRANT_STATUS,
} from '../investigator/config.js';

const metadataByChatId = new Map();
const extensionSettings = {
    [MODULE_NAME]: {
        playRole: PLAY_ROLES.INVESTIGATOR,
        enabled: true,
    },
    [INVESTIGATOR_MODULE_NAME]: {},
};

let chatId = 'investigator-v15-chat';
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

const { syncChatStateCacheFromMetadata } = await import('../deathnote/core.js');

const {
    applyCaseAction,
    assignOfficer,
    buildCasePromptReplacements,
    confrontSuspect,
    fileWarrant,
    getCaseStrength,
    getInvestigatorState,
    isTaskForceOfficer,
    linkEvidenceToSuspect,
    logEvidence,
    pinSuspect,
    processAssistantCaseActionMessage,
    removeOfficer,
    setPlayRole,
    tickWarrantsForGeneration,
} = await import('../investigator/core.js');

const {
    getInvestigatorCasePromptInjectionMessage,
    shouldInjectInvestigatorCasePrompt,
} = await import('../investigator/prompts.js');

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
    switchChat(`investigator-v15-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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

reset();

// Officers assign / remove / membership / clearance
{
    const created = assignOfficer(officerActor(), { rank: 'Lead', clearance: OFFICER_CLEARANCE.LEAD });
    assert.equal(created.applied, true);
    assert.equal(created.officer.rank, 'Lead');
    assert.equal(created.officer.clearance, OFFICER_CLEARANCE.LEAD);
    assert.equal(isTaskForceOfficer(officerActor()), true);
    assert.equal(getInvestigatorState().officers.length, 1);

    const updated = assignOfficer(officerActor(), { rank: 'Chief', clearance: OFFICER_CLEARANCE.LEAD });
    assert.equal(updated.applied, true);
    assert.equal(updated.reason, 'updated');
    assert.equal(getInvestigatorState().officers[0].rank, 'Chief');

    const removed = removeOfficer(officerActor());
    assert.equal(removed.applied, true);
    assert.equal(isTaskForceOfficer(officerActor()), false);
    assert.equal(getInvestigatorState().officers.length, 0);
}

reset();

// Clearance gates advanced actions
{
    const speaker = officerActor();
    assignOfficer(speaker, { rank: 'Officer', clearance: OFFICER_CLEARANCE.FIELD });
    const blocked = applyCaseAction({
        officer: 'L Lawliet',
        action: 'restrain',
        target: 'Light Yagami',
        reason: 'No clearance',
    }, speaker);
    assert.equal(blocked.applied, false);
    assert.equal(blocked.reason, 'insufficient_clearance');

    assignOfficer(speaker, { clearance: OFFICER_CLEARANCE.DETECTIVE });
    const allowed = applyCaseAction({
        officer: 'L Lawliet',
        action: 'restrain',
        target: 'Light Yagami',
        reason: 'Detective custody',
    }, speaker);
    assert.equal(allowed.applied, true);
}

reset();

// Case actions require Task Force officer + matching officer field
{
    const speaker = officerActor();
    assignOfficer(speaker, { rank: 'Detective', clearance: OFFICER_CLEARANCE.DETECTIVE });

    const rejected = applyCaseAction({
        officer: 'Wrong Name',
        action: 'log',
        title: 'Bad report',
        detail: 'Nope',
    }, speaker);
    assert.equal(rejected.applied, false);
    assert.equal(rejected.reason, 'officer_mismatch');

    const outsider = applyCaseAction({
        officer: 'Light Yagami',
        action: 'log',
        title: 'Outsider',
    }, suspectActor());
    assert.equal(outsider.applied, false);
    assert.equal(outsider.reason, 'not_officer');

    const logged = applyCaseAction({
        officer: 'L Lawliet',
        action: 'log',
        title: 'Witness statement',
        detail: 'Saw suspicious writing.',
        type: 'statement',
    }, speaker);
    assert.equal(logged.applied, true);
    assert.ok(getInvestigatorState().evidence.some((entry) => entry.title === 'Witness statement'));

    const pinned = applyCaseAction({
        officer: 'L Lawliet',
        action: 'pin',
        target: 'Light Yagami',
        status: 'prime',
        detail: 'Primary suspect.',
    }, speaker);
    assert.equal(pinned.applied, true);
    assert.equal(getInvestigatorState().suspects[0].status, 'prime');

    const statused = applyCaseAction({
        officer: 'L Lawliet',
        action: 'status',
        target: 'Light Yagami',
        status: 'poi',
    }, speaker);
    assert.equal(statused.applied, true);
    assert.equal(getInvestigatorState().suspects[0].status, 'poi');

    const restrained = applyCaseAction({
        officer: 'L Lawliet',
        action: 'restrain',
        target: 'Light Yagami',
        reason: 'For questioning',
    }, speaker);
    assert.equal(restrained.applied, true);
    assert.equal(getInvestigatorState().restrained.length, 1);

    const released = applyCaseAction({
        officer: 'L Lawliet',
        action: 'release',
        target: 'Light Yagami',
    }, speaker);
    assert.equal(released.applied, true);
    assert.equal(getInvestigatorState().restrained.length, 0);
}

reset();

// Warrants resolve after generation ticks; confront gates on case strength
{
    const target = suspectActor();
    pinSuspect(target, { status: 'poi' });

    const weakConfront = confrontSuspect(target, { note: 'Too early' });
    assert.equal(weakConfront.applied, false);
    assert.equal(weakConfront.reason, 'insufficient_strength');

    const warrant = fileWarrant(target, { generations: 2, note: 'Search apartment' });
    assert.equal(warrant.applied, true);
    assert.equal(getInvestigatorState().warrants[0].status, WARRANT_STATUS.PENDING);

    tickWarrantsForGeneration(1);
    assert.equal(getInvestigatorState().warrants[0].generationsLeft, 1);
    assert.equal(getInvestigatorState().warrants[0].status, WARRANT_STATUS.PENDING);

    const resolvedTick = tickWarrantsForGeneration(2);
    assert.equal(resolvedTick.resolved.length, 1);
    assert.equal(getInvestigatorState().warrants[0].status, WARRANT_STATUS.RESOLVED);
    assert.ok(getInvestigatorState().evidence.some((entry) => entry.type === 'warrant_result'));

    const evidence = logEvidence({
        type: 'statement',
        title: 'Linked lead',
        detail: 'Builds case strength',
        source: 'test',
    }).evidence;
    linkEvidenceToSuspect(evidence.id, getInvestigatorState().suspects[0].key);
    pinSuspect(target, { status: 'prime' });
    assert.ok(getCaseStrength(target).strength >= 2);

    const strongConfront = confrontSuspect(target, { note: 'Prime pressure' });
    assert.equal(strongConfront.applied, true);
    assert.ok(['pressure', 'probable_cause', 'overreach'].includes(strongConfront.outcome));
}

reset();

// Lead officer can file warrant via kwCaseAction
{
    assignOfficer(officerActor(), { rank: 'Lead', clearance: OFFICER_CLEARANCE.LEAD });
    chat = [{
        name: 'L Lawliet',
        original_avatar: 'l.png',
        is_user: false,
        is_system: false,
        mes: [
            'Filing a search.',
            `[${CASE_ACTION_BLOCK_TAG}]`,
            'officer: L Lawliet',
            'action: warrant',
            'target: Light Yagami',
            'generations: 1',
            'note: Room search',
            `[/${CASE_ACTION_BLOCK_TAG}]`,
        ].join('\n'),
        extra: {},
    }];
    assert.equal(processAssistantCaseActionMessage(0), true);
    assert.equal(getInvestigatorState().warrants.length, 1);
    assert.doesNotMatch(String(chat[0].mes), new RegExp(CASE_ACTION_BLOCK_TAG, 'i'));
}

reset();

// processAssistantCaseActionMessage applies + strips hidden blocks
{
    assignOfficer(officerActor(), { rank: 'Lead', clearance: OFFICER_CLEARANCE.LEAD });
    chat = [{
        name: 'L Lawliet',
        original_avatar: 'l.png',
        is_user: false,
        is_system: false,
        mes: [
            'We should treat Light as a person of interest.',
            `[${CASE_ACTION_BLOCK_TAG}]`,
            'officer: L Lawliet',
            'action: pin',
            'target: Light Yagami',
            'status: poi',
            'detail: Case board update from scene.',
            `[/${CASE_ACTION_BLOCK_TAG}]`,
        ].join('\n'),
        extra: {},
    }];

    const changed = processAssistantCaseActionMessage(0);
    assert.equal(changed, true);
    assert.equal(getInvestigatorState().suspects.length, 1);
    assert.equal(getInvestigatorState().suspects[0].status, 'poi');
    assert.match(String(chat[0].mes), /person of interest/i);
    assert.doesNotMatch(String(chat[0].mes), new RegExp(CASE_ACTION_BLOCK_TAG, 'i'));
    assert.equal(chat[0].extra.killerWithinInvestigator.caseAction.applied, true);
    assert.equal(chat[0].extra.killerWithinInvestigator.caseAction.stripped, true);
}

reset();

// Case prompt injection when investigator or officers present
{
    setPlayRole(PLAY_ROLES.KIRA);
    assert.equal(shouldInjectInvestigatorCasePrompt(), false);
    assert.equal(getInvestigatorCasePromptInjectionMessage(), null);

    assignOfficer(officerActor(), { rank: 'Lead', clearance: OFFICER_CLEARANCE.LEAD });
    assert.equal(shouldInjectInvestigatorCasePrompt(), true);
    const injection = getInvestigatorCasePromptInjectionMessage();
    assert.ok(injection);
    assert.match(injection.mes, /L Lawliet/);
    assert.match(injection.mes, new RegExp(CASE_ACTION_BLOCK_TAG));
    assert.match(injection.mes, /warrant\|confront|Pending warrants/i);

    const replacements = buildCasePromptReplacements();
    assert.equal(replacements.example_officer, 'L Lawliet');
    assert.match(replacements.officers_block, /clearance:lead/i);
}

reset();

{
    setPlayRole(PLAY_ROLES.INVESTIGATOR);
    assert.equal(shouldInjectInvestigatorCasePrompt(), true);
    const injection = getInvestigatorCasePromptInjectionMessage();
    assert.ok(injection);
    assert.match(injection.mes, /Task Force Case Context|case file/i);
}

console.log('investigator-hub-v1-5 tests passed');
