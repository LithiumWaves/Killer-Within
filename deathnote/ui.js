import { FLOATING_ID } from './config.js';
import {
    getNotebookPages,
    getSettings,
    persistChatChanges,
    scheduleSettingsSave,
    setNotebookPages,
} from './core.js';

const PAGE_PLACEHOLDER = '[NAME] [METHOD OF DEATH] [TIME]';
const PAGE_TURN_MS = 240;
const CLOSED_WIDTH = 220;
const CLOSED_HEIGHT = 310;
let pendingFocus = null;
let pageTurnTimer = null;
let pageTurnCleanupTimer = null;

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
        return { width: CLOSED_WIDTH, height: CLOSED_HEIGHT };
    }

    const aspectRatio = 992 / 744;
    const maxWidth = Math.min(window.innerWidth * 0.9, 960);
    const maxHeight = Math.min(window.innerHeight * 0.78, 720);
    const width = Math.min(maxWidth, maxHeight * aspectRatio);
    const height = width / aspectRatio;
    return { width, height };
}

function getDefaultPosition() {
    const width = CLOSED_WIDTH;
    const height = CLOSED_HEIGHT;
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

function getTogglePosition(left, top, isOpening) {
    const nextSize = getWidgetSize(isOpening);
    const nextX = clamp(left, 0, Math.max(0, window.innerWidth - nextSize.width));
    const nextY = clamp(top, 0, Math.max(0, window.innerHeight - nextSize.height));

    return {
        x: Math.round(nextX),
        y: Math.round(nextY),
    };
}

function getSpreadCount(pages) {
    const totalPages = Math.max(1, Array.isArray(pages) ? pages.length : 0);
    return Math.max(1, 1 + Math.ceil(Math.max(0, totalPages - 1) / 2));
}

function getClampedSpreadIndex(pages) {
    const settings = getSettings();
    const rawIndex = settings.currentSpreadIndex !== undefined && settings.currentSpreadIndex !== null
        ? settings.currentSpreadIndex
        : settings.currentPageIndex;
    const fallback = Number(rawIndex) || 0;
    const maxIndex = Math.max(0, getSpreadCount(pages) - 1);
    const next = clamp(fallback, 0, maxIndex);
    if (next !== settings.currentSpreadIndex) {
        settings.currentSpreadIndex = next;
        scheduleSettingsSave();
    }
    return next;
}

function ensurePageCapacity(pages, pageIndex) {
    const nextPages = Array.isArray(pages) ? [...pages] : [''];
    while (nextPages.length <= pageIndex) {
        nextPages.push('');
    }
    return nextPages;
}

function getVisiblePageIndices(spreadIndex) {
    if (spreadIndex <= 0) {
        return { leftPageIndex: null, rightPageIndex: 0 };
    }

    const leftPageIndex = (spreadIndex * 2) - 1;
    return {
        leftPageIndex,
        rightPageIndex: leftPageIndex + 1,
    };
}

function getSpreadLabel(spreadIndex, visible) {
    if (spreadIndex <= 0) {
        return 'Rules + Page 1';
    }

    return `Pages ${visible.leftPageIndex + 1}-${visible.rightPageIndex + 1}`;
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

function renderEditablePage({ pageIndex, side, text, extraClass = '' }) {
    const classes = ['kw-deathnote__paper', 'kw-deathnote__paper--editable', extraClass].filter(Boolean).join(' ');
    return `
        <div class="${classes}">
            <textarea
                class="kw-deathnote__entry-textarea"
                name="entryText"
                data-page-index="${pageIndex}"
                data-page-side="${side}"
                autocomplete="off"
                spellcheck="false"
                placeholder="${PAGE_PLACEHOLDER}"
            >${escapeHtml(String(text || ''))}</textarea>
        </div>
    `;
}

function queueFocusRestore(pageIndex, side, mode = 'end') {
    pendingFocus = {
        pageIndex,
        side,
        mode,
    };
}

function updatePageWithOverflow(textarea, pages, pageIndex, value) {
    const nextPages = ensurePageCapacity(pages, pageIndex);
    const result = [...nextPages];

    if (measureFits(textarea, value)) {
        result[pageIndex] = value;
        return {
            pages: result,
            overflowed: false,
        };
    }

    let cursor = pageIndex;
    let carry = String(value || '');

    while (true) {
        const currentExisting = cursor === pageIndex ? '' : String(result[cursor] || '');
        const combined = `${carry}${currentExisting}`;

        if (measureFits(textarea, combined)) {
            result[cursor] = combined;
            break;
        }

        const splitIndex = findPageBreakIndex(textarea, combined);
        result[cursor] = combined.slice(0, splitIndex);
        carry = combined.slice(splitIndex);
        cursor += 1;
        result.push(...ensurePageCapacity(result, cursor).slice(result.length));
    }

    return {
        pages: result,
        overflowed: cursor > pageIndex,
    };
}

function buildWidgetHtml() {
    const coverUrl = new URL('../assets/deathnote/cover.jpg', import.meta.url).toString();
    const rulesPageUrl = new URL('../assets/deathnote/rulespage1.jpg', import.meta.url).toString();
    const settings = getSettings();
    const pages = ensurePageCapacity(getNotebookPages(), 0);
    const currentSpreadIndex = getClampedSpreadIndex(pages);
    const visible = getVisiblePageIndices(currentSpreadIndex);
    const expandedPages = ensurePageCapacity(pages, visible.rightPageIndex);
    const leftPageHtml = visible.leftPageIndex !== null
        ? renderEditablePage({
            pageIndex: visible.leftPageIndex,
            side: 'left',
            text: expandedPages[visible.leftPageIndex] || '',
            extraClass: 'kw-deathnote__paper--left',
        })
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
            <button
                type="button"
                class="kw-deathnote__cover kw-deathnote__drag-handle kw-deathnote__toggle"
                aria-label="Open Death Note"
            >
                <img
                    class="kw-deathnote__cover-art"
                    src="${coverUrl}"
                    alt="Death Note"
                    draggable="false"
                />
            </button>

            <div
                class="kw-deathnote__spread"
                role="dialog"
                aria-label="Death Note notebook"
            >
                <button
                    type="button"
                    class="kw-deathnote__close-tab kw-deathnote__drag-handle kw-deathnote__toggle"
                    aria-label="Close notebook"
                ></button>
                <div class="kw-deathnote__spine-handle kw-deathnote__drag-handle" aria-hidden="true"></div>
                <div class="kw-deathnote__page-left ${visible.leftPageIndex !== null ? 'kw-deathnote__page-left--paper' : 'kw-deathnote__page-left--cover'}" aria-label="Death Note left page">
                    ${leftPageHtml}
                    <button
                        type="button"
                        class="kw-deathnote__corner-tab kw-deathnote__corner-tab--prev ${currentSpreadIndex <= 0 ? 'is-hidden' : ''}"
                        data-page-nav="prev"
                        aria-label="Previous spread"
                        ${currentSpreadIndex <= 0 ? 'disabled' : ''}
                    ></button>
                </div>
                <div class="kw-deathnote__page-right">
                    <div class="kw-deathnote__toolbar">
                        <div class="kw-deathnote__page-indicator">${getSpreadLabel(currentSpreadIndex, visible)}</div>
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
                    </div>
                    ${renderEditablePage({
                        pageIndex: visible.rightPageIndex,
                        side: 'right',
                        text: expandedPages[visible.rightPageIndex] || '',
                    })}
                    <button
                        type="button"
                        class="kw-deathnote__corner-tab kw-deathnote__corner-tab--next"
                        data-page-nav="next"
                        aria-label="Next spread"
                    ></button>
                </div>
            </div>
        </div>
    `;
}

function ensureWidget() {
    const settings = getSettings();
    if (!settings.enabled) {
        const existing = document.getElementById(FLOATING_ID);
        if (existing) {
            existing.remove();
        }
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
    restorePendingFocus(root);
    return root;
}

function restorePendingFocus(root) {
    if (!pendingFocus || !root) {
        return;
    }

    const target = root.querySelector(`.kw-deathnote__entry-textarea[data-page-index="${pendingFocus.pageIndex}"]`);
    if (!(target instanceof HTMLTextAreaElement)) {
        return;
    }

    requestAnimationFrame(() => {
        target.focus({ preventScroll: true });
        const valueLength = target.value.length;
        const position = pendingFocus.mode === 'start' ? 0 : valueLength;
        target.setSelectionRange(position, position);
        pendingFocus = null;
    });
}

function scheduleChatSave(state) {
    if (state.saveTimer) {
        clearTimeout(state.saveTimer);
    }

    state.saveTimer = setTimeout(async () => {
        state.saveTimer = null;
        await persistChatChanges();
    }, 450);
}

function getVisibleTexts(pages, spreadIndex) {
    const visible = getVisiblePageIndices(spreadIndex);
    return {
        left: visible.leftPageIndex === null ? null : String(pages[visible.leftPageIndex] || ''),
        right: String(pages[visible.rightPageIndex] || ''),
    };
}

function runPageTurn(direction, callback) {
    const root = document.getElementById(FLOATING_ID);
    if (!root) {
        callback();
        refreshDeathNoteUi();
        return;
    }

    clearTimeout(pageTurnTimer);
    clearTimeout(pageTurnCleanupTimer);
    root.classList.remove('kw-deathnote--turn-prev', 'kw-deathnote--turn-next', 'kw-deathnote--turn-prev-in', 'kw-deathnote--turn-next-in');
    root.classList.add(direction === 'prev' ? 'kw-deathnote--turn-prev' : 'kw-deathnote--turn-next');

    pageTurnTimer = setTimeout(() => {
        callback();
        refreshDeathNoteUi();
        const nextRoot = document.getElementById(FLOATING_ID);
        if (!nextRoot) {
            return;
        }

        nextRoot.classList.remove('kw-deathnote--turn-prev', 'kw-deathnote--turn-next');
        nextRoot.classList.add(direction === 'prev' ? 'kw-deathnote--turn-prev-in' : 'kw-deathnote--turn-next-in');

        pageTurnCleanupTimer = setTimeout(() => {
            nextRoot.classList.remove('kw-deathnote--turn-prev-in', 'kw-deathnote--turn-next-in');
        }, PAGE_TURN_MS);
    }, PAGE_TURN_MS);
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

            const e = event.originalEvent || event;
            if (!e || !e.isPrimary) {
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
                        const isOpening = !settings.isOpen;
                        if (root) {
                            const rectFinal = root.getBoundingClientRect();
                            const nextPosition = getTogglePosition(rectFinal.left, rectFinal.top, isOpening);
                            settings.floatingX = nextPosition.x;
                            settings.floatingY = nextPosition.y;
                        }
                        settings.isOpen = isOpening;
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

            const pageIndex = Number(textarea.dataset.pageIndex);
            const pageSide = String(textarea.dataset.pageSide || 'right').trim().toLowerCase();
            if (!Number.isFinite(pageIndex) || pageIndex < 0) {
                return;
            }

            const pages = ensurePageCapacity(getNotebookPages(), pageIndex);
            const settings = getSettings();
            const currentSpreadIndex = getClampedSpreadIndex(pages);
            const beforeVisible = getVisibleTexts(pages, currentSpreadIndex);
            const rawValue = $(textarea).val();
            const value = String(rawValue === undefined || rawValue === null ? '' : rawValue);
            const update = updatePageWithOverflow(textarea, pages, pageIndex, value);
            const nextPages = update.pages;
            const changed = setNotebookPages(nextPages);

            if (!changed) {
                return;
            }

            const activeTrimmed = String(nextPages[pageIndex] || '') !== value;
            const afterVisible = getVisibleTexts(nextPages, currentSpreadIndex);
            const otherSideChanged = pageSide === 'left'
                ? beforeVisible.right !== afterVisible.right
                : beforeVisible.left !== afterVisible.left;

            if (activeTrimmed) {
                const nextPageIndex = pageIndex + 1;
                const nextSpreadIndex = nextPageIndex === 0 ? 0 : Math.floor((nextPageIndex + 1) / 2);
                settings.currentSpreadIndex = nextSpreadIndex;
                queueFocusRestore(nextPageIndex, nextPageIndex % 2 === 1 ? 'left' : 'right', 'start');
                scheduleSettingsSave();
                refreshDeathNoteUi();
                scheduleChatSave(state);
                return;
            }

            if (otherSideChanged) {
                queueFocusRestore(pageIndex, pageSide, 'end');
                refreshDeathNoteUi();
            } else {
                textarea.dataset.pageIndex = String(pageIndex);
            }

            scheduleSettingsSave();
            scheduleChatSave(state);
        })
        .off('click', `#${FLOATING_ID} .kw-deathnote__font-button`)
        .on('click', `#${FLOATING_ID} .kw-deathnote__font-button`, (event) => {
            event.preventDefault();
            const fontMode = String($(event.currentTarget).data('fontMode') || 'print').trim().toLowerCase();
            getSettings().fontMode = fontMode === 'script' ? 'script' : 'print';
            scheduleSettingsSave();
            refreshDeathNoteUi();
        })
        .off('click', `#${FLOATING_ID} .kw-deathnote__corner-tab`)
        .on('click', `#${FLOATING_ID} .kw-deathnote__corner-tab`, (event) => {
            event.preventDefault();
            const direction = String($(event.currentTarget).data('pageNav') || '').trim().toLowerCase();
            const pages = getNotebookPages();
            const settings = getSettings();
            const currentSpreadIndex = getClampedSpreadIndex(pages);

            if (direction === 'prev' && currentSpreadIndex > 0) {
                runPageTurn('prev', () => {
                    settings.currentSpreadIndex = Math.max(0, currentSpreadIndex - 1);
                    queueFocusRestore(getVisiblePageIndices(settings.currentSpreadIndex).rightPageIndex, 'right', 'end');
                    scheduleSettingsSave();
                });
                return;
            }

            if (direction === 'next') {
                const nextSpreadIndex = currentSpreadIndex + 1;
                const nextVisible = getVisiblePageIndices(nextSpreadIndex);
                const expanded = ensurePageCapacity(pages, nextVisible.rightPageIndex);

                runPageTurn('next', () => {
                    setNotebookPages(expanded);
                    settings.currentSpreadIndex = nextSpreadIndex;
                    queueFocusRestore(
                        nextVisible.leftPageIndex === null ? nextVisible.rightPageIndex : nextVisible.leftPageIndex,
                        nextVisible.leftPageIndex === null ? 'right' : 'left',
                        'end',
                    );
                    scheduleSettingsSave();
                    persistChatChanges();
                });
            }
        });
}

let measureElement = null;

function getMeasureElement() {
    if (measureElement && measureElement.isConnected) {
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
    const source = String(text === undefined || text === null ? '' : text);
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

