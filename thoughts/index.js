import { getSettings } from './core.js';
import {
    attachPendingThoughtToLatestMessage,
    clearPendingThought,
    generateThoughtForMessage,
    installInterceptor,
} from './generation.js';
import { registerEventHandlers } from './events.js';
import {
    bindGlobalUi,
    queueThoughtRender,
    refreshThoughtUi,
    renderSettingsPanel,
} from './ui.js';

export function setupThoughtsExtension() {
    installInterceptor();

    jQuery(() => {
        getSettings();
        renderSettingsPanel();
        bindGlobalUi(generateThoughtForMessage);
        registerEventHandlers({
            attachPendingThoughtToLatestMessage,
            clearPendingThought,
            refreshThoughtUi,
            queueThoughtRender,
        });
        queueThoughtRender();
    });
}
