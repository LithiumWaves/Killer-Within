/**
 * Headless checks for Task Force dock hide + wand-menu open helpers.
 */
import assert from 'node:assert/strict';
import {
    MODULE_NAME,
    PLAY_ROLES,
} from '../deathnote/config.js';
import {
    INVESTIGATOR_DOCK_ID,
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
        showDock: true,
        dockX: null,
        dockY: null,
    },
};

const bodyChildren = new Map();
const menuChildren = new Map();

function makeEl(id = '') {
    const el = {
        id,
        className: '',
        hidden: false,
        style: {},
        innerHTML: '',
        tabIndex: 0,
        title: '',
        open: false,
        classList: {
            _set: new Set(),
            add(name) { this._set.add(name); },
            remove(name) { this._set.delete(name); },
            contains(name) { return this._set.has(name); },
        },
        setAttribute() {},
        getAttribute() { return null; },
        removeAttribute() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        remove() {
            bodyChildren.delete(this.id);
            menuChildren.delete(this.id);
        },
        getBoundingClientRect() {
            return { width: 200, height: 48, top: 80, bottom: 128, left: 40, right: 240 };
        },
        append(child) {
            if (child?.id) {
                if (this.id === 'extensionsMenu') {
                    menuChildren.set(child.id, child);
                }
                bodyChildren.set(child.id, child);
            }
        },
        addEventListener() {},
        closest() { return null; },
        dataset: {},
    };
    return el;
}

const extensionsMenu = makeEl('extensionsMenu');

globalThis.HTMLElement = class HTMLElement {};
globalThis.HTMLDialogElement = class HTMLDialogElement extends globalThis.HTMLElement {};
globalThis.window = {
    innerWidth: 390,
    innerHeight: 844,
    visualViewport: { width: 390, height: 844 },
    matchMedia() { return { matches: true }; },
    addEventListener() {},
    requestAnimationFrame(cb) { return setTimeout(cb, 0); },
};
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.document = {
    body: {
        append(child) {
            if (child?.id) {
                bodyChildren.set(child.id, child);
            }
        },
        classList: { add() {}, remove() {} },
    },
    getElementById(id) {
        if (id === 'extensionsMenu') {
            return extensionsMenu;
        }
        return bodyChildren.get(id) || menuChildren.get(id) || null;
    },
    createElement(tag) {
        const el = makeEl();
        el.tagName = String(tag || '').toUpperCase();
        if (String(tag).toLowerCase() === 'dialog') {
            el.showModal = function showModal() { this.open = true; };
            el.close = function close() { this.open = false; };
        }
        return el;
    },
    addEventListener() {},
};
globalThis.toastr = { info() {}, warning() {}, error() {}, success() {} };

globalThis.SillyTavern = {
    getContext() {
        return {
            chatId: 'dock-hide-wand',
            chatMetadata: metadataByChatId.get('dock-hide-wand')
                || (metadataByChatId.set('dock-hide-wand', {}), metadataByChatId.get('dock-hide-wand')),
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

const {
    shouldShowTaskForceDock,
    setTaskForceDockVisible,
    hideTaskForceDock,
    showTaskForceDock,
    openTerminalFromWand,
    refreshInvestigatorUi,
    syncInvestigatorWandMenu,
} = await import('../investigator/ui.js');
const { getInvestigatorSettings } = await import('../investigator/core.js');
const { runTerminalAction } = await import('../investigator/slash.js');

assert.equal(shouldShowTaskForceDock({
    isInvestigator: true,
    hubOpen: false,
    mobileDockPlacement: true,
    showDock: false,
}), false, 'hidden dock setting suppresses the floating button');

assert.equal(shouldShowTaskForceDock({
    isInvestigator: true,
    hubOpen: false,
    mobileDockPlacement: true,
    showDock: true,
}), true, 'visible dock setting keeps the floating button');

refreshInvestigatorUi();
assert.ok(document.getElementById(INVESTIGATOR_DOCK_ID), 'dock mounts when showDock is true');

hideTaskForceDock({ notify: false });
assert.equal(getInvestigatorSettings().showDock, false);
refreshInvestigatorUi();
assert.equal(document.getElementById(INVESTIGATOR_DOCK_ID), null, 'dock removed when hidden');

showTaskForceDock({ notify: false });
assert.equal(getInvestigatorSettings().showDock, true);
refreshInvestigatorUi();
assert.ok(document.getElementById(INVESTIGATOR_DOCK_ID), 'dock restores when shown');

hideTaskForceDock({ notify: false });
await openTerminalFromWand({ notify: false, restoreDock: true });
assert.equal(getInvestigatorSettings().hubOpen, true, 'wand open opens the terminal');
assert.equal(getInvestigatorSettings().showDock, true, 'wand open restores a hidden dock');

const hub = document.getElementById('kw-investigator-hub');
assert.ok(hub, 'hub mounts after wand open');
assert.match(String(hub.innerHTML), /data-inv-dock-hide/, 'Conceal control lives inside the terminal');
assert.match(String(hub.innerHTML), /Conceal/, 'Conceal label is present in hub chrome');

const dock = document.getElementById(INVESTIGATOR_DOCK_ID);
assert.ok(dock, 'dock restored');
assert.doesNotMatch(String(dock.innerHTML), /data-inv-dock-hide/, 'dock no longer hosts the hide control');

syncInvestigatorWandMenu();
assert.ok(document.getElementById('kw-investigator-wand-terminal'), 'wand terminal item registered');
assert.ok(document.getElementById('kw-investigator-wand-dock'), 'wand dock toggle registered');

setTaskForceDockVisible(false, { notify: false });
const hideMsg = await runTerminalAction('show');
assert.match(hideMsg, /shown/i);
assert.equal(getInvestigatorSettings().showDock, true);

const status = await runTerminalAction('status');
assert.match(status, /Dock: visible/);

console.log('investigator-dock-hide-wand tests passed');
