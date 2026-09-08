/**
 * Hub overlay must mount as a top-layer <dialog> filling the viewport.
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

function makeEl(id = '', tagName = 'DIV') {
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
    const el = {
        id,
        tagName,
        className: '',
        hidden: false,
        open: false,
        style,
        innerHTML: '',
        classList: { add() {}, remove() {} },
        setAttribute() {},
        getAttribute() { return null; },
        removeAttribute() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        remove() { bodyChildren.delete(this.id); },
        addEventListener() {},
        showModal() { this.open = true; },
        close() { this.open = false; },
        getBoundingClientRect() {
            return { width: 390, height: 700, top: 0, bottom: 700, left: 0, right: 390 };
        },
        append() {},
        _styleProps: styleProps,
    };
    return el;
}

globalThis.HTMLElement = class HTMLElement {};
globalThis.HTMLDialogElement = class HTMLDialogElement extends globalThis.HTMLElement {};
globalThis.window = {
    innerWidth: 390,
    innerHeight: 700,
    visualViewport: { width: 390, height: 560, offsetLeft: 12, offsetTop: 640 },
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
    createElement(tag) {
        const tagName = String(tag || 'div').toUpperCase();
        return makeEl('', tagName);
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
    closeHub,
} = await import('../investigator/ui.js');
const { getInvestigatorSettings } = await import('../investigator/core.js');

const box = getViewportBox();
assert.equal(box.top, 0);
assert.equal(box.left, 0);

await openHub();
assert.equal(getInvestigatorSettings().hubOpen, true);
const hub = document.getElementById(INVESTIGATOR_HUB_ID);
assert.ok(hub, 'hub node mounted');
assert.equal(hub.tagName, 'DIALOG', 'hub must be a native dialog for top-layer');
assert.equal(hub.open, true, 'dialog.showModal() must present the hub');
assert.equal(hub.style.getPropertyValue('top'), '0');
assert.equal(hub.style.getPropertyValue('left'), '0');
assert.equal(hub.style.getPropertyValue('width'), '100%');
assert.equal(hub.style.getPropertyValue('height'), '100%');
assert.equal(hub.style.getPropertyValue('inset'), '0');
assert.ok(String(hub.innerHTML).includes('TASK FORCE OS'), 'hub content rendered');
assert.ok(String(hub.innerHTML).includes('data-inv-close'), 'mobile hub includes Lock control');
assert.ok(String(hub.innerHTML).includes('Lock'), 'mobile Lock label present');
assert.equal(String(hub.innerHTML).includes('kw-investigator-hub__plate'), false, 'mobile hub omits plate chrome');

window.visualViewport.offsetTop = 900;
applyHubViewportBox(hub);
assert.equal(hub.style.getPropertyValue('top'), '0', 'scrolled offsetTop must not push hub down');

closeHub();
assert.equal(getInvestigatorSettings().hubOpen, false);
assert.equal(document.getElementById(INVESTIGATOR_HUB_ID), null, 'closed hub is dismissed');

console.log('investigator-hub-overlay tests passed');
