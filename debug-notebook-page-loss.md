# Debug Session: notebook-page-loss
- **Status**: [OPEN]
- **Issue**: User notebook entries vanish on close and page turn on both mobile and PC after the multi-Death-Note refactor.
- **Debug Server**: http://192.168.0.12:7777/event
- **Log File**: .dbg/trae-debug-log-notebook-page-loss.ndjson

## Reproduction Steps
1. Open a Death Note held by the user.
2. Type text into a page.
3. Close and reopen the notebook, or flip to the next page.
4. Observe whether the written text persists and whether the left/right page content advances correctly.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | The page-turn callback rerenders with a stale spread index or stale notebook ID. | High | Low | Rejected |
| B | The selected notebook ID changes or resolves differently between input, close, and rerender. | High | Low | Rejected |
| C | The widget rebuilds before the latest textarea value is committed to notebook state. | Medium | Low | Rejected |
| D | A legacy sync path overwrites the selected notebook pages during refresh. | High | Medium | Confirmed |
| E | The page expansion path preserves animation but rebuilds the wrong visible page pair. | Medium | Low | Secondary symptom |

## Log Evidence
- Instrumentation added to notebook ID lookup, page writes, widget rebuild, close/open refresh, and page-turn callbacks.
- Evidence chain:
  - `setNotebookPages` logged a successful write to `death-note-main` with `nextFirstPage: "TEST-BETA-1"`.
  - The very next page-turn request still saw `pageCount: 1` and empty visible pages.
  - `buildWidgetHtml` then rerendered the inside cover and an empty first page again.
  - This isolates the loss to a re-entrant state rebuild after the write, not to notebook selection or the turn animation itself.

## Verification Conclusion
- Applied minimal fix: reconcile notebook entries against the already-mutated live `state` object instead of calling `getChatState()` again from inside `setNotebookPages`, `setNotebookText`, and scrap writes.
- Applied persistence fix: bind the Death Note state to the active `chatId`/group/character cache key and reattach that live object to `context.chatMetadata` on each read/save.
- Pending post-fix user verification.
