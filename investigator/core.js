import {
    DEFAULT_INVESTIGATOR_SETTINGS,
    EVIDENCE_TYPES,
    INVESTIGATOR_CHAT_METADATA_KEY,
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
        version: 1,
        caseId: `TF-${String(Date.now()).slice(-6)}`,
        caseTitle: 'Kira Case File',
        suspects: [],
        evidence: [],
        restrained: [],
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

function normalizeInvestigatorState(value) {
    const defaults = createDefaultInvestigatorState();
    const state = value && typeof value === 'object' ? value : {};
    return {
        version: 1,
        caseId: String(state.caseId || defaults.caseId).trim() || defaults.caseId,
        caseTitle: String(state.caseTitle || defaults.caseTitle).trim() || defaults.caseTitle,
        suspects: (Array.isArray(state.suspects) ? state.suspects : []).map(normalizeSuspect),
        evidence: (Array.isArray(state.evidence) ? state.evidence : []).map(normalizeEvidence),
        restrained: (Array.isArray(state.restrained) ? state.restrained : []).map(normalizeRestrained),
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

export {
    PLAY_ROLES,
    SUSPECT_STATUSES,
    EVIDENCE_TYPES,
    getActorKey,
};
