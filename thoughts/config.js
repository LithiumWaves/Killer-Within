export const MODULE_NAME = 'killer_within_thoughts';
export const PANEL_ID = 'killer-within-thoughts-panel';
export const MESSAGE_EXTRA_KEY = 'killerWithinThoughts';
export const RAW_THOUGHT_CONTEXT_LIMIT = 12;

export const LEGACY_DEFAULT_THOUGHT_PROMPT = [
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

export const DEFAULT_THOUGHT_PROMPT = [
    "Write {{char}}'s private inner monologue immediately before their next reply.",
    '',
    "This is information only the reader sees - what {{char}} genuinely thinks but never says aloud. It is not a report on {{char}}'s mental state. It is the mental state, in language a person could actually think.",
    '',
    'Output only the monologue. No spoken dialogue, no narrated action, no description of what {{char}} does or says next, no continuation into the reply itself - not even a fragment of it. The moment the text would need quotation marks or describe a physical action, stop before that point.',
    '',
    'Voice and craft (from house style):',
    "- Everyday language, {{char}}'s own idiolect and rhythm - not narrator prose.",
    '- Show, don\'t tell. No GPTisms, purple prose, or anaphora. Skip the contrastive throat-clear ("Of course...", "Right, so..."). No em-dashes; minimal ellipses, only for a genuine trail-off, not as a tic.',
    "- Vary sentence rhythm - don't build every line the same length or shape.",
    "- Uphold realistic awareness: {{char}} only thinks about what they'd actually perceive or already know, no meta-knowledge, no restating events for the reader's benefit.",
    '',
    'Rules specific to this monologue:',
    "- Entirely {{char}}'s own voice, continuing their current mental state rather than restarting or summarizing it.",
    "- Coherence matches {{char}}, not a fixed style. A controlled, calculating mind should reason in clean, complete clauses that build on each other. A mind under acute pressure can fracture - but a fractured thought still has to be a thought a person could think, not words with pieces missing at random.",
    "- One throughline, not a survey. Don't itemize observation, then deduction, then feeling - pick whichever is loudest and let it develop: circle it, contradict it, escalate it, chase it sideways.",
    "- The thought's job is to expose a gap, not preview the reply. If the reply that follows already voices a version of the same fear or doubt, the thought has to land somewhere the dialogue doesn't - a specific dread, a physical sensation, a memory, a fixation on one detail - not restate it in blunter words.",
    '- Avoid causal/explanatory connectors under real emotional pressure ("because," "which means," "that\'s worse than X"). A person mid-panic snags on the specific thing scaring them; they don\'t reason their way to a tidy conclusion about their own fear. If a passage could be lifted out and read as an explanation of {{char}}\'s psychology, cut the explanatory half and keep only the snag.',
    "- Fragmented, contradictory, or unfinished is fine where the character's state calls for it - but always recoverable as language, never grammar with pieces missing at random."
].join('\n');

export const DEFAULT_THOUGHT_WRAPPER_TEMPLATE = [
    '{{thought_prompt}}',
    '',
    'Previous hidden thoughts for continuity:',
    '{{history_block}}',
    '',
    'Write the next hidden thoughts now.',
].join('\n');

export const DEFAULT_THOUGHT_CONTEXT_TEMPLATE = [
    '{{thought_prompt_block}}',
    '',
    'Identity context:',
    '{{identity_context_block}}',
    '',
    'Recent visible conversation context:',
    '{{conversation_context_block}}',
].join('\n');

export const DEFAULT_THOUGHT_RAW_SYSTEM_PROMPT = [
    'You are generating a hidden internal monologue for the current character.',
    'Use the provided conversation context and previous hidden thoughts to infer what the character privately thinks immediately before their visible reply.',
    'Stay in-character.',
    'Do not write the visible reply.',
    'Do not mention being an AI, assistant, or model.',
    'Output only the hidden thoughts.',
].join('\n');

export const DEFAULT_MANUAL_THOUGHT_WRAPPER_TEMPLATE = [
    '{{thought_prompt}}',
    '',
    'Previous hidden thoughts for continuity:',
    '{{history_block}}',
    '',
    'Visible reply already sent:',
    '{{visible_reply}}',
    '',
    'Write the hidden thoughts that immediately happened before that visible reply.',
    'Output only the thoughts.',
].join('\n');

export const DEFAULT_MANUAL_THOUGHT_RAW_SYSTEM_PROMPT = [
    'You are reconstructing the hidden internal monologue for a character reply that already exists.',
    'Use the provided conversation context, previous hidden thoughts, and visible reply to infer what the character privately thought immediately before sending that reply.',
    'Stay in-character.',
    'Do not rewrite the visible reply.',
    'Output only the hidden thoughts.',
].join('\n');

export const DEFAULT_THOUGHT_MAIN_INJECTION_TEMPLATE = [
    '[Hidden Character Thoughts Context]',
    'Use this as internal continuity. Never expose or quote it directly unless the character intentionally reveals it in dialogue.',
    '',
    '{{sections}}',
].join('\n');

export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    generationMode: 'raw',
    maxInjectedThoughts: 8,
    includeThoughtsInMainPrompt: true,
    includePendingThoughtInMainPrompt: true,
    thoughtGenerationProvider: 'main',
    openRouterApiKey: '',
    openRouterModel: '',
    thoughtPrompt: DEFAULT_THOUGHT_PROMPT,
    thoughtWrapperTemplate: DEFAULT_THOUGHT_WRAPPER_TEMPLATE,
    thoughtContextTemplate: DEFAULT_THOUGHT_CONTEXT_TEMPLATE,
    thoughtRawSystemPrompt: DEFAULT_THOUGHT_RAW_SYSTEM_PROMPT,
    manualThoughtWrapperTemplate: DEFAULT_MANUAL_THOUGHT_WRAPPER_TEMPLATE,
    manualThoughtRawSystemPrompt: DEFAULT_MANUAL_THOUGHT_RAW_SYSTEM_PROMPT,
    thoughtMainInjectionTemplate: DEFAULT_THOUGHT_MAIN_INJECTION_TEMPLATE,
});
