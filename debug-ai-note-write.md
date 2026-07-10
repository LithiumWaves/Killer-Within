# Debug Session: ai-note-write

Status: OPEN

## Symptom
- AI notebook write blocks appear in assistant messages.
- The block is not reliably hidden/shown according to the debug toggle.
- Retrieving the notebook still shows no written entry.

## Scope
- `deathnote/core.js`
- `deathnote/events.js`
- `deathnote/index.js`
- `deathnote/ui.js`
- `deathnote/prompts.js`

## Hypotheses
- H1: The finalized assistant message contains the block, but `processAssistantNotebookWriteMessage()` is not being called on the event that sees that final text.
- H2: The parser extracts the block, but the write is rejected before notebook state is mutated.
- H3: Notebook state is mutated, but the line is appended to a page that the notebook viewer is not displaying after retrieval.
- H4: The message visibility toggle is operating on stale chat text rather than the stored raw/stripped variants for the processed message.
- H5: Another later reconciliation or UI refresh path is overwriting the notebook pages after the AI write succeeds.

## Evidence Log
- Pending instrumentation.

## Next Step
- Add runtime instrumentation around block extraction, parse result, notebook page mutation, and post-refresh notebook page state.
