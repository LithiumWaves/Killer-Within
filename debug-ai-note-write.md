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
- Pre-fix reproduction captured in `.dbg/trae-debug-log-ai-note-write.ndjson`.
- H1 rejected: `processAssistantNotebookWriteMessage()` saw the final bracket block (`hasBracketBlock: true`) before stripping.
- H2 rejected: extraction and parse succeeded for `writer: Mikayla` and `entry: Viktor Gonza`.
- H3 narrowed/confirmed: `appendAiNotebookLine()` prepared `nextPages[0] = "Viktor Gonza"`, but page state was already empty immediately after `setNotebookPages()`.
- H4 partially confirmed: the debug toggle computed the correct raw target text after generation, but the visible chat did not update retroactively.
- H5 still inconclusive: need instrumentation inside `setNotebookPages()` and `reconcileEntriesFromNotebookPages()` to prove where the notebook text is wiped.

## Next Step
- Add one more instrumentation layer inside `setNotebookPages()` and `reconcileEntriesFromNotebookPages()` to capture normalized pages before assignment and notebook state after reconciliation.
