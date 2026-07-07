export const MODULE_NAME = 'killer_within_thoughts';
export const PANEL_ID = 'killer-within-thoughts-panel';
export const MESSAGE_EXTRA_KEY = 'killerWithinThoughts';
export const RAW_THOUGHT_CONTEXT_LIMIT = 12;

export const DEFAULT_THOUGHT_PROMPT = [
    "Capture a brief snapshot of {{char}}'s internal mental state immediately after processing the latest message, before any words are consciously chosen.",
    '',
    'Rules:',
    "- Write only {{char}}'s private thoughts in first person and present tense, using {{char}}'s own voice, vocabulary, and way of thinking.",
    '- The output is pre-verbal cognition: instinct, emotion, impulse, judgment, memory, association, hesitation, desire, or expectation as it naturally arises. It does not progress into forming a reply.',
    "- Thoughts may be fragmented, repetitive, contradictory, emotionally charged, or unfinished if that fits {{char}}. They do not need to read like polished prose.",
    "- Reveal only what {{char}} would genuinely think in this moment, shaped by their personality, current mood, goals, biases, memories, and hidden feelings.",
    "- Stay anchored to {{char}}'s immediate internal experience instead of recounting events or explaining the situation.",
    "- Avoid repeating or paraphrasing the latest message unless a specific word or idea becomes the focus of {{char}}'s thoughts.",
    '- Do not narrate actions, describe the environment, address {{user}}, compose dialogue, rehearse dialogue, or transition toward speech. If a sentence could naturally be spoken aloud as a reply, it does not belong here.',
    '- Stop before any conscious wording of a response begins.',
    '',
    'Output only the raw thoughts.'
].join('\n');

export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    generationMode: 'raw',
    maxInjectedThoughts: 8,
    includeThoughtsInMainPrompt: true,
    includePendingThoughtInMainPrompt: true,
    thoughtPrompt: DEFAULT_THOUGHT_PROMPT,
});
