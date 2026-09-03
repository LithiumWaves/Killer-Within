/**
 * Headless checks for Killer Within role / terminal slash commands.
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
        isOpen: false,
    },
    [INVESTIGATOR_MODULE_NAME]: {
        hubOpen: false,
        hubCollapsed: false,
        activeScreen: 'board',
    },
};

const registered = [];

globalThis.window = {
    innerWidth: 1280,
    matchMedia() {
        return { matches: false };
    },
    addEventListener() {},
};

function makeArgument(props) {
    return { ...props };
}

globalThis.SillyTavern = {
    getContext() {
        return {
            chatId: 'slash-commands',
            chatMetadata: metadataByChatId.get('slash-commands')
                || (metadataByChatId.set('slash-commands', {}), metadataByChatId.get('slash-commands')),
            extensionSettings,
            chat: [],
            characters: [],
            groups: null,
            characterId: 0,
            saveSettingsDebounced() {},
            saveChat: async () => {},
            ARGUMENT_TYPE: { STRING: 'string' },
            SlashCommandArgument: {
                fromProps: makeArgument,
            },
            SlashCommandNamedArgument: {
                fromProps: makeArgument,
            },
            SlashCommand: {
                fromProps(props) {
                    return { ...props };
                },
            },
            SlashCommandParser: {
                addCommandObject(command) {
                    registered.push(command);
                },
            },
        };
    },
};

globalThis.toastr = {
    info() {},
    warning() {},
    error() {},
};

const {
    parseRoleToken,
    registerInvestigatorSlashCommands,
    runRoleSwitch,
    runTerminalAction,
} = await import('../investigator/slash.js');
const { getPlayRole } = await import('../investigator/core.js');
const { getInvestigatorSettings } = await import('../investigator/core.js');

assert.equal(parseRoleToken('Kira'), PLAY_ROLES.KIRA);
assert.equal(parseRoleToken('investigator'), PLAY_ROLES.INVESTIGATOR);
assert.equal(parseRoleToken('tf'), PLAY_ROLES.INVESTIGATOR);
assert.equal(parseRoleToken('nope'), null);

assert.equal(registerInvestigatorSlashCommands(), true);
const names = registered.map((command) => command.name).sort();
assert.deepEqual(names, ['investigator', 'kira', 'kwrole', 'kwterminal']);

assert.match(await runRoleSwitch(PLAY_ROLES.KIRA, { notify: false }), /Switched to Kira/);
assert.equal(getPlayRole(), PLAY_ROLES.KIRA);
assert.equal(getInvestigatorSettings().hubOpen, false);

assert.match(await runTerminalAction('open'), /opened/i);
assert.equal(getPlayRole(), PLAY_ROLES.INVESTIGATOR);
assert.equal(getInvestigatorSettings().hubOpen, true);

assert.match(await runTerminalAction('close'), /closed/i);
assert.equal(getInvestigatorSettings().hubOpen, false);

assert.match(await runTerminalAction('status'), /Role: investigator/i);

const kiraCmd = registered.find((command) => command.name === 'kira');
assert.match(await kiraCmd.callback({}, ''), /Switched to Kira|Already playing as Kira/);
assert.equal(getPlayRole(), PLAY_ROLES.KIRA);

const invCmd = registered.find((command) => command.name === 'investigator');
assert.match(await invCmd.callback({}, ''), /Switched to Investigator|Already playing as Investigator/);
assert.equal(getPlayRole(), PLAY_ROLES.INVESTIGATOR);

const roleCmd = registered.find((command) => command.name === 'kwrole');
assert.match(await roleCmd.callback({}, 'kira'), /Switched to Kira|Already playing as Kira/);
assert.equal(await roleCmd.callback({}, 'wat'), 'Usage: /kwrole kira|investigator');

console.log('investigator-slash-commands tests passed');
