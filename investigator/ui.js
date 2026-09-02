import {
    DEFAULT_CASE_PROMPT_TEMPLATE,
    EVIDENCE_TYPES,
    INVESTIGATOR_DOCK_ID,
    INVESTIGATOR_HUB_ID,
    OFFICER_CLEARANCE,
    PLAY_ROLES,
    SURVEILLANCE_KINDS,
    SURVEILLANCE_STATUS,
    SUSPECT_STATUSES,
} from './config.js';
import {
    analyzeVictimPattern,
    assignOfficer,
    commitInvestigatorMutation,
    confrontSuspect,
    createBroadcastTrap,
    fileWarrant,
    getBoardSuspectChoices,
    getCaseStrength,
    getInvestigatorSettings,
    getInvestigatorState,
    getInvestigatorVictimTimeline,
    getPlayRole,
    getSeizeCandidates,
    isInvestigatorRole,
    linkEvidenceToSuspect,
    logEvidence,
    logSurveillanceSignalAsEvidence,
    pinSuspect,
    plantSurveillance,
    releaseRestrainedActor,
    removeOfficer,
    removeSurveillancePlant,
    restrainActor,
    scheduleInvestigatorSettingsSave,
    seizeNotebook,
    seizeScrap,
    setPlayRole,
    setSuspectStatus,
    syncAllCaseActionMessageVisibility,
    syncDeathReportsIntoTimelineEvidence,
} from './core.js';
import { getDeathNotes, persistChatChanges } from '../deathnote/core.js';
import { NOTEBOOK_ACTOR_TYPES } from '../deathnote/config.js';

const MOBILE_VIEWPORT_MAX = 720;
const SCREENS = Object.freeze({
    BOARD: 'board',
    TIMELINE: 'timeline',
    LOCKER: 'locker',
    SURVEIL: 'surveil',
    OPS: 'ops',
});

let refreshDeathNoteUiHook = null;
let dockDragState = {
    dragging: false,
    moved: false,
    ignoreClick: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    pointerId: null,
    handlersInstalled: false,
    moveHandler: null,
    upHandler: null,
};

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

function renderNavHtml(activeScreen) {
    const items = [
        { id: SCREENS.BOARD, label: 'Board' },
        { id: SCREENS.TIMELINE, label: 'Timeline' },
        { id: SCREENS.LOCKER, label: 'Locker' },
        { id: SCREENS.SURVEIL, label: 'Surveil' },
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
                <p>Scroll for officers, warrants, confront, seize, and debug tools.</p>
            </header>
            <div class="kw-investigator-ops-scroll">
                <div class="kw-investigator-ops-grid">
                    <div class="kw-investigator-panel">
                        <div class="kw-investigator-subhead">Case file</div>
                        <div class="kw-investigator-row__meta">${escapeHtml(state.caseId)} · ${escapeHtml(state.caseTitle)}</div>
                        <label class="kw-investigator-field">
                            <span>Play role</span>
                            <select id="kw-investigator-play-role" class="text_pole">
                                <option value="${PLAY_ROLES.INVESTIGATOR}" selected>Investigator</option>
                                <option value="${PLAY_ROLES.KIRA}">Kira</option>
                            </select>
                        </label>
                        <button type="button" class="menu_button kw-investigator-btn kw-investigator-btn--block" data-inv-open-dn-registry>Open notebook registry (debug)</button>
                        <small class="kw-investigator-hint">Terminal-styled Death Note manager for debug peek / ownership tools.</small>
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
                                    <option value="${OFFICER_CLEARANCE.DETECTIVE}">Detective — + restrain / surveil / analyze</option>
                                    <option value="${OFFICER_CLEARANCE.LEAD}" selected>Lead — + warrant / confront / broadcast</option>
                                </select>
                            </label>
                            <button type="submit" class="menu_button kw-investigator-btn kw-investigator-btn--primary kw-investigator-btn--block">Assign officer</button>
                        </form>
                        <small class="kw-investigator-hint">Clearance gates which <code>kwCaseAction</code> verbs an officer may file.</small>
                        <div class="kw-investigator-list">${officersHtml}</div>
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
                        <small class="kw-investigator-hint">Needs case strength ≥ 2. Prime + strength ≥ 3 records probable cause (restrain still required to seize).</small>
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

function renderActiveScreen(settings, state) {
    switch (settings.activeScreen) {
        case SCREENS.TIMELINE:
            return renderTimelineScreen(state);
        case SCREENS.LOCKER:
            return renderLockerScreen(state);
        case SCREENS.SURVEIL:
            return renderSurveillanceScreen(state);
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
        <div class="kw-investigator-hub__room">
            <div class="kw-investigator-hub__bezel" aria-label="Task Force computer">
                <span class="kw-investigator-hub__screw kw-investigator-hub__screw--tl" aria-hidden="true"></span>
                <span class="kw-investigator-hub__screw kw-investigator-hub__screw--tr" aria-hidden="true"></span>
                <span class="kw-investigator-hub__screw kw-investigator-hub__screw--bl" aria-hidden="true"></span>
                <span class="kw-investigator-hub__screw kw-investigator-hub__screw--br" aria-hidden="true"></span>
                <div class="kw-investigator-hub__plate">
                    <span class="kw-investigator-hub__plate-mark">NPA</span>
                    <span class="kw-investigator-hub__plate-name">Task Force Terminal</span>
                </div>
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
                            <span>SECURE // LOCAL CASE STATE</span>
                        </footer>
                    </div>
                </div>
                <div class="kw-investigator-hub__hardware">
                    <span class="kw-investigator-hub__power-led" aria-hidden="true"></span>
                    <button type="button" class="kw-investigator-hub__power" data-inv-close title="Lock terminal">
                        ${mobile ? 'Lock' : 'Power / Lock'}
                    </button>
                    <span class="kw-investigator-hub__vent" aria-hidden="true"></span>
                </div>
            </div>
        </div>
    `;
}

function applyDockPosition(root) {
    if (!root) {
        return;
    }
    const settings = getInvestigatorSettings();
    const mobile = isMobileViewport();
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

    if (mobile) {
        root.style.left = '';
        root.style.top = '';
        root.style.right = '';
        root.style.bottom = '';
    } else {
        root.style.left = '';
        root.style.top = '';
        root.style.right = '';
        root.style.bottom = '';
    }
}

function ensureTaskForceDock() {
    let root = document.getElementById(INVESTIGATOR_DOCK_ID);
    document.getElementById('kw-investigator-session-bar')?.remove();
    document.getElementById('kw-investigator-workstation')?.remove();

    const settings = getInvestigatorSettings();
    const shouldShow = isInvestigatorRole() && !settings.hubOpen;

    if (!shouldShow) {
        if (root) {
            root.remove();
        }
        return null;
    }

    const state = getInvestigatorState();
    const mobile = isMobileViewport();

    if (!root) {
        root = document.createElement('div');
        root.id = INVESTIGATOR_DOCK_ID;
        document.body.append(root);
    }

    root.className = `kw-investigator-dock ${mobile ? 'is-mobile' : 'is-desktop'}`;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Task Force terminal');
    root.innerHTML = `
        <div class="kw-investigator-dock__shell">
            <button type="button" class="kw-investigator-dock__open" data-inv-wake data-inv-drag-handle="true">
                <span class="kw-investigator-dock__led" aria-hidden="true"></span>
                <span class="kw-investigator-dock__copy">
                    <span class="kw-investigator-dock__label">Task Force</span>
                    <span class="kw-investigator-dock__case">${escapeHtml(state.caseId)}</span>
                </span>
                <span class="kw-investigator-dock__action">Open</span>
            </button>
        </div>
    `;
    requestAnimationFrame(() => applyDockPosition(root));
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
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = buildHubHtml(settings, state);

    if (mobile) {
        root.style.left = '0';
        root.style.top = '0';
        root.style.right = '0';
        root.style.bottom = '0';
    } else {
        // Desktop: also immersive full-bleed terminal session (GTA computer sit-down).
        root.style.left = '0';
        root.style.top = '0';
        root.style.right = '0';
        root.style.bottom = '0';
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

async function handleRoleChange(nextRole) {
    const changed = setPlayRole(nextRole);
    if (!changed && getPlayRole() === nextRole) {
        return;
    }
    if (nextRole === PLAY_ROLES.INVESTIGATOR) {
        const settings = getInvestigatorSettings();
        settings.hubOpen = true;
        settings.hubCollapsed = false;
        scheduleInvestigatorSettingsSave();
    } else {
        const settings = getInvestigatorSettings();
        settings.hubOpen = false;
        scheduleInvestigatorSettingsSave();
    }
    refreshDeathNoteUiHook?.();
    refreshInvestigatorUi();
    globalThis.toastr?.info?.(
        nextRole === PLAY_ROLES.INVESTIGATOR
            ? 'Logging into Task Force terminal…'
            : 'Returned to Death Note tools.',
    );
}

function bindTaskForceDock(root) {
    if (!root) {
        return;
    }

    const handle = root.querySelector('[data-inv-drag-handle="true"]');
    if (!(handle instanceof HTMLElement)) {
        return;
    }

    handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 && event.pointerType === 'mouse') {
            return;
        }
        if (!event.isPrimary) {
            return;
        }

        event.preventDefault();
        const rect = root.getBoundingClientRect();
        dockDragState.dragging = true;
        dockDragState.moved = false;
        dockDragState.pointerId = event.pointerId;
        dockDragState.startX = event.clientX;
        dockDragState.startY = event.clientY;
        dockDragState.originX = rect.left;
        dockDragState.originY = rect.top;

        if (!dockDragState.handlersInstalled) {
            dockDragState.handlersInstalled = true;

            dockDragState.moveHandler = (moveEvent) => {
                if (!dockDragState.dragging) {
                    return;
                }
                if (dockDragState.pointerId !== null && moveEvent.pointerId !== dockDragState.pointerId) {
                    return;
                }
                const activeRoot = document.getElementById(INVESTIGATOR_DOCK_ID);
                if (!activeRoot) {
                    return;
                }

                const dx = moveEvent.clientX - dockDragState.startX;
                const dy = moveEvent.clientY - dockDragState.startY;
                if (Math.abs(dx) + Math.abs(dy) > 4) {
                    dockDragState.moved = true;
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
                dockDragState.dragging = false;
                dockDragState.pointerId = null;
                dockDragState.ignoreClick = dockDragState.moved;

                if (activeRoot && dockDragState.moved) {
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
            };

            window.addEventListener('pointermove', dockDragState.moveHandler, true);
            window.addEventListener('pointerup', dockDragState.upHandler, true);
            window.addEventListener('pointercancel', dockDragState.upHandler, true);
        }
    });

    handle.addEventListener('click', (event) => {
        if (dockDragState.ignoreClick) {
            dockDragState.ignoreClick = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        event.preventDefault();
        openHub();
    });
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
    const settings = getInvestigatorSettings();
    if (!Object.values(SCREENS).includes(settings.activeScreen)) {
        settings.activeScreen = SCREENS.BOARD;
    }

    const dock = ensureTaskForceDock();
    const hub = ensureHub();
    bindTaskForceDock(dock);
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
