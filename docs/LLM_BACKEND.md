# LLM Backend (Claude Code, Codex)

## Open questions & notes

- Is it possible to decline the human-in-the-loop if the LLM Backend decides to ask the user something? For the Claude Code CLI it never hits the HITL, probably.
- Do we use the CLI for the LLM Backend, or do we write our own request engine?
- What are the pros/cons of having the Claude CLI as the backend?
- Should the response from the Backend be formatted, e.g. JSON?
- Backend per agent, e.g. Claude Code CLI Sonnet for the Elaborator and Claude Code CLI Opus for the Consolidator.
