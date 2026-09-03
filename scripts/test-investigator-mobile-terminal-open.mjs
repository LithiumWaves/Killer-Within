/**
 * Headless checks: mobile terminal open must not be killed by stuck-recovery,
 * and toast helper must prefer top placement on narrow viewports.
 */
import assert from 'node:assert/strict';
import {
    MODULE_NAME,
    PLAY_ROLES,
} from '../deathnote/config.js';
import { INVESTIGATOR_HUB_ID, INVESTIGATOR_MODULE_NAME } from '../investigator/config.js';

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
const toastCalls = [];

function makeEl(id) {
    const style = {};
    const el = {
        id,
        className: '',
        hidden: false,
        style,
        innerHTML: '',
        classList: {
            add() {},
            remove() {},
        },
        setAttribute() {},
        getAttribute() { return null; },
        querySelectorAll() { return []; },
        querySelector() { return null; },
        remove() {
            bodyChildren.delete(id);
        },
        getBoundingClientRect() {
            // Simulate first-paint / keyboard-collapsed visual viewport noise:
            // old recovery treated this as "stuck" and closed the hub.
            return { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 };
        },
        append() {},
    };
    return el;
}

globalThis.window = {
    innerWidth: 390,
    innerHeight: 280, // keyboard open
    visualViewport: { height: 280 },
    matchMedia() {
        return { matches: true };
    },
    addEventListener() {},
    requestAnimationFrame(cb) {
        return setTimeout(cb, 0);
    },
};
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.HTMLElement = class HTMLElement {};

globalThis.document = {
    body: {
        classList: {
            _set: new Set(),
            add(name) { this._set.add(name); },
            remove(name) { this._set.delete(name); },
        },
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
            chatId: 'mobile-hub-open',
            chatMetadata: metadataByChatId.get('mobile-hub-open')
                || (metadataByChatId.set('mobile-hub-open', {}), metadataByChatId.get('mobile-hub-open')),
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

globalThis.toastr = {
    info(message, _title, options = {}) {
        toastCalls.push({ type: 'info', message, options });
    },
    warning(message, _title, options = {}) {
        toastCalls.push({ type: 'warning', message, options });
    },
};

const {
    notifyInvestigator,
    openHub,
    shouldRecoverStuckMobileHub,
} = await import('../investigator/ui.js');
const { getInvestigatorSettings } = await import('../investigator/core.js');
const { runTerminalAction } = await import('../investigator/slash.js');

// Geometry policy: healthy fullscreen hub overlapping a short keyboard viewport
// must NOT recover; only empty/off-screen boxes should.
assert.equal(shouldRecoverStuckMobileHub(
    { width: 390, height: 844, top: 0, bottom: 844 },
    { viewportHeight: 280 },
), false, 'fullscreen hub must stay open when keyboard shrinks visual viewport');

assert.equal(shouldRecoverStuckMobileHub(
    { width: 0, height: 0, top: 0, bottom: 0 },
    { viewportHeight: 800 },
), true, 'zero-size hub may recover after grace');

assert.equal(shouldRecoverStuckMobileHub(
    { width: 390, height: 48, top: 0, bottom: 48 },
    { viewportHeight: 800 },
), false, 'short-but-present box must not be treated as stuck');

assert.equal(shouldRecoverStuckMobileHub(
    { width: 390, height: 200, top: 900, bottom: 1100 },
    { viewportHeight: 800 },
), true, 'fully below viewport may recover');

// Intentional open while keyboard is up: hubOpen must stick despite 0x0 first paint.
await runTerminalAction('open');
assert.equal(getInvestigatorSettings().hubOpen, true, 'slash open keeps hubOpen on mobile');
assert.ok(document.getElementById(INVESTIGATOR_HUB_ID), 'hub node mounted');

// Wait deferred recovery frames; grace period must prevent teardown.
await new Promise((resolve) => setTimeout(resolve, 50));
assert.equal(getInvestigatorSettings().hubOpen, true, 'hubOpen survives deferred recovery during grace');
assert.ok(document.getElementById(INVESTIGATOR_HUB_ID), 'hub node survives deferred recovery during grace');

toastCalls.length = 0;
notifyInvestigator('info', 'Terminal opened');
assert.equal(toastCalls.length, 1);
assert.equal(toastCalls[0].options.positionClass, 'toast-top-center');
assert.ok(document.body.classList._set.has('kw-investigator-toast-mobile'));

openHub();
assert.equal(getInvestigatorSettings().hubOpen, true);

console.log('investigator-mobile-terminal-open tests passed');
