import { MESSAGE_EXTRA_KEY, PANEL_ID } from './config.js';
import {
    getAssistantThought,
    getContext,
    getSettings,
    notify,
    persistChatChanges,
    scheduleSettingsSave,
} from './core.js';
import { getThoughtEntries } from './prompts.js';
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

function buildMemoryManagerHtml() {
    const entries = getThoughtEntries({
        selectedOnly: false,
    });

    if (!entries.length) {
        return '<div class="kw-memory-manager__empty">No thought memories stored in this chat yet.</div>';
    }

    const groups = new Map();

    for (const entry of entries) {
        const key = entry.characterKey || entry.name || 'Character';
        const existing = groups.get(key) ?? {
            name: entry.name || 'Character',
            entries: [],
        };
        existing.entries.push(entry);
        groups.set(key, existing);
    }

    return Array.from(groups.values())
        .map((group) => {
            const items = group.entries
                .slice()
                .reverse()
                .map((entry) => `
                    <label class="kw-memory-entry">
                        <span class="kw-memory-entry__toggle">
                            <input
                                type="checkbox"
                                class="kw-memory-toggle"
                                data-mesid="${entry.index}"
                                ${entry.selected ? 'checked' : ''}
                            />
                            <span>Use in context</span>
                        </span>
                        <span class="kw-memory-entry__meta">Thought ${entry.characterThoughtNumber || 1} · Message ${entry.index + 1}</span>
                        <span class="kw-memory-entry__body">${escapeHtml(entry.thought)}</span>
                    </label>
                `)
                .join('');

            return `
                <details class="kw-memory-group" open>
                    <summary class="kw-memory-group__summary">${escapeHtml(group.name)}</summary>
                    <div class="kw-memory-group__entries">${items}</div>
                </details>
            `;
        })
        .join('');
}

function renderMemoryManager() {
    const target = $('#kw-thoughts-memory-manager');
    if (!target.length) {
        return;
    }

    target.html(buildMemoryManagerHtml());
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
        renderMemoryManager();
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
    $('#kw-thoughts-wrapper-template').val(settings.thoughtWrapperTemplate);
    $('#kw-thoughts-context-template').val(settings.thoughtContextTemplate);
    $('#kw-thoughts-raw-system').val(settings.thoughtRawSystemPrompt);
    $('#kw-thoughts-manual-wrapper-template').val(settings.manualThoughtWrapperTemplate);
    $('#kw-thoughts-manual-raw-system').val(settings.manualThoughtRawSystemPrompt);
    $('#kw-thoughts-main-injection-template').val(settings.thoughtMainInjectionTemplate);
    renderMemoryManager();
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

    $('#kw-thoughts-wrapper-template').off('input').on('input', (event) => {
        getSettings().thoughtWrapperTemplate = String($(event.currentTarget).val() || '').trim();
        scheduleSettingsSave();
    });

    $('#kw-thoughts-context-template').off('input').on('input', (event) => {
        getSettings().thoughtContextTemplate = String($(event.currentTarget).val() || '').trim();
        scheduleSettingsSave();
    });

    $('#kw-thoughts-raw-system').off('input').on('input', (event) => {
        getSettings().thoughtRawSystemPrompt = String($(event.currentTarget).val() || '').trim();
        scheduleSettingsSave();
    });

    $('#kw-thoughts-manual-wrapper-template').off('input').on('input', (event) => {
        getSettings().manualThoughtWrapperTemplate = String($(event.currentTarget).val() || '').trim();
        scheduleSettingsSave();
    });

    $('#kw-thoughts-manual-raw-system').off('input').on('input', (event) => {
        getSettings().manualThoughtRawSystemPrompt = String($(event.currentTarget).val() || '').trim();
        scheduleSettingsSave();
    });

    $('#kw-thoughts-main-injection-template').off('input').on('input', (event) => {
        getSettings().thoughtMainInjectionTemplate = String($(event.currentTarget).val() || '').trim();
        scheduleSettingsSave();
    });

    $(document)
        .off('change', '.kw-memory-toggle')
        .on('change', '.kw-memory-toggle', async (event) => {
            const mesId = Number($(event.currentTarget).data('mesid'));
            if (!Number.isInteger(mesId)) {
                return;
            }

            const context = getContext();
            const message = context?.chat?.[mesId];
            const metadata = message?.extra?.[MESSAGE_EXTRA_KEY];
            if (!metadata?.thought) {
                return;
            }

            metadata.enabledInContext = Boolean($(event.currentTarget).prop('checked'));
            await persistChatChanges();
            queueThoughtRender();
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
                <div class="killer-within-settings__field">
                    <span>Prompt templates</span>
                    <small>Use placeholders like <code>{{thought_prompt}}</code>, <code>{{history_block}}</code>, <code>{{thought_prompt_block}}</code>, <code>{{identity_context_block}}</code>, <code>{{conversation_context_block}}</code>, <code>{{visible_reply}}</code>, and <code>{{sections}}</code>.</small>
                </div>
                <label class="killer-within-settings__field">
                    <span>Thought wrapper template</span>
                    <textarea id="kw-thoughts-wrapper-template" class="text_pole" rows="8"></textarea>
                </label>
                <label class="killer-within-settings__field">
                    <span>Thought context template</span>
                    <textarea id="kw-thoughts-context-template" class="text_pole" rows="8"></textarea>
                </label>
                <label class="killer-within-settings__field">
                    <span>Raw generation system prompt</span>
                    <textarea id="kw-thoughts-raw-system" class="text_pole" rows="6"></textarea>
                </label>
                <label class="killer-within-settings__field">
                    <span>Manual thought wrapper template</span>
                    <textarea id="kw-thoughts-manual-wrapper-template" class="text_pole" rows="8"></textarea>
                </label>
                <label class="killer-within-settings__field">
                    <span>Manual reconstruction system prompt</span>
                    <textarea id="kw-thoughts-manual-raw-system" class="text_pole" rows="6"></textarea>
                </label>
                <label class="killer-within-settings__field">
                    <span>Main reply injection template</span>
                    <textarea id="kw-thoughts-main-injection-template" class="text_pole" rows="6"></textarea>
                </label>
                <div class="killer-within-settings__field">
                    <span>Thought memories in this chat</span>
                    <div id="kw-thoughts-memory-manager" class="kw-memory-manager"></div>
                </div>
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
