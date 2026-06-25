# Elaborator (specs)

## Open questions & notes

- Is an agent iteration just one iteration, or does it loop multiple times until confident? maxIterations?
- Do we run validation after the agent iteration, or do we give the agent a tool and instruct it to validate the stuff? I'm pretty sure we need to run validation and continue the loop if validation fails. What if the agent gets stuck fixing validation failures? I see some ways:
  1. Ask the user to resolve the issue — but the agent itself shouldn't know it can hand off to the user, because the agent will abuse that.
  2. Show warnings that it's a bad state, but continue iterations and so on.
  3. Send a high-priority signal to look at it — but what if, after looking, it fails again and adds the signal again?
- What's the strategy for running iterations? E.g. in interactive mode it might be continuous until all signals are processed — but for a daemon? cron? IDK.
- Should we track the progress of elaboration in percent? If yes, how? What if we're done 100% but then there's a change the Elaborator will cover soon — there's still a moment when it's "100%" but not actually 100%.
