import { PLAY_ROLES } from './config.js';
import { getInvestigatorSettings, getPlayRole, isInvestigatorRole } from './core.js';
import {
    activateInvestigatorShell,
    closeHub,
    notifyInvestigator,
    openHub,
    switchPlayRole,
} from './ui.js';

function getSlashApis() {
    const context = globalThis.SillyTavern?.getContext?.() ?? null;
    if (!context?.SlashCommandParser?.addCommandObject || !context?.SlashCommand?.fromProps) {
        return null;
    }
    return context;
}

function normalizeToken(value) {
    return String(value ?? '').trim().toLowerCase();
}

function parseRoleToken(raw) {
    const token = normalizeToken(raw);
    if (!token) {
        return null;
    }
    if (token === PLAY_ROLES.KIRA || token === 'deathnote' || token === 'dn' || token === 'note') {
        return PLAY_ROLES.KIRA;
    }
    if (
        token === PLAY_ROLES.INVESTIGATOR
        || token === 'inv'
        || token === 'tf'
        || token === 'taskforce'
        || token === 'task-force'
        || token === 'cop'
    ) {
        return PLAY_ROLES.INVESTIGATOR;
    }
    return null;
}

async function runRoleSwitch(role, { notify = true } = {}) {
    return switchPlayRole(role, { notify });
}

async function runTerminalAction(actionRaw) {
    const action = normalizeToken(actionRaw) || 'open';
    if (action === 'status') {
        const role = getPlayRole();
        const settings = getInvestigatorSettings();
        const message = `Role: ${role}. Terminal: ${settings.hubOpen ? 'open' : 'closed'}.`;
        notifyInvestigator('info', message);
        return message;
    }

    if (action === 'close' || action === 'lock' || action === 'hide') {
        if (!isInvestigatorRole()) {
            const message = 'Terminal is only available in Investigator role. Use /kwrole investigator first.';
            notifyInvestigator('warning', message);
            return message;
        }
        closeHub();
        const message = 'Task Force terminal closed. Use /kwterminal open (or the dock) to reopen.';
        notifyInvestigator('info', message);
        return message;
    }

    if (action === 'open' || action === 'show' || action === 'unlock') {
        if (!isInvestigatorRole()) {
            await runRoleSwitch(PLAY_ROLES.INVESTIGATOR, { notify: false });
        }
        openHub();
        const message = 'Task Force terminal opened.';
        notifyInvestigator('info', message);
        return message;
    }

    if (action === 'dock' || action === 'activate') {
        if (!isInvestigatorRole()) {
            await runRoleSwitch(PLAY_ROLES.INVESTIGATOR, { notify: false });
        } else {
            activateInvestigatorShell();
        }
        const settings = getInvestigatorSettings();
        const message = settings.hubOpen
            ? 'Investigator shell active — terminal opened.'
            : 'Investigator shell active — use the floating dock (or /kwterminal open).';
        notifyInvestigator('info', message);
        return message;
    }

    const message = 'Unknown action. Use /kwterminal open|close|status|dock';
    notifyInvestigator('warning', message);
    return message;
}

/**
 * Register Killer Within role / terminal recovery slash commands.
 * Safe no-op when SillyTavern slash APIs are unavailable (headless tests).
 * @returns {boolean} Whether commands were registered.
 */
export function registerInvestigatorSlashCommands() {
    const context = getSlashApis();
    if (!context) {
        console.warn('[killer_within_investigator] Slash command APIs unavailable; skipping registration');
        return false;
    }

    const {
        SlashCommandParser,
        SlashCommand,
        SlashCommandArgument,
        ARGUMENT_TYPE,
    } = context;

    const stringType = ARGUMENT_TYPE?.STRING
        ? [ARGUMENT_TYPE.STRING]
        : ['string'];

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'kwrole',
        aliases: ['kw-role', 'killerwithin-role'],
        returns: 'role switch status',
        helpString: `
            <div>
                Switch Killer Within play role between <code>kira</code> and <code>investigator</code>.
                Use this if the Task Force UI traps you with no terminal controls.
            </div>
            <div>
                <strong>Examples:</strong>
                <ul>
                    <li><pre><code>/kwrole kira</code></pre></li>
                    <li><pre><code>/kwrole investigator</code></pre></li>
                </ul>
            </div>
        `,
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'role: kira | investigator',
                typeList: stringType,
                isRequired: true,
                enumList: [PLAY_ROLES.KIRA, PLAY_ROLES.INVESTIGATOR],
            }),
        ],
        callback: async (_named, unnamed) => {
            const role = parseRoleToken(unnamed);
            if (!role) {
                return 'Usage: /kwrole kira|investigator';
            }
            return runRoleSwitch(role);
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'kira',
        aliases: ['kwkira', 'kw-kira'],
        returns: 'role switch status',
        helpString: `
            <div>
                Switch Killer Within to <strong>Kira</strong> (Death Note tools).
                Recovery path when Investigator UI is stuck.
            </div>
        `,
        callback: async () => runRoleSwitch(PLAY_ROLES.KIRA),
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'investigator',
        aliases: ['kwinvestigator', 'kw-investigator', 'taskforce-role'],
        returns: 'role switch status',
        helpString: `
            <div>
                Switch Killer Within to <strong>Investigator</strong> and activate the Task Force shell.
            </div>
        `,
        callback: async () => runRoleSwitch(PLAY_ROLES.INVESTIGATOR),
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'kwterminal',
        aliases: ['kw-terminal', 'kwhub', 'kw-hub', 'taskforce'],
        returns: 'terminal status',
        helpString: `
            <div>
                Open, close, or inspect the Investigator Task Force terminal.
                Also works as recovery when the floating dock is missing.
            </div>
            <div>
                <strong>Examples:</strong>
                <ul>
                    <li><pre><code>/kwterminal open</code></pre></li>
                    <li><pre><code>/kwterminal close</code></pre></li>
                    <li><pre><code>/kwterminal status</code></pre></li>
                    <li><pre><code>/taskforce dock</code></pre></li>
                </ul>
            </div>
        `,
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'action: open | close | status | dock (default open)',
                typeList: stringType,
                isRequired: false,
                enumList: ['open', 'close', 'status', 'dock'],
            }),
        ],
        callback: async (_named, unnamed) => runTerminalAction(unnamed),
    }));

    return true;
}

export {
    parseRoleToken,
    runRoleSwitch,
    runTerminalAction,
};
