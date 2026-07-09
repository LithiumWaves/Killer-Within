[OPEN] Debug Session: notebook-reveal-missing

## Symptom
- Expected: When the Death Note is opened while at least one other character is present (Presence), the next completion should include a system injection telling present characters that {{user}} pulled out a strange black notebook.
- Actual: User reports this does not seem to trigger.

## Repro Notes (to fill)
- Presence enabled:
- At least one other character marked present:
- Action: Open Death Note (full notebook, not scrap):
- Observation:

## Hypotheses (falsifiable)
1. The open action does not call `markNotebookPresenceRevealPending()` due to the Presence detection returning false.
2. The pending flag is set, but `getNotebookRevealPromptInjectionMessage()` is not being inserted into the outgoing chat by the generation interceptor.
3. The pending flag is set and injection is inserted, but it is being removed/overwritten later in the pipeline.
4. The injection is generated but `consumeNotebookPresenceRevealPending()` clears it too early (or never clears), resulting in no message reaching the model.

## Evidence Plan
- Instrument: open-event path, Presence detector output, pending flag state transitions, prompt builder output, and actual insertion into the outgoing chat array.
- Collect: logs from a single reproduce attempt, then compare to expected state machine.

## Log References
- Pre-fix:
- Post-fix:

## Status
- Next step: Add instrumentation + run repro once.

