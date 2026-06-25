# clawloop

**A spec is the desired state; agents continuously close the gap.**

You write a **User Spec** — only what you actually care about. clawloop's agents expand it into an
**Agent Spec** — the fully-resolved interpretation, with every ambiguity decided — and keep the
system reconciled toward it. The User Spec is the source of truth: agents never change it, only the
user does.

## The two-layer spec

- **User Spec (US)** — human-owned and authoritative. Written in [MyST](https://mystmd.org) Markdown;
  clawloop reads `id`s, so silence is meaningful (what you don't specify, the system is free to decide).
  No Agent Spec may contradict it.
- **Agent Spec (AS)** — the machine-owned interpretation of the US. Split across blocks that can depend
  on one another; revisable as the US evolves.

## Components

| Component | Role |
|---|---|
| **Elaborator** | Expands the User Spec into the Agent Spec, resolving ambiguity. |
| **Consolidator** | Works the AS down into drafts/code. |
| **Signals** | Structured triggers that wake agents (e.g. a US change) and drive the loop. |
| **Agent Diaries** | Per-agent working memory across iterations. |
| **LLM Backend** | The model an agent runs on (e.g. Claude Code CLI), configurable per agent. |

Everything clawloop owns lives under `.clawloop/` (like `.git`): the User Spec, the Agent Spec, agent
config, and runtime state.

> **Status: early design.** The concept is being worked out one component at a time. See
> [`docs/`](docs/) for the per-component design notes and open questions.

## CLI

```bash
clawloop init        # scaffold .clawloop/ — asks where the User Spec lives
clawloop init -y     # same, non-interactive, using defaults
```

`init` creates `.clawloop/` with `user-spec/` and `agent-spec/` folders and a `settings.json`
recording the User Spec path and each agent's backend.

## Develop

```bash
npm install
npm run build        # tsc → dist/
npm test             # vitest
npm run dev -- init  # run the CLI from source via tsx
```

## License

[MIT](LICENSE)
