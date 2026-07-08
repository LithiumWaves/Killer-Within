import { getSettings } from './core.js';
import { registerEventHandlers } from './events.js';
import { tickDeathNoteCountdown } from './core.js';
import { refreshDeathNoteUi, setupDeathNoteUi } from './ui.js';

export function setupDeathNoteExtension() {
    jQuery(() => {
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

