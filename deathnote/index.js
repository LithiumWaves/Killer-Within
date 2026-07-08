import { getSettings } from './core.js';
import { registerEventHandlers } from './events.js';
import { tickDeathNoteCountdown } from './core.js';
import { refreshDeathNoteUi, setupDeathNoteUi } from './ui.js';

export function setupDeathNoteExtension() {
    jQuery(() => {
        if (!globalThis.__kwDeathNoteInitLogged) {
            globalThis.__kwDeathNoteInitLogged = true;
            console.info('[killer_within_deathnote] init');
        }
        getSettings();
        setupDeathNoteUi();
        registerEventHandlers({
            onChatChanged: refreshDeathNoteUi,
            onTick: tickDeathNoteCountdown,
            onUiRefresh: refreshDeathNoteUi,
        });
        refreshDeathNoteUi();
    });
}

