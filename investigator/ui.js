import { INVESTIGATOR_HUB_ID, PLAY_ROLES, SUSPECT_STATUSES, EVIDENCE_TYPES } from './config.js';
import {
    commitInvestigatorMutation,
    getBoardSuspectChoices,
    getInvestigatorSettings,
    getInvestigatorState,
    getInvestigatorVictimTimeline,
    getPlayRole,
    getSeizeCandidates,
    isInvestigatorRole,
    linkEvidenceToSuspect,
    logEvidence,
    pinSuspect,
    releaseRestrainedActor,
    restrainActor,
    scheduleInvestigatorSettingsSave,
    seizeNotebook,
    seizeScrap,
    setPlayRole,
    setSuspectStatus,
    syncDeathReportsIntoTimelineEvidence,
} from './core.js';
import { NOTEBOOK_ACTOR_TYPES } from '../deathnote/config.js';

const MOBILE_VIEWPORT_MAX = 720;
const LAUNCHER_ID = 'kw-investigator-launcher';
const SCREENS = Object.freeze({
    BOARD: 'board',
    TIMELINE: 'timeline',
    LOCKER: 'locker',
    OPS: 'ops',
});

let hubDragState = {
    dragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    pointerId: null,
    handlersInstalled: false,
    moveHandler: null,
    upHandler: null,
};

let refreshDeathNoteUiHook = null;

export function registerDeathNoteUiRefresh(fn) {
    refreshDeathNoteUiHook = typeof fn === 'function' ? fn : null;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isMobileViewport() {
    return window.innerWidth <= MOBILE_VIEWPORT_MAX;
}

function formatClock(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) {
        return '—';
    }
    try {
        return new Date(value).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch (_error) {
        return '—';
    }
}

function statusLabel(status) {
    switch (String(status || '').toLowerCase()) {
        case SUSPECT_STATUSES.PRIME:
            return 'PRIME';
        case SUSPECT_STATUSES.CLEARED:
            return 'CLEARED';
        case SUSPECT_STATUSES.DECEASED:
            return 'DECEASED';
        default:
            return 'POI';
    }
}

function openHub() {
    const settings = getInvestigatorSettings();
    settings.hubOpen = true;
    settings.hubCollapsed = false;
    scheduleInvestigatorSettingsSave();
    refreshInvestigatorUi();
}

function closeHub() {
    const settings = getInvestigatorSettings();
    settings.hubOpen = false;
    scheduleInvestigatorSettingsSave();
    refreshInvestigatorUi();
}

function setActiveScreen(screen) {
    const settings = getInvestigatorSettings();
    const next = Object.values(SCREENS).includes(screen) ? screen : SCREENS.BOARD;
    settings.activeScreen = next;
    scheduleInvestigatorSettingsSave();
    refreshInvestigatorUi();
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function resolveHubPosition(root) {
    const settings = getInvestigatorSettings();
    const width = root?.offsetWidth || 720;
    const height = root?.offsetHeight || 480;
    const maxX = Math.max(0, window.innerWidth - width);
    const maxY = Math.max(0, window.innerHeight - height);
    const x = Number.isFinite(Number(settings.hubX)) ? Number(settings.hubX) : Math.max(24, Math.round((window.innerWidth - width) / 2));
    const y = Number.isFinite(Number(settings.hubY)) ? Number(settings.hubY) : Math.max(24, Math.round((window.innerHeight - height) / 5));
    return {
        x: clamp(x, 0, maxX),
        y: clamp(y, 0, maxY),
    };
}

function renderNavHtml(activeScreen) {
    const items = [
        { id: SCREENS.BOARD, label: 'Board' },
        { id: SCREENS.TIMELINE, label: 'Timeline' },
        { id: SCREENS.LOCKER, label: 'Locker' },
        { id: SCREENS.OPS, label: 'Ops' },
    ];
    return items.map((item) => `
        <button
            type="button"
            class="kw-investigator-nav__btn ${activeScreen === item.id ? 'is-active' : ''}"
            data-inv-screen="${item.id}"
        >${escapeHtml(item.label)}</button>
    `).join('');
}

function renderBoardScreen(state) {
    const choices = getBoardSuspectChoices();
    const options = choices.map((actor) => {
        const value = JSON.stringify({
            type: actor.type,
            id: actor.id,
            name: actor.name,
        });
        return `<option value="${escapeHtml(value)}">${escapeHtml(actor.name || 'Character')}</option>`;
    }).join('');

    const suspectsHtml = state.suspects.length
        ? state.suspects.map((suspect) => `
            <article class="kw-investigator-row" data-suspect-key="${escapeHtml(suspect.key)}">
                <div class="kw-investigator-row__main">
                    <div class="kw-investigator-row__title">${escapeHtml(suspect.actor?.name || 'Unknown')}</div>
                    <div class="kw-investigator-row__meta">${escapeHtml(statusLabel(suspect.status))} · pinned ${escapeHtml(formatClock(suspect.pinnedAt))}</div>
                    ${suspect.notes ? `<div class="kw-investigator-row__notes">${escapeHtml(suspect.notes)}</div>` : ''}
                </div>
                <label class="kw-investigator-inline-field">
                    <span>Status</span>
                    <select class="text_pole kw-investigator-select" data-suspect-status="${escapeHtml(suspect.key)}">
                        <option value="${SUSPECT_STATUSES.PERSON_OF_INTEREST}" ${suspect.status === SUSPECT_STATUSES.PERSON_OF_INTEREST ? 'selected' : ''}>POI</option>
                        <option value="${SUSPECT_STATUSES.PRIME}" ${suspect.status === SUSPECT_STATUSES.PRIME ? 'selected' : ''}>Prime</option>
                        <option value="${SUSPECT_STATUSES.CLEARED}" ${suspect.status === SUSPECT_STATUSES.CLEARED ? 'selected' : ''}>Cleared</option>
                        <option value="${SUSPECT_STATUSES.DECEASED}" ${suspect.status === SUSPECT_STATUSES.DECEASED ? 'selected' : ''}>Deceased</option>
                    </select>
                </label>
            </article>
        `).join('')
        : '<p class="kw-investigator-empty">No pins yet. Add a person of interest to the board.</p>';

    return `
        <section class="kw-investigator-screen" data-screen="board">
            <header class="kw-investigator-screen__head">
                <h2>Investigation Board</h2>
                <p>Pin suspects. Link them later from the locker.</p>
            </header>
            <form class="kw-investigator-form" data-inv-form="pin-suspect">
                <label class="kw-investigator-field">
                    <span>Subject</span>
                    <select name="actorJson" class="text_pole" required>
                        <option value="">Select character…</option>
                        ${options}
                    </select>
                </label>
                <label class="kw-investigator-field">
                    <span>Notes</span>
                    <input name="notes" class="text_pole" type="text" maxlength="240" placeholder="Why are they on the board?" />
                </label>
                <button type="submit" class="menu_button kw-investigator-btn kw-investigator-btn--primary">Pin to board</button>
            </form>
            <div class="kw-investigator-list">${suspectsHtml}</div>
        </section>
    `;
}

function renderTimelineScreen(state) {
    const deaths = getInvestigatorVictimTimeline();
    const deathHtml = deaths.length
        ? deaths.map((death) => `
            <article class="kw-investigator-row">
                <div class="kw-investigator-row__main">
                    <div class="kw-investigator-row__title">${escapeHtml(death.targetName)}</div>
                    <div class="kw-investigator-row__meta">Cause: ${escapeHtml(death.cause)} · ${escapeHtml(formatClock(death.resolvedAt))}</div>
                    ${death.noteText ? `<div class="kw-investigator-row__notes">${escapeHtml(death.noteText)}</div>` : ''}
                </div>
                <span class="kw-investigator-chip">DEATH</span>
            </article>
        `).join('')
        : '<p class="kw-investigator-empty">No resolved deaths recorded yet.</p>';

    const logs = (state.evidence || [])
        .filter((entry) => entry.type === EVIDENCE_TYPES.MANUAL_LOG || entry.type === EVIDENCE_TYPES.SIGHTING || entry.type === EVIDENCE_TYPES.STATEMENT)
        .slice(0, 24);
    const logHtml = logs.length
        ? logs.map((entry) => `
            <article class="kw-investigator-row">
                <div class="kw-investigator-row__main">
                    <div class="kw-investigator-row__title">${escapeHtml(entry.title)}</div>
                    <div class="kw-investigator-row__meta">${escapeHtml(entry.type)} · ${escapeHtml(formatClock(entry.createdAt))}</div>
                    ${entry.detail ? `<div class="kw-investigator-row__notes">${escapeHtml(entry.detail)}</div>` : ''}
                </div>
            </article>
        `).join('')
        : '<p class="kw-investigator-empty">No manual timeline entries.</p>';

    return `
        <section class="kw-investigator-screen" data-screen="timeline">
            <header class="kw-investigator-screen__head">
                <h2>Case Timeline</h2>
                <p>Auto victim reports from resolved Death Note entries, plus your logs.</p>
            </header>
            <div class="kw-investigator-split">
                <div>
                    <div class="kw-investigator-subhead">Victim reports</div>
                    <div class="kw-investigator-list">${deathHtml}</div>
                </div>
                <div>
                    <div class="kw-investigator-subhead">Officer log</div>
                    <form class="kw-investigator-form" data-inv-form="manual-log">
                        <label class="kw-investigator-field">
                            <span>Title</span>
                            <input name="title" class="text_pole" type="text" maxlength="120" placeholder="Sighting / statement" required />
                        </label>
                        <label class="kw-investigator-field">
                            <span>Detail</span>
                            <textarea name="detail" class="text_pole" rows="3" maxlength="800" placeholder="What happened?"></textarea>
                        </label>
                        <button type="submit" class="menu_button kw-investigator-btn">Append log</button>
                    </form>
                    <div class="kw-investigator-list">${logHtml}</div>
                </div>
            </div>
        </section>
    `;
}

function renderLockerScreen(state) {
    const physical = (state.evidence || []).filter((entry) => (
        entry.type === EVIDENCE_TYPES.NOTEBOOK
        || entry.type === EVIDENCE_TYPES.SCRAP
        || entry.type === EVIDENCE_TYPES.DEATH_REPORT
    ));
    const suspects = state.suspects || [];
    const html = physical.length
        ? physical.map((entry) => {
            const linkOptions = suspects.map((suspect) => `
                <option value="${escapeHtml(suspect.key)}">${escapeHtml(suspect.actor?.name || suspect.key)}</option>
            `).join('');
            const snapshot = entry.itemRef?.snapshot
                ? `<pre class="kw-investigator-snapshot">${escapeHtml(entry.itemRef.snapshot)}</pre>`
                : '';
            return `
                <article class="kw-investigator-row kw-investigator-row--locker">
                    <div class="kw-investigator-row__main">
                        <div class="kw-investigator-row__title">${escapeHtml(entry.title)}</div>
                        <div class="kw-investigator-row__meta">${escapeHtml(entry.type)} · ${escapeHtml(formatClock(entry.createdAt))}</div>
                        ${entry.detail ? `<div class="kw-investigator-row__notes">${escapeHtml(entry.detail)}</div>` : ''}
                        ${snapshot}
                    </div>
                    ${suspects.length ? `
                        <form class="kw-investigator-form kw-investigator-form--compact" data-inv-form="link-evidence" data-evidence-id="${escapeHtml(entry.id)}">
                            <label class="kw-investigator-field">
                                <span>Link to</span>
                                <select name="suspectKey" class="text_pole" required>
                                    <option value="">Suspect…</option>
                                    ${linkOptions}
                                </select>
                            </label>
                            <button type="submit" class="menu_button kw-investigator-btn">Link</button>
                        </form>
                    ` : ''}
                </article>
            `;
        }).join('')
        : '<p class="kw-investigator-empty">Evidence locker empty. Seize restrained notebooks/scraps from Ops, or wait for death reports.</p>';

    return `
        <section class="kw-investigator-screen" data-screen="locker">
            <header class="kw-investigator-screen__head">
                <h2>Evidence Locker</h2>
                <p>Sealed notebooks, scraps, and auto death reports. Seized notes cannot be rewritten.</p>
            </header>
            <div class="kw-investigator-list">${html}</div>
        </section>
    `;
}

function renderOpsScreen(state) {
    const choices = getBoardSuspectChoices();
    const options = choices.map((actor) => {
        const value = JSON.stringify({
            type: actor.type,
            id: actor.id,
            name: actor.name,
        });
        return `<option value="${escapeHtml(value)}">${escapeHtml(actor.name || 'Character')}</option>`;
    }).join('');
    const restrainedHtml = state.restrained.length
        ? state.restrained.map((entry) => `
            <article class="kw-investigator-row">
                <div class="kw-investigator-row__main">
                    <div class="kw-investigator-row__title">${escapeHtml(entry.actor?.name || 'Unknown')}</div>
                    <div class="kw-investigator-row__meta">${escapeHtml(entry.reason || 'Restrained')} · ${escapeHtml(formatClock(entry.restrainedAt))}</div>
                </div>
                <button type="button" class="menu_button kw-investigator-btn" data-inv-release="${escapeHtml(entry.key)}">Release</button>
            </article>
        `).join('')
        : '<p class="kw-investigator-empty">Nobody marked restrained.</p>';

    const candidates = getSeizeCandidates();
    const notebookSeize = (candidates.notebooks || []).map((notebook) => `
        <button type="button" class="menu_button kw-investigator-btn kw-investigator-btn--danger" data-inv-seize-notebook="${escapeHtml(notebook.itemId)}">
            Seize ${escapeHtml(notebook.label || 'Death Note')} (${escapeHtml(notebook.holder?.name || 'held')})
        </button>
    `).join('');
    const scrapSeize = (candidates.scraps || []).map((scrap) => `
        <button type="button" class="menu_button kw-investigator-btn kw-investigator-btn--danger" data-inv-seize-scrap="${escapeHtml(scrap.id)}">
            Seize scrap (${escapeHtml(scrap.holder?.name || 'held')})
        </button>
    `).join('');
    const seizeBlock = (notebookSeize || scrapSeize)
        ? `${notebookSeize}${scrapSeize}`
        : '<p class="kw-investigator-empty">No seizable items. Restrain a character who currently holds a notebook or scrap.</p>';

    const caseLog = (state.log || []).slice().reverse().slice(0, 12).map((entry) => `
        <div class="kw-investigator-logline"><span>${escapeHtml(formatClock(entry.at))}</span> ${escapeHtml(entry.text)}</div>
    `).join('') || '<p class="kw-investigator-empty">System log quiet.</p>';

    return `
        <section class="kw-investigator-screen" data-screen="ops">
            <header class="kw-investigator-screen__head">
                <h2>Operations</h2>
                <p>Restrain subjects, seize evidence, switch play role.</p>
            </header>
            <div class="kw-investigator-ops-grid">
                <div class="kw-investigator-panel">
                    <div class="kw-investigator-subhead">Case file</div>
                    <div class="kw-investigator-row__meta">${escapeHtml(state.caseId)} · ${escapeHtml(state.caseTitle)}</div>
                    <label class="kw-investigator-field">
                        <span>Play role</span>
                        <select id="kw-investigator-play-role" class="text_pole">
                            <option value="${PLAY_ROLES.INVESTIGATOR}" selected>Investigator (Task Force hub)</option>
                            <option value="${PLAY_ROLES.KIRA}">Kira (Death Note tools)</option>
                        </select>
                    </label>
                    <small class="kw-investigator-hint">V1: one role at a time. Gothic Death Note UI stays on the Kira side.</small>
                </div>
                <div class="kw-investigator-panel">
                    <div class="kw-investigator-subhead">Mark restrained</div>
                    <form class="kw-investigator-form" data-inv-form="restrain">
                        <label class="kw-investigator-field">
                            <span>Subject</span>
                            <select name="actorJson" class="text_pole" required>
                                <option value="">Select character…</option>
                                ${options}
                            </select>
                        </label>
                        <label class="kw-investigator-field">
                            <span>Reason</span>
                            <input name="reason" class="text_pole" type="text" maxlength="200" placeholder="In-scene custody / arrest" />
                        </label>
                        <button type="submit" class="menu_button kw-investigator-btn kw-investigator-btn--primary">Mark restrained</button>
                    </form>
                    <div class="kw-investigator-list">${restrainedHtml}</div>
                </div>
                <div class="kw-investigator-panel">
                    <div class="kw-investigator-subhead">Seize (restrained holders only)</div>
                    <div class="kw-investigator-actions">${seizeBlock}</div>
                </div>
                <div class="kw-investigator-panel">
                    <div class="kw-investigator-subhead">System log</div>
                    <div class="kw-investigator-log">${caseLog}</div>
                </div>
            </div>
        </section>
    `;
}

function renderActiveScreen(settings, state) {
    switch (settings.activeScreen) {
        case SCREENS.TIMELINE:
            return renderTimelineScreen(state);
        case SCREENS.LOCKER:
            return renderLockerScreen(state);
        case SCREENS.OPS:
            return renderOpsScreen(state);
        case SCREENS.BOARD:
        default:
            return renderBoardScreen(state);
    }
}

function buildHubHtml(settings, state) {
    const mobile = isMobileViewport();
    return `
        <div class="kw-investigator-hub__chrome">
            <header class="kw-investigator-hub__titlebar" data-inv-drag="${mobile ? 'false' : 'true'}">
                <div class="kw-investigator-hub__brand">
                    <span class="kw-investigator-hub__led" aria-hidden="true"></span>
                    <div>
                        <div class="kw-investigator-hub__os">TASK FORCE OS // TERMINAL</div>
                        <div class="kw-investigator-hub__case">${escapeHtml(state.caseId)} — ${escapeHtml(state.caseTitle)}</div>
                    </div>
                </div>
                <div class="kw-investigator-hub__window-controls">
                    ${mobile ? '' : '<button type="button" class="kw-investigator-hub__winbtn" data-inv-close title="Close">×</button>'}
                    ${mobile ? '<button type="button" class="kw-investigator-hub__winbtn" data-inv-close title="Close">Done</button>' : ''}
                </div>
            </header>
            <nav class="kw-investigator-nav ${mobile ? 'kw-investigator-nav--dock' : ''}" aria-label="Hub screens">
                ${renderNavHtml(settings.activeScreen || SCREENS.BOARD)}
            </nav>
            <div class="kw-investigator-hub__body">
                ${renderActiveScreen(settings, state)}
            </div>
            <footer class="kw-investigator-hub__status">
                <span>ROLE: INVESTIGATOR</span>
                <span>SECURE // LOCAL CASE STATE</span>
            </footer>
        </div>
    `;
}

function ensureLauncher() {
    let root = document.getElementById(LAUNCHER_ID);
    if (!isInvestigatorRole()) {
        if (root) {
            root.remove();
        }
        return null;
    }

    if (!root) {
        root = document.createElement('button');
        root.id = LAUNCHER_ID;
        root.type = 'button';
        root.className = 'kw-investigator-launcher';
        root.setAttribute('aria-label', 'Open Task Force terminal');
        document.body.append(root);
    }

    const settings = getInvestigatorSettings();
    root.hidden = Boolean(settings.hubOpen);
    root.innerHTML = `
        <span class="kw-investigator-launcher__glyph" aria-hidden="true"></span>
        <span class="kw-investigator-launcher__label">TF Terminal</span>
    `;
    return root;
}

function ensureHub() {
    const settings = getInvestigatorSettings();
    let root = document.getElementById(INVESTIGATOR_HUB_ID);

    if (!isInvestigatorRole() || !settings.hubOpen) {
        if (root) {
            root.remove();
        }
        return null;
    }

    syncDeathReportsIntoTimelineEvidence();
    const state = getInvestigatorState();
    const mobile = isMobileViewport();

    if (!root) {
        root = document.createElement('div');
        root.id = INVESTIGATOR_HUB_ID;
        document.body.append(root);
    }

    root.className = `kw-investigator-hub ${mobile ? 'is-mobile' : 'is-desktop'}`;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', mobile ? 'true' : 'false');
    root.innerHTML = buildHubHtml(settings, state);

    if (mobile) {
        root.style.left = '0';
        root.style.top = '0';
        root.style.right = '0';
        root.style.bottom = '0';
    } else {
        const position = resolveHubPosition(root);
        root.style.left = `${position.x}px`;
        root.style.top = `${position.y}px`;
        root.style.right = 'auto';
        root.style.bottom = 'auto';
        if (settings.hubX !== position.x || settings.hubY !== position.y) {
            settings.hubX = position.x;
            settings.hubY = position.y;
            scheduleInvestigatorSettingsSave();
        }
    }

    return root;
}

function parseActorJson(raw) {
    try {
        const parsed = JSON.parse(String(raw || ''));
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        return {
            type: String(parsed.type || NOTEBOOK_ACTOR_TYPES.CHARACTER),
            id: String(parsed.id || ''),
            name: String(parsed.name || ''),
        };
    } catch (_error) {
        return null;
    }
}

async function handleRoleChange(nextRole) {
    const changed = setPlayRole(nextRole);
    if (!changed && getPlayRole() === nextRole) {
        return;
    }
    if (nextRole === PLAY_ROLES.KIRA) {
        closeHub();
    }
    refreshDeathNoteUiHook?.();
    refreshInvestigatorUi();
    globalThis.toastr?.info?.(
        nextRole === PLAY_ROLES.INVESTIGATOR
            ? 'Switched to Investigator terminal.'
            : 'Switched to Kira tools.',
    );
}

function bindHubInteractions(root) {
    if (!root) {
        return;
    }

    root.querySelectorAll('[data-inv-screen]').forEach((button) => {
        button.addEventListener('click', () => {
            setActiveScreen(button.getAttribute('data-inv-screen'));
        });
    });

    root.querySelectorAll('[data-inv-close]').forEach((button) => {
        button.addEventListener('click', () => closeHub());
    });

    root.querySelectorAll('[data-suspect-status]').forEach((select) => {
        select.addEventListener('change', async () => {
            const key = select.getAttribute('data-suspect-status');
            await commitInvestigatorMutation(() => setSuspectStatus(key, select.value), 'Suspect status updated.');
            refreshInvestigatorUi();
        });
    });

    root.querySelectorAll('[data-inv-release]').forEach((button) => {
        button.addEventListener('click', async () => {
            const key = button.getAttribute('data-inv-release');
            await commitInvestigatorMutation(() => releaseRestrainedActor(key), 'Subject released.');
            refreshInvestigatorUi();
        });
    });

    root.querySelectorAll('[data-inv-seize-notebook]').forEach((button) => {
        button.addEventListener('click', async () => {
            const id = button.getAttribute('data-inv-seize-notebook');
            const result = await commitInvestigatorMutation(() => seizeNotebook(id), 'Notebook seized into evidence.');
            if (!result || !result.applied) {
                globalThis.toastr?.warning?.(
                    result?.reason === 'not_restrained'
                        ? 'Holder must be restrained before seizure.'
                        : 'Could not seize notebook.',
                );
            }
            refreshInvestigatorUi();
            refreshDeathNoteUiHook?.();
        });
    });

    root.querySelectorAll('[data-inv-seize-scrap]').forEach((button) => {
        button.addEventListener('click', async () => {
            const id = button.getAttribute('data-inv-seize-scrap');
            const result = await commitInvestigatorMutation(() => seizeScrap(id), 'Scrap seized into evidence.');
            if (!result || !result.applied) {
                globalThis.toastr?.warning?.(
                    result?.reason === 'not_restrained'
                        ? 'Holder must be restrained before seizure.'
                        : 'Could not seize scrap.',
                );
            }
            refreshInvestigatorUi();
            refreshDeathNoteUiHook?.();
        });
    });

    const roleSelect = root.querySelector('#kw-investigator-play-role');
    if (roleSelect) {
        roleSelect.addEventListener('change', async () => {
            await handleRoleChange(roleSelect.value);
        });
    }

    root.querySelectorAll('form[data-inv-form]').forEach((form) => {
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const kind = form.getAttribute('data-inv-form');
            const data = new FormData(form);

            if (kind === 'pin-suspect') {
                const actor = parseActorJson(data.get('actorJson'));
                if (!actor?.name) {
                    return;
                }
                await commitInvestigatorMutation(
                    () => pinSuspect(actor, { notes: String(data.get('notes') || '') }),
                    'Suspect pinned.',
                );
            } else if (kind === 'manual-log') {
                await commitInvestigatorMutation(
                    () => logEvidence({
                        type: EVIDENCE_TYPES.MANUAL_LOG,
                        title: String(data.get('title') || 'Case log'),
                        detail: String(data.get('detail') || ''),
                        source: 'manual',
                    }),
                    'Log appended.',
                );
            } else if (kind === 'restrain') {
                const actor = parseActorJson(data.get('actorJson'));
                if (!actor?.name) {
                    return;
                }
                await commitInvestigatorMutation(
                    () => restrainActor(actor, { reason: String(data.get('reason') || '') }),
                    'Subject marked restrained.',
                );
            } else if (kind === 'link-evidence') {
                const evidenceId = form.getAttribute('data-evidence-id');
                const suspectKey = String(data.get('suspectKey') || '');
                await commitInvestigatorMutation(
                    () => linkEvidenceToSuspect(evidenceId, suspectKey),
                    'Evidence linked.',
                );
            }

            refreshInvestigatorUi();
        });
    });

    if (!isMobileViewport()) {
        installHubDrag(root);
    }
}

function installHubDrag(root) {
    const handle = root.querySelector('[data-inv-drag="true"]');
    if (!(handle instanceof HTMLElement)) {
        return;
    }

    handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
            return;
        }
        if (event.target instanceof HTMLElement && event.target.closest('button, select, input, textarea, a')) {
            return;
        }
        const settings = getInvestigatorSettings();
        hubDragState.dragging = true;
        hubDragState.startX = event.clientX;
        hubDragState.startY = event.clientY;
        hubDragState.originX = Number(settings.hubX) || root.offsetLeft || 0;
        hubDragState.originY = Number(settings.hubY) || root.offsetTop || 0;
        hubDragState.pointerId = event.pointerId;
        handle.setPointerCapture?.(event.pointerId);

        if (!hubDragState.handlersInstalled) {
            hubDragState.moveHandler = (moveEvent) => {
                if (!hubDragState.dragging) {
                    return;
                }
                const dx = moveEvent.clientX - hubDragState.startX;
                const dy = moveEvent.clientY - hubDragState.startY;
                const width = root.offsetWidth || 720;
                const height = root.offsetHeight || 480;
                const nextX = clamp(hubDragState.originX + dx, 0, Math.max(0, window.innerWidth - width));
                const nextY = clamp(hubDragState.originY + dy, 0, Math.max(0, window.innerHeight - height));
                root.style.left = `${nextX}px`;
                root.style.top = `${nextY}px`;
                settings.hubX = nextX;
                settings.hubY = nextY;
            };
            hubDragState.upHandler = () => {
                if (!hubDragState.dragging) {
                    return;
                }
                hubDragState.dragging = false;
                scheduleInvestigatorSettingsSave();
            };
            window.addEventListener('pointermove', hubDragState.moveHandler);
            window.addEventListener('pointerup', hubDragState.upHandler);
            hubDragState.handlersInstalled = true;
        }
    });
}

function bindLauncher() {
    const launcher = document.getElementById(LAUNCHER_ID);
    if (!launcher) {
        return;
    }
    launcher.onclick = () => openHub();
}

export function refreshInvestigatorUi() {
    const settings = getInvestigatorSettings();
    if (!Object.values(SCREENS).includes(settings.activeScreen)) {
        settings.activeScreen = SCREENS.BOARD;
    }

    ensureLauncher();
    const hub = ensureHub();
    bindLauncher();
    bindHubInteractions(hub);
}

export function setupInvestigatorUi() {
    getInvestigatorSettings();
    refreshInvestigatorUi();
    window.addEventListener('resize', () => {
        if (isInvestigatorRole()) {
            refreshInvestigatorUi();
        }
    });
}

export { openHub, closeHub, setActiveScreen };
