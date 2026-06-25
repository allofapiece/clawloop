# Agent Spec (AS)

## Open questions & notes

- How verbose/detailed should the AS be? How many files must it be split into? How to decide? Probably the agent decides on its own.
- We need validation of the spec: no orphaned dependencies. (Not sure about this, because if the user removes a block the Elaborator will fix it later — but there is still a moment when the spec is not valid.)
- AS blocks can depend on other AS blocks.
- How are the connections between blocks stored?
- We need a hash mechanism for each block, to understand when it has changed and to update all related blocks.
- We need a sort of groups/tags mechanism that defines the group of a spec block.
- We need a sort of "essentials" mechanism: all specs in a group depend on the "essential" spec of that group.
- Can an essential exist without a group? If yes, why and how?
