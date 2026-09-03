/**
 * Headless checks for Task Force dock visibility rules (mobile trap recovery).
 */
import assert from 'node:assert/strict';
import {
    MODULE_NAME,
    PLAY_ROLES,
} from '../deathnote/config.js';
import { INVESTIGATOR_MODULE_NAME } from '../investigator/config.js';

const metadataByChatId = new Map();
const extensionSettings = {
    [MODULE_NAME]: {
        playRole: PLAY_ROLES.INVESTIGATOR,
        enabled: true,
    },
    [INVESTIGATOR_MODULE_NAME]: {},
};

globalThis.SillyTavern = {
    getContext() {
        return {
            chatId: 'dock-visibility',
            chatMetadata: metadataByChatId.get('dock-visibility') || (metadataByChatId.set('dock-visibility', {}), metadataByChatId.get('dock-visibility')),
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

const { shouldShowTaskForceDock } = await import('../investigator/ui.js');

assert.equal(shouldShowTaskForceDock({
    isInvestigator: false,
    hubOpen: false,
    mobileDockPlacement: true,
}), false, 'kira never gets the dock');

assert.equal(shouldShowTaskForceDock({
    isInvestigator: true,
    hubOpen: false,
    mobileDockPlacement: false,
}), true, 'desktop investigator with hub closed shows dock');

assert.equal(shouldShowTaskForceDock({
    isInvestigator: true,
    hubOpen: true,
    mobileDockPlacement: false,
}), false, 'desktop investigator with hub open hides dock');

assert.equal(shouldShowTaskForceDock({
    isInvestigator: true,
    hubOpen: true,
    mobileDockPlacement: true,
}), true, 'mobile investigator keeps dock even while hub is open');

assert.equal(shouldShowTaskForceDock({
    isInvestigator: true,
    hubOpen: false,
    mobileDockPlacement: true,
}), true, 'mobile investigator with hub closed shows dock');

console.log('investigator-dock-visibility tests passed');
