/**
 * Shinigami Eyes V2: character deals + slow lifespan decay.
 */
import assert from 'node:assert/strict';
import { CHAT_METADATA_KEY, MODULE_NAME, NOTEBOOK_ACTOR_TYPES, SHINIGAMI_EYES_DEAL_BLOCK_TAG } from '../deathnote/config.js';

const metadataByChatId = new Map();
const extensionSettings = {
    [MODULE_NAME]: {
        shinigamiEyesDecayEnabled: true,
        shinigamiEyesDecayYearsPerGeneration: 0.05,
        defaultUserLifespanYears: 72,
        enabled: true,
        showAiWriteDebugBlocks: false,
    },
};

let chatId = 'eyes-v2-chat';
const chat = [];

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
                { avatar: 'misa.png', name: 'Misa Amane', description: '' },
                { avatar: 'light.png', name: 'Light Yagami', description: '' },
                { avatar: 'rem.png', name: 'Rem', description: 'Shinigami' },
            ],
            groups: null,
            characterId: 0,
            substituteParams: (value) => value,
        };
    },
};

const {
    acceptCharacterShinigamiEyesDeal,
    acceptShinigamiEyesDeal,
    applyShinigamiEyesLifespanDecay,
    characterHasShinigamiEyes,
    createDeathNote,
    getCharacterShinigamiEyesHolders,
    getShinigamiEyesState,
    linkNotebookShinigami,
    processAssistantShinigamiEyesDealMessage,
    syncChatStateCacheFromMetadata,
    transferNotebookTo,
    tickDeathNoteCountdownForGeneration,
} = await import('../deathnote/core.js');

const {
    getCharacterShinigamiEyesPromptInjectionMessage,
} = await import('../deathnote/prompts.js');

chatId = `eyes-v2-${Date.now()}`;
syncChatStateCacheFromMetadata();

const notebook = createDeathNote({
    holder: { type: NOTEBOOK_ACTOR_TYPES.CHARACTER, id: 'misa.png', name: 'Misa Amane' },
    owner: { type: NOTEBOOK_ACTOR_TYPES.USER, name: 'User' },
});
assert.ok(notebook?.itemId);

transferNotebookTo({ type: NOTEBOOK_ACTOR_TYPES.CHARACTER, id: 'misa.png', name: 'Misa Amane' }, {
    notebookItemId: notebook.itemId,
    owner: { type: NOTEBOOK_ACTOR_TYPES.USER, name: 'User' },
    userAccess: 'none',
    exists: true,
    reason: 'Handed to Misa for Eyes V2 test.',
});

linkNotebookShinigami({
    type: NOTEBOOK_ACTOR_TYPES.SHINIGAMI,
    id: 'rem.png',
    name: 'Rem',
}, {
    notebookItemId: notebook.itemId,
    avatar: 'rem.png',
    name: 'Rem',
});

const misa = { type: NOTEBOOK_ACTOR_TYPES.CHARACTER, id: 'misa.png', name: 'Misa Amane' };

{
    const first = acceptCharacterShinigamiEyesDeal(misa, { shinigamiName: 'Rem' });
    assert.equal(first.applied, true);
    assert.equal(first.reason, 'first_deal');
    assert.equal(first.afterYears, Math.floor(first.beforeYears / 2));
    assert.ok(first.afterYears > 0);
    assert.equal(characterHasShinigamiEyes(misa), true);
    assert.equal(getCharacterShinigamiEyesHolders().length, 1);
    assert.equal(getShinigamiEyesState().characters['id:misa.png']?.remainingLifespanYears, first.afterYears);
}

{
    const beforeSecond = getShinigamiEyesState().characters['id:misa.png']?.remainingLifespanYears;
    const second = acceptCharacterShinigamiEyesDeal(misa, {});
    assert.equal(second.applied, true);
    assert.equal(second.reason, 'second_deal');
    assert.equal(second.afterYears, Math.floor(beforeSecond / 2));
    assert.equal(getShinigamiEyesState().characters['id:misa.png']?.dealCount, 2);
}

{
    const injection = getCharacterShinigamiEyesPromptInjectionMessage();
    assert.ok(injection);
    assert.match(String(injection.mes || ''), /Misa Amane/);
    assert.match(String(injection.mes || ''), new RegExp(`${getShinigamiEyesState().characters['id:misa.png'].remainingLifespanYears} years`));
}

{
    acceptShinigamiEyesDeal({});
    assert.equal(getShinigamiEyesState().active, true);
    const userBefore = getShinigamiEyesState().remainingLifespanYears;
    const misaBefore = getShinigamiEyesState().characters['id:misa.png']?.remainingLifespanYears;
    assert.ok(userBefore > 0);
    assert.ok(misaBefore > 0);

    const decay = applyShinigamiEyesLifespanDecay({ years: 0.05 });
    assert.equal(decay.changed, true);
    assert.equal(getShinigamiEyesState().remainingLifespanYears, Math.round((userBefore - 0.05) * 100) / 100);
    assert.equal(
        getShinigamiEyesState().characters['id:misa.png']?.remainingLifespanYears,
        Math.round((misaBefore - 0.05) * 100) / 100,
    );
}

{
    // Generation tick should also decay once per signature.
    const beforeUser = getShinigamiEyesState().remainingLifespanYears;
    tickDeathNoteCountdownForGeneration(101);
    const afterUser = getShinigamiEyesState().remainingLifespanYears;
    assert.ok(afterUser < beforeUser);
    tickDeathNoteCountdownForGeneration(101);
    assert.equal(getShinigamiEyesState().remainingLifespanYears, afterUser);
}

{
    chat.length = 0;
    chat.push({
        name: 'Misa Amane',
        is_user: false,
        is_system: false,
        force_avatar: 'http://localhost/?file=misa.png',
        mes: [
            'I accept.',
            `[${SHINIGAMI_EYES_DEAL_BLOCK_TAG}]`,
            'character: Misa Amane',
            'shinigami: Rem',
            `[/${SHINIGAMI_EYES_DEAL_BLOCK_TAG}]`,
        ].join('\n'),
    });

    // Reset Misa deal for marker test in a fresh chat bag.
    chatId = `eyes-v2-marker-${Date.now()}`;
    syncChatStateCacheFromMetadata();
    const note2 = createDeathNote({
        holder: misa,
        owner: { type: NOTEBOOK_ACTOR_TYPES.USER, name: 'User' },
    });
    transferNotebookTo(misa, {
        notebookItemId: note2.itemId,
        owner: { type: NOTEBOOK_ACTOR_TYPES.USER, name: 'User' },
        userAccess: 'none',
        exists: true,
    });
    linkNotebookShinigami({
        type: NOTEBOOK_ACTOR_TYPES.SHINIGAMI,
        id: 'rem.png',
        name: 'Rem',
    }, {
        notebookItemId: note2.itemId,
        avatar: 'rem.png',
        name: 'Rem',
    });

    chat[0].mes = [
        'I accept.',
        `[${SHINIGAMI_EYES_DEAL_BLOCK_TAG}]`,
        'character: Misa Amane',
        'shinigami: Rem',
        `[/${SHINIGAMI_EYES_DEAL_BLOCK_TAG}]`,
    ].join('\n');

    const applied = processAssistantShinigamiEyesDealMessage(0);
    assert.equal(applied, true);
    assert.equal(characterHasShinigamiEyes(misa), true);
    assert.match(String(chat[0].mes || ''), /I accept/);
    assert.doesNotMatch(String(chat[0].mes || ''), new RegExp(SHINIGAMI_EYES_DEAL_BLOCK_TAG));
}

console.log('Shinigami Eyes V2 checks passed.');
