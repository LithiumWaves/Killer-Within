import {
    BROADCAST_TRAP_STATUS,
    CASE_ACTIONS,
    CASE_ACTION_BLOCK_TAG,
    CONFRONT_MIN_STRENGTH,
    CONFRONT_PRIME_STRENGTH,
    DEFAULT_CASE_PROMPT_TEMPLATE,
    DEFAULT_INVESTIGATOR_SETTINGS,
    DEFAULT_WARRANT_GENERATIONS,
    EVIDENCE_TYPES,
    INVESTIGATOR_CHAT_METADATA_KEY,
    INVESTIGATOR_MESSAGE_EXTRA_KEY,
    INVESTIGATOR_MODULE_NAME,
    MAX_ACTIVE_SURVEILLANCE_PLANTS,
    MAX_SURVEILLANCE_SIGNALS,
    OFFICER_CLEARANCE,
    OFFICER_CLEARANCE_ACTIONS,
    PLAY_ROLES,
    SURVEILLANCE_KINDS,
    SURVEILLANCE_SIGNAL_KINDS,
    SURVEILLANCE_STATUS,
    SUSPECT_STATUSES,
    WARRANT_RESULTS,
    WARRANT_STATUS,
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
        version: 4,
        caseId: `TF-${String(Date.now()).slice(-6)}`,
        caseTitle: 'Kira Case File',
        suspects: [],
        evidence: [],
        restrained: [],
        officers: [],
        warrants: [],
        seizeRightsKeys: [],
        seizedNotebookIds: [],
        seizedScrapIds: [],
        surveillance: [],
        signals: [],
        patternReports: [],
        broadcastTraps: [],
        log: [],
        warrantTickSignature: null,
        surveillanceTickSignature: null,
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

function normalizeOfficerClearance(value, rank = '') {
    const raw = String(value || '').trim().toLowerCase();
    if (Object.values(OFFICER_CLEARANCE).includes(raw)) {
        return raw;
    }
    const rankText = String(rank || '').trim().toLowerCase();
    if (/\b(lead|chief|captain|commander)\b/.test(rankText)) {
        return OFFICER_CLEARANCE.LEAD;
    }
    if (/\b(detective|inspector|lieutenant)\b/.test(rankText)) {
        return OFFICER_CLEARANCE.DETECTIVE;
    }
    return OFFICER_CLEARANCE.FIELD;
}

function normalizeOfficer(value, index = 0) {
    const entry = value && typeof value === 'object' ? value : {};
    const actor = normalizeActorRef(entry.actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const key = String(entry.key || getActorKey(actor) || `officer-${index + 1}`).trim();
    const rank = String(entry.rank || 'Officer').trim() || 'Officer';
    return {
        key,
        actor,
        rank,
        clearance: normalizeOfficerClearance(entry.clearance, rank),
        notes: String(entry.notes || '').trim(),
        assignedAt: Number.isFinite(Number(entry.assignedAt)) ? Number(entry.assignedAt) : Date.now(),
    };
}

function normalizeWarrant(value, index = 0) {
    const entry = value && typeof value === 'object' ? value : {};
    const target = normalizeActorRef(entry.target, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const filedBy = normalizeActorRef(entry.filedBy, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const statusRaw = String(entry.status || WARRANT_STATUS.PENDING).trim().toLowerCase();
    const status = Object.values(WARRANT_STATUS).includes(statusRaw) ? statusRaw : WARRANT_STATUS.PENDING;
    const resultRaw = String(entry.result || '').trim().toLowerCase();
    const result = Object.values(WARRANT_RESULTS).includes(resultRaw) ? resultRaw : '';
    const generationsLeft = Math.max(0, Math.round(Number(entry.generationsLeft) || 0));
    return {
        id: String(entry.id || `warrant-${index + 1}-${Date.now()}`).trim(),
        target,
        targetKey: String(entry.targetKey || getActorKey(target) || '').trim(),
        filedBy,
        note: String(entry.note || '').trim(),
        status,
        result,
        evidenceId: String(entry.evidenceId || '').trim(),
        generationsLeft,
        filedAt: Number.isFinite(Number(entry.filedAt)) ? Number(entry.filedAt) : Date.now(),
        resolvedAt: Number.isFinite(Number(entry.resolvedAt)) ? Number(entry.resolvedAt) : null,
    };
}

function normalizeSurveillancePlant(value, index = 0) {
    const entry = value && typeof value === 'object' ? value : {};
    const kindRaw = String(entry.kind || SURVEILLANCE_KINDS.TRAIL).trim().toLowerCase();
    const kind = Object.values(SURVEILLANCE_KINDS).includes(kindRaw) ? kindRaw : SURVEILLANCE_KINDS.TRAIL;
    const statusRaw = String(entry.status || SURVEILLANCE_STATUS.ACTIVE).trim().toLowerCase();
    const status = Object.values(SURVEILLANCE_STATUS).includes(statusRaw) ? statusRaw : SURVEILLANCE_STATUS.ACTIVE;
    const target = normalizeActorRef(entry.target, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    return {
        id: String(entry.id || `plant-${index + 1}-${Date.now()}`).trim(),
        kind,
        status,
        location: String(entry.location || '').trim(),
        target,
        targetKey: String(entry.targetKey || getActorKey(target) || '').trim(),
        notebookItemId: String(entry.notebookItemId || '').trim(),
        label: String(entry.label || '').trim(),
        plantedAt: Number.isFinite(Number(entry.plantedAt)) ? Number(entry.plantedAt) : Date.now(),
        plantedBy: normalizeActorRef(entry.plantedBy, NOTEBOOK_ACTOR_TYPES.USER, 'Task Force'),
        lastSignalAt: Number.isFinite(Number(entry.lastSignalAt)) ? Number(entry.lastSignalAt) : null,
        lastSeenHolderKey: String(entry.lastSeenHolderKey || '').trim(),
        lastSeenEventKey: String(entry.lastSeenEventKey || '').trim(),
        signalIds: Array.isArray(entry.signalIds)
            ? entry.signalIds.map((id) => String(id || '').trim()).filter(Boolean).slice(0, 20)
            : [],
    };
}

function normalizeSurveillanceSignal(value, index = 0) {
    const entry = value && typeof value === 'object' ? value : {};
    const kindRaw = String(entry.kind || SURVEILLANCE_SIGNAL_KINDS.OFFICER_REPORT).trim().toLowerCase();
    const kind = Object.values(SURVEILLANCE_SIGNAL_KINDS).includes(kindRaw)
        ? kindRaw
        : SURVEILLANCE_SIGNAL_KINDS.OFFICER_REPORT;
    return {
        id: String(entry.id || `signal-${index + 1}-${Date.now()}`).trim(),
        plantId: String(entry.plantId || '').trim(),
        at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : Date.now(),
        kind,
        text: String(entry.text || '').trim(),
        sourceEvent: String(entry.sourceEvent || '').trim(),
        eventKey: String(entry.eventKey || '').trim(),
        linkedSuspectKeys: Array.isArray(entry.linkedSuspectKeys)
            ? entry.linkedSuspectKeys.map((key) => String(key || '').trim()).filter(Boolean)
            : [],
        evidenceId: String(entry.evidenceId || '').trim(),
    };
}

function normalizePatternReport(value, index = 0) {
    const entry = value && typeof value === 'object' ? value : {};
    return {
        id: String(entry.id || `pattern-${index + 1}-${Date.now()}`).trim(),
        pattern: String(entry.pattern || 'insufficient_data').trim() || 'insufficient_data',
        deathIds: Array.isArray(entry.deathIds)
            ? entry.deathIds.map((id) => String(id || '').trim()).filter(Boolean)
            : [],
        createdAt: Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : Date.now(),
        evidenceId: String(entry.evidenceId || '').trim(),
        detail: String(entry.detail || '').trim(),
    };
}

function normalizeBroadcastTrap(value, index = 0) {
    const entry = value && typeof value === 'object' ? value : {};
    const statusRaw = String(entry.status || BROADCAST_TRAP_STATUS.ACTIVE).trim().toLowerCase();
    const status = Object.values(BROADCAST_TRAP_STATUS).includes(statusRaw)
        ? statusRaw
        : BROADCAST_TRAP_STATUS.ACTIVE;
    return {
        id: String(entry.id || `trap-${index + 1}-${Date.now()}`).trim(),
        status,
        decoyName: String(entry.decoyName || '').trim(),
        challenge: String(entry.challenge || '').trim(),
        createdAt: Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : Date.now(),
        createdBy: normalizeActorRef(entry.createdBy, NOTEBOOK_ACTOR_TYPES.USER, 'Task Force'),
        matchedDeathId: String(entry.matchedDeathId || '').trim(),
        evidenceId: String(entry.evidenceId || '').trim(),
        triggeredAt: Number.isFinite(Number(entry.triggeredAt)) ? Number(entry.triggeredAt) : null,
    };
}

function normalizeInvestigatorState(value) {
    const defaults = createDefaultInvestigatorState();
    const state = value && typeof value === 'object' ? value : {};
    return {
        version: 4,
        caseId: String(state.caseId || defaults.caseId).trim() || defaults.caseId,
        caseTitle: String(state.caseTitle || defaults.caseTitle).trim() || defaults.caseTitle,
        suspects: (Array.isArray(state.suspects) ? state.suspects : []).map(normalizeSuspect),
        evidence: (Array.isArray(state.evidence) ? state.evidence : []).map(normalizeEvidence),
        restrained: (Array.isArray(state.restrained) ? state.restrained : []).map(normalizeRestrained),
        officers: (Array.isArray(state.officers) ? state.officers : []).map(normalizeOfficer),
        warrants: (Array.isArray(state.warrants) ? state.warrants : []).map(normalizeWarrant).slice(-40),
        seizeRightsKeys: (Array.isArray(state.seizeRightsKeys) ? state.seizeRightsKeys : [])
            .map((key) => String(key || '').trim())
            .filter(Boolean),
        seizedNotebookIds: (Array.isArray(state.seizedNotebookIds) ? state.seizedNotebookIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean),
        seizedScrapIds: (Array.isArray(state.seizedScrapIds) ? state.seizedScrapIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean),
        surveillance: (Array.isArray(state.surveillance) ? state.surveillance : [])
            .map(normalizeSurveillancePlant)
            .slice(-20),
        signals: (Array.isArray(state.signals) ? state.signals : [])
            .map(normalizeSurveillanceSignal)
            .slice(-MAX_SURVEILLANCE_SIGNALS),
        patternReports: (Array.isArray(state.patternReports) ? state.patternReports : [])
            .map(normalizePatternReport)
            .slice(-20),
        broadcastTraps: (Array.isArray(state.broadcastTraps) ? state.broadcastTraps : [])
            .map(normalizeBroadcastTrap)
            .slice(-20),
        log: (Array.isArray(state.log) ? state.log : []).slice(-80).map((entry, index) => ({
            id: String(entry?.id || `log-${index}`).trim(),
            at: Number.isFinite(Number(entry?.at)) ? Number(entry.at) : Date.now(),
            text: String(entry?.text || '').trim(),
        })),
        warrantTickSignature: state.warrantTickSignature == null ? null : state.warrantTickSignature,
        surveillanceTickSignature: state.surveillanceTickSignature == null ? null : state.surveillanceTickSignature,
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
    const trapMatch = matchBroadcastTrapsAgainstTimeline();
    const surveillance = syncSurveillanceFromWorldState();
    return { added, trapsTriggered: trapMatch.triggered, surveillanceSignals: surveillance.added };
}

function makeEventKey(...parts) {
    return parts.map((part) => normalizeKnowledgeKey(part)).filter(Boolean).join('|');
}

function pushSurveillanceSignal(plant, options = {}) {
    const state = getInvestigatorState();
    const livePlant = state.surveillance.find((entry) => entry.id === plant.id);
    if (!livePlant || livePlant.status !== SURVEILLANCE_STATUS.ACTIVE) {
        return { applied: false, reason: 'missing_plant' };
    }

    const eventKey = String(options.eventKey || '').trim();
    if (eventKey && state.signals.some((entry) => (
        entry.plantId === livePlant.id && entry.eventKey === eventKey
    ))) {
        return { applied: false, reason: 'duplicate_signal' };
    }

    const signal = normalizeSurveillanceSignal({
        id: `signal-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
        plantId: livePlant.id,
        at: Date.now(),
        kind: options.kind || SURVEILLANCE_SIGNAL_KINDS.OFFICER_REPORT,
        text: String(options.text || '').trim(),
        sourceEvent: String(options.sourceEvent || '').trim(),
        eventKey,
        linkedSuspectKeys: Array.isArray(options.linkedSuspectKeys) ? options.linkedSuspectKeys : [],
    });

    state.signals.unshift(signal);
    if (state.signals.length > MAX_SURVEILLANCE_SIGNALS) {
        state.signals = state.signals.slice(0, MAX_SURVEILLANCE_SIGNALS);
    }
    livePlant.lastSignalAt = signal.at;
    livePlant.signalIds = [signal.id, ...livePlant.signalIds].slice(0, 20);
    if (Object.hasOwn(options, 'lastSeenHolderKey')) {
        livePlant.lastSeenHolderKey = String(options.lastSeenHolderKey || '').trim();
    }
    if (Object.hasOwn(options, 'lastSeenEventKey')) {
        livePlant.lastSeenEventKey = String(options.lastSeenEventKey || '').trim();
    }
    pushCaseLog(state, `SURVEIL signal: ${signal.text || signal.kind}`);
    return { applied: true, signal };
}

export function plantSurveillance(options = {}) {
    const state = getInvestigatorState();
    const kindRaw = String(options.kind || SURVEILLANCE_KINDS.TRAIL).trim().toLowerCase();
    const kind = Object.values(SURVEILLANCE_KINDS).includes(kindRaw) ? kindRaw : SURVEILLANCE_KINDS.TRAIL;
    const activeCount = state.surveillance.filter((entry) => entry.status === SURVEILLANCE_STATUS.ACTIVE).length;
    if (activeCount >= MAX_ACTIVE_SURVEILLANCE_PLANTS) {
        return { applied: false, reason: 'plant_cap' };
    }

    const target = options.target
        ? normalizeActorRef(options.target, NOTEBOOK_ACTOR_TYPES.CHARACTER, '')
        : normalizeActorRef({ type: NOTEBOOK_ACTOR_TYPES.NONE }, NOTEBOOK_ACTOR_TYPES.NONE, '');
    const notebookItemId = String(options.notebookItemId || '').trim();
    const location = String(options.location || '').trim();

    if (kind === SURVEILLANCE_KINDS.TRAIL && !target.name) {
        return { applied: false, reason: 'missing_target' };
    }
    if (kind === SURVEILLANCE_KINDS.WATCH_NOTEBOOK && !notebookItemId) {
        return { applied: false, reason: 'missing_notebook' };
    }
    if (kind === SURVEILLANCE_KINDS.BUG_ROOM && !location) {
        return { applied: false, reason: 'missing_location' };
    }

    let lastSeenHolderKey = '';
    if (kind === SURVEILLANCE_KINDS.WATCH_NOTEBOOK) {
        const notebook = getDeathNotes().find((entry) => entry?.itemId === notebookItemId);
        lastSeenHolderKey = getActorKey(notebook?.holder);
    } else if (kind === SURVEILLANCE_KINDS.TRAIL) {
        lastSeenHolderKey = getActorKey(target);
    }

    const label = String(options.label || '').trim()
        || (kind === SURVEILLANCE_KINDS.BUG_ROOM
            ? `Bug: ${location}`
            : kind === SURVEILLANCE_KINDS.WATCH_NOTEBOOK
                ? `Watch note ${notebookItemId.slice(-6)}`
                : `Trail: ${target.name}`);

    const plant = normalizeSurveillancePlant({
        id: `plant-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
        kind,
        status: SURVEILLANCE_STATUS.ACTIVE,
        location,
        target,
        targetKey: getActorKey(target),
        notebookItemId,
        label,
        plantedAt: Date.now(),
        plantedBy: options.plantedBy
            ? normalizeActorRef(options.plantedBy, NOTEBOOK_ACTOR_TYPES.CHARACTER, '')
            : normalizeActorRef({ type: NOTEBOOK_ACTOR_TYPES.USER, name: 'Task Force' }, NOTEBOOK_ACTOR_TYPES.USER, 'Task Force'),
        lastSeenHolderKey,
    });
    state.surveillance.push(plant);
    pushCaseLog(state, `Surveillance planted: ${plant.label}.`);
    return { applied: true, plant };
}

export function removeSurveillancePlant(plantId) {
    const state = getInvestigatorState();
    const plant = state.surveillance.find((entry) => entry.id === String(plantId || '').trim());
    if (!plant) {
        return { applied: false, reason: 'missing_plant' };
    }
    plant.status = SURVEILLANCE_STATUS.REMOVED;
    pushCaseLog(state, `Surveillance removed: ${plant.label || plant.id}.`);
    return { applied: true, plant };
}

export function logSurveillanceSignalAsEvidence(signalId) {
    const state = getInvestigatorState();
    const signal = state.signals.find((entry) => entry.id === String(signalId || '').trim());
    if (!signal) {
        return { applied: false, reason: 'missing_signal' };
    }
    if (signal.evidenceId) {
        return { applied: false, reason: 'already_logged', evidenceId: signal.evidenceId };
    }
    const plant = state.surveillance.find((entry) => entry.id === signal.plantId);
    const evidence = logEvidence({
        type: EVIDENCE_TYPES.SIGHTING,
        title: `Surveillance: ${plant?.label || signal.kind}`,
        detail: signal.text,
        source: `surveil:${signal.id}`,
        linkedSuspectKeys: signal.linkedSuspectKeys,
    }).evidence;
    const live = getInvestigatorState().signals.find((entry) => entry.id === signal.id);
    if (live) {
        live.evidenceId = evidence.id;
    }
    return { applied: true, evidence };
}

export function syncSurveillanceFromWorldState() {
    const state = getInvestigatorState();
    const active = state.surveillance.filter((entry) => entry.status === SURVEILLANCE_STATUS.ACTIVE);
    if (!active.length) {
        return { added: 0 };
    }

    const notebooks = getDeathNotes();
    const inventory = getDeathNoteInventory();
    let added = 0;

    for (const plant of active) {
        if (plant.kind === SURVEILLANCE_KINDS.WATCH_NOTEBOOK) {
            const notebook = notebooks.find((entry) => entry?.itemId === plant.notebookItemId);
            if (!notebook || notebook.destroyed) {
                continue;
            }
            const holderKey = getActorKey(notebook.holder);
            if (holderKey && holderKey !== plant.lastSeenHolderKey) {
                const fromLabel = plant.lastSeenHolderKey || 'unknown';
                const toLabel = notebook.holder?.name || holderKey;
                const result = pushSurveillanceSignal(plant, {
                    kind: SURVEILLANCE_SIGNAL_KINDS.CUSTODY_MOVE,
                    sourceEvent: 'note_lend',
                    eventKey: makeEventKey('custody', plant.id, fromLabel, holderKey, notebook.updatedAt || Date.now()),
                    text: `SURVEIL ${plant.label}: custody change — ${notebook.label || 'Death Note'} → ${toLabel}.`,
                    linkedSuspectKeys: [holderKey].filter(Boolean),
                    lastSeenHolderKey: holderKey,
                });
                if (result.applied) {
                    added += 1;
                }
            } else if (!plant.lastSeenHolderKey && holderKey) {
                plant.lastSeenHolderKey = holderKey;
            }

            if (notebook.presenceReveal?.pending) {
                const eventKey = makeEventKey('open', plant.id, notebook.presenceReveal.openedAt || Date.now());
                const result = pushSurveillanceSignal(plant, {
                    kind: SURVEILLANCE_SIGNAL_KINDS.SIGHTING_OPEN,
                    sourceEvent: 'notebook_open_reveal',
                    eventKey,
                    text: `SURVEIL ${plant.label}: notebook activity detected near ${notebook.holder?.name || 'holder'}. Contents unknown.`,
                    linkedSuspectKeys: [holderKey].filter(Boolean),
                    lastSeenEventKey: eventKey,
                });
                if (result.applied) {
                    added += 1;
                }
            }
        }

        if (plant.kind === SURVEILLANCE_KINDS.TRAIL && plant.targetKey) {
            for (const notebook of notebooks) {
                if (!notebook || notebook.destroyed || !notebook.exists) {
                    continue;
                }
                const holderKey = getActorKey(notebook.holder);
                if (holderKey !== plant.targetKey) {
                    continue;
                }
                if (notebook.presenceReveal?.pending) {
                    const eventKey = makeEventKey('trail-open', plant.id, notebook.itemId, notebook.presenceReveal.openedAt || Date.now());
                    const result = pushSurveillanceSignal(plant, {
                        kind: SURVEILLANCE_SIGNAL_KINDS.SIGHTING_OPEN,
                        sourceEvent: 'notebook_open_reveal',
                        eventKey,
                        text: `SURVEIL ${plant.label}: subject active with notebook. No page contents recovered.`,
                        linkedSuspectKeys: [plant.targetKey],
                    });
                    if (result.applied) {
                        added += 1;
                    }
                }
            }

            for (const scrap of inventory.scraps || []) {
                if (!scrap?.active) {
                    continue;
                }
                const holderKey = getActorKey(scrap.holder);
                if (holderKey !== plant.targetKey) {
                    continue;
                }
                const eventKey = makeEventKey('scrap', plant.id, scrap.id, scrap.updatedAt || scrap.createdAt || '');
                if (eventKey && eventKey !== makeEventKey('scrap', plant.id, scrap.id, '')) {
                    const result = pushSurveillanceSignal(plant, {
                        kind: SURVEILLANCE_SIGNAL_KINDS.CUSTODY_MOVE,
                        sourceEvent: 'scrap_move',
                        eventKey,
                        text: `SURVEIL ${plant.label}: scrap custody with ${scrap.holder?.name || 'subject'} observed.`,
                        linkedSuspectKeys: [plant.targetKey],
                        lastSeenEventKey: eventKey,
                    });
                    if (result.applied) {
                        added += 1;
                    }
                }
            }
        }
    }

    // Subject-active: newly resolved deaths written from a watched notebook source.
    const deathState = getDeathNoteChatState();
    const entries = Array.isArray(deathState?.entries) ? deathState.entries : [];
    for (const plant of active.filter((entry) => entry.kind === SURVEILLANCE_KINDS.WATCH_NOTEBOOK)) {
        for (const entry of entries) {
            const sourceId = String(entry?.sourceId || entry?.source?.id || '').trim();
            if (!sourceId || sourceId !== plant.notebookItemId) {
                continue;
            }
            const eventKey = makeEventKey('write', plant.id, entry.id || entry.createdAt);
            const result = pushSurveillanceSignal(plant, {
                kind: SURVEILLANCE_SIGNAL_KINDS.SUBJECT_ACTIVE,
                sourceEvent: 'holder_write',
                eventKey,
                text: `SURVEIL ${plant.label}: subject active with notebook. No page contents recovered.`,
                linkedSuspectKeys: [getActorKey(notebooks.find((note) => note?.itemId === plant.notebookItemId)?.holder)].filter(Boolean),
            });
            if (result.applied) {
                added += 1;
            }
        }
    }

    return { added };
}

export function tickSurveillanceForGeneration(signature) {
    const state = getInvestigatorState();
    const nextSignature = signature == null ? Date.now() : signature;
    if (state.surveillanceTickSignature === nextSignature) {
        return { ticked: false, added: 0 };
    }
    state.surveillanceTickSignature = nextSignature;
    const result = syncSurveillanceFromWorldState();
    return { ticked: true, added: result.added };
}

function detectVictimPatterns(timeline) {
    const deaths = Array.isArray(timeline) ? timeline : [];
    const directoryNames = new Set(
        getCharacterNameDirectory().map((entry) => normalizeKnowledgeKey(entry.actor?.name)),
    );
    const patterns = [];

    const heartAttacks = deaths.filter((entry) => /heart\s*attack/i.test(String(entry.cause || '')));
    if (heartAttacks.length >= 3) {
        patterns.push({
            pattern: 'heart_attack_cluster',
            deathIds: heartAttacks.map((entry) => entry.id),
            detail: `${heartAttacks.length} resolved deaths share heart-attack causes.`,
        });
    }

    if (deaths.length >= 4) {
        const gaps = [];
        for (let index = 1; index < deaths.length; index += 1) {
            const prev = Number(deaths[index - 1].resolvedAt) || 0;
            const next = Number(deaths[index].resolvedAt) || 0;
            if (prev && next && next >= prev) {
                gaps.push(next - prev);
            }
        }
        if (gaps.length) {
            const sorted = gaps.slice().sort((left, right) => left - right);
            const median = sorted[Math.floor(sorted.length / 2)];
            if (median <= 6 * 60 * 60 * 1000) {
                patterns.push({
                    pattern: 'timing_window',
                    deathIds: deaths.map((entry) => entry.id),
                    detail: `Median gap between consecutive resolved deaths is ${Math.round(median / 60000)} minutes.`,
                });
            }
        }
    }

    if (deaths.length >= 3) {
        const offCard = deaths.filter((entry) => !directoryNames.has(normalizeKnowledgeKey(entry.targetName)));
        if ((offCard.length / deaths.length) >= 0.7) {
            patterns.push({
                pattern: 'criminals_only',
                deathIds: offCard.map((entry) => entry.id),
                detail: `${offCard.length}/${deaths.length} victims are off the active character roster.`,
            });
        }
    }

    const recent = deaths.slice(-5);
    const characterVictims = recent.filter((entry) => directoryNames.has(normalizeKnowledgeKey(entry.targetName)));
    if (characterVictims.length >= 2) {
        patterns.push({
            pattern: 'anyone_pattern',
            deathIds: characterVictims.map((entry) => entry.id),
            detail: `${characterVictims.length} of the last ${recent.length} victims are named cast characters.`,
        });
    }

    const inventory = getDeathNoteInventory();
    const scrapHolderNames = new Set(
        (inventory.scraps || [])
            .filter((scrap) => scrap?.active)
            .map((scrap) => normalizeKnowledgeKey(scrap.holder?.name))
            .filter(Boolean),
    );
    const scrapHolderDeaths = deaths.filter((entry) => scrapHolderNames.has(normalizeKnowledgeKey(entry.targetName)));
    if (scrapHolderDeaths.length >= 1) {
        patterns.push({
            pattern: 'scrap_holder_deaths',
            deathIds: scrapHolderDeaths.map((entry) => entry.id),
            detail: `${scrapHolderDeaths.length} victim(s) currently/recently match scrap holders.`,
        });
    }

    if (!patterns.length) {
        patterns.push({
            pattern: 'insufficient_data',
            deathIds: deaths.map((entry) => entry.id),
            detail: `Sample size ${deaths.length} is too thin for a confident pattern.`,
        });
    }

    return patterns;
}

export function analyzeVictimPattern(options = {}) {
    const timeline = getInvestigatorVictimTimeline();
    const detected = detectVictimPatterns(timeline);
    const focus = String(options.note || options.detail || '').trim().toLowerCase();
    const chosen = focus
        ? (detected.find((entry) => entry.pattern.includes(focus.replace(/\s+/g, '_'))) || detected[0])
        : detected[0];

    const deathKey = chosen.deathIds.slice().sort().join(',');
    const state = getInvestigatorState();
    const duplicate = state.patternReports.find((entry) => (
        entry.pattern === chosen.pattern && entry.deathIds.slice().sort().join(',') === deathKey
    ));
    if (duplicate) {
        return { applied: false, reason: 'duplicate_report', report: duplicate };
    }

    const evidence = logEvidence({
        type: EVIDENCE_TYPES.PATTERN_REPORT,
        title: `Pattern report: ${chosen.pattern}`,
        detail: chosen.detail,
        source: 'analyze_pattern',
        itemRef: {
            kind: 'pattern_report',
            id: `pattern-${Date.now()}`,
            label: chosen.pattern,
            snapshot: JSON.stringify({
                pattern: chosen.pattern,
                deathIds: chosen.deathIds,
                sampleSize: timeline.length,
            }),
        },
    }).evidence;

    const report = normalizePatternReport({
        id: evidence.itemRef?.id || `pattern-${Date.now()}`,
        pattern: chosen.pattern,
        deathIds: chosen.deathIds,
        createdAt: Date.now(),
        evidenceId: evidence.id,
        detail: chosen.detail,
    });
    const liveState = getInvestigatorState();
    liveState.patternReports.push(report);
    pushCaseLog(liveState, `Pattern analysis: ${chosen.pattern}.`);
    return { applied: true, report, evidence, patterns: detected };
}

export function createBroadcastTrap(options = {}) {
    const decoyName = String(options.decoyName || options.target || '').trim();
    if (!decoyName) {
        return { applied: false, reason: 'missing_decoy' };
    }
    const state = getInvestigatorState();
    for (const trap of state.broadcastTraps) {
        if (trap.status === BROADCAST_TRAP_STATUS.ACTIVE) {
            trap.status = BROADCAST_TRAP_STATUS.EXPIRED;
        }
    }
    const trap = normalizeBroadcastTrap({
        id: `trap-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
        status: BROADCAST_TRAP_STATUS.ACTIVE,
        decoyName,
        challenge: String(options.challenge || options.detail || options.note || '').trim(),
        createdAt: Date.now(),
        createdBy: options.createdBy
            ? normalizeActorRef(options.createdBy, NOTEBOOK_ACTOR_TYPES.CHARACTER, '')
            : normalizeActorRef({ type: NOTEBOOK_ACTOR_TYPES.USER, name: 'Task Force' }, NOTEBOOK_ACTOR_TYPES.USER, 'Task Force'),
    });
    state.broadcastTraps.push(trap);
    pushCaseLog(state, `Broadcast trap armed: ${decoyName}.`);
    return { applied: true, trap };
}

export function getActiveBroadcastTrap() {
    return getInvestigatorState().broadcastTraps.find((entry) => entry.status === BROADCAST_TRAP_STATUS.ACTIVE) || null;
}

export function matchBroadcastTrapsAgainstTimeline() {
    const state = getInvestigatorState();
    const active = state.broadcastTraps.filter((entry) => entry.status === BROADCAST_TRAP_STATUS.ACTIVE);
    if (!active.length) {
        return { triggered: 0 };
    }
    const timeline = getInvestigatorVictimTimeline();
    let triggered = 0;

    for (const trap of active) {
        const match = timeline.find((death) => (
            normalizeKnowledgeKey(death.targetName) === normalizeKnowledgeKey(trap.decoyName)
        ));
        if (!match) {
            continue;
        }

        const trapId = trap.id;
        const evidence = logEvidence({
            type: EVIDENCE_TYPES.TRAP_LINK,
            title: `Trap link: ${trap.decoyName}`,
            detail: [
                `Broadcast decoy "${trap.decoyName}" killed.`,
                `Death entry: ${match.id}`,
                `Cause: ${match.cause}`,
                trap.challenge ? `Challenge: ${trap.challenge}` : '',
            ].filter(Boolean).join('\n'),
            source: 'auto_trap_link',
            itemRef: {
                kind: 'broadcast_trap',
                id: trapId,
                label: trap.decoyName,
                snapshot: match.noteText || '',
            },
        }).evidence;

        const liveState = getInvestigatorState();
        const live = liveState.broadcastTraps.find((entry) => entry.id === trapId);
        if (!live) {
            continue;
        }
        live.status = BROADCAST_TRAP_STATUS.TRIGGERED;
        live.matchedDeathId = match.id;
        live.evidenceId = evidence.id;
        live.triggeredAt = Date.now();
        pushCaseLog(liveState, `TRAP LINK: decoy ${live.decoyName} matched death ${match.id}.`);
        triggered += 1;
    }

    return { triggered };
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
        const applied = typeof result === 'object' && Object.hasOwn(result, 'applied')
            ? Boolean(result.applied)
            : true;
        if (applied && successMessage && globalThis.toastr?.success) {
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

    const nextRank = Object.hasOwn(options, 'rank')
        ? String(options.rank || 'Officer').trim() || 'Officer'
        : null;
    const nextClearance = Object.hasOwn(options, 'clearance')
        ? normalizeOfficerClearance(options.clearance, nextRank || '')
        : null;

    const existingIndex = state.officers.findIndex((entry) => entry.key === key);
    if (existingIndex >= 0) {
        const current = state.officers[existingIndex];
        state.officers[existingIndex] = normalizeOfficer({
            ...current,
            rank: nextRank ?? current.rank,
            clearance: nextClearance ?? current.clearance,
            notes: Object.hasOwn(options, 'notes') ? options.notes : current.notes,
        }, existingIndex);
        pushCaseLog(state, `Updated Task Force officer: ${normalized.name}.`);
        return { applied: true, reason: 'updated', officer: state.officers[existingIndex] };
    }

    const rank = nextRank || String(options.rank || 'Officer').trim() || 'Officer';
    const officer = normalizeOfficer({
        key,
        actor: normalized,
        rank,
        clearance: nextClearance || normalizeOfficerClearance(options.clearance, rank),
        notes: String(options.notes || '').trim(),
        assignedAt: Date.now(),
    });
    state.officers.push(officer);
    pushCaseLog(state, `Assigned Task Force officer: ${normalized.name} [${officer.clearance}].`);
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

export function getOfficerRecord(actor) {
    const key = getActorKey(actor);
    if (!key) {
        return null;
    }
    return getInvestigatorState().officers.find((entry) => entry.key === key) || null;
}

export function officerMayPerformAction(actor, action) {
    const officer = getOfficerRecord(actor);
    if (!officer) {
        return false;
    }
    const allowed = OFFICER_CLEARANCE_ACTIONS[officer.clearance] || OFFICER_CLEARANCE_ACTIONS[OFFICER_CLEARANCE.FIELD];
    return allowed.includes(String(action || '').trim().toLowerCase());
}

export function hasSeizeRightsForActor(actor) {
    const key = getActorKey(actor);
    if (!key) {
        return false;
    }
    if (isActorRestrained(actor)) {
        return true;
    }
    return getInvestigatorState().seizeRightsKeys.includes(key);
}

export function getCaseStrength(actorOrKey) {
    const state = getInvestigatorState();
    const key = typeof actorOrKey === 'string'
        ? String(actorOrKey || '').trim()
        : getActorKey(actorOrKey);
    const suspect = state.suspects.find((entry) => entry.key === key);
    if (!suspect) {
        return { strength: 0, linked: 0, statusBonus: 0, suspect: null };
    }
    const linked = Array.isArray(suspect.linkedEvidenceIds) ? suspect.linkedEvidenceIds.length : 0;
    let statusBonus = 0;
    if (suspect.status === SUSPECT_STATUSES.PRIME) {
        statusBonus = 2;
    } else if (suspect.status === SUSPECT_STATUSES.PERSON_OF_INTEREST) {
        statusBonus = 1;
    } else if (suspect.status === SUSPECT_STATUSES.CLEARED) {
        statusBonus = -2;
    }
    return {
        strength: Math.max(0, linked + statusBonus),
        linked,
        statusBonus,
        suspect,
    };
}

function pickWarrantResult(strength) {
    if (strength >= 4) {
        return WARRANT_RESULTS.ID_HIT;
    }
    if (strength >= 3) {
        return WARRANT_RESULTS.STATEMENT;
    }
    if (strength >= 2) {
        return WARRANT_RESULTS.SCRAP_TRACE;
    }
    if (strength >= 1) {
        return WARRANT_RESULTS.FALSE_LEAD;
    }
    return WARRANT_RESULTS.EMPTY;
}

function describeWarrantResult(result, targetName) {
    switch (result) {
        case WARRANT_RESULTS.ID_HIT:
            return `Search of ${targetName} recovered identifying personal effects tied to prior case activity.`;
        case WARRANT_RESULTS.STATEMENT:
            return `Search of ${targetName} produced a usable statement / contemporaneous note fragment.`;
        case WARRANT_RESULTS.SCRAP_TRACE:
            return `Search of ${targetName} found a scrap-paper trace with incomplete writing residue.`;
        case WARRANT_RESULTS.FALSE_LEAD:
            return `Search of ${targetName} turned up a misleading lead that does not hold under review.`;
        case WARRANT_RESULTS.EMPTY:
        default:
            return `Search of ${targetName} returned empty / nothing actionable.`;
    }
}

export function fileWarrant(actor, options = {}) {
    const state = getInvestigatorState();
    const target = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const key = getActorKey(target);
    if (!key || !target.name) {
        return { applied: false, reason: 'invalid_actor' };
    }

    const pending = state.warrants.find((entry) => (
        entry.status === WARRANT_STATUS.PENDING && entry.targetKey === key
    ));
    if (pending) {
        return { applied: false, reason: 'already_pending', warrant: pending };
    }

    const generations = Math.max(
        1,
        Math.min(8, Math.round(Number(options.generations) || DEFAULT_WARRANT_GENERATIONS)),
    );
    const filedBy = options.filedBy
        ? normalizeActorRef(options.filedBy, NOTEBOOK_ACTOR_TYPES.CHARACTER, '')
        : normalizeActorRef({ type: NOTEBOOK_ACTOR_TYPES.USER, name: 'Task Force' }, NOTEBOOK_ACTOR_TYPES.USER, 'Task Force');

    const warrant = normalizeWarrant({
        id: `warrant-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
        target,
        targetKey: key,
        filedBy,
        note: String(options.note || options.reason || options.detail || '').trim(),
        status: WARRANT_STATUS.PENDING,
        generationsLeft: generations,
        filedAt: Date.now(),
    });
    state.warrants.push(warrant);
    pushCaseLog(state, `Warrant filed on ${target.name} (resolve in ${generations} gen).`);
    return { applied: true, warrant };
}

export function resolveWarrant(warrantId, options = {}) {
    const state = getInvestigatorState();
    const warrant = state.warrants.find((entry) => entry.id === String(warrantId || '').trim());
    if (!warrant) {
        return { applied: false, reason: 'missing_warrant' };
    }
    if (warrant.status === WARRANT_STATUS.RESOLVED && !options.force) {
        return { applied: false, reason: 'already_resolved', warrant };
    }

    const strengthInfo = getCaseStrength(warrant.targetKey);
    const result = options.result || pickWarrantResult(strengthInfo.strength);
    const targetName = warrant.target?.name || 'subject';
    const detail = describeWarrantResult(result, targetName)
        + (warrant.note ? ` Filed note: ${warrant.note}` : '');
    const warrantKey = warrant.id;
    const targetKey = warrant.targetKey;
    const note = warrant.note;

    const evidence = logEvidence({
        type: EVIDENCE_TYPES.WARRANT_RESULT,
        title: `Warrant result: ${targetName}`,
        detail,
        source: `warrant:${warrantKey}`,
        linkedSuspectKeys: [targetKey].filter(Boolean),
    }).evidence;

    if (targetKey) {
        linkEvidenceToSuspect(evidence.id, targetKey);
    }

    const liveState = getInvestigatorState();
    const live = liveState.warrants.find((entry) => entry.id === warrantKey);
    if (!live) {
        return { applied: false, reason: 'missing_warrant' };
    }
    live.status = WARRANT_STATUS.RESOLVED;
    live.result = result;
    live.evidenceId = evidence.id;
    live.generationsLeft = 0;
    live.resolvedAt = Date.now();
    live.note = note;
    pushCaseLog(liveState, `Warrant resolved on ${targetName}: ${result}.`);
    return { applied: true, warrant: live, evidence, result };
}

export function tickWarrantsForGeneration(signature) {
    const state = getInvestigatorState();
    const nextSignature = signature == null ? Date.now() : signature;
    if (state.warrantTickSignature === nextSignature) {
        return { ticked: false, resolved: [] };
    }
    state.warrantTickSignature = nextSignature;

    const pendingIds = state.warrants
        .filter((entry) => entry.status === WARRANT_STATUS.PENDING)
        .map((entry) => entry.id);
    if (!pendingIds.length) {
        return { ticked: true, resolved: [] };
    }

    const resolved = [];
    for (const warrantId of pendingIds) {
        const liveState = getInvestigatorState();
        const warrant = liveState.warrants.find((entry) => entry.id === warrantId);
        if (!warrant || warrant.status !== WARRANT_STATUS.PENDING) {
            continue;
        }
        warrant.generationsLeft = Math.max(0, Number(warrant.generationsLeft || 0) - 1);
        if (warrant.generationsLeft > 0) {
            continue;
        }
        const result = resolveWarrant(warrant.id);
        if (result.applied) {
            resolved.push(result);
        }
    }
    return { ticked: true, resolved };
}

export function confrontSuspect(actor, options = {}) {
    const state = getInvestigatorState();
    const target = normalizeActorRef(actor, NOTEBOOK_ACTOR_TYPES.CHARACTER, '');
    const key = getActorKey(target);
    if (!key || !target.name) {
        return { applied: false, reason: 'invalid_actor' };
    }

    let suspect = state.suspects.find((entry) => entry.key === key);
    if (!suspect) {
        pinSuspect(target, {
            status: SUSPECT_STATUSES.PERSON_OF_INTEREST,
            notes: String(options.detail || options.reason || 'Confronted without prior pin.').trim(),
        });
        suspect = state.suspects.find((entry) => entry.key === key);
    }

    const strengthInfo = getCaseStrength(key);
    if (strengthInfo.strength < CONFRONT_MIN_STRENGTH) {
        pushCaseLog(state, `Confront blocked on ${target.name}: insufficient case strength (${strengthInfo.strength}/${CONFRONT_MIN_STRENGTH}).`);
        return {
            applied: false,
            reason: 'insufficient_strength',
            strength: strengthInfo.strength,
            required: CONFRONT_MIN_STRENGTH,
        };
    }

    const isPrime = suspect?.status === SUSPECT_STATUSES.PRIME;
    const strongEnough = strengthInfo.strength >= CONFRONT_PRIME_STRENGTH;
    const restrained = isActorRestrained(target);
    let outcome = 'pressure';
    let seizeUnlocked = false;

    if (isPrime && strongEnough) {
        outcome = 'probable_cause';
        if (!state.seizeRightsKeys.includes(key)) {
            state.seizeRightsKeys.push(key);
        }
        seizeUnlocked = true;
    } else if (!isPrime && strengthInfo.strength >= CONFRONT_PRIME_STRENGTH) {
        outcome = 'overreach';
        pushCaseLog(state, `Confront overreach on ${target.name}: case noise / trust strain logged.`);
    }

    const detailParts = [
        String(options.detail || options.reason || options.note || '').trim(),
        `Case strength ${strengthInfo.strength} (linked ${strengthInfo.linked}, status ${suspect?.status || 'none'}).`,
        `Outcome: ${outcome}.`,
        seizeUnlocked
            ? (restrained
                ? 'Seize rights confirmed while subject is restrained.'
                : 'Probable cause recorded — restrain the subject before seizure.')
            : 'No seize unlock.',
    ].filter(Boolean);

    const evidence = logEvidence({
        type: EVIDENCE_TYPES.CONFRONTATION,
        title: `Confrontation: ${target.name}`,
        detail: detailParts.join(' '),
        source: 'confront',
        linkedSuspectKeys: [key],
    }).evidence;
    linkEvidenceToSuspect(evidence.id, key);

    pushCaseLog(state, `Confronted ${target.name} → ${outcome}.`);
    return {
        applied: true,
        outcome,
        seizeUnlocked,
        strength: strengthInfo.strength,
        evidence,
        suspect,
    };
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
        generations: '',
        note: '',
        kind: '',
        notebook: '',
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
    if (!officerMayPerformAction(speaker, action)) {
        return { applied: false, reason: 'insufficient_clearance' };
    }

    if (action === CASE_ACTIONS.LOG) {
        const evidence = logEvidence({
            type: Object.values(EVIDENCE_TYPES).includes(parsed.type) ? parsed.type : EVIDENCE_TYPES.STATEMENT,
            title: parsed.title || `Officer report: ${speaker.name}`,
            detail: parsed.detail || parsed.reason || parsed.note || '',
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
            notes: parsed.detail || parsed.reason || parsed.note || `Pinned by officer ${speaker.name}.`,
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
            reason: parsed.reason || parsed.detail || parsed.note || `Restrained by officer ${speaker.name}.`,
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

    if (action === CASE_ACTIONS.WARRANT) {
        const target = resolveTargetActorByName(parsed.target);
        if (!target?.name) {
            return { applied: false, reason: 'missing_target' };
        }
        const result = fileWarrant(target, {
            note: parsed.note || parsed.detail || parsed.reason || '',
            generations: parsed.generations,
            filedBy: speaker,
        });
        return {
            applied: Boolean(result.applied),
            reason: result.reason || 'warrant_filed',
            warrant: result.warrant,
        };
    }

    if (action === CASE_ACTIONS.CONFRONT) {
        const target = resolveTargetActorByName(parsed.target);
        if (!target?.name) {
            return { applied: false, reason: 'missing_target' };
        }
        const result = confrontSuspect(target, {
            note: parsed.note || parsed.detail || parsed.reason || '',
            detail: parsed.detail || parsed.reason || parsed.note || '',
        });
        return {
            applied: Boolean(result.applied),
            reason: result.reason || result.outcome || 'confronted',
            outcome: result.outcome,
            seizeUnlocked: result.seizeUnlocked,
            strength: result.strength,
        };
    }

    if (action === CASE_ACTIONS.SURVEIL) {
        const kindRaw = String(parsed.kind || '').trim().toLowerCase();
        let kind = Object.values(SURVEILLANCE_KINDS).includes(kindRaw) ? kindRaw : '';
        const target = parsed.target ? resolveTargetActorByName(parsed.target) : null;
        if (!kind) {
            kind = target?.name ? SURVEILLANCE_KINDS.TRAIL : SURVEILLANCE_KINDS.BUG_ROOM;
        }

        // Field officers may only append reports against existing plants.
        const officer = getOfficerRecord(speaker);
        if (officer?.clearance === OFFICER_CLEARANCE.FIELD) {
            const state = getInvestigatorState();
            const plant = state.surveillance.find((entry) => (
                entry.status === SURVEILLANCE_STATUS.ACTIVE
                && (
                    (target?.name && normalizeKnowledgeKey(entry.target?.name) === normalizeKnowledgeKey(target.name))
                    || (parsed.target && normalizeKnowledgeKey(entry.location) === normalizeKnowledgeKey(parsed.target))
                    || (parsed.notebook && entry.notebookItemId === String(parsed.notebook || '').trim())
                )
            ));
            if (!plant) {
                return { applied: false, reason: 'insufficient_clearance' };
            }
            const signal = pushSurveillanceSignal(plant, {
                kind: SURVEILLANCE_SIGNAL_KINDS.OFFICER_REPORT,
                sourceEvent: 'ai_report',
                eventKey: makeEventKey('ai', plant.id, Date.now(), parsed.note || parsed.detail),
                text: parsed.note || parsed.detail || parsed.reason || `Officer report from ${speaker.name}.`,
                linkedSuspectKeys: plant.targetKey ? [plant.targetKey] : [],
            });
            return { applied: Boolean(signal.applied), reason: signal.reason || 'surveil_reported', signal: signal.signal };
        }

        const result = plantSurveillance({
            kind,
            target,
            location: kind === SURVEILLANCE_KINDS.BUG_ROOM ? (parsed.target || parsed.detail || '') : '',
            notebookItemId: parsed.notebook || '',
            label: parsed.title || '',
            plantedBy: speaker,
        });
        if (result.applied && (parsed.note || parsed.detail || parsed.reason)) {
            pushSurveillanceSignal(result.plant, {
                kind: SURVEILLANCE_SIGNAL_KINDS.OFFICER_REPORT,
                sourceEvent: 'ai_report',
                eventKey: makeEventKey('ai-plant', result.plant.id, Date.now()),
                text: parsed.note || parsed.detail || parsed.reason,
                linkedSuspectKeys: result.plant.targetKey ? [result.plant.targetKey] : [],
            });
        }
        return { applied: Boolean(result.applied), reason: result.reason || 'surveil_planted', plant: result.plant };
    }

    if (action === CASE_ACTIONS.ANALYZE) {
        const result = analyzeVictimPattern({
            note: parsed.note || parsed.detail || parsed.reason || '',
        });
        return {
            applied: Boolean(result.applied),
            reason: result.reason || 'analyzed',
            report: result.report,
            evidence: result.evidence,
        };
    }

    if (action === CASE_ACTIONS.BROADCAST) {
        const result = createBroadcastTrap({
            decoyName: parsed.target || parsed.title || '',
            challenge: parsed.detail || parsed.note || parsed.reason || '',
            createdBy: speaker,
        });
        return { applied: Boolean(result.applied), reason: result.reason || 'broadcast_armed', trap: result.trap };
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
    const warrants = (state.warrants || []).filter((entry) => entry.status === WARRANT_STATUS.PENDING);
    const plants = (state.surveillance || []).filter((entry) => entry.status === SURVEILLANCE_STATUS.ACTIVE);
    const traps = (state.broadcastTraps || []).filter((entry) => entry.status === BROADCAST_TRAP_STATUS.ACTIVE);
    const recentSignals = (state.signals || []).slice(0, 5);

    return {
        play_role: getPlayRole(),
        case_id: state.caseId,
        case_title: state.caseTitle,
        case_action_tag: CASE_ACTION_BLOCK_TAG,
        example_officer: officers[0]?.actor?.name || 'Officer Name',
        officers_block: officers.length
            ? officers.map((entry) => (
                `- ${entry.actor?.name || 'Officer'} (${entry.rank || 'Officer'} / clearance:${entry.clearance || OFFICER_CLEARANCE.FIELD})`
            )).join('\n')
            : 'No Task Force officers assigned yet.',
        suspects_block: suspects.length
            ? suspects.map((entry) => {
                const strength = getCaseStrength(entry.key).strength;
                return `- ${entry.actor?.name || 'Unknown'} [${entry.status}] strength:${strength}${entry.notes ? `: ${entry.notes}` : ''}`;
            }).join('\n')
            : 'No suspects pinned.',
        evidence_block: evidence.length
            ? evidence.map((entry) => `- ${entry.title}: ${entry.detail || '(no detail)'}`).join('\n')
            : 'No evidence logged.',
        restrained_block: restrained.length
            ? restrained.map((entry) => `- ${entry.actor?.name || 'Unknown'}${entry.reason ? `: ${entry.reason}` : ''}`).join('\n')
            : 'Nobody currently marked restrained.',
        warrants_block: warrants.length
            ? warrants.map((entry) => (
                `- ${entry.target?.name || 'Unknown'} (${entry.generationsLeft} gen left)${entry.note ? `: ${entry.note}` : ''}`
            )).join('\n')
            : 'No pending warrants.',
        surveillance_block: plants.length
            ? [
                ...plants.map((entry) => `- ${entry.label || entry.kind} [${entry.kind}]`),
                ...recentSignals.map((entry) => `  signal: ${entry.text || entry.kind}`),
            ].join('\n')
            : 'No active surveillance plants.',
        traps_block: traps.length
            ? traps.map((entry) => `- ${entry.decoyName}${entry.challenge ? `: ${entry.challenge}` : ''}`).join('\n')
            : 'No active broadcast traps.',
    };
}

export {
    PLAY_ROLES,
    SUSPECT_STATUSES,
    EVIDENCE_TYPES,
    CASE_ACTIONS,
    CASE_ACTION_BLOCK_TAG,
    DEFAULT_CASE_PROMPT_TEMPLATE,
    OFFICER_CLEARANCE,
    SURVEILLANCE_KINDS,
    SURVEILLANCE_STATUS,
    BROADCAST_TRAP_STATUS,
    WARRANT_STATUS,
    WARRANT_RESULTS,
    getActorKey,
};
