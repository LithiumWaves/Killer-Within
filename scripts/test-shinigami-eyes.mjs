/**
 * Headless checks for Shinigami Eyes V1 deal / lifespan / prompt wiring.
 * Mocks SillyTavern.getContext with an in-memory chat metadata bag.
 */
import assert from 'node:assert/strict';
import { CHAT_METADATA_KEY, MODULE_NAME, NOTEBOOK_ACTOR_TYPES } from '../deathnote/config.js';

const chatMetadata = {};
const extensionSettings = {
    [MODULE_NAME]: {},
};

let chatId = 'eyes-test-chat';

globalThis.SillyTavern = {
    getContext() {
        return {
            chatId,
            chatMetadata,
            extensionSettings,
            chat: [],
            characters: [
                { avatar: 'light.png', name: 'Light Yagami', description: '' },
                { avatar: 'ryuk.png', name: 'Ryuk', description: 'Shinigami' },
            ],
            groups: null,
            characterId: 0,
        };
    },
};

const {
    acceptShinigamiEyesDeal,
    createDeathNote,
    getActorShinigamiLifespan,
    getSettings,
    getShinigamiEyesState,
    linkNotebookShinigami,
    userHasShinigamiEyes,
} = await import('../deathnote/core.js');

const { getShinigamiEyesPromptInjectionMessage } = await import('../deathnote/prompts.js');

function resetEyesState() {
    const settings = getSettings();
    settings.defaultUserLifespanYears = 72;
    settings.enabled = true;
    chatId = `eyes-test-chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    for (const key of Object.keys(chatMetadata)) {
        delete chatMetadata[key];
    }
}

resetEyesState();

// Fresh state: dormant, full lifespan from settings.
{
    const eyes = getShinigamiEyesState();
    assert.equal(eyes.active, false);
    assert.equal(eyes.dealCount, 0);
    assert.equal(eyes.remainingLifespanYears, 72);
    assert.equal(userHasShinigamiEyes(), false);
    assert.equal(getShinigamiEyesPromptInjectionMessage(), null);
}

// Deal requires a linked Shinigami.
{
    const blocked = acceptShinigamiEyesDeal({});
    assert.equal(blocked.applied, false);
    assert.equal(blocked.reason, 'no_linked_shinigami');
}

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

// Default lifespan setting syncs only before any deal.
{
    resetEyesState();
    getSettings().defaultUserLifespanYears = 80;
    const eyes = getShinigamiEyesState();
    assert.equal(eyes.remainingLifespanYears, 80);
    assert.equal(eyes.originalLifespanYears, 80);
}

console.log('Shinigami Eyes V1 checks passed.');
