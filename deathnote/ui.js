import { FLOATING_ID } from './config.js';
import {
    addDeathEntry,
    clearDeathEntries,
    getChatState,
    getSettings,
    isDebugEnabled,
    notify,
    persistChatChanges,
    removeDeathEntry,
    scheduleSettingsSave,
} from './core.js';

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getDefaultPosition() {
    const width = 92;
    const height = 132;
    const margin = 16;

    const x = Math.max(margin, window.innerWidth - width - margin);
    const y = Math.max(margin, Math.round(window.innerHeight * 0.22) - Math.round(height / 2));
    return { x, y };
}

function resolvePosition() {
    const settings = getSettings();
    if (Number.isFinite(settings.floatingX) && Number.isFinite(settings.floatingY)) {
        return {
            x: settings.floatingX,
            y: settings.floatingY,
        };
    }

    return getDefaultPosition();
}

function setPosition(x, y) {
    const settings = getSettings();
    settings.floatingX = x;
    settings.floatingY = y;
    scheduleSettingsSave();
}

function renderEntriesHtml() {
    const state = getChatState();
    const entries = Array.isArray(state.entries) ? state.entries : [];

    if (!entries.length) {
        return '<div class="kw-deathnote__entries-empty">No names written yet.</div>';
    }

    return entries
        .slice()
        .reverse()
        .map((entry) => {
            const status = entry?.status === 'triggered' ? 'triggered' : 'active';
            const remaining = Number.isFinite(Number(entry?.remainingAssistantMessages))
                ? Math.max(0, Math.floor(Number(entry.remainingAssistantMessages)))
                : 0;

            return `
                <div class="kw-deathnote__entry kw-deathnote__entry--${status}">
                    <div class="kw-deathnote__entry-main">
                        <div class="kw-deathnote__entry-target">${escapeHtml(String(entry?.targetName || ''))}</div>
                        <div class="kw-deathnote__entry-cause">${escapeHtml(String(entry?.cause || ''))}</div>
                        <div class="kw-deathnote__entry-meta">
                            <span>${status === 'triggered' ? 'Triggered' : `In ${remaining} assistant messages`}</span>
                        </div>
                    </div>
                    <div class="kw-deathnote__entry-actions">
                        <button type="button" class="kw-deathnote__entry-remove menu_button" data-entry-id="${escapeHtml(String(entry?.id || ''))}">✕</button>
                    </div>
                </div>
            `;
        })
        .join('');
}

function renderDebugHtml() {
    if (!isDebugEnabled()) {
        return '';
    }

    const state = getChatState();
    return `
        <details class="kw-deathnote__debug" open>
            <summary class="kw-deathnote__debug-summary">Debug</summary>
            <div class="kw-deathnote__debug-actions">
                <button type="button" class="kw-deathnote__debug-button menu_button" data-action="copy-state">Copy state</button>
                <button type="button" class="kw-deathnote__debug-button menu_button" data-action="clear-entries">Clear entries</button>
                <button type="button" class="kw-deathnote__debug-button menu_button" data-action="toggle-notebook">${state.hasNotebook ? 'Drop notebook' : 'Claim notebook'}</button>
            </div>
            <pre class="kw-deathnote__debug-pre">${escapeHtml(JSON.stringify(state, null, 2))}</pre>
        </details>
    `;
}

function buildWidgetHtml() {
    const coverUrl = new URL('../assets/deathnote/cover.jpg', import.meta.url).toString();
    const rulesUrl = new URL('../assets/deathnote/rulespage1.jpg', import.meta.url).toString();
    const state = getChatState();
    const settings = getSettings();

    return `
        <div class="kw-deathnote__stage">
            <button type="button" class="kw-deathnote__cover" aria-label="Death Note" style="background-image:url('${coverUrl}')"></button>
            <div class="kw-deathnote__book" role="dialog" aria-label="Death Note notebook">
                <div class="kw-deathnote__spread">
                    <div class="kw-deathnote__page kw-deathnote__page--left">
                        <img class="kw-deathnote__rules" src="${rulesUrl}" alt="Death Note rules" />
                    </div>
                    <div class="kw-deathnote__page kw-deathnote__page--right">
                        <div class="kw-deathnote__paper">
                            <div class="kw-deathnote__paper-header">
                                <div class="kw-deathnote__title">Death Note</div>
                                <div class="kw-deathnote__header-controls">
                                    <label class="kw-deathnote__row kw-deathnote__row--compact">
                                        <input class="kw-deathnote__has-notebook" type="checkbox" ${state.hasNotebook ? 'checked' : ''} />
                                        <span>In possession</span>
                                    </label>
                                    <label class="kw-deathnote__row kw-deathnote__row--compact">
                                        <input class="kw-deathnote__debug-toggle" type="checkbox" ${settings.debug ? 'checked' : ''} />
                                        <span>Debug</span>
                                    </label>
                                </div>
                            </div>

                            <form class="kw-deathnote__form">
                                <label class="kw-deathnote__field">
                                    <span>Full display name</span>
                                    <input class="text_pole kw-deathnote__input" name="target" autocomplete="off" />
                                </label>
                                <label class="kw-deathnote__field">
                                    <span>Cause of death</span>
                                    <input class="text_pole kw-deathnote__input" name="cause" autocomplete="off" />
                                </label>
                                <label class="kw-deathnote__field">
                                    <span>In how many assistant messages?</span>
                                    <input class="text_pole kw-deathnote__input" name="countdown" type="number" min="0" step="1" value="1" />
                                </label>
                                <div class="kw-deathnote__actions">
                                    <button type="submit" class="kw-deathnote__write menu_button">Write</button>
                                    <button type="button" class="kw-deathnote__close menu_button">Close</button>
                                </div>
                            </form>

                            <div class="kw-deathnote__entries">
                                <div class="kw-deathnote__entries-title">Written names</div>
                                <div class="kw-deathnote__entries-list">${renderEntriesHtml()}</div>
                            </div>

                            ${renderDebugHtml()}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function ensureWidget() {
    const settings = getSettings();
    if (!settings.enabled) {
        document.getElementById(FLOATING_ID)?.remove();
        return null;
    }

    let root = document.getElementById(FLOATING_ID);
    if (!root) {
        root = document.createElement('div');
        root.id = FLOATING_ID;
        root.className = 'kw-deathnote';
        document.body.append(root);
    }

    const { x, y } = resolvePosition();
    root.style.left = `${Math.round(x)}px`;
    root.style.top = `${Math.round(y)}px`;
    root.classList.toggle('kw-deathnote--open', Boolean(settings.isOpen));

    root.innerHTML = buildWidgetHtml();
    return root;
}

async function writeEntryFromForm(form) {
    const data = new FormData(form);
    const targetName = String(data.get('target') || '').trim();
    const cause = String(data.get('cause') || '').trim();
    const remaining = Number(data.get('countdown'));

    const entry = addDeathEntry({
        targetName,
        cause,
        remainingAssistantMessages: remaining,
    });

    if (!entry) {
        notify('warning', 'A full display name is required.');
        return;
    }

    await persistChatChanges();
    notify('success', 'Name written in the Death Note.');
    form.reset();
    const countdown = form.querySelector('[name="countdown"]');
    if (countdown) {
        countdown.value = '1';
    }
}

async function copyText(text) {
    const value = String(text || '');

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch (error) {
        console.warn('[killer_within_deathnote] Clipboard write failed', error);
    }

    try {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.append(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        return true;
    } catch (error) {
        console.warn('[killer_within_deathnote] Fallback clipboard copy failed', error);
        return false;
    }
}

function bindWidgetUi() {
    const state = {
        dragging: false,
        startX: 0,
        startY: 0,
        originX: 0,
        originY: 0,
        moved: false,
        pointerId: null,
    };

    $(document)
        .off('pointerdown', `#${FLOATING_ID} .kw-deathnote__cover`)
        .on('pointerdown', `#${FLOATING_ID} .kw-deathnote__cover`, (event) => {
            const root = document.getElementById(FLOATING_ID);
            if (!root) {
                return;
            }

            const e = event.originalEvent ?? event;
            if (!e?.isPrimary) {
                return;
            }

            const rect = root.getBoundingClientRect();
            state.dragging = true;
            state.moved = false;
            state.pointerId = e.pointerId;
            state.startX = e.clientX;
            state.startY = e.clientY;
            state.originX = rect.left;
            state.originY = rect.top;

            try {
                e.currentTarget?.setPointerCapture?.(e.pointerId);
            } catch (error) {
                void error;
            }
        })
        .off('pointermove', `#${FLOATING_ID} .kw-deathnote__cover`)
        .on('pointermove', `#${FLOATING_ID} .kw-deathnote__cover`, (event) => {
            if (!state.dragging) {
                return;
            }

            const root = document.getElementById(FLOATING_ID);
            if (!root) {
                return;
            }

            const e = event.originalEvent ?? event;
            if (state.pointerId !== null && e.pointerId !== state.pointerId) {
                return;
            }

            const dx = e.clientX - state.startX;
            const dy = e.clientY - state.startY;
            const moved = Math.abs(dx) + Math.abs(dy) > 4;
            if (moved) {
                state.moved = true;
            }

            const maxX = Math.max(0, window.innerWidth - root.offsetWidth);
            const maxY = Math.max(0, window.innerHeight - root.offsetHeight);

            const nextX = clamp(state.originX + dx, 0, maxX);
            const nextY = clamp(state.originY + dy, 0, maxY);

            root.style.left = `${Math.round(nextX)}px`;
            root.style.top = `${Math.round(nextY)}px`;
        })
        .off('pointerup pointercancel', `#${FLOATING_ID} .kw-deathnote__cover`)
        .on('pointerup pointercancel', `#${FLOATING_ID} .kw-deathnote__cover`, async (event) => {
            if (!state.dragging) {
                return;
            }

            const root = document.getElementById(FLOATING_ID);
            if (!root) {
                state.dragging = false;
                state.pointerId = null;
                return;
            }

            state.dragging = false;
            state.pointerId = null;

            const rect = root.getBoundingClientRect();
            setPosition(Math.round(rect.left), Math.round(rect.top));

            if (!state.moved) {
                const settings = getSettings();
                settings.isOpen = !settings.isOpen;
                scheduleSettingsSave();
                refreshDeathNoteUi();
            }
        })
        .off('submit', `#${FLOATING_ID} .kw-deathnote__form`)
        .on('submit', `#${FLOATING_ID} .kw-deathnote__form`, async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            if (!(form instanceof HTMLFormElement)) {
                return;
            }

            await writeEntryFromForm(form);
            refreshDeathNoteUi();
        })
        .off('click', `#${FLOATING_ID} .kw-deathnote__close`)
        .on('click', `#${FLOATING_ID} .kw-deathnote__close`, (event) => {
            event.preventDefault();
            getSettings().isOpen = false;
            scheduleSettingsSave();
            refreshDeathNoteUi();
        })
        .off('click', `#${FLOATING_ID} .kw-deathnote__entry-remove`)
        .on('click', `#${FLOATING_ID} .kw-deathnote__entry-remove`, async (event) => {
            event.preventDefault();
            const id = String($(event.currentTarget).data('entryId') ?? '').trim();
            if (!id) {
                return;
            }

            if (!removeDeathEntry(id)) {
                return;
            }

            await persistChatChanges();
            refreshDeathNoteUi();
        })
        .off('change', `#${FLOATING_ID} .kw-deathnote__has-notebook`)
        .on('change', `#${FLOATING_ID} .kw-deathnote__has-notebook`, async (event) => {
            const checked = Boolean($(event.currentTarget).prop('checked'));
            getChatState().hasNotebook = checked;
            await persistChatChanges();
            refreshDeathNoteUi();
        })
        .off('change', `#${FLOATING_ID} .kw-deathnote__debug-toggle`)
        .on('change', `#${FLOATING_ID} .kw-deathnote__debug-toggle`, (event) => {
            getSettings().debug = Boolean($(event.currentTarget).prop('checked'));
            scheduleSettingsSave();
            refreshDeathNoteUi();
        })
        .off('click', `#${FLOATING_ID} .kw-deathnote__debug-button`)
        .on('click', `#${FLOATING_ID} .kw-deathnote__debug-button`, async (event) => {
            event.preventDefault();
            const action = String($(event.currentTarget).data('action') || '').trim();
            if (!action) {
                return;
            }

            if (action === 'copy-state') {
                const ok = await copyText(JSON.stringify(getChatState(), null, 2));
                notify(ok ? 'success' : 'warning', ok ? 'Death Note state copied.' : 'Could not copy state.');
                return;
            }

            if (action === 'clear-entries') {
                clearDeathEntries();
                await persistChatChanges();
                refreshDeathNoteUi();
                return;
            }

            if (action === 'toggle-notebook') {
                getChatState().hasNotebook = !getChatState().hasNotebook;
                await persistChatChanges();
                refreshDeathNoteUi();
            }
        });
}

export function refreshDeathNoteUi() {
    ensureWidget();
}

export function setupDeathNoteUi() {
    ensureWidget();
    bindWidgetUi();
}

