import {
    DEFAULT_CASE_PROMPT_TEMPLATE,
    EVIDENCE_CUSTODY,
    EVIDENCE_TYPES,
    INTERROGATION_STATUS,
    INVESTIGATOR_DOCK_ID,
    INVESTIGATOR_HUB_ID,
    OFFICER_CLEARANCE,
    PLAY_ROLES,
    SURVEILLANCE_KINDS,
    SURVEILLANCE_STATUS,
    SUSPECT_STATUSES,
    TASK_FORCE_TRUST_BLOCK,
    TASK_FORCE_TRUST_WARN,
} from './config.js';
import {
    analyzeVictimPattern,
    assignOfficer,
    commitInvestigatorMutation,
    confrontSuspect,
    createBroadcastTrap,
    endInterrogation,
    fileWarrant,
    getBoardSuspectChoices,
    getCaseStrength,
    getInvestigatorSettings,
    getInvestigatorState,
    getInvestigatorVictimTimeline,
    getPlayRole,
    getSeizeCandidates,
    getTaskForceTrust,
    isInvestigatorRole,
    linkEvidenceToSuspect,
    logEvidence,
    logSurveillanceSignalAsEvidence,
    pinSuspect,
    plantSurveillance,
    releaseRestrainedActor,
    releaseSeizedEvidence,
    removeOfficer,
    removeSurveillancePlant,
    restrainActor,
    scheduleInvestigatorSettingsSave,
    seizeNotebook,
    seizeScrap,
    setPlayRole,
    setSuspectStatus,
    startInterrogation,
    syncAllCaseActionMessageVisibility,
    syncDeathReportsIntoTimelineEvidence,
} from './core.js';
import { getDeathNotes, persistChatChanges } from '../deathnote/core.js';
import { NOTEBOOK_ACTOR_TYPES } from '../deathnote/config.js';

const MOBILE_VIEWPORT_MAX = 720;
const MOBILE_DOCK_WIDTH_MAX = 1200;
const SCREENS = Object.freeze({
    BOARD: 'board',
    TIMELINE: 'timeline',
    LOCKER: 'locker',
    SURVEIL: 'surveil',
    ACCESS: 'access',
    OPS: 'ops',
});

let refreshDeathNoteUiHook = null;
let lastHubOpenIntentAt = 0;
let lastHubToggleAt = 0;
const HUB_OPEN_GRACE_MS = 4000;
let dockDragState = {
    dragging: false,
    moved: false,
    ignoreClick: false,
    mobileTapOnly: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    pointerId: null,
    handlersInstalled: false,
    moveHandler: null,
    upHandler: null,
};

function scheduleFrame(callback) {
    if (typeof requestAnimationFrame === 'function') {
        return requestAnimationFrame(callback);
    }
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        return window.requestAnimationFrame(callback);
    }
    return setTimeout(callback, 16);
}

function markHubOpenIntent() {
    lastHubOpenIntentAt = Date.now();
}

/**
 * Mobile-safe toast — ST's default bottom toasts sit under the message form.
 * @param {'info'|'success'|'warning'|'error'} type
 * @param {string} message
 */
export function notifyInvestigator(type, message) {
    const text = String(message || '').trim();
    if (!text) {
        return;
    }
    const fn = globalThis.toastr?.[type];
    if (typeof fn !== 'function') {
        console.info(`[killer_within_investigator] ${text}`);
        return;
    }
    const mobile = typeof window !== 'undefined'
        && (window.innerWidth <= MOBILE_DOCK_WIDTH_MAX || useMobileDockPlacement());
    if (mobile) {
        try {
            document.body?.classList?.add('kw-investigator-toast-mobile');
        } catch (_error) {
            // ignore
        }
        fn.call(globalThis.toastr, text, '', {
            positionClass: 'toast-top-center',
            timeOut: 4500,
            extendedTimeOut: 2000,
            closeButton: true,
            onHidden() {
                try {
                    const container = document.getElementById('toast-container');
                    if (!container || container.childElementCount === 0) {
                        document.body?.classList?.remove('kw-investigator-toast-mobile');
                    }
                } catch (_error) {
                    // ignore
                }
            },
        });
        return;
    }
    fn.call(globalThis.toastr, text);
}

export function registerDeathNoteUiRefresh(fn) {
    refreshDeathNoteUiHook = typeof fn === 'function' ? fn : null;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isCoarsePointerDevice() {
    try {
        if (window.matchMedia('(pointer: coarse)').matches) {
            return true;
        }
        if (window.matchMedia('(hover: none)').matches) {
            return true;
        }
    } catch (_error) {
        // matchMedia unavailable
    }
    return 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
}

function isMobileViewport() {
    return window.innerWidth <= MOBILE_VIEWPORT_MAX;
}

/** Phones (incl. S25 Ultra landscape / “Desktop site”) should use mobile dock placement. */
function useMobileDockPlacement() {
    if (isMobileViewport()) {
        return true;
    }
    return isCoarsePointerDevice() && window.innerWidth <= MOBILE_DOCK_WIDTH_MAX;
}

export function shouldShowTaskForceDock({
    isInvestigator = false,
    hubOpen = false,
    mobileDockPlacement = false,
} = {}) {
    if (!isInvestigator) {
        return false;
    }
    // Desktop: hide dock while the immersive hub is open.
    // Mobile: always keep the dock so a stuck/off-screen hub cannot trap the user.
    if (hubOpen && !mobileDockPlacement) {
        return false;
    }
    return true;
}

export function activateInvestigatorShell() {
    const settings = getInvestigatorSettings();
    // Always open the terminal. Mobile keeps the floating Lock dock as escape.
    settings.hubOpen = true;
    settings.hubCollapsed = false;
    markHubOpenIntent();
    try {
        document.activeElement?.blur?.();
    } catch (_error) {
        // ignore
    }
    scheduleInvestigatorSettingsSave();
    refreshInvestigatorUi();
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
    // Keyboard / focused chat input collapses the visual viewport on phones and
    // makes fixed fullscreen shells look "missing". Blur before mounting.
    try {
        document.activeElement?.blur?.();
    } catch (_error) {
        // ignore
    }
    markHubOpenIntent();
    lastHubToggleAt = Date.now();
    scheduleInvestigatorSettingsSave();
    refreshInvestigatorUi();
    // Re-assert after layout — never leave hubOpen=true with no visible box.
    scheduleFrame(() => {
        if (!getInvestigatorSettings().hubOpen) {
            return;
        }
        let hub = document.getElementById(INVESTIGATOR_HUB_ID);
        if (!hub) {
            refreshInvestigatorUi();
            hub = document.getElementById(INVESTIGATOR_HUB_ID);
        }
        if (hub) {
            applyHubViewportBox(hub);
        }
    });
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

function renderTrustPanel(state) {
    const trust = Number.isFinite(Number(state?.taskForceTrust))
        ? Math.max(0, Math.min(100, Math.round(Number(state.taskForceTrust))))
        : getTaskForceTrust();
    const blocked = trust < TASK_FORCE_TRUST_BLOCK;
    const warn = trust < TASK_FORCE_TRUST_WARN;
    const tone = blocked ? 'is-block' : warn ? 'is-warn' : '';
    const stripe = blocked
        ? `<div class="kw-investigator-trust-warn">Trust lock (${trust}/${TASK_FORCE_TRUST_BLOCK}). New warrants and confronts are blocked.</div>`
        : warn
            ? `<div class="kw-investigator-trust-warn">Trust is low (${trust}). Warrants and confronts lock below ${TASK_FORCE_TRUST_BLOCK}.</div>`
            : '';
    return `
        <div class="kw-investigator-trust ${tone}">
            <div class="kw-investigator-trust__row">
                <span>Task Force trust</span>
                <span>${escapeHtml(String(trust))}</span>
            </div>
            <div class="kw-investigator-trust__track" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${trust}">
                <span class="kw-investigator-trust__fill" style="width:${trust}%"></span>
            </div>
        </div>
        ${stripe}
    `;
}

function renderActorSelectOptions(choices) {
    return (choices || []).map((actor) => {
        const value = JSON.stringify({
            type: actor.type,
            id: actor.id,
            name: actor.name,
        });
        return `<option value="${escapeHtml(value)}">${escapeHtml(actor.name || 'Character')}</option>`;
    }).join('');
}

function renderNavHtml(activeScreen) {
    const items = [
        { id: SCREENS.BOARD, label: 'Board' },
        { id: SCREENS.TIMELINE, label: 'Timeline' },
        { id: SCREENS.LOCKER, label: 'Locker' },
        { id: SCREENS.SURVEIL, label: 'Surveil' },
        { id: SCREENS.ACCESS, label: 'Access' },
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
        ? state.suspects.map((suspect) => {
            const underQuestion = (state.interrogations || []).some((entry) => (
                entry.key === suspect.key && entry.status === INTERROGATION_STATUS.ACTIVE
            ));
            return `
            <article class="kw-investigator-row" data-suspect-key="${escapeHtml(suspect.key)}">
                <div class="kw-investigator-row__main">
                    <div class="kw-investigator-row__title">${escapeHtml(suspect.actor?.name || 'Unknown')}</div>
                    <div class="kw-investigator-row__meta">${escapeHtml(statusLabel(suspect.status))} · pinned ${escapeHtml(formatClock(suspect.pinnedAt))}</div>
                    ${underQuestion ? '<span class="kw-investigator-chip kw-investigator-chip--live">Under interrogation</span>' : ''}
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
            `;
        }).join('')
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
        || entry.type === EVIDENCE_TYPES.STATEMENT
        || entry.type === EVIDENCE_TYPES.WARRANT_RESULT
        || entry.type === EVIDENCE_TYPES.CONFRONTATION
        || entry.type === EVIDENCE_TYPES.PATTERN_REPORT
        || entry.type === EVIDENCE_TYPES.TRAP_LINK
        || entry.type === EVIDENCE_TYPES.SIGHTING
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
            const isPhysicalItem = entry.type === EVIDENCE_TYPES.NOTEBOOK || entry.type === EVIDENCE_TYPES.SCRAP;
            const held = isPhysicalItem && entry.custody !== EVIDENCE_CUSTODY.RELEASED;
            const custodyLabel = entry.custody === EVIDENCE_CUSTODY.HELD
                ? 'held'
                : entry.custody === EVIDENCE_CUSTODY.RELEASED
                    ? `released${entry.releasedTo?.name ? ` → ${entry.releasedTo.name}` : ''}`
                    : entry.type;
            const releaseForm = held ? `
                <form class="kw-investigator-form kw-investigator-form--compact" data-inv-form="release-evidence" data-evidence-id="${escapeHtml(entry.id)}">
                    <label class="kw-investigator-field">
                        <span>Release to</span>
                        <select name="destination" class="text_pole">
                            <option value="holder">Original holder</option>
                            <option value="user">User</option>
                        </select>
                    </label>
                    <button type="submit" class="menu_button kw-investigator-btn">Release</button>
                </form>
            ` : '';
            return `
                <article class="kw-investigator-row kw-investigator-row--locker">
                    <div class="kw-investigator-row__main">
                        <div class="kw-investigator-row__title">${escapeHtml(entry.title)}</div>
                        <div class="kw-investigator-row__meta">${escapeHtml(custodyLabel)} · ${escapeHtml(formatClock(entry.createdAt))}</div>
                        ${entry.detail ? `<div class="kw-investigator-row__notes">${escapeHtml(entry.detail)}</div>` : ''}
                        ${snapshot}
                    </div>
                    ${releaseForm}
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
                <p>Seized notebooks, scraps, statements, and death reports. Release held items to the original holder or the user.</p>
            </header>
            <div class="kw-investigator-list">${html}</div>
        </section>
    `;
}

function renderSurveillanceScreen(state) {
    const plants = (state.surveillance || []).filter((entry) => entry.status === SURVEILLANCE_STATUS.ACTIVE);
    const signals = (state.signals || []).slice(0, 16);
    const plantsHtml = plants.length
        ? plants.map((entry) => `
            <article class="kw-investigator-row">
                <div class="kw-investigator-row__main">
                    <div class="kw-investigator-row__title">${escapeHtml(entry.label || entry.kind)}</div>
                    <div class="kw-investigator-row__meta">${escapeHtml(entry.kind)}${entry.target?.name ? ` · ${escapeHtml(entry.target.name)}` : ''}${entry.location ? ` · ${escapeHtml(entry.location)}` : ''}${entry.lastSignalAt ? ` · last ${escapeHtml(formatClock(entry.lastSignalAt))}` : ''}</div>
                </div>
                <button type="button" class="menu_button kw-investigator-btn" data-inv-remove-plant="${escapeHtml(entry.id)}">Remove</button>
            </article>
        `).join('')
        : '<p class="kw-investigator-empty">No active plants. Deploy from Ops.</p>';

    const signalsHtml = signals.length
        ? signals.map((entry) => `
            <article class="kw-investigator-row">
                <div class="kw-investigator-row__main">
                    <div class="kw-investigator-row__title">${escapeHtml(entry.kind)}</div>
                    <div class="kw-investigator-row__meta">${escapeHtml(formatClock(entry.at))} · ${escapeHtml(entry.text || '')}</div>
                </div>
                ${entry.evidenceId ? '<span class="kw-investigator-chip">Logged</span>' : `
                    <button type="button" class="menu_button kw-investigator-btn" data-inv-log-signal="${escapeHtml(entry.id)}">Log evidence</button>
                `}
            </article>
        `).join('')
        : '<p class="kw-investigator-empty">No surveillance signals yet.</p>';

    return `
        <section class="kw-investigator-screen" data-screen="surveil">
            <header class="kw-investigator-screen__head">
                <h2>Surveillance</h2>
                <p>Active bugs / trails / notebook watches and recent signals. Contents are never recovered.</p>
            </header>
            <div class="kw-investigator-split">
                <div class="kw-investigator-panel">
                    <div class="kw-investigator-subhead">Active plants</div>
                    <div class="kw-investigator-list">${plantsHtml}</div>
                </div>
                <div class="kw-investigator-panel">
                    <div class="kw-investigator-subhead">Signal feed</div>
                    <div class="kw-investigator-list">${signalsHtml}</div>
                </div>
            </div>
        </section>
    `;
}

function renderOpsScreen(state) {
    const settings = getInvestigatorSettings();
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

    const interrogationsHtml = (state.interrogations || []).filter((entry) => entry.status === INTERROGATION_STATUS.ACTIVE).length
        ? state.interrogations.filter((entry) => entry.status === INTERROGATION_STATUS.ACTIVE).map((entry) => `
            <article class="kw-investigator-row">
                <div class="kw-investigator-row__main">
                    <div class="kw-investigator-row__title">${escapeHtml(entry.actor?.name || 'Unknown')}</div>
                    <div class="kw-investigator-row__meta">Started ${escapeHtml(formatClock(entry.startedAt))} · clip ${entry.autoClip === false ? 'off' : 'on'}</div>
                </div>
                <button type="button" class="menu_button kw-investigator-btn" data-inv-end-interrogation="${escapeHtml(entry.key)}">End</button>
            </article>
        `).join('')
        : '<p class="kw-investigator-empty">No active interrogation. Start one to auto-clip statements.</p>';

    const warrantsHtml = (state.warrants || []).length
        ? state.warrants.slice().reverse().slice(0, 8).map((entry) => `
            <article class="kw-investigator-row">
                <div class="kw-investigator-row__main">
                    <div class="kw-investigator-row__title">${escapeHtml(entry.target?.name || 'Unknown')}</div>
                    <div class="kw-investigator-row__meta">${escapeHtml(entry.status)}${entry.status === 'pending' ? ` · ${escapeHtml(String(entry.generationsLeft))} gen left` : entry.result ? ` · ${escapeHtml(entry.result)}` : ''}${entry.note ? ` · ${escapeHtml(entry.note)}` : ''}</div>
                </div>
            </article>
        `).join('')
        : '<p class="kw-investigator-empty">No warrants filed.</p>';

    const confrontChoices = (state.suspects || []).map((entry) => {
        const strength = getCaseStrength(entry.key).strength;
        const value = JSON.stringify({
            type: entry.actor?.type || NOTEBOOK_ACTOR_TYPES.CHARACTER,
            id: entry.actor?.id || '',
            name: entry.actor?.name || '',
        });
        return `<option value="${escapeHtml(value)}">${escapeHtml(entry.actor?.name || 'Suspect')} [${escapeHtml(entry.status)} · str ${strength}]</option>`;
    }).join('');

    const candidates = getSeizeCandidates();
    const notebookSeize = (candidates.notebooks || []).map((notebook) => `
        <button type="button" class="menu_button kw-investigator-btn kw-investigator-btn--danger kw-investigator-btn--block" data-inv-seize-notebook="${escapeHtml(notebook.itemId)}">
            <span class="kw-investigator-btn__main">Seize notebook</span>
            <span class="kw-investigator-btn__sub">${escapeHtml(notebook.label || 'Death Note')} · ${escapeHtml(notebook.holder?.name || 'held')}</span>
        </button>
    `).join('');
    const scrapSeize = (candidates.scraps || []).map((scrap) => `
        <button type="button" class="menu_button kw-investigator-btn kw-investigator-btn--danger kw-investigator-btn--block" data-inv-seize-scrap="${escapeHtml(scrap.id)}">
            <span class="kw-investigator-btn__main">Seize scrap</span>
            <span class="kw-investigator-btn__sub">${escapeHtml(scrap.holder?.name || 'held')}</span>
        </button>
    `).join('');
    const seizeBlock = (notebookSeize || scrapSeize)
        ? `${notebookSeize}${scrapSeize}`
        : '<p class="kw-investigator-empty">No seizable items. Restrain a character who currently holds a notebook or scrap.</p>';

    const caseLog = (state.log || []).slice().reverse().slice(0, 12).map((entry) => `
        <div class="kw-investigator-logline"><span>${escapeHtml(formatClock(entry.at))}</span> ${escapeHtml(entry.text)}</div>
    `).join('') || '<p class="kw-investigator-empty">System log quiet.</p>';

    const casePromptTemplate = String(settings.casePromptTemplate || DEFAULT_CASE_PROMPT_TEMPLATE);
    const notebookOptions = getDeathNotes()
        .filter((entry) => entry && !entry.destroyed && entry.exists)
        .map((entry) => `<option value="${escapeHtml(entry.itemId)}">${escapeHtml(entry.label || entry.itemId)} · ${escapeHtml(entry.holder?.name || 'held')}</option>`)
        .join('');

    return `
        <section class="kw-investigator-screen kw-investigator-screen--ops" data-screen="ops">
            <header class="kw-investigator-screen__head">
                <h2>Operations</h2>
                <p>Warrants, confront, interrogate, restrain, seize, and field tools.</p>
            </header>
            <div class="kw-investigator-ops-scroll">
                <div class="kw-investigator-ops-grid">
                    <div class="kw-investigator-panel">
                        <div class="kw-investigator-subhead">Case file</div>
                        <div class="kw-investigator-row__meta">${escapeHtml(state.caseId)} · ${escapeHtml(state.caseTitle)}</div>
                        ${renderTrustPanel(state)}
                        <button type="button" class="menu_button kw-investigator-btn kw-investigator-btn--block" data-inv-open-dn-registry>Open notebook registry (debug)</button>
                        <small class="kw-investigator-hint">Officers and play role live under Access. Registry is a debug peek.</small>
                    </div>
                    <div class="kw-investigator-panel">
                        <div class="kw-investigator-subhead">Warrant / search</div>
                        <form class="kw-investigator-form kw-investigator-form--embedded" data-inv-form="warrant">
                            <label class="kw-investigator-field">
                                <span>Target</span>
                                <select name="actorJson" class="text_pole" required>
                                    <option value="">Select character…</option>
                                    ${options}
                                </select>
                            </label>
                            <label class="kw-investigator-field">
                                <span>Resolve after generations</span>
                                <input name="generations" class="text_pole" type="number" min="1" max="8" value="2" />
                            </label>
                            <label class="kw-investigator-field">
                                <span>Note</span>
                                <input name="note" class="text_pole" type="text" maxlength="200" placeholder="Scope / probable cause" />
                            </label>
                            <button type="submit" class="menu_button kw-investigator-btn kw-investigator-btn--primary kw-investigator-btn--block">File warrant</button>
                        </form>
                        <div class="kw-investigator-list">${warrantsHtml}</div>
                    </div>
                    <div class="kw-investigator-panel">
                        <div class="kw-investigator-subhead">Confront</div>
                        <form class="kw-investigator-form kw-investigator-form--embedded" data-inv-form="confront">
                            <label class="kw-investigator-field">
                                <span>Suspect</span>
                                <select name="actorJson" class="text_pole" required>
                                    <option value="">Select pinned suspect…</option>
                                    ${confrontChoices || options}
                                </select>
                            </label>
                            <label class="kw-investigator-field">
                                <span>Note</span>
                                <input name="note" class="text_pole" type="text" maxlength="200" placeholder="Accusation / pressure angle" />
                            </label>
                            <button type="submit" class="menu_button kw-investigator-btn kw-investigator-btn--primary kw-investigator-btn--block">Confront</button>
                        </form>
                        <small class="kw-investigator-hint">Needs case strength ≥ 2 and trust ≥ ${TASK_FORCE_TRUST_BLOCK}. Prime + strength ≥ 3 records probable cause (restrain still required to seize). Overreach drops trust.</small>
                    </div>
                    <div class="kw-investigator-panel">
                        <div class="kw-investigator-subhead">Interrogate</div>
                        <form class="kw-investigator-form kw-investigator-form--embedded" data-inv-form="interrogate">
                            <label class="kw-investigator-field">
                                <span>Subject</span>
                                <select name="actorJson" class="text_pole" required>
                                    <option value="">Select character…</option>
                                    ${options}
                                </select>
                            </label>
                            <button type="submit" class="menu_button kw-investigator-btn kw-investigator-btn--primary kw-investigator-btn--block">Start interrogation</button>
                        </form>
                        <small class="kw-investigator-hint">While active, matching character replies clip into locker statements (~500 chars).</small>
                        <div class="kw-investigator-list">${interrogationsHtml}</div>
                    </div>
                    <div class="kw-investigator-panel">
                        <div class="kw-investigator-subhead">Plant surveillance</div>
                        <form class="kw-investigator-form kw-investigator-form--embedded" data-inv-form="surveil">
                            <label class="kw-investigator-field">
                                <span>Kind</span>
                                <select name="kind" class="text_pole" required>
                                    <option value="${SURVEILLANCE_KINDS.TRAIL}">Trail character</option>
                                    <option value="${SURVEILLANCE_KINDS.WATCH_NOTEBOOK}">Watch notebook</option>
                                    <option value="${SURVEILLANCE_KINDS.BUG_ROOM}">Bug room / location</option>
                                </select>
                            </label>
                            <label class="kw-investigator-field">
                                <span>Character (trail)</span>
                                <select name="actorJson" class="text_pole">
                                    <option value="">Select character…</option>
                                    ${options}
                                </select>
                            </label>
                            <label class="kw-investigator-field">
                                <span>Notebook (watch)</span>
                                <select name="notebookItemId" class="text_pole">
                                    <option value="">Select notebook…</option>
                                    ${notebookOptions}
                                </select>
                            </label>
                            <label class="kw-investigator-field">
                                <span>Location (bug)</span>
                                <input name="location" class="text_pole" type="text" maxlength="120" placeholder="Light’s room / warehouse" />
                            </label>
                            <button type="submit" class="menu_button kw-investigator-btn kw-investigator-btn--primary kw-investigator-btn--block">Plant</button>
                        </form>
                        <small class="kw-investigator-hint">Max 3 active plants. Signals never include notebook page text.</small>
                    </div>
                    <div class="kw-investigator-panel">
                        <div class="kw-investigator-subhead">Analyze pattern</div>
                        <form class="kw-investigator-form kw-investigator-form--embedded" data-inv-form="analyze">
                            <label class="kw-investigator-field">
                                <span>Focus hint (optional)</span>
                                <input name="note" class="text_pole" type="text" maxlength="120" placeholder="heart attack / timing / criminals" />
                            </label>
                            <button type="submit" class="menu_button kw-investigator-btn kw-investigator-btn--primary kw-investigator-btn--block">Run pattern analysis</button>
                        </form>
                        <small class="kw-investigator-hint">Uses investigator-visible resolved deaths only.</small>
                    </div>
                    <div class="kw-investigator-panel">
                        <div class="kw-investigator-subhead">Broadcast trap</div>
                        <form class="kw-investigator-form kw-investigator-form--embedded" data-inv-form="broadcast">
                            <label class="kw-investigator-field">
                                <span>Decoy name</span>
                                <input name="decoyName" class="text_pole" type="text" maxlength="120" required placeholder="Fake criminal / challenge target" />
                            </label>
                            <label class="kw-investigator-field">
                                <span>Challenge blurb</span>
                                <input name="challenge" class="text_pole" type="text" maxlength="240" placeholder="Public broadcast detail" />
                            </label>
                            <button type="submit" class="menu_button kw-investigator-btn kw-investigator-btn--primary kw-investigator-btn--block">Arm broadcast trap</button>
                        </form>
                        <small class="kw-investigator-hint">One active trap. Matching resolved kill auto-links trap evidence.</small>
                    </div>
                    <div class="kw-investigator-panel">
                        <div class="kw-investigator-subhead">Mark restrained</div>
                        <form class="kw-investigator-form kw-investigator-form--embedded" data-inv-form="restrain">
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
                            <button type="submit" class="menu_button kw-investigator-btn kw-investigator-btn--primary kw-investigator-btn--block">Mark restrained</button>
                        </form>
                        <div class="kw-investigator-list">${restrainedHtml}</div>
                    </div>
                    <div class="kw-investigator-panel">
                        <div class="kw-investigator-subhead">Seize</div>
                        <div class="kw-investigator-actions">${seizeBlock}</div>
                    </div>
                    <div class="kw-investigator-panel">
                        <div class="kw-investigator-subhead">Case AI</div>
                        <label class="kw-investigator-field kw-investigator-field--row">
                            <input id="kw-investigator-show-case-action-debug" type="checkbox" ${settings.showCaseActionDebugBlocks ? 'checked' : ''} />
                            <span>Show hidden officer case-action blocks in chat</span>
                        </label>
                        <label class="kw-investigator-field">
                            <span>Case context prompt template</span>
                            <textarea id="kw-investigator-case-prompt-template" class="text_pole" rows="8">${escapeHtml(casePromptTemplate)}</textarea>
                        </label>
                        <small class="kw-investigator-hint">Placeholders include warrants_block and clearance-aware officers_block.</small>
                    </div>
                    <div class="kw-investigator-panel">
                        <div class="kw-investigator-subhead">System log</div>
                        <div class="kw-investigator-log">${caseLog}</div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

function renderAccessScreen(state) {
    const choices = getBoardSuspectChoices();
    const options = renderActorSelectOptions(choices);
    const officersHtml = (state.officers || []).length
        ? state.officers.map((entry) => `
            <article class="kw-investigator-row">
                <div class="kw-investigator-row__main">
                    <div class="kw-investigator-row__title">${escapeHtml(entry.actor?.name || 'Officer')}</div>
                    <div class="kw-investigator-row__meta">${escapeHtml(entry.rank || 'Officer')} · clearance:${escapeHtml(entry.clearance || OFFICER_CLEARANCE.FIELD)}${entry.notes ? ` · ${escapeHtml(entry.notes)}` : ''}</div>
                </div>
                <button type="button" class="menu_button kw-investigator-btn" data-inv-remove-officer="${escapeHtml(entry.key)}">Remove</button>
            </article>
        `).join('')
        : '<p class="kw-investigator-empty">No Task Force officers assigned. Assign characters so they can file case actions.</p>';

    return `
        <section class="kw-investigator-screen kw-investigator-screen--ops" data-screen="access">
            <header class="kw-investigator-screen__head">
                <h2>Access</h2>
                <p>Play role, Task Force roster, and clearance.</p>
            </header>
            <div class="kw-investigator-ops-scroll">
                <div class="kw-investigator-ops-grid">
                    <div class="kw-investigator-panel">
                        <div class="kw-investigator-subhead">Session</div>
                        ${renderTrustPanel(state)}
                        <label class="kw-investigator-field">
                            <span>Play role</span>
                            <select id="kw-investigator-play-role" class="text_pole">
                                <option value="${PLAY_ROLES.INVESTIGATOR}" selected>Investigator</option>
                                <option value="${PLAY_ROLES.KIRA}">Kira</option>
                            </select>
                        </label>
                        <small class="kw-investigator-hint">Kira and Investigator stay exclusive. Switching tears down the other side’s widgets.</small>
                    </div>
                    <div class="kw-investigator-panel">
                        <div class="kw-investigator-subhead">Task Force officers</div>
                        <form class="kw-investigator-form kw-investigator-form--embedded" data-inv-form="assign-officer">
                            <label class="kw-investigator-field">
                                <span>Character</span>
                                <select name="actorJson" class="text_pole" required>
                                    <option value="">Select character…</option>
                                    ${options}
                                </select>
                            </label>
                            <label class="kw-investigator-field">
                                <span>Rank label</span>
                                <input name="rank" class="text_pole" type="text" maxlength="80" placeholder="Officer / Detective / Lead" />
                            </label>
                            <label class="kw-investigator-field">
                                <span>Clearance</span>
                                <select name="clearance" class="text_pole">
                                    <option value="${OFFICER_CLEARANCE.FIELD}">Field — log / pin / status / report</option>
                                    <option value="${OFFICER_CLEARANCE.DETECTIVE}">Detective — + restrain / surveil / analyze / interrogate</option>
                                    <option value="${OFFICER_CLEARANCE.LEAD}" selected>Lead — + warrant / confront / broadcast</option>
                                </select>
                            </label>
                            <button type="submit" class="menu_button kw-investigator-btn kw-investigator-btn--primary kw-investigator-btn--block">Assign officer</button>
                        </form>
                        <small class="kw-investigator-hint">Clearance gates which <code>kwCaseAction</code> verbs an officer may file.</small>
                        <div class="kw-investigator-list">${officersHtml}</div>
                    </div>
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
        case SCREENS.SURVEIL:
            return renderSurveillanceScreen(state);
        case SCREENS.ACCESS:
            return renderAccessScreen(state);
        case SCREENS.OPS:
            return renderOpsScreen(state);
        case SCREENS.BOARD:
        default:
            return renderBoardScreen(state);
    }
}

function buildHubHtml(settings, state) {
    const mobile = useMobileDockPlacement();
    // On phones the floating dock already provides Lock — drop plate/hardware
    // chrome so the CRT can fit inside the visible viewport.
    const plateHtml = mobile
        ? ''
        : `
                <div class="kw-investigator-hub__plate">
                    <span class="kw-investigator-hub__plate-mark">NPA</span>
                    <span class="kw-investigator-hub__plate-name">Task Force Terminal</span>
                </div>`;
    const hardwareHtml = mobile
        ? ''
        : `
                <div class="kw-investigator-hub__hardware">
                    <span class="kw-investigator-hub__power-led" aria-hidden="true"></span>
                    <button type="button" class="kw-investigator-hub__power" data-inv-close title="Lock terminal">
                        Power / Lock
                    </button>
                    <span class="kw-investigator-hub__vent" aria-hidden="true"></span>
                </div>`;
    return `
        <div class="kw-investigator-hub__room">
            <div class="kw-investigator-hub__bezel" aria-label="Task Force computer">
                <span class="kw-investigator-hub__screw kw-investigator-hub__screw--tl" aria-hidden="true"></span>
                <span class="kw-investigator-hub__screw kw-investigator-hub__screw--tr" aria-hidden="true"></span>
                <span class="kw-investigator-hub__screw kw-investigator-hub__screw--bl" aria-hidden="true"></span>
                <span class="kw-investigator-hub__screw kw-investigator-hub__screw--br" aria-hidden="true"></span>
                ${plateHtml}
                <div class="kw-investigator-hub__crt">
                    <div class="kw-investigator-hub__scan" aria-hidden="true"></div>
                    <div class="kw-investigator-hub__chrome">
                        <header class="kw-investigator-hub__titlebar">
                            <div class="kw-investigator-hub__brand">
                                <span class="kw-investigator-hub__led" aria-hidden="true"></span>
                                <div>
                                    <div class="kw-investigator-hub__os">TASK FORCE OS // TERMINAL</div>
                                    <div class="kw-investigator-hub__case">${escapeHtml(state.caseId)} — ${escapeHtml(state.caseTitle)}</div>
                                </div>
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
                            <span>TRUST ${escapeHtml(String(getTaskForceTrust()))}</span>
                            <span>SECURE // LOCAL CASE STATE</span>
                        </footer>
                    </div>
                </div>
                ${hardwareHtml}
            </div>
        </div>
    `;
}

function applyDockPosition(root) {
    if (!root) {
        return;
    }
    const settings = getInvestigatorSettings();

    // Phones / touch devices always use CSS placement — never restored desktop coords.
    if (useMobileDockPlacement()) {
        root.style.left = '';
        root.style.top = '';
        root.style.right = '';
        root.style.bottom = '';
        root.style.transform = '';
        return;
    }

    const hasSaved = Number.isFinite(Number(settings.dockX)) && Number.isFinite(Number(settings.dockY));
    if (hasSaved) {
        const width = root.offsetWidth || 180;
        const height = Math.min(root.offsetHeight || 48, 64);
        const maxX = Math.max(0, window.innerWidth - width);
        const maxY = Math.max(0, window.innerHeight - height);
        const x = clamp(Number(settings.dockX), 0, maxX);
        const y = clamp(Number(settings.dockY), 0, maxY);
        root.style.left = `${Math.round(x)}px`;
        root.style.top = `${Math.round(y)}px`;
        root.style.right = 'auto';
        root.style.bottom = 'auto';
        return;
    }

    root.style.left = '';
    root.style.top = '';
    root.style.right = '';
    root.style.bottom = '';
}

function recoverStuckInvestigatorShell() {
    const settings = getInvestigatorSettings();
    if (!isInvestigatorRole() || !settings.hubOpen || !useMobileDockPlacement()) {
        return false;
    }
    // Fresh intentional opens must never be treated as stuck — measuring a hub in
    // the same turn it mounts (or while the soft keyboard is up) falsely reported
    // zero/off-screen bounds and immediately tore the terminal down on phones.
    if (Date.now() - lastHubOpenIntentAt < HUB_OPEN_GRACE_MS) {
        return false;
    }
    const hub = document.getElementById(INVESTIGATOR_HUB_ID);
    // Missing node means ensureHub has not run yet — do not treat as stuck.
    if (!hub) {
        return false;
    }
    if (!shouldRecoverStuckMobileHub(hub.getBoundingClientRect(), {
        viewportHeight: Math.max(
            Number(window.visualViewport?.height) || 0,
            Number(window.innerHeight) || 0,
            1,
        ),
    })) {
        return false;
    }
    settings.hubOpen = false;
    scheduleInvestigatorSettingsSave();
    hub.remove();
    return true;
}

/**
 * @param {{ width: number, height: number, top: number, bottom: number }} rect
 * @param {{ viewportHeight: number }} options
 */
export function shouldRecoverStuckMobileHub(rect, { viewportHeight = 1 } = {}) {
    // Only treat a shell as gone when it has essentially no box (display:none /
    // unmounted metrics). Never use a mid-size height threshold — that false-triggered
    // while the soft keyboard or first layout pass reported a short rect.
    const hasBox = Number(rect?.width) >= 40 && Number(rect?.height) >= 40;
    const fullyOffscreen = Number(rect?.bottom) <= 0 || Number(rect?.top) >= Number(viewportHeight || 1);
    return !hasBox || fullyOffscreen;
}

function ensureTaskForceDock() {
    let root = document.getElementById(INVESTIGATOR_DOCK_ID);
    document.getElementById('kw-investigator-session-bar')?.remove();
    document.getElementById('kw-investigator-workstation')?.remove();

    const settings = getInvestigatorSettings();
    const mobileDock = useMobileDockPlacement();
    const hubOpen = Boolean(settings.hubOpen);
    const shouldShow = shouldShowTaskForceDock({
        isInvestigator: isInvestigatorRole(),
        hubOpen,
        mobileDockPlacement: mobileDock,
    });

    if (!shouldShow) {
        if (root) {
            root.remove();
        }
        return null;
    }

    const state = getInvestigatorState();

    if (!root) {
        root = document.createElement('div');
        root.id = INVESTIGATOR_DOCK_ID;
        document.body.append(root);
    }

    root.className = `kw-investigator-dock ${mobileDock ? 'is-mobile' : 'is-desktop'}${hubOpen ? ' is-hub-open' : ''}`;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', hubOpen ? 'Lock Task Force terminal' : 'Task Force terminal');
    root.hidden = false;
    root.style.display = '';
    root.style.visibility = 'visible';
    root.style.opacity = '1';
    root.innerHTML = `
        <div class="kw-investigator-dock__shell">
            <button type="button" class="kw-investigator-dock__open" data-inv-dock-toggle="true" data-inv-drag-handle="true">
                <span class="kw-investigator-dock__led" aria-hidden="true"></span>
                <span class="kw-investigator-dock__copy">
                    <span class="kw-investigator-dock__label">Task Force</span>
                    <span class="kw-investigator-dock__case">${escapeHtml(state.caseId)}</span>
                </span>
                <span class="kw-investigator-dock__action">${hubOpen ? 'Lock' : 'Open'}</span>
            </button>
        </div>
    `;
    scheduleFrame(() => applyDockPosition(root));
    return root;
}

function getViewportBox() {
    const vv = window.visualViewport;
    const vvWidth = Number(vv?.width);
    const vvHeight = Number(vv?.height);
    const layoutWidth = Math.min(
        Number(window.innerWidth) || Infinity,
        Number(document.documentElement?.clientWidth) || Infinity,
    );
    const layoutHeight = Math.min(
        Number(window.innerHeight) || Infinity,
        Number(document.documentElement?.clientHeight) || Infinity,
    );
    // Prefer the *visible* viewport size, never larger than the layout viewport.
    const width = Math.max(
        1,
        Math.round(
            Number.isFinite(vvWidth) && vvWidth > 0
                ? Math.min(vvWidth, layoutWidth || vvWidth)
                : (layoutWidth || window.innerWidth || 1),
        ),
    );
    const height = Math.max(
        1,
        Math.round(
            Number.isFinite(vvHeight) && vvHeight > 0
                ? Math.min(vvHeight, layoutHeight || vvHeight)
                : (layoutHeight || window.innerHeight || 1),
        ),
    );
    // IMPORTANT: do NOT use visualViewport.offsetTop/Left as fixed top/left.
    // On Chrome Android / Samsung Internet, position:fixed is already relative to
    // the visual viewport — applying offsetTop double-offsets the hub so only the
    // titlebar peeks from the bottom of the screen (S25 Ultra bug).
    return { width, height, left: 0, top: 0 };
}

function applyHubViewportBox(root) {
    if (!root) {
        return;
    }
    const box = getViewportBox();
    const style = root.style || (root.style = {});
    const set = (name, value) => {
        if (typeof style.setProperty === 'function') {
            style.setProperty(name, value, 'important');
        } else {
            style[name] = value;
        }
    };
    // Anchor to the visual top-left of the fixed containing block (top/left 0).
    // Size with visible viewport pixels so the soft keyboard shortens the shell
    // instead of covering it — without shifting the origin.
    set('position', 'fixed');
    set('left', '0');
    set('top', '0');
    set('right', '0');
    set('bottom', 'auto');
    set('width', `${box.width}px`);
    set('height', `${box.height}px`);
    set('max-width', '100%');
    set('max-height', `${box.height}px`);
    set('min-width', '0');
    set('min-height', '0');
    set('z-index', '2147483646');
    set('display', 'block');
    set('visibility', 'visible');
    set('opacity', '1');
    set('pointer-events', 'auto');
    set('transform', 'none');
    set('inset', 'auto');
    set('overflow', 'hidden');
    set('box-sizing', 'border-box');
    root.hidden = false;
    try {
        root.removeAttribute?.('hidden');
    } catch (_error) {
        // ignore
    }
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

    const mobile = useMobileDockPlacement();

    if (!root) {
        root = document.createElement('div');
        root.id = INVESTIGATOR_HUB_ID;
        document.body.append(root);
    }

    root.className = `kw-investigator-hub ${mobile ? 'is-mobile' : 'is-desktop'}`;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Task Force terminal');

    try {
        syncDeathReportsIntoTimelineEvidence();
        const state = getInvestigatorState();
        root.innerHTML = buildHubHtml(settings, state);
    } catch (error) {
        console.error('[killer_within_investigator] Hub render failed; showing fallback shell', error);
        root.innerHTML = `
            <div class="kw-investigator-hub__room">
                <div class="kw-investigator-hub__bezel" aria-label="Task Force computer">
                    <div class="kw-investigator-hub__crt">
                        <div class="kw-investigator-hub__chrome">
                            <header class="kw-investigator-hub__titlebar">
                                <div class="kw-investigator-hub__brand">
                                    <span class="kw-investigator-hub__led" aria-hidden="true"></span>
                                    <div>
                                        <div class="kw-investigator-hub__os">TASK FORCE OS // TERMINAL</div>
                                        <div class="kw-investigator-hub__case">Render error — UI still online</div>
                                    </div>
                                </div>
                            </header>
                            <div class="kw-investigator-hub__body">
                                <p class="kw-investigator-hint">The terminal shell mounted, but case content failed to render. Try Lock and Open again.</p>
                            </div>
                            <div class="kw-investigator-hub__hardware">
                                <button type="button" class="kw-investigator-hub__power" data-inv-close>Lock</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    applyHubViewportBox(root);
    if (!mobile) {
        root.classList.add('is-immersive');
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

/**
 * Switch Killer Within play role and refresh both UIs.
 * @param {string} nextRole
 * @param {{ notify?: boolean }} [options]
 * @returns {Promise<string>} Human-readable status for slash / toasts.
 */
export async function switchPlayRole(nextRole, options = {}) {
    const notify = options.notify !== false;
    const role = String(nextRole || '').trim().toLowerCase() === PLAY_ROLES.INVESTIGATOR
        ? PLAY_ROLES.INVESTIGATOR
        : PLAY_ROLES.KIRA;
    const changed = setPlayRole(role);
    if (!changed && getPlayRole() === role) {
        const message = role === PLAY_ROLES.INVESTIGATOR
            ? 'Already playing as Investigator.'
            : 'Already playing as Kira.';
        if (notify) {
            notifyInvestigator('info', message);
        }
        return message;
    }
    if (role === PLAY_ROLES.INVESTIGATOR) {
        activateInvestigatorShell();
    } else {
        const settings = getInvestigatorSettings();
        settings.hubOpen = false;
        scheduleInvestigatorSettingsSave();
        refreshInvestigatorUi();
    }
    refreshDeathNoteUiHook?.();
    const message = role === PLAY_ROLES.INVESTIGATOR
        ? 'Switched to Investigator. Task Force terminal opened.'
        : 'Switched to Kira. Returned to Death Note tools.';
    if (notify) {
        notifyInvestigator('info', message);
    }
    return message;
}

async function handleRoleChange(nextRole) {
    await switchPlayRole(nextRole);
}

function toggleHubFromDock() {
    const now = Date.now();
    // Swallow ghost click / second pointerup that would instantly close a fresh open.
    if (now - lastHubToggleAt < 350) {
        return;
    }
    lastHubToggleAt = now;
    if (getInvestigatorSettings().hubOpen) {
        closeHub();
    } else {
        openHub();
    }
}

let dockPointerDelegationInstalled = false;

function bindTaskForceDock(_root) {
    // Install once on document — ensureTaskForceDock rebuilds the button HTML every
    // refresh, so per-button listeners would be easy to stack or miss on touch.
    if (dockPointerDelegationInstalled) {
        return;
    }
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
        return;
    }
    dockPointerDelegationInstalled = true;

    // Mirror Death Note inventory/cover: toggle on pointerup, not click.
    // Touch browsers suppress the synthetic click after pointerdown.preventDefault(),
    // which is why Kira UI worked on phones and Investigator Open did not.
    document.addEventListener('pointerdown', (event) => {
        const handle = event.target?.closest?.('[data-inv-dock-toggle="true"]');
        if (!(handle instanceof HTMLElement)) {
            return;
        }
        if (event.button !== 0 && event.pointerType === 'mouse') {
            return;
        }
        if (!event.isPrimary) {
            return;
        }

        const root = document.getElementById(INVESTIGATOR_DOCK_ID);
        if (!root) {
            return;
        }

        const mobilePinned = useMobileDockPlacement();
        // While hub is open on mobile, Lock is tap-only (no drag session).
        if (getInvestigatorSettings().hubOpen && mobilePinned) {
            dockDragState.dragging = true;
            dockDragState.moved = false;
            dockDragState.pointerId = event.pointerId;
            dockDragState.startX = event.clientX;
            dockDragState.startY = event.clientY;
            dockDragState.mobileTapOnly = true;
        } else {
            event.preventDefault();
            const rect = root.getBoundingClientRect();
            dockDragState.dragging = true;
            dockDragState.moved = false;
            dockDragState.mobileTapOnly = mobilePinned;
            dockDragState.pointerId = event.pointerId;
            dockDragState.startX = event.clientX;
            dockDragState.startY = event.clientY;
            dockDragState.originX = rect.left;
            dockDragState.originY = rect.top;
        }

        if (!dockDragState.handlersInstalled) {
            dockDragState.handlersInstalled = true;

            dockDragState.moveHandler = (moveEvent) => {
                if (!dockDragState.dragging) {
                    return;
                }
                if (dockDragState.pointerId !== null && moveEvent.pointerId !== dockDragState.pointerId) {
                    return;
                }
                const dx = moveEvent.clientX - dockDragState.startX;
                const dy = moveEvent.clientY - dockDragState.startY;
                if (Math.abs(dx) + Math.abs(dy) > 10) {
                    dockDragState.moved = true;
                }

                // Mobile dock is CSS-pinned (!important). Dragging only fights the
                // stylesheet and falsely marks taps as moves — skip repositioning.
                if (dockDragState.mobileTapOnly || useMobileDockPlacement()) {
                    return;
                }

                const activeRoot = document.getElementById(INVESTIGATOR_DOCK_ID);
                if (!activeRoot) {
                    return;
                }
                const rectNow = activeRoot.getBoundingClientRect();
                const maxX = Math.max(0, window.innerWidth - rectNow.width);
                const maxY = Math.max(0, window.innerHeight - Math.min(rectNow.height, 72));
                const nextX = clamp(dockDragState.originX + dx, 0, maxX);
                const nextY = clamp(dockDragState.originY + dy, 0, maxY);
                activeRoot.style.left = `${Math.round(nextX)}px`;
                activeRoot.style.top = `${Math.round(nextY)}px`;
                activeRoot.style.right = 'auto';
                activeRoot.style.bottom = 'auto';
            };

            dockDragState.upHandler = (upEvent) => {
                if (!dockDragState.dragging) {
                    return;
                }
                if (dockDragState.pointerId !== null && upEvent.pointerId !== dockDragState.pointerId) {
                    return;
                }

                const activeRoot = document.getElementById(INVESTIGATOR_DOCK_ID);
                const wasMoved = dockDragState.moved;
                dockDragState.dragging = false;
                dockDragState.pointerId = null;
                // Always swallow the trailing click — toggle happens here (Death Note pattern).
                dockDragState.ignoreClick = true;

                if (activeRoot && wasMoved && !useMobileDockPlacement()) {
                    const rectFinal = activeRoot.getBoundingClientRect();
                    const settings = getInvestigatorSettings();
                    settings.dockX = Math.round(rectFinal.left);
                    settings.dockY = Math.round(rectFinal.top);
                    scheduleInvestigatorSettingsSave();
                }

                window.removeEventListener('pointermove', dockDragState.moveHandler, true);
                window.removeEventListener('pointerup', dockDragState.upHandler, true);
                window.removeEventListener('pointercancel', dockDragState.upHandler, true);
                dockDragState.handlersInstalled = false;

                if (!wasMoved) {
                    toggleHubFromDock();
                }
            };

            window.addEventListener('pointermove', dockDragState.moveHandler, true);
            window.addEventListener('pointerup', dockDragState.upHandler, true);
            window.addEventListener('pointercancel', dockDragState.upHandler, true);
        }
    }, true);

    document.addEventListener('click', (event) => {
        const handle = event.target?.closest?.('[data-inv-dock-toggle="true"]');
        if (!(handle instanceof HTMLElement)) {
            return;
        }
        if (dockDragState.ignoreClick) {
            dockDragState.ignoreClick = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        // Keyboard / non-pointer activation fallback.
        event.preventDefault();
        toggleHubFromDock();
    }, true);
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

    root.querySelectorAll('[data-inv-remove-officer]').forEach((button) => {
        button.addEventListener('click', async () => {
            const key = button.getAttribute('data-inv-remove-officer');
            await commitInvestigatorMutation(() => removeOfficer(key), 'Officer removed from Task Force.');
            refreshInvestigatorUi();
        });
    });

    root.querySelectorAll('[data-inv-remove-plant]').forEach((button) => {
        button.addEventListener('click', async () => {
            const id = button.getAttribute('data-inv-remove-plant');
            await commitInvestigatorMutation(() => removeSurveillancePlant(id), 'Surveillance plant removed.');
            refreshInvestigatorUi();
        });
    });

    root.querySelectorAll('[data-inv-log-signal]').forEach((button) => {
        button.addEventListener('click', async () => {
            const id = button.getAttribute('data-inv-log-signal');
            const result = await commitInvestigatorMutation(
                () => logSurveillanceSignalAsEvidence(id),
                'Signal logged to evidence locker.',
            );
            if (!result || !result.applied) {
                globalThis.toastr?.warning?.(
                    result?.reason === 'already_logged' ? 'Signal already logged.' : 'Could not log signal.',
                );
            }
            refreshInvestigatorUi();
        });
    });

    root.querySelectorAll('[data-inv-end-interrogation]').forEach((button) => {
        button.addEventListener('click', async () => {
            const key = button.getAttribute('data-inv-end-interrogation');
            const result = await commitInvestigatorMutation(() => endInterrogation(key), 'Interrogation ended.');
            if (!result || !result.applied) {
                globalThis.toastr?.warning?.('No active interrogation for that subject.');
            }
            refreshInvestigatorUi();
        });
    });

    root.querySelectorAll('[data-inv-open-dn-registry]').forEach((button) => {
        button.addEventListener('click', async () => {
            try {
                const module = await import('../deathnote/ui.js');
                if (typeof module.openDeathNoteManageModal === 'function') {
                    module.openDeathNoteManageModal({ theme: 'terminal' });
                } else {
                    globalThis.toastr?.warning?.('Death Note registry is unavailable.');
                }
            } catch (error) {
                console.warn('[killer_within_investigator] Could not open Death Note registry', error);
                globalThis.toastr?.error?.('Could not open notebook registry.');
            }
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

    const debugToggle = root.querySelector('#kw-investigator-show-case-action-debug');
    if (debugToggle) {
        debugToggle.addEventListener('change', async () => {
            const settings = getInvestigatorSettings();
            settings.showCaseActionDebugBlocks = Boolean(debugToggle.checked);
            scheduleInvestigatorSettingsSave();
            if (syncAllCaseActionMessageVisibility()) {
                await persistChatChanges();
            }
            refreshInvestigatorUi();
        });
    }

    const casePromptField = root.querySelector('#kw-investigator-case-prompt-template');
    if (casePromptField) {
        casePromptField.addEventListener('change', () => {
            const settings = getInvestigatorSettings();
            settings.casePromptTemplate = String(casePromptField.value || '').trim() || DEFAULT_CASE_PROMPT_TEMPLATE;
            scheduleInvestigatorSettingsSave();
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
            } else if (kind === 'assign-officer') {
                const actor = parseActorJson(data.get('actorJson'));
                if (!actor?.name) {
                    return;
                }
                await commitInvestigatorMutation(
                    () => assignOfficer(actor, {
                        rank: String(data.get('rank') || 'Officer'),
                        clearance: String(data.get('clearance') || OFFICER_CLEARANCE.LEAD),
                    }),
                    'Task Force officer assigned.',
                );
            } else if (kind === 'warrant') {
                const actor = parseActorJson(data.get('actorJson'));
                if (!actor?.name) {
                    return;
                }
                const result = await commitInvestigatorMutation(
                    () => fileWarrant(actor, {
                        generations: data.get('generations'),
                        note: String(data.get('note') || ''),
                    }),
                    'Warrant filed.',
                );
                if (!result || !result.applied) {
                    globalThis.toastr?.warning?.(
                        result?.reason === 'already_pending'
                            ? 'A pending warrant already exists for that target.'
                            : result?.reason === 'trust_blocked'
                                ? `Task Force trust too low (${result.trust ?? getTaskForceTrust()}).`
                                : 'Could not file warrant.',
                    );
                }
            } else if (kind === 'confront') {
                const actor = parseActorJson(data.get('actorJson'));
                if (!actor?.name) {
                    return;
                }
                const result = await commitInvestigatorMutation(
                    () => confrontSuspect(actor, { note: String(data.get('note') || '') }),
                    'Confrontation logged.',
                );
                if (!result || !result.applied) {
                    globalThis.toastr?.warning?.(
                        result?.reason === 'insufficient_strength'
                            ? `Need case strength ≥ ${result.required || 2} (current ${result.strength ?? 0}).`
                            : result?.reason === 'trust_blocked'
                                ? `Task Force trust too low (${result.trust ?? getTaskForceTrust()}).`
                                : 'Confront blocked.',
                    );
                } else if (result.seizeUnlocked) {
                    globalThis.toastr?.success?.('Seize rights unlocked for this subject.');
                }
            } else if (kind === 'surveil') {
                const plantKind = String(data.get('kind') || SURVEILLANCE_KINDS.TRAIL);
                const actor = parseActorJson(data.get('actorJson'));
                const result = await commitInvestigatorMutation(
                    () => plantSurveillance({
                        kind: plantKind,
                        target: actor,
                        notebookItemId: String(data.get('notebookItemId') || ''),
                        location: String(data.get('location') || ''),
                    }),
                    'Surveillance plant deployed.',
                );
                if (!result || !result.applied) {
                    globalThis.toastr?.warning?.(
                        result?.reason === 'plant_cap'
                            ? 'Maximum active plants reached (3).'
                            : 'Could not plant surveillance.',
                    );
                }
            } else if (kind === 'analyze') {
                const result = await commitInvestigatorMutation(
                    () => analyzeVictimPattern({ note: String(data.get('note') || '') }),
                    'Pattern report filed.',
                );
                if (!result || !result.applied) {
                    globalThis.toastr?.warning?.(
                        result?.reason === 'duplicate_report'
                            ? 'Identical pattern report already exists.'
                            : 'Pattern analysis produced nothing new.',
                    );
                }
            } else if (kind === 'broadcast') {
                const result = await commitInvestigatorMutation(
                    () => createBroadcastTrap({
                        decoyName: String(data.get('decoyName') || ''),
                        challenge: String(data.get('challenge') || ''),
                    }),
                    'Broadcast trap armed.',
                );
                if (!result || !result.applied) {
                    globalThis.toastr?.warning?.('Could not arm broadcast trap.');
                }
            } else if (kind === 'interrogate') {
                const actor = parseActorJson(data.get('actorJson'));
                if (!actor?.name) {
                    return;
                }
                const result = await commitInvestigatorMutation(
                    () => startInterrogation(actor),
                    'Interrogation started. Matching replies will clip as statements.',
                );
                if (!result || !result.applied) {
                    globalThis.toastr?.warning?.(
                        result?.reason === 'already_active'
                            ? 'That subject is already under interrogation.'
                            : 'Could not start interrogation.',
                    );
                }
            } else if (kind === 'release-evidence') {
                const evidenceId = form.getAttribute('data-evidence-id');
                const destination = String(data.get('destination') || 'holder');
                const result = await commitInvestigatorMutation(
                    () => releaseSeizedEvidence(evidenceId, { toUser: destination === 'user' }),
                    'Evidence released from locker custody.',
                );
                if (!result || !result.applied) {
                    globalThis.toastr?.warning?.(
                        result?.reason === 'already_released'
                            ? 'That item is already released.'
                            : 'Could not release evidence.',
                    );
                }
                refreshDeathNoteUiHook?.();
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
}

export function refreshInvestigatorUi() {
    if (typeof document === 'undefined') {
        return;
    }
    const settings = getInvestigatorSettings();
    if (!Object.values(SCREENS).includes(settings.activeScreen)) {
        settings.activeScreen = SCREENS.BOARD;
    }

    const hub = ensureHub();
    const dock = ensureTaskForceDock();
    bindTaskForceDock(dock);
    bindHubInteractions(hub);

    // Keep the hub sized to the live visual viewport (keyboard / URL bar changes).
    if (hub) {
        applyHubViewportBox(hub);
    }

    // Stuck auto-close removed: it was tearing down healthy hubs on phones.
    // The floating Lock dock is the escape hatch.
}

export function setupInvestigatorUi() {
    getInvestigatorSettings();
    refreshInvestigatorUi();
    const onViewportChange = () => {
        if (!isInvestigatorRole()) {
            return;
        }
        const hub = document.getElementById(INVESTIGATOR_HUB_ID);
        if (hub && getInvestigatorSettings().hubOpen) {
            applyHubViewportBox(hub);
            return;
        }
        refreshInvestigatorUi();
    };
    window.addEventListener('resize', onViewportChange);
    window.visualViewport?.addEventListener?.('resize', onViewportChange);
    window.visualViewport?.addEventListener?.('scroll', onViewportChange);
}

export {
    openHub,
    closeHub,
    setActiveScreen,
    toggleHubFromDock,
    applyHubViewportBox,
    getViewportBox,
};
