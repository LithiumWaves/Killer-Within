/**
 * Hub overlay must mount with explicit pixel viewport box (not collapsed %).
 */
import assert from 'node:assert/strict';
import {
    MODULE_NAME,
    PLAY_ROLES,
} from '../deathnote/config.js';
import {
    INVESTIGATOR_HUB_ID,
    INVESTIGATOR_MODULE_NAME,
} from '../investigator/config.js';

const metadataByChatId = new Map();
const extensionSettings = {
    [MODULE_NAME]: {
        playRole: PLAY_ROLES.INVESTIGATOR,
        enabled: true,
        isOpen: false,
    },
    [INVESTIGATOR_MODULE_NAME]: {
        hubOpen: false,
        hubCollapsed: false,
        activeScreen: 'board',
    },
};

const bodyChildren = new Map();

function makeEl(id = '') {
    const styleProps = new Map();
    const style = {
        setProperty(name, value, priority) {
            styleProps.set(name, { value, priority: priority || '' });
            this[name] = value;
        },
        getPropertyValue(name) {
            return styleProps.get(name)?.value || '';
        },
        getPropertyPriority(name) {
            return styleProps.get(name)?.priority || '';
        },
    };
    return {
        id,
        className: '',
        hidden: false,
        style,
        innerHTML: '',
        classList: { add() {}, remove() {} },
        setAttribute() {},
        getAttribute() { return null; },
        removeAttribute() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        remove() { bodyChildren.delete(this.id); },
        getBoundingClientRect() {
            const width = Number.parseFloat(style.width) || 0;
            const height = Number.parseFloat(style.height) || 0;
            return { width, height, top: 0, bottom: height, left: 0, right: width };
        },
        append() {},
        _styleProps: styleProps,
    };
}

globalThis.HTMLElement = class HTMLElement {};
globalThis.window = {
    innerWidth: 390,
    innerHeight: 700,
    visualViewport: { width: 390, height: 560, offsetLeft: 0, offsetTop: 0 },
    matchMedia() { return { matches: true }; },
    addEventListener() {},
    requestAnimationFrame(cb) { return setTimeout(cb, 0); },
};
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.document = {
    documentElement: { clientWidth: 390, clientHeight: 700 },
    body: {
        classList: { add() {}, remove() {} },
        append(node) {
            if (node?.id) {
                bodyChildren.set(node.id, node);
            }
        },
    },
    activeElement: { blur() {} },
    getElementById(id) {
        return bodyChildren.get(id) || null;
    },
    createElement() {
        return makeEl('');
    },
    addEventListener() {},
};
globalThis.SillyTavern = {
    getContext() {
        return {
            chatId: 'hub-overlay',
            chatMetadata: metadataByChatId.get('hub-overlay')
                || (metadataByChatId.set('hub-overlay', {}), metadataByChatId.get('hub-overlay')),
            extensionSettings,
            chat: [],
            characters: [],
            groups: null,
            characterId: 0,
            saveSettingsDebounced() {},
            saveChat: async () => {},
        };
    },
};
globalThis.toastr = { info() {}, warning() {}, success() {}, error() {} };

const {
    applyHubViewportBox,
    getViewportBox,
    openHub,
} = await import('../investigator/ui.js');
const { getInvestigatorSettings } = await import('../investigator/core.js');

const box = getViewportBox();
assert.equal(box.width, 390);
assert.equal(box.height, 560, 'prefer visualViewport height while keyboard is up');

await openHub();
assert.equal(getInvestigatorSettings().hubOpen, true);
const hub = document.getElementById(INVESTIGATOR_HUB_ID);
assert.ok(hub, 'hub node mounted');
assert.equal(hub.style.getPropertyValue('width'), '390px');
assert.equal(hub.style.getPropertyValue('height'), '560px');
assert.equal(hub.style.getPropertyPriority('width'), 'important');
assert.equal(hub.style.getPropertyPriority('height'), 'important');
assert.equal(hub.style.getPropertyValue('display'), 'block');
assert.equal(hub.style.getPropertyValue('visibility'), 'visible');
assert.equal(hub.style.getPropertyValue('opacity'), '1');
assert.ok(String(hub.innerHTML).includes('TASK FORCE OS'), 'hub content rendered');

// Re-apply after viewport shrink should keep a real box.
window.visualViewport.height = 480;
applyHubViewportBox(hub);
assert.equal(hub.style.getPropertyValue('height'), '480px');

console.log('investigator-hub-overlay tests passed');
