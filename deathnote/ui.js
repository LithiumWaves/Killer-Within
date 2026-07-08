import { FLOATING_ID, NOTEBOOK_ACTOR_TYPES, NOTEBOOK_USER_ACCESS } from './config.js';
import {
    addNotebookToucher,
    clearNotebookTouchers,
    createNotebookScrap,
    destroyNotebook,
    getChatState,
    getContext,
    getDeathNoteInventory,
    getLinkedShinigami,
    getNotebookPages,
    getNotebookOwnership,
    getSettings,
    linkNotebookShinigami,
    notify,
    persistChatChanges,
    removeNotebookScrap,
    scheduleSettingsSave,
    setNotebookOwnership,
    setNotebookPages,
    setUserNotebookAccess,
    transferNotebookScrap,
    transferNotebookTo,
    unlinkNotebookShinigami,
} from './core.js';
import { syncLinkedShinigamiVisibility } from '../presence/index.js';

const PAGE_TURN_MS = 240;
const CLOSED_WIDTH = 240;
const CLOSED_HEIGHT = 340;
const SETTINGS_PANEL_ID = 'kw-deathnote-settings';
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
    const preferredX = settings.isOpen ? settings.floatingX : settings.closedFloatingX;
    const preferredY = settings.isOpen ? settings.floatingY : settings.closedFloatingY;

    if (Number.isFinite(preferredX) && Number.isFinite(preferredY)) {
        return {
            x: preferredX,
            y: preferredY,
        };
    }

    if (Number.isFinite(settings.floatingX) && Number.isFinite(settings.floatingY)) {
        return {
            x: settings.floatingX,
            y: settings.floatingY,
        };
    }

    if (Number.isFinite(settings.closedFloatingX) && Number.isFinite(settings.closedFloatingY)) {
        return {
            x: settings.closedFloatingX,
            y: settings.closedFloatingY,
        };
    }

    return getDefaultPosition();
}

function setPosition(x, y, options = {}) {
    const settings = getSettings();
    settings.floatingX = x;
    settings.floatingY = y;

    if (options.rememberClosed) {
        settings.closedFloatingX = x;
        settings.closedFloatingY = y;
    }

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
            <div class="kw-deathnote__page-text">${escapeHtml(content)}</div>
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

function encodeActorValue(actor) {
    return encodeURIComponent(JSON.stringify({
        type: String(actor && actor.type ? actor.type : NOTEBOOK_ACTOR_TYPES.NONE),
        id: String(actor && actor.id ? actor.id : ''),
        name: String(actor && actor.name ? actor.name : ''),
    }));
}

function decodeActorValue(value, fallback = null) {
    const source = String(value || '').trim();
    if (!source) {
        return fallback;
    }

    try {
        const parsed = JSON.parse(decodeURIComponent(source));
        return {
            type: String(parsed && parsed.type ? parsed.type : NOTEBOOK_ACTOR_TYPES.NONE).trim().toLowerCase() || NOTEBOOK_ACTOR_TYPES.NONE,
            id: String(parsed && parsed.id ? parsed.id : '').trim(),
            name: String(parsed && parsed.name ? parsed.name : '').trim(),
        };
    } catch (_error) {
        return fallback;
    }
}

function actorIdentityKey(actor) {
    const source = actor && typeof actor === 'object' ? actor : {};
    return [
        String(source.type || NOTEBOOK_ACTOR_TYPES.NONE).trim().toLowerCase(),
        String(source.id || '').trim(),
        String(source.name || '').trim(),
    ].join('::');
}

function formatActorLabel(actor) {
    const source = actor && typeof actor === 'object' ? actor : {};
    const type = String(source.type || NOTEBOOK_ACTOR_TYPES.NONE).trim().toLowerCase();
    const name = String(source.name || '').trim();

    if (type === NOTEBOOK_ACTOR_TYPES.USER) {
        return name || 'User';
    }

    if (type === NOTEBOOK_ACTOR_TYPES.SHINIGAMI) {
        return name ? `${name} (Shinigami)` : 'Shinigami';
    }

    if (type === NOTEBOOK_ACTOR_TYPES.WORLD) {
        return name || 'World';
    }

    if (type === NOTEBOOK_ACTOR_TYPES.CHARACTER) {
        return name || 'Character';
    }

    return name || 'Unknown';
}

function getAvailableCharacterActors() {
    const context = getContext();
    const characters = context && Array.isArray(context.characters) ? context.characters : [];
    const seen = new Set();
    const actors = [];

    for (const character of characters) {
        const actor = {
            type: NOTEBOOK_ACTOR_TYPES.CHARACTER,
            id: String(character && character.avatar ? character.avatar : '').trim(),
            name: String(character && character.name ? character.name : '').trim(),
        };
        if (!actor.name && !actor.id) {
            continue;
        }

        const key = actorIdentityKey(actor);
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        actors.push(actor);
    }

    return actors;
}

function getActorChoices(options = {}) {
    const includeUser = options.includeUser !== false;
    const includeCharacters = options.includeCharacters !== false;
    const includeWorld = Boolean(options.includeWorld);
    const currentActor = options.currentActor && typeof options.currentActor === 'object' ? options.currentActor : null;
    const seen = new Set();
    const actors = [];

    if (includeUser) {
        actors.push({
            type: NOTEBOOK_ACTOR_TYPES.USER,
            id: '',
            name: 'User',
        });
    }

    if (includeCharacters) {
        actors.push(...getAvailableCharacterActors());
    }

    if (includeWorld) {
        actors.push({
            type: NOTEBOOK_ACTOR_TYPES.WORLD,
            id: '',
            name: 'World',
        });
    }

    if (currentActor) {
        actors.push(currentActor);
    }

    return actors.filter((actor) => {
        const key = actorIdentityKey(actor);
        if (seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
}

function renderActorOptions(actors, selectedActor, includeEmpty = false, emptyLabel = 'None') {
    const options = [];
    if (includeEmpty) {
        options.push(`<option value="">${escapeHtml(emptyLabel)}</option>`);
    }

    const selectedKey = selectedActor ? actorIdentityKey(selectedActor) : '';
    for (const actor of Array.isArray(actors) ? actors : []) {
        const isSelected = selectedKey && actorIdentityKey(actor) === selectedKey;
        options.push(`
            <option value="${escapeHtml(encodeActorValue(actor))}" ${isSelected ? 'selected' : ''}>
                ${escapeHtml(formatActorLabel(actor))}
            </option>
        `);
    }

    return options.join('');
}

function formatAccessLabel(access) {
    if (access === NOTEBOOK_USER_ACCESS.FULL) {
        return 'Full notebook';
    }

    if (access === NOTEBOOK_USER_ACCESS.SCRAP) {
        return 'Scrap only';
    }

    if (access === NOTEBOOK_USER_ACCESS.TOUCH) {
        return 'Touch only';
    }

    return 'No access';
}

function renderUserAccessOptions(selectedAccess) {
    const options = [
        { value: NOTEBOOK_USER_ACCESS.FULL, label: 'Full notebook' },
        { value: NOTEBOOK_USER_ACCESS.SCRAP, label: 'Scrap only' },
        { value: NOTEBOOK_USER_ACCESS.TOUCH, label: 'Touch only' },
        { value: NOTEBOOK_USER_ACCESS.NONE, label: 'None' },
    ];

    return options.map((option) => {
        return `
            <option value="${option.value}" ${selectedAccess === option.value ? 'selected' : ''}>
                ${option.label}
            </option>
        `;
    }).join('');
}

function renderNotebookManagerHtml() {
    const ownership = getNotebookOwnership();
    const inventory = getDeathNoteInventory();
    const actors = getActorChoices({
        currentActor: ownership.holder,
        includeWorld: true,
    });

    return `
        <div class="kw-deathnote-manager">
            <div class="kw-deathnote-manager__summary">
                <span><b>Owner:</b> ${escapeHtml(formatActorLabel(ownership.owner))}</span>
                <span><b>Holder:</b> ${escapeHtml(formatActorLabel(ownership.holder))}</span>
                <span><b>User access:</b> ${escapeHtml(formatAccessLabel(ownership.userAccess))}</span>
                <span><b>Status:</b> ${inventory.notebook.destroyed ? 'Destroyed / missing' : 'In play'}</span>
            </div>
            <div class="kw-deathnote-manager__grid">
                <label class="killer-within-settings__field">
                    <span>Notebook owner</span>
                    <select id="kw-deathnote-owner" class="text_pole">
                        ${renderActorOptions(actors, ownership.owner)}
                    </select>
                </label>
                <label class="killer-within-settings__field">
                    <span>Current holder</span>
                    <select id="kw-deathnote-holder" class="text_pole">
                        ${renderActorOptions(actors, ownership.holder)}
                    </select>
                </label>
                <label class="killer-within-settings__field">
                    <span>User access</span>
                    <select id="kw-deathnote-user-access" class="text_pole">
                        ${renderUserAccessOptions(ownership.userAccess)}
                    </select>
                </label>
            </div>
            <div class="kw-deathnote-manager__actions">
                <button
                    type="button"
                    id="kw-deathnote-toggle-destroyed"
                    class="menu_button"
                >${inventory.notebook.destroyed ? 'Restore notebook' : 'Destroy notebook'}</button>
            </div>
        </div>
    `;
}

function renderLinkManagerHtml() {
    const linked = getLinkedShinigami();
    const actors = getActorChoices({
        includeUser: false,
        includeCharacters: true,
        currentActor: linked.active ? {
            type: NOTEBOOK_ACTOR_TYPES.CHARACTER,
            id: linked.avatar || linked.actor.id,
            name: linked.actor.name,
        } : null,
    });
    const selectedActor = linked.active ? {
        type: NOTEBOOK_ACTOR_TYPES.CHARACTER,
        id: linked.avatar || linked.actor.id,
        name: linked.actor.name,
    } : null;

    return `
        <div class="kw-deathnote-manager">
            <div class="kw-deathnote-manager__summary">
                <span><b>Linked Shinigami:</b> ${escapeHtml(linked.active ? (linked.actor.name || linked.avatar || 'Linked') : 'None')}</span>
            </div>
            <div class="kw-deathnote-manager__actions">
                <label class="killer-within-settings__field kw-deathnote-manager__grow">
                    <span>Character card to link</span>
                    <select id="kw-deathnote-shinigami-select" class="text_pole">
                        ${renderActorOptions(actors, selectedActor, true, 'Select a character')}
                    </select>
                </label>
                <button type="button" id="kw-deathnote-link-shinigami" class="menu_button">Link</button>
                <button type="button" id="kw-deathnote-unlink-shinigami" class="menu_button" ${linked.active ? '' : 'disabled'}>Clear link</button>
            </div>
        </div>
    `;
}

function renderScrapManagerHtml() {
    const inventory = getDeathNoteInventory();
    const actors = getActorChoices({
        currentActor: inventory.scraps.length ? inventory.scraps[0].holder : null,
        includeWorld: true,
    });
    const scraps = inventory.scraps.filter((scrap) => scrap && scrap.active);

    if (!scraps.length) {
        return `
            <div class="kw-deathnote-manager">
                <div class="kw-memory-manager__empty">No active scraps.</div>
                <div class="kw-deathnote-manager__actions">
                    <label class="killer-within-settings__field kw-deathnote-manager__grow">
                        <span>New scrap holder</span>
                        <select id="kw-deathnote-new-scrap-holder" class="text_pole">
                            ${renderActorOptions(actors, null)}
                        </select>
                    </label>
                    <button type="button" id="kw-deathnote-create-scrap" class="menu_button">Create scrap</button>
                </div>
            </div>
        `;
    }

    const rows = scraps.map((scrap) => {
        const choices = getActorChoices({
            currentActor: scrap.holder,
            includeWorld: true,
        });
        return `
            <div class="kw-deathnote-item">
                <div class="kw-deathnote-item__meta">
                    <b>${escapeHtml(scrap.label)}</b>
                    <span>${escapeHtml(scrap.noteText || 'Blank scrap')}</span>
                </div>
                <select
                    class="text_pole kw-deathnote-scrap-holder"
                    data-scrap-id="${escapeHtml(scrap.id)}"
                >
                    ${renderActorOptions(choices, scrap.holder)}
                </select>
                <button
                    type="button"
                    class="menu_button kw-deathnote-remove-scrap"
                    data-scrap-id="${escapeHtml(scrap.id)}"
                >Remove</button>
            </div>
        `;
    }).join('');

    return `
        <div class="kw-deathnote-manager">
            <div class="kw-deathnote-manager__list">${rows}</div>
            <div class="kw-deathnote-manager__actions">
                <label class="killer-within-settings__field kw-deathnote-manager__grow">
                    <span>New scrap holder</span>
                    <select id="kw-deathnote-new-scrap-holder" class="text_pole">
                        ${renderActorOptions(actors, null)}
                    </select>
                </label>
                <button type="button" id="kw-deathnote-create-scrap" class="menu_button">Create scrap</button>
            </div>
        </div>
    `;
}

function renderToucherManagerHtml() {
    const state = getChatState();
    const touchers = state.inventory.touchers.filter((entry) => entry && entry.active);
    const derived = getChatState().inventory.touchers.filter((entry) => entry && entry.active);
    const actors = getActorChoices({
        includeWorld: false,
    });
    const currentTouchers = getNotebookTouchersSummary();
    const manualRows = touchers.length
        ? touchers.map((toucher) => {
            return `
                <div class="kw-deathnote-item">
                    <div class="kw-deathnote-item__meta">
                        <b>${escapeHtml(formatActorLabel(toucher.actor))}</b>
                        <span>${escapeHtml(String(toucher.source || 'manual_touch'))}</span>
                    </div>
                </div>
            `;
        }).join('')
        : '<div class="kw-memory-manager__empty">No explicit manual touchers.</div>';

    return `
        <div class="kw-deathnote-manager">
            <div class="kw-deathnote-manager__summary">
                <span><b>Current viewers:</b> ${escapeHtml(currentTouchers || 'None')}</span>
            </div>
            <div class="kw-deathnote-manager__list">${manualRows}</div>
            <div class="kw-deathnote-manager__actions">
                <label class="killer-within-settings__field kw-deathnote-manager__grow">
                    <span>Add manual toucher</span>
                    <select id="kw-deathnote-new-toucher" class="text_pole">
                        ${renderActorOptions(actors, null, true, 'Select a character')}
                    </select>
                </label>
                <button type="button" id="kw-deathnote-add-toucher" class="menu_button">Add toucher</button>
                <button type="button" id="kw-deathnote-clear-touchers" class="menu_button" ${derived.length ? '' : 'disabled'}>Clear manual touchers</button>
            </div>
        </div>
    `;
}

function getNotebookTouchersSummary() {
    const state = getChatState();
    const touchers = state && state.inventory && Array.isArray(state.inventory.touchers) ? state.inventory.touchers.filter((entry) => entry && entry.active) : [];
    const inventory = getDeathNoteInventory();
    const derived = [];

    if (inventory.notebook && inventory.notebook.exists) {
        derived.push(formatActorLabel(inventory.notebook.holder));
    }

    for (const scrap of inventory.scraps) {
        if (!scrap || !scrap.active) {
            continue;
        }

        derived.push(formatActorLabel(scrap.holder));
    }

    for (const toucher of touchers) {
        derived.push(formatActorLabel(toucher.actor));
    }

    return Array.from(new Set(derived.filter(Boolean))).join(', ');
}

async function commitInventoryMutation(mutate, successMessage = '') {
    try {
        const result = await mutate();
        if (!result) {
            return false;
        }

        await persistChatChanges();
        await syncLinkedShinigamiVisibility();
        refreshDeathNoteUi();
        if (successMessage) {
            notify('success', successMessage);
        }
        return true;
    } catch (error) {
        console.error('[killer_within_deathnote] Inventory manager action failed', error);
        notify('error', 'Death Note manager action failed.');
        return false;
    }
}

function getSettingsHost() {
    return $('#extensions_settings2, #extensions_settings').first();
}

function syncSettingsUi() {
    const settings = getSettings();
    $('#kw-deathnote-font-mode').val(settings.fontMode === 'script' ? 'script' : 'print');
    $('#kw-deathnote-notebook-manager').html(renderNotebookManagerHtml());
    $('#kw-deathnote-link-manager').html(renderLinkManagerHtml());
    $('#kw-deathnote-scrap-manager').html(renderScrapManagerHtml());
    $('#kw-deathnote-toucher-manager').html(renderToucherManagerHtml());
}

function bindSettingsUi() {
    $('#kw-deathnote-font-mode').off('input').on('input', (event) => {
        const value = String($(event.currentTarget).val() || 'print').trim().toLowerCase();
        getSettings().fontMode = value === 'script' ? 'script' : 'print';
        scheduleSettingsSave();
        refreshDeathNoteUi();
    });

    $(document)
        .off('change', '#kw-deathnote-owner')
        .on('change', '#kw-deathnote-owner', async (event) => {
            const ownership = getNotebookOwnership();
            const actor = decodeActorValue($(event.currentTarget).val(), ownership.owner);
            await commitInventoryMutation(() => {
                return setNotebookOwnership({
                    owner: actor,
                    holder: ownership.holder,
                    userAccess: ownership.userAccess,
                    lastTransferredAt: ownership.lastTransferredAt,
                });
            }, 'Notebook owner updated.');
        })
        .off('change', '#kw-deathnote-holder')
        .on('change', '#kw-deathnote-holder', async (event) => {
            const ownership = getNotebookOwnership();
            const inventory = getDeathNoteInventory();
            const actor = decodeActorValue($(event.currentTarget).val(), ownership.holder);
            await commitInventoryMutation(() => {
                return transferNotebookTo(actor, {
                    owner: ownership.owner,
                    userAccess: ownership.userAccess,
                    exists: !inventory.notebook.destroyed,
                    reason: `Notebook transferred to ${actor.name || actor.type} via manager.`,
                });
            }, 'Notebook holder updated.');
        })
        .off('change', '#kw-deathnote-user-access')
        .on('change', '#kw-deathnote-user-access', async (event) => {
            const nextAccess = String($(event.currentTarget).val() || NOTEBOOK_USER_ACCESS.NONE).trim().toLowerCase();
            await commitInventoryMutation(() => setUserNotebookAccess(nextAccess, {
                reason: `User access changed to ${nextAccess} via manager.`,
            }), 'User access updated.');
        })
        .off('click', '#kw-deathnote-toggle-destroyed')
        .on('click', '#kw-deathnote-toggle-destroyed', async (event) => {
            event.preventDefault();
            const ownership = getNotebookOwnership();
            const inventory = getDeathNoteInventory();
            if (inventory.notebook.destroyed) {
                await commitInventoryMutation(() => {
                    return transferNotebookTo(ownership.holder, {
                        owner: ownership.owner,
                        userAccess: ownership.userAccess,
                        exists: true,
                        reason: 'Notebook restored via manager.',
                    });
                }, 'Notebook restored.');
                return;
            }

            await commitInventoryMutation(() => destroyNotebook({
                reason: 'Notebook destroyed via manager.',
            }), 'Notebook destroyed.');
        })
        .off('click', '#kw-deathnote-link-shinigami')
        .on('click', '#kw-deathnote-link-shinigami', async (event) => {
            event.preventDefault();
            const actor = decodeActorValue($('#kw-deathnote-shinigami-select').val(), null);
            if (!actor) {
                notify('warning', 'Select a character to link as the notebook Shinigami.');
                return;
            }

            await commitInventoryMutation(() => {
                return linkNotebookShinigami({
                    type: NOTEBOOK_ACTOR_TYPES.SHINIGAMI,
                    id: actor.id,
                    name: actor.name,
                }, {
                    avatar: actor.id,
                    name: actor.name,
                    reason: `${actor.name || 'Selected character'} linked via manager.`,
                });
            }, 'Linked Shinigami updated.');
        })
        .off('click', '#kw-deathnote-unlink-shinigami')
        .on('click', '#kw-deathnote-unlink-shinigami', async (event) => {
            event.preventDefault();
            await commitInventoryMutation(() => unlinkNotebookShinigami({
                reason: 'Linked Shinigami cleared via manager.',
            }), 'Linked Shinigami cleared.');
        })
        .off('click', '#kw-deathnote-create-scrap')
        .on('click', '#kw-deathnote-create-scrap', async (event) => {
            event.preventDefault();
            const holder = decodeActorValue($('#kw-deathnote-new-scrap-holder').val(), getNotebookOwnership().holder);
            await commitInventoryMutation(() => createNotebookScrap({
                holder,
                label: `Scrap ${getDeathNoteInventory().scraps.filter((scrap) => scrap && scrap.active).length + 1}`,
                reason: `Scrap created for ${holder.name || holder.type} via manager.`,
            }), 'Notebook scrap created.');
        })
        .off('change', '.kw-deathnote-scrap-holder')
        .on('change', '.kw-deathnote-scrap-holder', async (event) => {
            const scrapId = String($(event.currentTarget).data('scrapId') || '').trim();
            const holder = decodeActorValue($(event.currentTarget).val(), null);
            if (!scrapId || !holder) {
                return;
            }

            await commitInventoryMutation(() => transferNotebookScrap(scrapId, holder, {
                reason: `${holder.name || holder.type} now holds ${scrapId}.`,
            }), 'Scrap holder updated.');
        })
        .off('click', '.kw-deathnote-remove-scrap')
        .on('click', '.kw-deathnote-remove-scrap', async (event) => {
            event.preventDefault();
            const scrapId = String($(event.currentTarget).data('scrapId') || '').trim();
            if (!scrapId) {
                return;
            }

            await commitInventoryMutation(() => removeNotebookScrap(scrapId, {
                reason: `${scrapId} removed via manager.`,
            }), 'Scrap removed.');
        })
        .off('click', '#kw-deathnote-add-toucher')
        .on('click', '#kw-deathnote-add-toucher', async (event) => {
            event.preventDefault();
            const actor = decodeActorValue($('#kw-deathnote-new-toucher').val(), null);
            if (!actor) {
                notify('warning', 'Select a character to add as a toucher.');
                return;
            }

            await commitInventoryMutation(() => addNotebookToucher(actor, {
                source: 'manual_touch',
                itemId: getDeathNoteInventory().notebook.itemId,
                reason: `${actor.name || actor.type} manually marked as touching the Death Note.`,
            }), 'Manual toucher added.');
        })
        .off('click', '#kw-deathnote-clear-touchers')
        .on('click', '#kw-deathnote-clear-touchers', async (event) => {
            event.preventDefault();
            await commitInventoryMutation(() => clearNotebookTouchers({
                source: 'manual_touch',
                reason: 'Manual Death Note touchers cleared via manager.',
            }), 'Manual touchers cleared.');
        });
}

function renderSettingsPanel() {
    const host = getSettingsHost();
    if (!host.length || document.getElementById(SETTINGS_PANEL_ID)) {
        return;
    }

    host.append(`
        <div id="${SETTINGS_PANEL_ID}" class="killer-within-settings inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Killer Within Death Note</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="killer-within-settings__field">
                    <span>Notebook font</span>
                    <select id="kw-deathnote-font-mode" class="text_pole">
                        <option value="print">Print</option>
                        <option value="script">Script</option>
                    </select>
                </label>
                <div class="killer-within-settings__field">
                    <span>Notebook defaults</span>
                    <small>If a cause is omitted, Death Note entries default to heart attack. If time is omitted, they trigger on the next assistant message.</small>
                </div>
                <div class="killer-within-settings__field">
                    <span>Notebook inventory</span>
                    <div id="kw-deathnote-notebook-manager"></div>
                </div>
                <div class="killer-within-settings__field">
                    <span>Linked Shinigami</span>
                    <div id="kw-deathnote-link-manager"></div>
                </div>
                <div class="killer-within-settings__field">
                    <span>Notebook scraps</span>
                    <div id="kw-deathnote-scrap-manager"></div>
                </div>
                <div class="killer-within-settings__field">
                    <span>Touchers and visibility</span>
                    <div id="kw-deathnote-toucher-manager"></div>
                </div>
            </div>
        </div>
    `);

    bindSettingsUi();
    syncSettingsUi();
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
        setPosition(x, y, { rememberClosed: !settings.isOpen });
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
    renderSettingsPanel();
    syncSettingsUi();
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
                        setPosition(Math.round(rectFinal.left), Math.round(rectFinal.top), {
                            rememberClosed: !getSettings().isOpen,
                        });
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
                            if (isOpening) {
                                settings.closedFloatingX = Math.round(rectFinal.left);
                                settings.closedFloatingY = Math.round(rectFinal.top);

                                const nextPosition = getTogglePosition(rectFinal.left, rectFinal.top, true);
                                settings.floatingX = nextPosition.x;
                                settings.floatingY = nextPosition.y;
                            } else if (Number.isFinite(settings.closedFloatingX) && Number.isFinite(settings.closedFloatingY)) {
                                settings.floatingX = settings.closedFloatingX;
                                settings.floatingY = settings.closedFloatingY;
                            } else {
                                settings.floatingX = Math.round(rectFinal.left);
                                settings.floatingY = Math.round(rectFinal.top);
                            }
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
    renderSettingsPanel();
    syncSettingsUi();
    ensureWidget();
}

export function setupDeathNoteUi() {
    renderSettingsPanel();
    syncSettingsUi();
    ensureWidget();
    bindWidgetUi();
}

