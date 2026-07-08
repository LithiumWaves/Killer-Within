import { FLOATING_ID } from './config.js';
import {
    getChatState,
    getNotebookPages,
    getSettings,
    persistChatChanges,
    scheduleSettingsSave,
    setNotebookPages,
} from './core.js';

const PAGE_PLACEHOLDER = '[NAME] [METHOD OF DEATH] [TIME]';

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
        return { width: 170, height: 240 };
    }

    const aspectRatio = 992 / 744;
    const maxWidth = Math.min(window.innerWidth * 0.9, 960);
    const maxHeight = Math.min(window.innerHeight * 0.78, 720);
    const width = Math.min(maxWidth, maxHeight * aspectRatio);
    const height = width / aspectRatio;
    return { width, height };
}

function getDefaultPosition() {
    const width = 170;
    const height = 240;
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

function getClampedPageIndex(pages) {
    const settings = getSettings();
    const maxIndex = Math.max(0, pages.length - 1);
    const next = clamp(Number(settings.currentPageIndex) || 0, 0, maxIndex);
    if (next !== settings.currentPageIndex) {
        settings.currentPageIndex = next;
        scheduleSettingsSave();
    }
    return next;
}

function renderNotebookPage(text, extraClass = '') {
    const content = String(text || '');
    const classes = ['kw-deathnote__paper', extraClass].filter(Boolean).join(' ');

    return `
        <div class="${classes}">
            <div class="kw-deathnote__page-text">${escapeHtml(content || PAGE_PLACEHOLDER)}</div>
        </div>
    `;
}

function buildWidgetHtml() {
    const coverUrl = new URL('../assets/deathnote/cover.jpg', import.meta.url).toString();
    const rulesPageUrl = new URL('../assets/deathnote/rulespage1.jpg', import.meta.url).toString();
    const state = getChatState();
    const settings = getSettings();
    const pages = getNotebookPages();
    const currentPageIndex = getClampedPageIndex(pages);
    const hasPreviousPage = currentPageIndex > 0;
    const leftPageHtml = hasPreviousPage
        ? renderNotebookPage(pages[currentPageIndex - 1], 'kw-deathnote__paper--left')
        : `
            <div class="kw-deathnote__inside-cover-panel">
                <div class="kw-deathnote__inside-cover-sheet">
                    <img
                        class="kw-deathnote__rules-page"
                        src="${rulesPageUrl}"
                        alt="Death Note rules"
                        draggable="false"
                    />
                </div>
            </div>
        `;

    return `
        <div class="kw-deathnote__stage">
            <img
                class="kw-deathnote__cover kw-deathnote__drag-handle kw-deathnote__toggle"
                src="${coverUrl}"
                alt="Death Note"
                draggable="false"
            />

            <div
                class="kw-deathnote__spread"
                role="dialog"
                aria-label="Death Note notebook"
            >
                <div class="kw-deathnote__page-left kw-deathnote__drag-handle" aria-label="Death Note left page">
                    ${leftPageHtml}
                </div>
                <div class="kw-deathnote__page-right">
                    <div class="kw-deathnote__toolbar">
                        <button
                            type="button"
                            class="kw-deathnote__page-nav ${currentPageIndex <= 0 ? 'is-disabled' : ''}"
                            data-page-nav="prev"
                            aria-label="Previous page"
                            ${currentPageIndex <= 0 ? 'disabled' : ''}
                        >Previous</button>
                        <div class="kw-deathnote__page-indicator">Page ${currentPageIndex + 1}</div>
                        <button
                            type="button"
                            class="kw-deathnote__font-button ${settings.fontMode === 'print' ? 'is-active' : ''}"
                            data-font-mode="print"
                        >Print</button>
                        <button
                            type="button"
                            class="kw-deathnote__font-button ${settings.fontMode === 'script' ? 'is-active' : ''}"
                            data-font-mode="script"
                        >Script</button>
                        <button
                            type="button"
                            class="kw-deathnote__page-nav"
                            data-page-nav="next"
                            aria-label="Next page"
                        >Next</button>
                    </div>
                    <div class="kw-deathnote__paper">
                        <textarea
                            class="kw-deathnote__entry-textarea"
                            name="entryText"
                            autocomplete="off"
                            spellcheck="false"
                            placeholder="${PAGE_PLACEHOLDER}"
                        >${escapeHtml(String(pages[currentPageIndex] || ''))}</textarea>
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
    root.style.display = 'block';
    root.style.visibility = 'visible';
    root.style.opacity = '1';
    root.style.pointerEvents = 'auto';
    root.classList.toggle('kw-deathnote--open', Boolean(settings.isOpen));
    root.classList.toggle('kw-deathnote--font-print', settings.fontMode !== 'script');
    root.classList.toggle('kw-deathnote--font-script', settings.fontMode === 'script');

    root.innerHTML = buildWidgetHtml();
    return root;
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
        handlersInstalled: false,
        moveHandler: null,
        upHandler: null,
        saveTimer: null,
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

            event.preventDefault();
            const rect = root.getBoundingClientRect();
            state.dragging = true;
            state.moved = false;
            state.toggleOnTap = Boolean($(event.currentTarget).closest('.kw-deathnote__toggle').length);
            state.pointerId = e.pointerId;
            state.startX = e.clientX;
            state.startY = e.clientY;
            state.originX = rect.left;
            state.originY = rect.top;

            const installHandlers = () => {
                if (state.handlersInstalled) {
                    return;
                }

                state.handlersInstalled = true;

                state.moveHandler = (rawEvent) => {
                    if (!state.dragging) {
                        return;
                    }

                    const root = document.getElementById(FLOATING_ID);
                    if (!root) {
                        return;
                    }

                    const eMove = rawEvent;
                    if (state.pointerId !== null && eMove.pointerId !== state.pointerId) {
                        return;
                    }

                    const dx = eMove.clientX - state.startX;
                    const dy = eMove.clientY - state.startY;
                    const moved = Math.abs(dx) + Math.abs(dy) > 4;
                    if (moved) {
                        state.moved = true;
                    }

                    const rectNow = root.getBoundingClientRect();
                    const maxX = Math.max(0, window.innerWidth - rectNow.width);
                    const maxY = Math.max(0, window.innerHeight - rectNow.height);

                    const nextX = clamp(state.originX + dx, 0, maxX);
                    const nextY = clamp(state.originY + dy, 0, maxY);

                    root.style.left = `${Math.round(nextX)}px`;
                    root.style.top = `${Math.round(nextY)}px`;
                };

                state.upHandler = async (rawEvent) => {
                    if (!state.dragging) {
                        return;
                    }

                    const eUp = rawEvent;
                    if (state.pointerId !== null && eUp.pointerId !== state.pointerId) {
                        return;
                    }

                    const root = document.getElementById(FLOATING_ID);

                    state.dragging = false;
                    state.pointerId = null;

                    if (root) {
                        const rectFinal = root.getBoundingClientRect();
                        setPosition(Math.round(rectFinal.left), Math.round(rectFinal.top));
                    }

                    window.removeEventListener('pointermove', state.moveHandler, true);
                    window.removeEventListener('pointerup', state.upHandler, true);
                    window.removeEventListener('pointercancel', state.upHandler, true);
                    state.handlersInstalled = false;

                    if (!state.moved && state.toggleOnTap) {
                        const settings = getSettings();
                        settings.isOpen = !settings.isOpen;
                        scheduleSettingsSave();
                        refreshDeathNoteUi();
                    }
                };

                window.addEventListener('pointermove', state.moveHandler, true);
                window.addEventListener('pointerup', state.upHandler, true);
                window.addEventListener('pointercancel', state.upHandler, true);
            };

            installHandlers();
        })
        .off('input', `#${FLOATING_ID} .kw-deathnote__entry-textarea`)
        .on('input', `#${FLOATING_ID} .kw-deathnote__entry-textarea`, (event) => {
            const textarea = event.currentTarget;
            if (!(textarea instanceof HTMLTextAreaElement)) {
                return;
            }

            const pages = [...getNotebookPages()];
            const settings = getSettings();
            const currentPageIndex = getClampedPageIndex(pages);
            const value = String($(textarea).val() ?? '');
            const tailText = pages.slice(currentPageIndex + 1).join('');
            const repaginated = paginateNotebookText(textarea, `${value}${tailText}`);
            const nextPages = [
                ...pages.slice(0, currentPageIndex),
                ...repaginated,
            ];
            const changed = setNotebookPages(nextPages);

            if (!changed) {
                return;
            }

            const movedForward = repaginated.length > 1 && repaginated[0] !== value;
            if (movedForward) {
                settings.currentPageIndex = Math.min(nextPages.length - 1, currentPageIndex + 1);
            } else {
                settings.currentPageIndex = currentPageIndex;
            }

            scheduleSettingsSave();
            refreshDeathNoteUi();

            if (state.saveTimer) {
                clearTimeout(state.saveTimer);
            }

            state.saveTimer = setTimeout(async () => {
                state.saveTimer = null;
                await persistChatChanges();
            }, 450);
        })
        .off('click', `#${FLOATING_ID} .kw-deathnote__font-button`)
        .on('click', `#${FLOATING_ID} .kw-deathnote__font-button`, (event) => {
            event.preventDefault();
            const fontMode = String($(event.currentTarget).data('fontMode') || 'print').trim().toLowerCase();
            getSettings().fontMode = fontMode === 'script' ? 'script' : 'print';
            scheduleSettingsSave();
            refreshDeathNoteUi();
        })
        .off('click', `#${FLOATING_ID} .kw-deathnote__page-nav`)
        .on('click', `#${FLOATING_ID} .kw-deathnote__page-nav`, (event) => {
            event.preventDefault();
            const direction = String($(event.currentTarget).data('pageNav') || '').trim().toLowerCase();
            const pages = getNotebookPages();
            const settings = getSettings();
            const currentPageIndex = getClampedPageIndex(pages);

            if (direction === 'prev') {
                settings.currentPageIndex = Math.max(0, currentPageIndex - 1);
            }

            if (direction === 'next') {
                if (currentPageIndex >= pages.length - 1) {
                    setNotebookPages([...pages, '']);
                }
                settings.currentPageIndex = Math.min(getNotebookPages().length - 1, currentPageIndex + 1);
            }

            scheduleSettingsSave();
            persistChatChanges();
            refreshDeathNoteUi();
        });
}

let measureElement = null;

function getMeasureElement() {
    if (measureElement?.isConnected) {
        return measureElement;
    }

    measureElement = document.createElement('div');
    measureElement.className = 'kw-deathnote__measure';
    document.body.append(measureElement);
    return measureElement;
}

function measureFits(textarea, value) {
    const styles = window.getComputedStyle(textarea);
    const measure = getMeasureElement();

    measure.style.width = `${textarea.clientWidth}px`;
    measure.style.minHeight = `${textarea.clientHeight}px`;
    measure.style.fontFamily = styles.fontFamily;
    measure.style.fontSize = styles.fontSize;
    measure.style.fontWeight = styles.fontWeight;
    measure.style.fontStyle = styles.fontStyle;
    measure.style.lineHeight = styles.lineHeight;
    measure.style.letterSpacing = styles.letterSpacing;
    measure.style.padding = styles.padding;
    measure.style.whiteSpace = 'pre-wrap';
    measure.style.overflowWrap = 'break-word';
    measure.style.wordBreak = 'break-word';
    measure.textContent = value || '\u200b';

    return measure.scrollHeight <= textarea.clientHeight + 1;
}

function findPageBreakIndex(textarea, text) {
    if (!text) {
        return 0;
    }

    if (measureFits(textarea, text)) {
        return text.length;
    }

    let low = 0;
    let high = text.length;

    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const sample = text.slice(0, mid);
        if (measureFits(textarea, sample)) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }

    let index = Math.max(1, low);
    if (index < text.length) {
        const boundary = Math.max(
            text.lastIndexOf('\n', index - 1),
            text.lastIndexOf(' ', index - 1),
        );

        if (boundary > Math.floor(index * 0.6)) {
            index = boundary + 1;
        }
    }

    return Math.max(1, index);
}

function paginateNotebookText(textarea, text) {
    const source = String(text ?? '');
    if (!source) {
        return [''];
    }

    const pages = [];
    let remaining = source;

    while (remaining.length) {
        const endIndex = findPageBreakIndex(textarea, remaining);
        const pageText = remaining.slice(0, endIndex);
        pages.push(pageText);
        remaining = remaining.slice(endIndex);

        if (!remaining) {
            break;
        }
    }

    return pages.length ? pages : [''];
}

export function refreshDeathNoteUi() {
    ensureWidget();
}

export function setupDeathNoteUi() {
    ensureWidget();
    bindWidgetUi();
}

