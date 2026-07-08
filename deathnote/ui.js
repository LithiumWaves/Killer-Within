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

function getWidgetSize(isOpen) {
    if (!isOpen) {
        return { width: 92, height: 132 };
    }

    const width = Math.min(window.innerWidth * 0.86, 780);
    const height = Math.min(window.innerHeight * 0.7, 520);
    return { width, height };
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
            const noteText = String(entry?.noteText || '').trim();
            const headline = noteText || String(entry?.targetName || '').trim();
            const details = noteText ? '' : String(entry?.cause || '').trim();

            return `
                <div class="kw-deathnote__entry kw-deathnote__entry--${status}">
                    <div class="kw-deathnote__entry-text">
                        <div class="kw-deathnote__entry-headline">${escapeHtml(headline)}</div>
                        ${details ? `<div class="kw-deathnote__entry-details">${escapeHtml(details)}</div>` : ''}
                        <div class="kw-deathnote__entry-meta">
                            <span>${status === 'triggered' ? 'Triggered' : `In ${remaining} assistant messages`}</span>
                        </div>
                    </div>
                    <button type="button" class="kw-deathnote__entry-remove menu_button" data-entry-id="${escapeHtml(String(entry?.id || ''))}">✕</button>
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
            <button type="button" class="kw-deathnote__cover3d kw-deathnote__drag-handle kw-deathnote__toggle" aria-label="Death Note">
                <div class="kw-deathnote__cover-face kw-deathnote__cover-face--front" style="background-image:url('${coverUrl}')"></div>
                <div class="kw-deathnote__cover-face kw-deathnote__cover-face--back">
                    <img class="kw-deathnote__rules" src="${rulesUrl}" alt="Death Note rules" />
                </div>
            </button>

            <div class="kw-deathnote__page-right" role="dialog" aria-label="Death Note notebook page">
                <div class="kw-deathnote__paper">
                    <div class="kw-deathnote__paper-header kw-deathnote__drag-handle">
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
                        <textarea
                            class="kw-deathnote__entry-textarea"
                            name="entryText"
                            rows="5"
                            autocomplete="off"
                            spellcheck="false"
                        >${escapeHtml(String(settings.draftText || ''))}</textarea>
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

    const { width, height } = getWidgetSize(Boolean(settings.isOpen));
    const maxX = Math.max(0, window.innerWidth - width);
    const maxY = Math.max(0, window.innerHeight - height);

    const resolved = resolvePosition();
    const x = clamp(resolved.x, 0, maxX);
    const y = clamp(resolved.y, 0, maxY);

    if (resolved.x !== x || resolved.y !== y) {
        setPosition(x, y);
    }

    root.style.left = `${Math.round(x)}px`;
    root.style.top = `${Math.round(y)}px`;
    root.classList.toggle('kw-deathnote--open', Boolean(settings.isOpen));

    root.innerHTML = buildWidgetHtml();
    return root;
}

function parseDeathNoteEntryText(text) {
    const raw = String(text || '').trim();
    if (!raw) {
        return null;
    }

    const lines = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    let targetName = '';
    let rest = '';

    if (lines.length >= 2) {
        targetName = lines[0];
        rest = lines.slice(1).join(' ').trim();
    } else {
        const compact = raw.replace(/\s+/g, ' ').trim();
        const matcher = compact.match(/^(.*?)\s*(?:[-—|:]|\bwill\s+die\b)([\s\S]*)$/i);
        if (matcher) {
            targetName = String(matcher[1] || '').trim();
            rest = String(matcher[2] || '').trim();
        } else {
            targetName = compact;
            rest = '';
        }
    }

    let remainingAssistantMessages = 1;
    let cause = rest;

    const numberMatch = cause.match(/(\d+)\s*(?:assistant\s+messages?|messages?)?\s*$/i);
    if (numberMatch) {
        remainingAssistantMessages = Math.max(0, Number(numberMatch[1]) || 0);
        cause = cause.slice(0, Math.max(0, numberMatch.index)).trim();
    }

    return {
        noteText: raw,
        targetName: String(targetName || '').trim(),
        cause: String(cause || '').trim(),
        remainingAssistantMessages,
    };
}

async function writeEntryFromForm(form) {
    const data = new FormData(form);
    const parsed = parseDeathNoteEntryText(data.get('entryText'));
    if (!parsed) {
        notify('warning', 'Write something in the notebook first.');
        return;
    }

    const entry = addDeathEntry(parsed);

    if (!entry) {
        notify('warning', 'A full display name is required.');
        return;
    }

    await persistChatChanges();
    getSettings().draftText = '';
    scheduleSettingsSave();
    notify('success', 'Name written in the Death Note.');
    form.reset();
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
        toggleOnTap: false,
        pointerId: null,
    };

    $(document)
        .off('pointerdown', `#${FLOATING_ID} .kw-deathnote__drag-handle`)
        .on('pointerdown', `#${FLOATING_ID} .kw-deathnote__drag-handle`, (event) => {
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
            state.toggleOnTap = Boolean($(event.currentTarget).closest('.kw-deathnote__toggle').length);
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
        .off('pointermove', `#${FLOATING_ID} .kw-deathnote__drag-handle`)
        .on('pointermove', `#${FLOATING_ID} .kw-deathnote__drag-handle`, (event) => {
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
        .off('pointerup pointercancel', `#${FLOATING_ID} .kw-deathnote__drag-handle`)
        .on('pointerup pointercancel', `#${FLOATING_ID} .kw-deathnote__drag-handle`, async () => {
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

            if (!state.moved && state.toggleOnTap) {
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
        .off('input', `#${FLOATING_ID} .kw-deathnote__entry-textarea`)
        .on('input', `#${FLOATING_ID} .kw-deathnote__entry-textarea`, (event) => {
            getSettings().draftText = String($(event.currentTarget).val() ?? '');
            scheduleSettingsSave();
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

