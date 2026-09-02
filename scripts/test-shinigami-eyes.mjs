/**
 * Headless checks for Shinigami Eyes V1 deal / lifespan / prompt wiring,
 * plus chat-scoped ownership isolation.
 */
import assert from 'node:assert/strict';
import { CHAT_METADATA_KEY, MODULE_NAME, NOTEBOOK_ACTOR_TYPES } from '../deathnote/config.js';

const metadataByChatId = new Map();
const extensionSettings = {
    [MODULE_NAME]: {},
};

let chatId = 'eyes-test-chat';
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
                { avatar: 'ryuk.png', name: 'Ryuk', description: 'Shinigami' },
            ],
            groups: null,
            characterId,
        };
    },
};

const {
    acceptShinigamiEyesDeal,
    createDeathNote,
    getActorShinigamiLifespan,
    getSettings,
    getShinigamiEyesRoster,
    getShinigamiEyesState,
    isLinkedDeathNoteShinigami,
    linkNotebookShinigami,
    syncChatStateCacheFromMetadata,
    userHasShinigamiEyes,
} = await import('../deathnote/core.js');

const { getShinigamiEyesPromptInjectionMessage } = await import('../deathnote/prompts.js');

function switchChat(nextChatId, nextCharacterId = 0) {
    chatId = String(nextChatId);
    characterId = nextCharacterId;
    syncChatStateCacheFromMetadata();
}

function resetEyesState() {
    const settings = getSettings();
    settings.defaultUserLifespanYears = 72;
    settings.enabled = true;
    metadataByChatId.clear();
    switchChat(`eyes-test-chat-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function seedLinkedShinigami() {
    const notebook = createDeathNote({
        holder: { type: NOTEBOOK_ACTOR_TYPES.USER, name: 'User' },
        owner: { type: NOTEBOOK_ACTOR_TYPES.USER, name: 'User' },
    });
    assert.ok(notebook?.itemId);
    linkNotebookShinigami({
        type: NOTEBOOK_ACTOR_TYPES.SHINIGAMI,
        id: 'ryuk.png',
        name: 'Ryuk',
    }, {
        notebookItemId: notebook.itemId,
        avatar: 'ryuk.png',
        name: 'Ryuk',
    });
    return notebook;
}

resetEyesState();

// Fresh state: dormant, full lifespan from settings.
{
    const eyes = getShinigamiEyesState();
    assert.equal(eyes.active, false);
    assert.equal(eyes.dealCount, 0);
    assert.equal(eyes.remainingLifespanYears, 72);
    assert.equal(eyes.owner?.type, NOTEBOOK_ACTOR_TYPES.USER);
    assert.equal(userHasShinigamiEyes(), false);
    assert.equal(getShinigamiEyesPromptInjectionMessage(), null);
}

// Deal requires a linked Shinigami.
{
    const blocked = acceptShinigamiEyesDeal({});
    assert.equal(blocked.applied, false);
    assert.equal(blocked.reason, 'no_linked_shinigami');
}

seedLinkedShinigami();

// First deal: irreversible half-life + Eyes active.
{
    const first = acceptShinigamiEyesDeal({});
    assert.equal(first.applied, true);
    assert.equal(first.reason, 'first_deal');
    assert.equal(first.beforeYears, 72);
    assert.equal(first.afterYears, 36);
    assert.equal(first.remainingLifespanYears, 36);
    assert.equal(userHasShinigamiEyes(), true);

    const eyes = getShinigamiEyesState();
    assert.equal(eyes.active, true);
    assert.equal(eyes.dealCount, 1);
    assert.equal(eyes.originalLifespanYears, 72);
    assert.equal(eyes.remainingLifespanYears, 36);
    assert.equal(eyes.grantedBy?.name, 'Ryuk');
    assert.equal(eyes.owner?.type, NOTEBOOK_ACTOR_TYPES.USER);
    assert.ok(ensureChatMetadata(chatId)[CHAT_METADATA_KEY]?.shinigamiEyes?.active);
}

// Soft death-clock / Eyes prompt injection present after deal.
{
    const message = getShinigamiEyesPromptInjectionMessage();
    assert.ok(message);
    assert.match(String(message.mes || ''), /Shinigami Eyes/);
    assert.match(String(message.mes || ''), /Remaining lifespan now: 36 years/);
    assert.match(String(message.mes || ''), /Soft death clock/);
    assert.equal(Boolean(message.extra?.killerWithinDeathNote?.shinigamiEyes), true);
}

// Lifespan display code matches spaced anime clusters (no hyphen).
{
    const lifespan = getActorShinigamiLifespan({
        type: NOTEBOOK_ACTOR_TYPES.CHARACTER,
        id: 'light.png',
        name: 'Light Yagami',
    });
    assert.ok(lifespan?.displayCode);
    assert.match(lifespan.displayCode, /^\d(?:\s+\d+){5}$/);
    assert.doesNotMatch(lifespan.displayCode, /-/);
}

// Linked Shinigami cards never get Eyes name/lifespan treatment.
{
    const ryukAsCharacter = {
        type: NOTEBOOK_ACTOR_TYPES.CHARACTER,
        id: 'ryuk.png',
        name: 'Ryuk',
    };
    assert.equal(isLinkedDeathNoteShinigami(ryukAsCharacter), true);
    assert.equal(getActorShinigamiLifespan(ryukAsCharacter), null);
    const roster = getShinigamiEyesRoster();
    assert.ok(roster.every((entry) => entry.trueName !== 'Ryuk'));
    assert.ok(roster.some((entry) => entry.trueName === 'Light Yagami'));
    const injection = String(getShinigamiEyesPromptInjectionMessage()?.mes || '');
    assert.doesNotMatch(injection, /Ryuk \//);
    assert.match(injection, /Light Yagami/);
}

// Second deal (Tier C7): halves remaining life again.
{
    const second = acceptShinigamiEyesDeal({});
    assert.equal(second.applied, true);
    assert.equal(second.reason, 'second_deal');
    assert.equal(second.beforeYears, 36);
    assert.equal(second.afterYears, 18);
    assert.equal(getShinigamiEyesState().dealCount, 2);
    assert.equal(getShinigamiEyesState().remainingLifespanYears, 18);
}

const chatA = chatId;

// Switching chats must not carry Eyes ownership into the other chat,
// even when both chats share the same characterId.
{
    switchChat('eyes-chat-b', 0);
    assert.equal(userHasShinigamiEyes(), false);
    assert.equal(getShinigamiEyesState().active, false);
    assert.equal(getShinigamiEyesState().dealCount, 0);
    assert.equal(getShinigamiEyesState().remainingLifespanYears, 72);
    assert.equal(getShinigamiEyesPromptInjectionMessage(), null);

    // Accepting Eyes in chat B stays on chat B only.
    seedLinkedShinigami();
    const dealB = acceptShinigamiEyesDeal({});
    assert.equal(dealB.applied, true);
    assert.equal(dealB.afterYears, 36);
    assert.equal(userHasShinigamiEyes(), true);

    switchChat(chatA, 0);
    assert.equal(userHasShinigamiEyes(), true);
    assert.equal(getShinigamiEyesState().remainingLifespanYears, 18);
    assert.equal(getShinigamiEyesState().dealCount, 2);

    switchChat('eyes-chat-b', 0);
    assert.equal(userHasShinigamiEyes(), true);
    assert.equal(getShinigamiEyesState().remainingLifespanYears, 36);
    assert.equal(getShinigamiEyesState().dealCount, 1);
}

// Default lifespan setting syncs only before any deal.
{
    resetEyesState();
    getSettings().defaultUserLifespanYears = 80;
    const eyes = getShinigamiEyesState();
    assert.equal(eyes.remainingLifespanYears, 80);
    assert.equal(eyes.originalLifespanYears, 80);
}

// Eyes deal fields must not live in extension settings.
{
    assert.equal(Object.hasOwn(getSettings(), 'shinigamiEyes'), false);
    assert.equal(Object.hasOwn(extensionSettings[MODULE_NAME], 'shinigamiEyes'), false);
}

console.log('Shinigami Eyes V1 + chat-scope checks passed.');
