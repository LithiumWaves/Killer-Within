import {
    CASE_ACTIONS,
    CASE_ACTION_BLOCK_TAG,
    DEFAULT_CASE_PROMPT_TEMPLATE,
    DEFAULT_INVESTIGATOR_SETTINGS,
    EVIDENCE_TYPES,
    INVESTIGATOR_CHAT_METADATA_KEY,
    INVESTIGATOR_MESSAGE_EXTRA_KEY,
    INVESTIGATOR_MODULE_NAME,
    PLAY_ROLES,
    SUSPECT_STATUSES,
} from './config.js';
import {
    NOTEBOOK_ACTOR_TYPES,
    NOTEBOOK_USER_ACCESS,
    MODULE_NAME as DEATHNOTE_MODULE_NAME,
} from '../deathnote/config.js';
import {
    getChatState as getDeathNoteChatState,
    getCharacterActorForMessage,
    getContext,
    getDeathNoteInventory,
    getDeathNotes,
    getNotebookOwnership,
    getNotebookPages,
    getSettings as getDeathNoteSettings,
    persistChatChanges,
    scheduleSettingsSave as scheduleDeathNoteSettingsSave,
    transferNotebookTo,
    transferNotebookScrap,
    getCharacterNameDirectory,
} from '../deathnote/core.js';

function createDefaultInvestigatorState() {
    return {
        version: 2,
        caseId: `TF-${String(Date.now()).slice(-6)}`,
        caseTitle: 'Kira Case File',
        suspects: [],
        evidence: [],
        restrained: [],
        officers: [],
        seizedNotebookIds: [],
        seizedScrapIds: [],
        log: [],
    };
}

function normalizeActorRef(actor, fallbackType = NOTEBOOK_ACTOR_TYPES.NONE, fallbackName = '') {
    const source = actor && typeof actor === 'object' ? actor : {};
    const type = String(source.type || fallbackType || NOTEBOOK_ACTOR_TYPES.NONE).trim().toLowerCase()
        || fallbackType
        || NOTEBOOK_ACTOR_TYPES.NONE;
    return {
        type,
        id: String(source.id || '').trim(),
        name: String(source.name || fallbackName || '').trim(),
    };
}

function normalizeKnowledgeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getActorKey(actor) {
    const normalized = normalizeActorRef(actor);
    const id = normalizeKnowledgeKey(normalized.id);
    if (id) {
        return `id:${id}`;
    }
    const name = normalizeKnowledgeKey(normalized.name);
    if (name) {
        return `name:${name}`;
    }
    return '';
}

function normalizeSuspect(value, index = 0) {
    const entry = value && typeof value === 'object' ? value : {};
    const actor = normalizeActorRef(entry.actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const key = String(entry.key || getActorKey(actor) || `suspect-${index + 1}`).trim();
    const statusRaw = String(entry.status || SUSPECT_STATUSES.PERSON_OF_INTEREST).trim().toLowerCase();
    const status = Object.values(SUSPECT_STATUSES).includes(statusRaw)
        ? statusRaw
        : SUSPECT_STATUSES.PERSON_OF_INTEREST;
    const linkedEvidenceIds = Array.isArray(entry.linkedEvidenceIds)
        ? entry.linkedEvidenceIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [];
    return {
        key,
        actor,
        status,
        notes: String(entry.notes || '').trim(),
        linkedEvidenceIds,
        pinnedAt: Number.isFinite(Number(entry.pinnedAt)) ? Number(entry.pinnedAt) : Date.now(),
    };
}

function normalizeEvidence(value, index = 0) {
    const entry = value && typeof value === 'object' ? value : {};
    const typeRaw = String(entry.type || EVIDENCE_TYPES.OTHER).trim().toLowerCase();
    const type = Object.values(EVIDENCE_TYPES).includes(typeRaw) ? typeRaw : EVIDENCE_TYPES.OTHER;
    return {
        id: String(entry.id || `ev-${index + 1}-${Date.now()}`).trim(),
        type,
        title: String(entry.title || 'Evidence').trim() || 'Evidence',
        detail: String(entry.detail || '').trim(),
        source: String(entry.source || 'manual').trim() || 'manual',
        linkedSuspectKeys: Array.isArray(entry.linkedSuspectKeys)
            ? entry.linkedSuspectKeys.map((key) => String(key || '').trim()).filter(Boolean)
            : [],
        itemRef: entry.itemRef && typeof entry.itemRef === 'object'
            ? {
                kind: String(entry.itemRef.kind || '').trim(),
                id: String(entry.itemRef.id || '').trim(),
                label: String(entry.itemRef.label || '').trim(),
                snapshot: String(entry.itemRef.snapshot || ''),
            }
            : null,
        createdAt: Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : Date.now(),
    };
}

function normalizeRestrained(value, index = 0) {
    const entry = value && typeof value === 'object' ? value : {};
    const actor = normalizeActorRef(entry.actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const key = String(entry.key || getActorKey(actor) || `restrained-${index + 1}`).trim();
    return {
        key,
        actor,
        reason: String(entry.reason || '').trim(),
        restrainedAt: Number.isFinite(Number(entry.restrainedAt)) ? Number(entry.restrainedAt) : Date.now(),
    };
}

function normalizeOfficer(value, index = 0) {
    const entry = value && typeof value === 'object' ? value : {};
    const actor = normalizeActorRef(entry.actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const key = String(entry.key || getActorKey(actor) || `officer-${index + 1}`).trim();
    return {
        key,
        actor,
        rank: String(entry.rank || 'Officer').trim() || 'Officer',
        notes: String(entry.notes || '').trim(),
        assignedAt: Number.isFinite(Number(entry.assignedAt)) ? Number(entry.assignedAt) : Date.now(),
    };
}

function normalizeInvestigatorState(value) {
    const defaults = createDefaultInvestigatorState();
    const state = value && typeof value === 'object' ? value : {};
    return {
        version: 2,
        caseId: String(state.caseId || defaults.caseId).trim() || defaults.caseId,
        caseTitle: String(state.caseTitle || defaults.caseTitle).trim() || defaults.caseTitle,
        suspects: (Array.isArray(state.suspects) ? state.suspects : []).map(normalizeSuspect),
        evidence: (Array.isArray(state.evidence) ? state.evidence : []).map(normalizeEvidence),
        restrained: (Array.isArray(state.restrained) ? state.restrained : []).map(normalizeRestrained),
        officers: (Array.isArray(state.officers) ? state.officers : []).map(normalizeOfficer),
        seizedNotebookIds: (Array.isArray(state.seizedNotebookIds) ? state.seizedNotebookIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean),
        seizedScrapIds: (Array.isArray(state.seizedScrapIds) ? state.seizedScrapIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean),
        log: (Array.isArray(state.log) ? state.log : []).slice(-80).map((entry, index) => ({
            id: String(entry?.id || `log-${index}`).trim(),
            at: Number.isFinite(Number(entry?.at)) ? Number(entry.at) : Date.now(),
            text: String(entry?.text || '').trim(),
        })),
    };
}

function bindInvestigatorChatState(context) {
    if (!context) {
        return createDefaultInvestigatorState();
    }
    context.chatMetadata ??= {};
    if (!context.chatMetadata[INVESTIGATOR_CHAT_METADATA_KEY]
        || typeof context.chatMetadata[INVESTIGATOR_CHAT_METADATA_KEY] !== 'object') {
        context.chatMetadata[INVESTIGATOR_CHAT_METADATA_KEY] = createDefaultInvestigatorState();
    }
    const state = normalizeInvestigatorState(context.chatMetadata[INVESTIGATOR_CHAT_METADATA_KEY]);
    Object.assign(context.chatMetadata[INVESTIGATOR_CHAT_METADATA_KEY], state);
    return context.chatMetadata[INVESTIGATOR_CHAT_METADATA_KEY];
}

export function getInvestigatorState() {
    return bindInvestigatorChatState(getContext());
}

export function getInvestigatorSettings() {
    const context = getContext();
    if (!context) {
        return structuredClone(DEFAULT_INVESTIGATOR_SETTINGS);
    }
    context.extensionSettings[INVESTIGATOR_MODULE_NAME] ??= {};
    const settings = context.extensionSettings[INVESTIGATOR_MODULE_NAME];
    for (const [key, value] of Object.entries(DEFAULT_INVESTIGATOR_SETTINGS)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = value;
        }
    }
    return settings;
}

export function scheduleInvestigatorSettingsSave() {
    try {
        getContext()?.saveSettingsDebounced?.();
    } catch (_error) {
        // Ignore settings save failures.
    }
}

export function getPlayRole() {
    const context = getContext();
    const deathnoteSettings = context?.extensionSettings?.[DEATHNOTE_MODULE_NAME];
    const role = String(deathnoteSettings?.playRole || PLAY_ROLES.KIRA).trim().toLowerCase();
    return role === PLAY_ROLES.INVESTIGATOR ? PLAY_ROLES.INVESTIGATOR : PLAY_ROLES.KIRA;
}

export function isInvestigatorRole() {
    return getPlayRole() === PLAY_ROLES.INVESTIGATOR;
}

export function isKiraRole() {
    return getPlayRole() === PLAY_ROLES.KIRA;
}

export function setPlayRole(role) {
    const settings = getDeathNoteSettings();
    const next = String(role || '').trim().toLowerCase() === PLAY_ROLES.INVESTIGATOR
        ? PLAY_ROLES.INVESTIGATOR
        : PLAY_ROLES.KIRA;
    const previous = getPlayRole();
    settings.playRole = next;
    if (next === PLAY_ROLES.INVESTIGATOR) {
        settings.isOpen = false;
    }
    scheduleDeathNoteSettingsSave();
    return previous !== next;
}

function pushCaseLog(state, text) {
    state.log.push({
        id: crypto.randomUUID?.() ?? `log-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        at: Date.now(),
        text: String(text || '').trim(),
    });
    if (state.log.length > 80) {
        state.log = state.log.slice(-80);
    }
}

export function getInvestigatorVictimTimeline() {
    const deathState = getDeathNoteChatState();
    const entries = Array.isArray(deathState?.entries) ? deathState.entries : [];
    return entries
        .filter((entry) => String(entry?.status || '').toLowerCase() === 'resolved')
        .slice()
        .sort((left, right) => (Number(left.resolvedAt) || 0) - (Number(right.resolvedAt) || 0))
        .map((entry) => ({
            id: String(entry.id || '').trim(),
            targetName: String(entry.targetName || 'Unknown').trim() || 'Unknown',
            targetType: String(entry.targetType || '').trim(),
            cause: String(entry.cause || 'heart attack').trim() || 'heart attack',
            noteText: String(entry.noteText || '').trim(),
            resolvedAt: Number(entry.resolvedAt) || null,
            createdAt: Number(entry.createdAt) || null,
        }));
}

export function pinSuspect(actor, options = {}) {
    const state = getInvestigatorState();
    const normalized = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const key = getActorKey(normalized);
    if (!key || !normalized.name) {
        return { applied: false, reason: 'invalid_actor' };
    }

    const existingIndex = state.suspects.findIndex((entry) => entry.key === key);
    const status = Object.values(SUSPECT_STATUSES).includes(String(options.status || '').trim().toLowerCase())
        ? String(options.status).trim().toLowerCase()
        : SUSPECT_STATUSES.PERSON_OF_INTEREST;

    if (existingIndex >= 0) {
        state.suspects[existingIndex] = normalizeSuspect({
            ...state.suspects[existingIndex],
            status: options.status ? status : state.suspects[existingIndex].status,
            notes: Object.hasOwn(options, 'notes')
                ? String(options.notes || '')
                : state.suspects[existingIndex].notes,
        }, existingIndex);
        pushCaseLog(state, `Updated board pin: ${normalized.name} (${state.suspects[existingIndex].status}).`);
        return { applied: true, reason: 'updated', suspect: state.suspects[existingIndex] };
    }

    const suspect = normalizeSuspect({
        key,
        actor: normalized,
        status,
        notes: String(options.notes || '').trim(),
        pinnedAt: Date.now(),
    });
    state.suspects.push(suspect);
    pushCaseLog(state, `Pinned suspect: ${normalized.name}.`);
    return { applied: true, reason: 'created', suspect };
}

export function setSuspectStatus(suspectKey, status) {
    const state = getInvestigatorState();
    const key = String(suspectKey || '').trim();
    const nextStatus = String(status || '').trim().toLowerCase();
    if (!Object.values(SUSPECT_STATUSES).includes(nextStatus)) {
        return { applied: false, reason: 'invalid_status' };
    }
    const suspect = state.suspects.find((entry) => entry.key === key);
    if (!suspect) {
        return { applied: false, reason: 'missing_suspect' };
    }
    suspect.status = nextStatus;
    pushCaseLog(state, `Suspect ${suspect.actor?.name || key} marked ${nextStatus}.`);
    return { applied: true, suspect };
}

export function logEvidence(options = {}) {
    const state = getInvestigatorState();
    const evidence = normalizeEvidence({
        id: crypto.randomUUID?.() ?? `ev-${Date.now()}`,
        type: options.type || EVIDENCE_TYPES.MANUAL_LOG,
        title: options.title || 'Case log',
        detail: options.detail || '',
        source: options.source || 'manual',
        linkedSuspectKeys: options.linkedSuspectKeys || [],
        itemRef: options.itemRef || null,
        createdAt: Date.now(),
    });
    state.evidence.unshift(evidence);
    if (state.evidence.length > 120) {
        state.evidence = state.evidence.slice(0, 120);
    }
    pushCaseLog(state, `Logged evidence: ${evidence.title}.`);
    return { applied: true, evidence };
}

export function linkEvidenceToSuspect(evidenceId, suspectKey) {
    const state = getInvestigatorState();
    const evidence = state.evidence.find((entry) => entry.id === String(evidenceId || '').trim());
    const suspect = state.suspects.find((entry) => entry.key === String(suspectKey || '').trim());
    if (!evidence || !suspect) {
        return { applied: false, reason: 'missing' };
    }
    if (!evidence.linkedSuspectKeys.includes(suspect.key)) {
        evidence.linkedSuspectKeys.push(suspect.key);
    }
    if (!suspect.linkedEvidenceIds.includes(evidence.id)) {
        suspect.linkedEvidenceIds.push(evidence.id);
    }
    pushCaseLog(state, `Linked evidence "${evidence.title}" → ${suspect.actor?.name || suspect.key}.`);
    return { applied: true };
}

export function restrainActor(actor, options = {}) {
    const state = getInvestigatorState();
    const normalized = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const key = getActorKey(normalized);
    if (!key || !normalized.name) {
        return { applied: false, reason: 'invalid_actor' };
    }
    const existing = state.restrained.find((entry) => entry.key === key);
    if (existing) {
        existing.reason = String(options.reason || existing.reason || '').trim();
        return { applied: true, reason: 'already_restrained', entry: existing };
    }
    const entry = normalizeRestrained({
        key,
        actor: normalized,
        reason: String(options.reason || 'Restrained in-scene for Task Force custody.').trim(),
        restrainedAt: Date.now(),
    });
    state.restrained.push(entry);
    pushCaseLog(state, `Marked restrained: ${normalized.name}.`);
    return { applied: true, entry };
}

export function releaseRestrainedActor(actorOrKey) {
    const state = getInvestigatorState();
    const key = typeof actorOrKey === 'string'
        ? String(actorOrKey || '').trim()
        : getActorKey(actorOrKey);
    const before = state.restrained.length;
    state.restrained = state.restrained.filter((entry) => entry.key !== key);
    if (state.restrained.length === before) {
        return { applied: false, reason: 'not_restrained' };
    }
    pushCaseLog(state, `Released restraint: ${key}.`);
    return { applied: true };
}

export function isActorRestrained(actor) {
    const key = getActorKey(actor);
    if (!key) {
        return false;
    }
    return getInvestigatorState().restrained.some((entry) => entry.key === key);
}

function taskForceEvidenceActor() {
    return {
        type: NOTEBOOK_ACTOR_TYPES.WORLD,
        id: 'task-force-evidence',
        name: 'Task Force Evidence',
    };
}

export function seizeNotebook(notebookId, options = {}) {
    if (!isInvestigatorRole()) {
        return { applied: false, reason: 'not_investigator' };
    }

    const notebooks = getDeathNotes();
    const notebook = notebooks.find((entry) => entry && entry.itemId === String(notebookId || '').trim());
    if (!notebook || notebook.destroyed || !notebook.exists) {
        return { applied: false, reason: 'missing_notebook' };
    }

    const holder = normalizeActorRef(notebook.holder, NOTEBOOK_ACTOR_TYPES.NONE, '');
    if (holder.type !== NOTEBOOK_ACTOR_TYPES.CHARACTER && holder.type !== NOTEBOOK_ACTOR_TYPES.NPC) {
        return { applied: false, reason: 'not_character_held' };
    }
    if (!isActorRestrained(holder)) {
        return { applied: false, reason: 'not_restrained' };
    }

    const ownership = getNotebookOwnership(notebook.itemId);
    const pages = getNotebookPages(notebook.itemId);
    const snapshot = (Array.isArray(pages) ? pages : []).join('\n\n');

    const transferred = transferNotebookTo(taskForceEvidenceActor(), {
        notebookItemId: notebook.itemId,
        owner: ownership.owner,
        userAccess: NOTEBOOK_USER_ACCESS.NONE,
        exists: true,
        reason: String(options.reason || '').trim()
            || `Task Force seized ${notebook.label || 'Death Note'} from ${holder.name || 'suspect'} while restrained.`,
    });
    if (!transferred) {
        return { applied: false, reason: 'transfer_failed' };
    }

    // Mark evidence custody on live notebook object.
    const deathState = getDeathNoteChatState();
    const live = (deathState.notebooks || []).find((entry) => entry?.itemId === notebook.itemId);
    if (live) {
        live.evidenceCustody = true;
        live.updatedAt = Date.now();
    }

    const state = getInvestigatorState();
    if (!state.seizedNotebookIds.includes(notebook.itemId)) {
        state.seizedNotebookIds.push(notebook.itemId);
    }

    const evidence = logEvidence({
        type: EVIDENCE_TYPES.NOTEBOOK,
        title: `Seized: ${notebook.label || 'Death Note'}`,
        detail: `Recovered from restrained subject ${holder.name || holder.type}. Pages sealed in evidence locker.`,
        source: 'seize',
        linkedSuspectKeys: [getActorKey(holder)].filter(Boolean),
        itemRef: {
            kind: 'notebook',
            id: notebook.itemId,
            label: notebook.label || 'Death Note',
            snapshot,
        },
    }).evidence;

    // Auto-pin holder as prime if not cleared.
    pinSuspect(holder, { status: SUSPECT_STATUSES.PRIME });
    linkEvidenceToSuspect(evidence.id, getActorKey(holder));

    pushCaseLog(state, `SEIZE success: ${notebook.label || notebook.itemId} from ${holder.name}.`);
    return {
        applied: true,
        notebookItemId: notebook.itemId,
        evidence,
        holder,
    };
}

export function seizeScrap(scrapId, options = {}) {
    if (!isInvestigatorRole()) {
        return { applied: false, reason: 'not_investigator' };
    }

    const inventory = getDeathNoteInventory();
    const scrap = (inventory.scraps || []).find((entry) => entry && entry.id === String(scrapId || '').trim() && entry.active);
    if (!scrap) {
        return { applied: false, reason: 'missing_scrap' };
    }

    const holder = normalizeActorRef(scrap.holder, NOTEBOOK_ACTOR_TYPES.NONE, '');
    if (holder.type !== NOTEBOOK_ACTOR_TYPES.CHARACTER && holder.type !== NOTEBOOK_ACTOR_TYPES.NPC) {
        return { applied: false, reason: 'not_character_held' };
    }
    if (!isActorRestrained(holder)) {
        return { applied: false, reason: 'not_restrained' };
    }

    const moved = transferNotebookScrap(scrap.id, taskForceEvidenceActor(), {
        userAccess: NOTEBOOK_USER_ACCESS.NONE,
        reason: String(options.reason || '').trim()
            || `Task Force seized scrap from ${holder.name || 'suspect'} while restrained.`,
    });
    if (!moved) {
        return { applied: false, reason: 'transfer_failed' };
    }

    const state = getInvestigatorState();
    if (!state.seizedScrapIds.includes(scrap.id)) {
        state.seizedScrapIds.push(scrap.id);
    }

    const evidence = logEvidence({
        type: EVIDENCE_TYPES.SCRAP,
        title: `Seized scrap: ${scrap.label || scrap.id}`,
        detail: String(scrap.noteText || '').trim() || 'Blank scrap recovered.',
        source: 'seize',
        linkedSuspectKeys: [getActorKey(holder)].filter(Boolean),
        itemRef: {
            kind: 'scrap',
            id: scrap.id,
            label: scrap.label || 'Scrap',
            snapshot: String(scrap.noteText || ''),
        },
    }).evidence;

    pinSuspect(holder, { status: SUSPECT_STATUSES.PRIME });
    linkEvidenceToSuspect(evidence.id, getActorKey(holder));
    pushCaseLog(state, `SEIZE scrap success from ${holder.name}.`);
    return { applied: true, scrapId: scrap.id, evidence, holder };
}

export function syncDeathReportsIntoTimelineEvidence() {
    const state = getInvestigatorState();
    const timeline = getInvestigatorVictimTimeline();
    let added = 0;
    for (const death of timeline) {
        const title = `Death report: ${death.targetName}`;
        const already = state.evidence.some((entry) => (
            entry.type === EVIDENCE_TYPES.DEATH_REPORT
            && entry.title === title
            && String(entry.detail || '').includes(String(death.id || ''))
        ));
        if (already) {
            continue;
        }
        logEvidence({
            type: EVIDENCE_TYPES.DEATH_REPORT,
            title,
            detail: [
                `Entry ID: ${death.id || 'unknown'}`,
                `Cause: ${death.cause}`,
                death.resolvedAt ? `Resolved: ${new Date(death.resolvedAt).toISOString()}` : '',
                death.noteText ? `Note line: ${death.noteText}` : '',
            ].filter(Boolean).join('\n'),
            source: 'auto_death_report',
        });
        added += 1;
    }
    return { added };
}

export function getSeizeCandidates() {
    const inventory = getDeathNoteInventory();
    const restrainedKeys = new Set(getInvestigatorState().restrained.map((entry) => entry.key));
    const notebooks = (inventory.notebooks || [])
        .filter((entry) => entry && !entry.destroyed && entry.exists)
        .filter((entry) => {
            const holder = normalizeActorRef(entry.holder);
            return (holder.type === NOTEBOOK_ACTOR_TYPES.CHARACTER || holder.type === NOTEBOOK_ACTOR_TYPES.NPC)
                && restrainedKeys.has(getActorKey(holder));
        });
    const scraps = (inventory.scraps || [])
        .filter((entry) => entry && entry.active)
        .filter((entry) => {
            const holder = normalizeActorRef(entry.holder);
            return (holder.type === NOTEBOOK_ACTOR_TYPES.CHARACTER || holder.type === NOTEBOOK_ACTOR_TYPES.NPC)
                && restrainedKeys.has(getActorKey(holder));
        });
    return { notebooks, scraps };
}

export function getBoardSuspectChoices() {
    return getCharacterNameDirectory()
        .map((entry) => entry.actor)
        .filter((actor) => actor && actor.type === NOTEBOOK_ACTOR_TYPES.CHARACTER);
}

export async function commitInvestigatorMutation(mutate, successMessage = '') {
    try {
        const result = await mutate();
        if (!result) {
            return false;
        }
        await persistChatChanges();
        if (successMessage && globalThis.toastr?.success) {
            globalThis.toastr.success(successMessage);
        }
        return result;
    } catch (error) {
        console.error('[killer_within_investigator] Action failed', error);
        globalThis.toastr?.error?.(error?.message || 'Investigator action failed.');
        return false;
    }
}

export function assignOfficer(actor, options = {}) {
    const state = getInvestigatorState();
    const normalized = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const key = getActorKey(normalized);
    if (!key || !normalized.name || normalized.type !== NOTEBOOK_ACTOR_TYPES.CHARACTER) {
        return { applied: false, reason: 'invalid_actor' };
    }

    const existingIndex = state.officers.findIndex((entry) => entry.key === key);
    if (existingIndex >= 0) {
        state.officers[existingIndex] = normalizeOfficer({
            ...state.officers[existingIndex],
            rank: Object.hasOwn(options, 'rank') ? options.rank : state.officers[existingIndex].rank,
            notes: Object.hasOwn(options, 'notes') ? options.notes : state.officers[existingIndex].notes,
        }, existingIndex);
        pushCaseLog(state, `Updated Task Force officer: ${normalized.name}.`);
        return { applied: true, reason: 'updated', officer: state.officers[existingIndex] };
    }

    const officer = normalizeOfficer({
        key,
        actor: normalized,
        rank: String(options.rank || 'Officer').trim() || 'Officer',
        notes: String(options.notes || '').trim(),
        assignedAt: Date.now(),
    });
    state.officers.push(officer);
    pushCaseLog(state, `Assigned Task Force officer: ${normalized.name}.`);
    return { applied: true, reason: 'created', officer };
}

export function removeOfficer(actorOrKey) {
    const state = getInvestigatorState();
    const key = typeof actorOrKey === 'string'
        ? String(actorOrKey || '').trim()
        : getActorKey(actorOrKey);
    const before = state.officers.length;
    state.officers = state.officers.filter((entry) => entry.key !== key);
    if (state.officers.length === before) {
        return { applied: false, reason: 'missing_officer' };
    }
    pushCaseLog(state, `Removed Task Force officer: ${key}.`);
    return { applied: true };
}

export function isTaskForceOfficer(actor) {
    const key = getActorKey(actor);
    if (!key) {
        return false;
    }
    return getInvestigatorState().officers.some((entry) => entry.key === key);
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureInvestigatorMessageExtra(message) {
    if (!message || typeof message !== 'object') {
        return null;
    }
    message.extra ??= {};
    if (!message.extra[INVESTIGATOR_MESSAGE_EXTRA_KEY] || typeof message.extra[INVESTIGATOR_MESSAGE_EXTRA_KEY] !== 'object') {
        message.extra[INVESTIGATOR_MESSAGE_EXTRA_KEY] = {};
    }
    return message.extra[INVESTIGATOR_MESSAGE_EXTRA_KEY];
}

function extractCaseActionBlocks(text) {
    const source = String(text ?? '');
    if (!source) {
        return { blocks: [], strippedText: source };
    }
    const tag = escapeRegExp(CASE_ACTION_BLOCK_TAG);
    const regex = new RegExp(`(?:<${tag}>|\\[${tag}\\])\\s*([\\s\\S]*?)\\s*(?:<\\/${tag}>|\\[\\/${tag}\\])`, 'gi');
    const blocks = [];
    let match = regex.exec(source);
    while (match) {
        blocks.push({
            rawBlock: String(match[0] || ''),
            body: String(match[1] || ''),
        });
        match = regex.exec(source);
    }
    if (!blocks.length) {
        return { blocks, strippedText: source };
    }
    const strippedText = source
        .replace(new RegExp(`\\s*(?:<${tag}>|\\[${tag}\\])\\s*[\\s\\S]*?\\s*(?:<\\/${tag}>|\\[\\/${tag}\\])`, 'gi'), '')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd();
    return { blocks, strippedText };
}

function parseCaseActionBlock(blockBody) {
    const fields = {
        officer: '',
        action: '',
        target: '',
        status: '',
        title: '',
        detail: '',
        reason: '',
        type: '',
    };
    for (const line of String(blockBody ?? '').split(/\r?\n/)) {
        const match = line.match(/^\s*([a-z_]+)\s*:\s*(.+?)\s*$/i);
        if (!match) {
            continue;
        }
        const key = String(match[1] || '').trim().toLowerCase();
        const value = String(match[2] || '').trim();
        if (Object.hasOwn(fields, key)) {
            fields[key] = value;
        }
    }
    fields.action = String(fields.action || '').trim().toLowerCase();
    fields.status = String(fields.status || '').trim().toLowerCase();
    fields.type = String(fields.type || '').trim().toLowerCase();
    return fields;
}

function resolveTargetActorByName(name) {
    const search = normalizeKnowledgeKey(name);
    if (!search) {
        return null;
    }
    const choices = getCharacterNameDirectory()
        .map((entry) => entry.actor)
        .filter((actor) => actor && actor.type === NOTEBOOK_ACTOR_TYPES.CHARACTER);
    const match = choices.find((actor) => normalizeKnowledgeKey(actor.name) === search);
    if (match) {
        return normalizeActorRef(match, NOTEBOOK_ACTOR_TYPES.CHARACTER, match.name);
    }
    return normalizeActorRef({
        type: NOTEBOOK_ACTOR_TYPES.CHARACTER,
        name: String(name || '').trim(),
    }, NOTEBOOK_ACTOR_TYPES.CHARACTER, String(name || '').trim());
}

export function applyCaseAction(parsed, speaker) {
    const action = String(parsed?.action || '').trim().toLowerCase();
    if (!Object.values(CASE_ACTIONS).includes(action)) {
        return { applied: false, reason: 'invalid_action' };
    }
    if (!isTaskForceOfficer(speaker)) {
        return { applied: false, reason: 'not_officer' };
    }
    if (normalizeKnowledgeKey(parsed.officer) !== normalizeKnowledgeKey(speaker.name)) {
        return { applied: false, reason: 'officer_mismatch' };
    }

    if (action === CASE_ACTIONS.LOG) {
        const evidence = logEvidence({
            type: Object.values(EVIDENCE_TYPES).includes(parsed.type) ? parsed.type : EVIDENCE_TYPES.STATEMENT,
            title: parsed.title || `Officer report: ${speaker.name}`,
            detail: parsed.detail || parsed.reason || '',
            source: `officer:${speaker.name}`,
        }).evidence;
        return { applied: true, reason: 'logged', evidence };
    }

    if (action === CASE_ACTIONS.PIN) {
        const target = resolveTargetActorByName(parsed.target);
        if (!target?.name) {
            return { applied: false, reason: 'missing_target' };
        }
        const result = pinSuspect(target, {
            status: parsed.status || SUSPECT_STATUSES.PERSON_OF_INTEREST,
            notes: parsed.detail || parsed.reason || `Pinned by officer ${speaker.name}.`,
        });
        return { applied: Boolean(result.applied), reason: result.reason || 'pinned', suspect: result.suspect };
    }

    if (action === CASE_ACTIONS.STATUS) {
        const target = resolveTargetActorByName(parsed.target);
        if (!target?.name) {
            return { applied: false, reason: 'missing_target' };
        }
        const key = getActorKey(target);
        let suspect = getInvestigatorState().suspects.find((entry) => entry.key === key);
        if (!suspect) {
            pinSuspect(target, { status: parsed.status || SUSPECT_STATUSES.PERSON_OF_INTEREST });
            suspect = getInvestigatorState().suspects.find((entry) => entry.key === key);
        }
        if (!suspect) {
            return { applied: false, reason: 'missing_suspect' };
        }
        const result = setSuspectStatus(suspect.key, parsed.status || SUSPECT_STATUSES.PERSON_OF_INTEREST);
        return { applied: Boolean(result.applied), reason: result.reason || 'status_updated', suspect: result.suspect };
    }

    if (action === CASE_ACTIONS.RESTRAIN) {
        const target = resolveTargetActorByName(parsed.target);
        if (!target?.name) {
            return { applied: false, reason: 'missing_target' };
        }
        const result = restrainActor(target, {
            reason: parsed.reason || parsed.detail || `Restrained by officer ${speaker.name}.`,
        });
        return { applied: Boolean(result.applied), reason: result.reason || 'restrained', entry: result.entry };
    }

    if (action === CASE_ACTIONS.RELEASE) {
        const target = resolveTargetActorByName(parsed.target);
        if (!target?.name) {
            return { applied: false, reason: 'missing_target' };
        }
        const result = releaseRestrainedActor(target);
        return { applied: Boolean(result.applied), reason: result.reason || 'released' };
    }

    return { applied: false, reason: 'unhandled_action' };
}

function syncCaseActionMessageVisibility(message, metadata = null) {
    const extra = ensureInvestigatorMessageExtra(message);
    const caseAction = metadata || extra?.caseAction;
    if (!caseAction?.processed) {
        return false;
    }
    const settings = getInvestigatorSettings();
    const showBlock = Boolean(settings.showCaseActionDebugBlocks);
    const rawMessage = String(caseAction.rawMessage || '');
    const strippedText = String(caseAction.strippedText || '');
    const nextText = showBlock
        ? (rawMessage || String(message.mes ?? ''))
        : (strippedText || String(message.mes ?? ''));
    if (String(message.mes ?? '') === nextText) {
        caseAction.stripped = !showBlock;
        return false;
    }
    message.mes = nextText;
    caseAction.stripped = !showBlock;
    return true;
}

export function processAssistantCaseActionMessage(messageIndex) {
    const context = getContext();
    const chat = context && Array.isArray(context.chat) ? context.chat : [];
    const index = Number(messageIndex);
    if (!Number.isInteger(index) || index < 0 || index >= chat.length) {
        return false;
    }

    const message = chat[index];
    if (!message || message.is_system || message.is_user) {
        return false;
    }

    const extra = ensureInvestigatorMessageExtra(message);
    if (extra?.caseAction?.processed) {
        return syncCaseActionMessageVisibility(message, extra.caseAction);
    }

    const rawText = String(message.mes ?? '');
    const extracted = extractCaseActionBlocks(rawText);
    if (!extracted.blocks.length) {
        return false;
    }

    const settings = getInvestigatorSettings();
    const speaker = getCharacterActorForMessage(message);
    const metadata = {
        processed: true,
        rawMessage: rawText,
        strippedText: extracted.strippedText,
        rawBlock: extracted.blocks[0].rawBlock,
        officer: '',
        action: '',
        applied: false,
        reason: '',
        stripped: !settings.showCaseActionDebugBlocks,
        updatedAt: Date.now(),
    };

    if (!speaker || speaker.type !== NOTEBOOK_ACTOR_TYPES.CHARACTER) {
        metadata.reason = 'invalid_speaker';
    } else {
        const parsed = parseCaseActionBlock(extracted.blocks[0].body);
        metadata.officer = parsed.officer;
        metadata.action = parsed.action;
        const result = applyCaseAction(parsed, speaker);
        metadata.applied = Boolean(result.applied);
        metadata.reason = result.reason || '';
    }

    extra.caseAction = metadata;
    const visibilityChanged = syncCaseActionMessageVisibility(message, metadata);
    return visibilityChanged || metadata.applied;
}

export function syncAllCaseActionMessageVisibility() {
    const context = getContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    let changed = false;
    for (let index = 0; index < chat.length; index += 1) {
        const message = chat[index];
        const caseAction = message?.extra?.[INVESTIGATOR_MESSAGE_EXTRA_KEY]?.caseAction;
        if (!caseAction?.processed) {
            continue;
        }
        if (syncCaseActionMessageVisibility(message, caseAction)) {
            changed = true;
        }
    }
    return changed;
}

export function buildCasePromptReplacements() {
    const state = getInvestigatorState();
    const officers = state.officers || [];
    const suspects = state.suspects || [];
    const evidence = (state.evidence || []).slice(0, 12);
    const restrained = state.restrained || [];

    return {
        play_role: getPlayRole(),
        case_id: state.caseId,
        case_title: state.caseTitle,
        case_action_tag: CASE_ACTION_BLOCK_TAG,
        example_officer: officers[0]?.actor?.name || 'Officer Name',
        officers_block: officers.length
            ? officers.map((entry) => `- ${entry.actor?.name || 'Officer'} (${entry.rank || 'Officer'})`).join('\n')
            : 'No Task Force officers assigned yet.',
        suspects_block: suspects.length
            ? suspects.map((entry) => `- ${entry.actor?.name || 'Unknown'} [${entry.status}]${entry.notes ? `: ${entry.notes}` : ''}`).join('\n')
            : 'No suspects pinned.',
        evidence_block: evidence.length
            ? evidence.map((entry) => `- ${entry.title}: ${entry.detail || '(no detail)'}`).join('\n')
            : 'No evidence logged.',
        restrained_block: restrained.length
            ? restrained.map((entry) => `- ${entry.actor?.name || 'Unknown'}${entry.reason ? `: ${entry.reason}` : ''}`).join('\n')
            : 'Nobody currently marked restrained.',
    };
}

export {
    PLAY_ROLES,
    SUSPECT_STATUSES,
    EVIDENCE_TYPES,
    CASE_ACTIONS,
    CASE_ACTION_BLOCK_TAG,
    DEFAULT_CASE_PROMPT_TEMPLATE,
    getActorKey,
};
