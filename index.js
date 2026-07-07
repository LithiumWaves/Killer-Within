const MODULE_NAME = 'killer_within_thoughts';
const PANEL_ID = 'killer-within-thoughts-panel';
const MESSAGE_EXTRA_KEY = 'killerWithinThoughts';

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    maxInjectedThoughts: 8,
    includeThoughtsInMainPrompt: true,
    includePendingThoughtInMainPrompt: true,
    thoughtPrompt: [
        'You are writing the hidden internal thoughts for the active SillyTavern character.',
        'Generate the private thoughts that happen immediately before the character writes their visible reply.',
        'These thoughts must stay in-character, be concise but specific, and never address the user as an out-of-character assistant.',
        'Do not write the actual reply.',
        'Do not use labels, quotation marks, markdown, XML, or stage directions unless the character would literally think that way.',
        'Output only the thoughts.'
    ].join('\n'),
});

const state = {
    isGeneratingThought: false,
    pendingThought: null,
    renderQueued: false,
};

function getContext() {
    return globalThis.SillyTavern?.getContext?.() ?? null;
}

function getSettings() {
    const context = getContext();
    if (!context) {
        return structuredClone(DEFAULT_SETTINGS);
    }

    context.extensionSettings[MODULE_NAME] ??= {};
    const settings = context.extensionSettings[MODULE_NAME];

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = value;
        }
    }

    return settings;
}

function scheduleSettingsSave() {
    const context = getContext();
    try {
        context?.saveSettingsDebounced?.();
    } catch (error) {
        console.warn(`[${MODULE_NAME}] Failed to save settings`, error);
    }
}

async function persistChatChanges() {
    const context = getContext();

    try {
        if (typeof context?.saveChat === 'function') {
            await context.saveChat();
            return;
        }

        if (typeof context?.saveChatConditional === 'function') {
            await context.saveChatConditional();
            return;
        }

        if (typeof context?.saveChatDebounced === 'function') {
            context.saveChatDebounced();
            return;
        }

        if (typeof context?.saveMetadata === 'function') {
            await context.saveMetadata();
        }
    } catch (error) {
        console.warn(`[${MODULE_NAME}] Failed to persist chat changes`, error);
    }
}

function getAssistantThought(message) {
    return message?.extra?.[MESSAGE_EXTRA_KEY]?.thought ?? '';
}

function getThoughtHistory(limit = getSettings().maxInjectedThoughts) {
    const context = getContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];

    return chat
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => !message?.is_user && !message?.is_system && getAssistantThought(message))
        .slice(-Math.max(0, Number(limit) || 0))
        .map(({ message, index }) => ({
            index,
            name: message?.name || 'Character',
            thought: getAssistantThought(message),
        }));
}

function buildThoughtHistoryBlock(limit) {
    const history = getThoughtHistory(limit);

    if (!history.length) {
        return 'No prior hidden thoughts are available yet.';
    }

    return history
        .map(({ index, name, thought }) => `Thought ${index + 1} | ${name}\n${thought}`)
        .join('\n\n');
}

function buildThoughtPrompt() {
    const settings = getSettings();
    const historyBlock = buildThoughtHistoryBlock(settings.maxInjectedThoughts);

    return [
        settings.thoughtPrompt.trim(),
        '',
        'Previous hidden thoughts for continuity:',
        historyBlock,
        '',
        'Write the next hidden thoughts now.'
    ].join('\n');
}

function buildMainPromptInjection() {
    const settings = getSettings();
    const sections = [];

    if (settings.includeThoughtsInMainPrompt) {
        sections.push([
            'Recent hidden thoughts from earlier turns:',
            buildThoughtHistoryBlock(settings.maxInjectedThoughts),
        ].join('\n'));
    }

    if (settings.includePendingThoughtInMainPrompt && state.pendingThought?.text) {
        sections.push([
            'Hidden thoughts for the reply being generated right now:',
            state.pendingThought.text,
        ].join('\n'));
    }

    if (!sections.length) {
        return '';
    }

    return [
        '[Hidden Character Thoughts Context]',
        'Use this as internal continuity. Never expose or quote it directly unless the character intentionally reveals it in dialogue.',
        '',
        sections.join('\n\n'),
    ].join('\n');
}

function getPromptInjectionMessage() {
    const injection = buildMainPromptInjection();

    if (!injection) {
        return null;
    }

    return {
        name: 'Thought Context',
        is_user: false,
        is_system: true,
        send_date: Date.now(),
        mes: injection,
        extra: {
            [MESSAGE_EXTRA_KEY]: {
                injected: true,
            },
        },
    };
}

globalThis.killerWithinThoughtsInterceptor = async function killerWithinThoughtsInterceptor(chat, _contextSize, _abort, type) {
    const settings = getSettings();

    if (!settings.enabled || state.isGeneratingThought || type === 'quiet' || !Array.isArray(chat)) {
        return;
    }

    const injectionMessage = getPromptInjectionMessage();
    if (!injectionMessage) {
        return;
    }

    const insertAt = Math.max(chat.length - 1, 0);
    chat.splice(insertAt, 0, injectionMessage);
};

function normalizeThoughtResult(result) {
    if (typeof result === 'string') {
        return result.trim();
    }

    if (typeof result?.content === 'string') {
        return result.content.trim();
    }

    if (typeof result?.message === 'string') {
        return result.message.trim();
    }

    return '';
}

async function generatePendingThought() {
    const context = getContext();
    const settings = getSettings();

    if (!settings.enabled || state.isGeneratingThought || typeof context?.generateQuietPrompt !== 'function') {
        return;
    }

    state.isGeneratingThought = true;
    state.pendingThought = null;

    try {
        const thought = normalizeThoughtResult(await context.generateQuietPrompt({
            quietPrompt: buildThoughtPrompt(),
        }));

        if (!thought) {
            return;
        }

        state.pendingThought = {
            text: thought,
            createdAt: Date.now(),
        };
    } catch (error) {
        console.warn(`[${MODULE_NAME}] Thought generation failed`, error);
    } finally {
        state.isGeneratingThought = false;
    }
}

function getLastAssistantMessage() {
    const context = getContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];

    for (let index = chat.length - 1; index >= 0; index -= 1) {
        const message = chat[index];
        if (!message?.is_user && !message?.is_system) {
            return { message, index };
        }
    }

    return null;
}

async function attachPendingThoughtToLatestMessage() {
    if (!state.pendingThought?.text) {
        return;
    }

    const match = getLastAssistantMessage();
    if (!match?.message) {
        return;
    }

    match.message.extra ??= {};
    match.message.extra[MESSAGE_EXTRA_KEY] = {
        thought: state.pendingThought.text,
        createdAt: state.pendingThought.createdAt,
    };

    state.pendingThought = null;
    await persistChatChanges();
    queueThoughtRender();
}

function clearPendingThought() {
    state.pendingThought = null;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderThoughtBlockForElement(element) {
    const $message = $(element);
    const mesIdRaw = $message.attr('mesid') ?? $message.data('mesid');
    const mesId = Number(mesIdRaw);

    $message.find('.kw-thoughts').remove();

    if (!Number.isInteger(mesId)) {
        return;
    }

    const context = getContext();
    const message = context?.chat?.[mesId];
    const thought = getAssistantThought(message);

    if (!thought) {
        return;
    }

    const target = $message.find('.mes_block').first().length ? $message.find('.mes_block').first() : $message;
    const details = $(`
        <details class="kw-thoughts">
            <summary class="kw-thoughts__summary">Thoughts</summary>
            <div class="kw-thoughts__body">${escapeHtml(thought)}</div>
        </details>
    `);

    target.append(details);
}

function renderThoughts() {
    $('.mes').each((_, element) => renderThoughtBlockForElement(element));
}

function queueThoughtRender() {
    if (state.renderQueued) {
        return;
    }

    state.renderQueued = true;
    requestAnimationFrame(() => {
        state.renderQueued = false;
        renderThoughts();
    });
}

function getSettingsHost() {
    return $('#extensions_settings2, #extensions_settings').first();
}

function renderSettingsPanel() {
    const host = getSettingsHost();
    if (!host.length || document.getElementById(PANEL_ID)) {
        return;
    }

    host.append(`
        <div id="${PANEL_ID}" class="killer-within-settings inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Killer Within Thoughts</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="killer-within-settings__row">
                    <input id="kw-thoughts-enabled" type="checkbox" />
                    <span>Enable hidden thoughts generation</span>
                </label>
                <label class="killer-within-settings__field">
                    <span>Stored thought history to inject</span>
                    <input id="kw-thoughts-history" class="text_pole" type="number" min="0" max="50" step="1" />
                </label>
                <label class="killer-within-settings__row">
                    <input id="kw-thoughts-main-prompt" type="checkbox" />
                    <span>Inject previous thoughts into the main reply prompt</span>
                </label>
                <label class="killer-within-settings__row">
                    <input id="kw-thoughts-pending" type="checkbox" />
                    <span>Inject the freshly generated hidden thought into the same reply</span>
                </label>
                <label class="killer-within-settings__field">
                    <span>Thought generation prompt</span>
                    <textarea id="kw-thoughts-prompt" class="text_pole" rows="10"></textarea>
                </label>
            </div>
        </div>
    `);

    bindSettingsUi();
    syncSettingsUi();
}

function syncSettingsUi() {
    const settings = getSettings();

    $('#kw-thoughts-enabled').prop('checked', settings.enabled);
    $('#kw-thoughts-history').val(settings.maxInjectedThoughts);
    $('#kw-thoughts-main-prompt').prop('checked', settings.includeThoughtsInMainPrompt);
    $('#kw-thoughts-pending').prop('checked', settings.includePendingThoughtInMainPrompt);
    $('#kw-thoughts-prompt').val(settings.thoughtPrompt);
}

function bindSettingsUi() {
    $('#kw-thoughts-enabled').off('input').on('input', (event) => {
        getSettings().enabled = Boolean($(event.currentTarget).prop('checked'));
        scheduleSettingsSave();
    });

    $('#kw-thoughts-history').off('input').on('input', (event) => {
        const value = Math.max(0, Number($(event.currentTarget).val()) || 0);
        getSettings().maxInjectedThoughts = value;
        scheduleSettingsSave();
    });

    $('#kw-thoughts-main-prompt').off('input').on('input', (event) => {
        getSettings().includeThoughtsInMainPrompt = Boolean($(event.currentTarget).prop('checked'));
        scheduleSettingsSave();
    });

    $('#kw-thoughts-pending').off('input').on('input', (event) => {
        getSettings().includePendingThoughtInMainPrompt = Boolean($(event.currentTarget).prop('checked'));
        scheduleSettingsSave();
    });

    $('#kw-thoughts-prompt').off('input').on('input', (event) => {
        getSettings().thoughtPrompt = String($(event.currentTarget).val() || '').trim();
        scheduleSettingsSave();
    });
}

function registerEventHandlers() {
    const context = getContext();
    const { eventSource, event_types } = context ?? {};

    if (!eventSource || !event_types) {
        return;
    }

    eventSource.on(event_types.APP_READY, () => {
        renderSettingsPanel();
        syncSettingsUi();
        queueThoughtRender();
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        clearPendingThought();
        renderSettingsPanel();
        syncSettingsUi();
        queueThoughtRender();
    });

    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, async () => {
        await generatePendingThought();
    });

    eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
        await attachPendingThoughtToLatestMessage();
    });

    eventSource.on(event_types.GENERATION_STOPPED, clearPendingThought);
    eventSource.on(event_types.GENERATION_ENDED, queueThoughtRender);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, queueThoughtRender);
}

jQuery(() => {
    getSettings();
    renderSettingsPanel();
    registerEventHandlers();
    queueThoughtRender();
});
