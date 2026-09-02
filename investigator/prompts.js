import {
    CASE_ACTION_BLOCK_TAG,
    DEFAULT_CASE_PROMPT_TEMPLATE,
    INVESTIGATOR_MESSAGE_EXTRA_KEY,
} from './config.js';
import {
    buildCasePromptReplacements,
    getInvestigatorSettings,
    getInvestigatorState,
    isInvestigatorRole,
} from './core.js';

function renderPromptTemplate(template, replacements = {}) {
    return String(template || '').replace(/\{\{([a-z0-9_]+)\}\}/gi, (_match, key) => {
        return Object.hasOwn(replacements, key) ? String(replacements[key] ?? '') : '';
    });
}

export function shouldInjectInvestigatorCasePrompt() {
    if (isInvestigatorRole()) {
        return true;
    }
    const state = getInvestigatorState();
    return Array.isArray(state?.officers) && state.officers.length > 0;
}

export function buildInvestigatorCasePromptText() {
    if (!shouldInjectInvestigatorCasePrompt()) {
        return '';
    }
    const settings = getInvestigatorSettings();
    const template = String(settings.casePromptTemplate || DEFAULT_CASE_PROMPT_TEMPLATE);
    return renderPromptTemplate(template, {
        ...buildCasePromptReplacements(),
        case_action_tag: CASE_ACTION_BLOCK_TAG,
    }).trim();
}

export function getInvestigatorCasePromptInjectionMessage() {
    const injection = buildInvestigatorCasePromptText();
    if (!injection) {
        return null;
    }

    return {
        name: 'Task Force Case',
        is_user: false,
        is_system: true,
        send_date: Date.now(),
        mes: injection,
        extra: {
            [INVESTIGATOR_MESSAGE_EXTRA_KEY]: {
                injected: true,
                casePrompt: true,
            },
        },
    };
}
