/**
 * Prove Investigator dock Open works like Death Note: pointerup toggle,
 * without relying on a synthetic click (which touch + preventDefault suppress).
 */
import assert from 'node:assert/strict';
import {
    MODULE_NAME,
    PLAY_ROLES,
} from '../deathnote/config.js';
import {
    INVESTIGATOR_DOCK_ID,
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
const docListeners = new Map();
const winListeners = new Map();

function makeEl(id = '') {
    const el = {
        id,
        className: '',
        hidden: false,
        style: {},
        innerHTML: '',
        classList: { add() {}, remove() {} },
        setAttribute() {},
        getAttribute() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        remove() { bodyChildren.delete(this.id); },
        getBoundingClientRect() {
            if (this.id === INVESTIGATOR_HUB_ID) {
                return { width: 390, height: 844, top: 0, bottom: 844, left: 0, right: 390 };
            }
            return { width: 180, height: 48, top: 12, bottom: 60, left: 200, right: 380 };
        },
        append() {},
        closest(sel) {
            if (String(sel).includes('data-inv-dock-toggle') && this.dataset?.invDockToggle === 'true') {
                return this;
            }
            return null;
        },
        dataset: {},
    };
    return el;
}

globalThis.HTMLElement = class HTMLElement {};
globalThis.window = {
    innerWidth: 390,
    innerHeight: 844,
    visualViewport: { height: 844 },
    matchMedia() { return { matches: true }; },
    addEventListener(type, handler, options) {
        const capture = options === true || options?.capture === true;
        const key = `${type}:${capture ? 'c' : 'b'}`;
        const list = winListeners.get(key) || [];
        list.push(handler);
        winListeners.set(key, list);
    },
    removeEventListener(type, handler, options) {
        const capture = options === true || options?.capture === true;
        const key = `${type}:${capture ? 'c' : 'b'}`;
        winListeners.set(key, (winListeners.get(key) || []).filter((h) => h !== handler));
    },
    requestAnimationFrame(cb) { return setTimeout(cb, 0); },
};
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;

const dockButton = makeEl('dock-btn');
Object.setPrototypeOf(dockButton, globalThis.HTMLElement.prototype);
dockButton.dataset = { invDockToggle: 'true' };
dockButton.closest = (sel) => (
    String(sel).includes('data-inv-dock-toggle') ? dockButton : null
);

globalThis.document = {
    body: {
        classList: { _set: new Set(), add(n) { this._set.add(n); }, remove(n) { this._set.delete(n); } },
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
    addEventListener(type, handler, options) {
        const capture = options === true || options?.capture === true;
        const key = `${type}:${capture ? 'c' : 'b'}`;
        const list = docListeners.get(key) || [];
        list.push(handler);
        docListeners.set(key, list);
    },
};

globalThis.SillyTavern = {
    getContext() {
        return {
            chatId: 'dock-touch-open',
            chatMetadata: metadataByChatId.get('dock-touch-open')
                || (metadataByChatId.set('dock-touch-open', {}), metadataByChatId.get('dock-touch-open')),
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
    activateInvestigatorShell,
    refreshInvestigatorUi,
} = await import('../investigator/ui.js');
const { getInvestigatorSettings, setPlayRole } = await import('../investigator/core.js');

setPlayRole(PLAY_ROLES.INVESTIGATOR);
extensionSettings[INVESTIGATOR_MODULE_NAME].hubOpen = false;

refreshInvestigatorUi();
assert.ok(document.getElementById(INVESTIGATOR_DOCK_ID), 'dock mounted');
assert.ok((docListeners.get('pointerdown:c') || []).length >= 1, 'dock pointer delegation installed');

function fire(type, store, overrides = {}) {
    const event = {
        type,
        target: dockButton,
        button: 0,
        pointerType: 'touch',
        isPrimary: true,
        pointerId: 1,
        clientX: 220,
        clientY: 30,
        preventDefault() {},
        stopPropagation() {},
        ...overrides,
    };
    for (const handler of [...(store.get(`${type}:c`) || [])]) {
        handler(event);
    }
}

// Touch open: pointerdown + pointerup, NO click — must open hub.
fire('pointerdown', docListeners);
fire('pointerup', winListeners);

assert.equal(getInvestigatorSettings().hubOpen, true, 'pointerup without click opens hub');
assert.ok(document.getElementById(INVESTIGATOR_HUB_ID), 'hub mounted after touch open');

// Trailing synthetic click must not immediately close (ignoreClick).
fire('click', docListeners, { type: 'click', pointerType: undefined });
assert.equal(getInvestigatorSettings().hubOpen, true, 'trailing click does not double-toggle');

// Role activation must open terminal on mobile (not dock-only).
extensionSettings[INVESTIGATOR_MODULE_NAME].hubOpen = false;
activateInvestigatorShell();
assert.equal(getInvestigatorSettings().hubOpen, true, 'activateInvestigatorShell opens hub on mobile');

console.log('investigator-dock-touch-open tests passed');
