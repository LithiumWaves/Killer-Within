import { PANEL_ID, MODULE_NAME } from './config.js';
import {
    getAssistantThought,
    getContext,
    getSettings,
    notify,
    scheduleSettingsSave,
} from './core.js';
import { state } from './state.js';

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

function getMessageActionHost($message) {
    const selectors = [
        '.mes_buttons',
        '.mes_edit_buttons',
        '.extraMesButtons',
        '.mes_header_buttons',
        '.mes_title_buttons',
    ];

    for (const selector of selectors) {
        const host = $message.find(selector).first();
        if (host.length) {
            return host;
        }
    }

    return $();
}

function renderThoughtButtonForElement(element) {
    const $message = $(element);
    const mesIdRaw = $message.attr('mesid') ?? $message.data('mesid');
    const mesId = Number(mesIdRaw);

    $message.find('.kw-thought-button').remove();

    if (!Number.isInteger(mesId)) {
        return;
    }

    const context = getContext();
    const message = context?.chat?.[mesId];
    if (!message || message.is_user || message.is_system) {
        return;
    }

    const host = getMessageActionHost($message);
    if (!host.length) {
        return;
    }

    const hasThought = Boolean(getAssistantThought(message));
    const button = $(`
        <button
            type="button"
            class="kw-thought-button menu_button fa-solid fa-brain interactable"
            title="${hasThought ? 'Regenerate hidden thought' : 'Generate hidden thought'}"
            aria-label="${hasThought ? 'Regenerate hidden thought' : 'Generate hidden thought'}"
            data-mesid="${mesId}"
        ></button>
    `);

    host.append(button);
}

function renderThoughts() {
    $('.mes').each((_, element) => renderThoughtBlockForElement(element));
}

function renderThoughtButtons() {
    $('.mes').each((_, element) => renderThoughtButtonForElement(element));
}

export function queueThoughtRender() {
    if (state.renderQueued) {
        return;
    }

    state.renderQueued = true;
    requestAnimationFrame(() => {
        state.renderQueued = false;
        renderThoughts();
        renderThoughtButtons();
    });
}

function getSettingsHost() {
    return $('#extensions_settings2, #extensions_settings').first();
}

function syncSettingsUi() {
    const settings = getSettings();

    $('#kw-thoughts-enabled').prop('checked', settings.enabled);
    $('#kw-thoughts-generation-mode').val(settings.generationMode === 'hybrid' ? 'hybrid' : 'raw');
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

    $('#kw-thoughts-generation-mode').off('input').on('input', (event) => {
        const value = String($(event.currentTarget).val() || 'raw').trim().toLowerCase();
        getSettings().generationMode = value === 'hybrid' ? 'hybrid' : 'raw';
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

export function renderSettingsPanel() {
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
                    <span>Thought generation mode</span>
                    <select id="kw-thoughts-generation-mode" class="text_pole">
                        <option value="raw">Raw</option>
                        <option value="hybrid">Hybrid</option>
                    </select>
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

export function refreshThoughtUi() {
    renderSettingsPanel();
    syncSettingsUi();
    queueThoughtRender();
}

export function bindGlobalUi(generateThoughtForMessage) {
    $(document)
        .off('click', '.kw-thought-button')
        .on('click', '.kw-thought-button', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const mesId = Number($(event.currentTarget).data('mesid'));
            if (!Number.isInteger(mesId)) {
                return;
            }

            if (state.isGeneratingThought) {
                notify('info', 'Thought generation is already in progress.');
                return;
            }

            const thought = await generateThoughtForMessage(mesId, queueThoughtRender);
            if (thought) {
                notify('success', 'Hidden thought generated.');
            } else {
                notify('warning', 'No hidden thought was generated.');
            }
        });
}
