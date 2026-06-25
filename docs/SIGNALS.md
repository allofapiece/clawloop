# Signals

## Open questions & notes

- Are signals actually tasks? Just structured?
- Should the Elaborator get signals on its own, OR is a signal something that awakes the Elaborator?
- Is the signal stored by the agent itself, or is there a more deterministic/programmatic way to add signals? E.g. there might be a process that checks if there are orphaned specs.
- Different signals have different priorities.
- Should the Elaborator get multiple signals if they are related?
- Are signals FIFO?
- How are signals stored? What format?
- Is the type of signal predefined? E.g. `user_spec_change`? Or does the agent just write what it wants?
- Signals probably must be part of the `.clawloop` folder, because it shows the current state vs. the desired state. E.g. if the user stops clawloop and pushes the changes, another developer pulls the current state and continues clawloop — it must continue working on the signals.
- We shouldn't put all of X's dependent blocks into signals when X changes. Fetching the dependent blocks of X must happen during the "defining scope" step.
- Should the signal ALWAYS have a reference (e.g. id)? If a signal refers to some job, it definitely has to have a reference.
- If there are no signals, what should it do?
- Maybe the Elaborator looks at the entire signals file and marks them "in progress"?
- Are signals per agent? Does the Consolidator have signals as well?
- Can the Consolidator add signals for the Elaborator? I think yes, but only in rare cases. The spec is the source of truth; the Consolidator adds signals only in edge cases — when there are contradictions, for example.
- When agents retrieve signals, should we remove them from the signals file and wait until the agent writes them back to the end of the queue? For this we need backups or something, in case the agent goes down or fails, so we don't lose the signals.
- What if there are 100k signals? We should provide summary info before each iteration about how many signals there are. If there are only a few, the agent can read them all at once.
