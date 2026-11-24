# Subagents

Tuffcode runs typed subagents. Each type has its own prompt, its own model, and its own
fallback, so a cheap explorer does not burn the same model as a worker.

## Types

| Type | Job | Tools | Worktree |
| --- | --- | --- | --- |
| `explorer` | Map the repository for one question, return file:line facts | read, glob, grep | no, read-only |
| `reviewer` | Judge a diff against the brief with the nine-point rubric | read, glob, grep | no, read-only |
| `notetaker` | Extract durable facts and write them to the brain | read, glob, grep | no, read-only |
| `worker` | Implement and verify one task | all six | yes, own branch |
| `planner` | Decompose a goal into a JSON task list | read, glob, grep | no, read-only |

## Prompts

Prompts live in `packages/prompt/src/subagents.ts`. Each one states the role, the output shape,
the evidence it must return, and what it must not do. They are compact by design; the shared base
prompt carries the engineering rules.

- explorer: return a map of files, symbols and line numbers, no edits, no speculation.
- reviewer: nine checks (scope, correctness, evidence, tests, secrets, validation, architecture,
  dead weight, criticality) and one verdict: pass, changes-requested, escalate.
- notetaker: return JSON facts with kind, text, tags, importance; the service writes them.
- worker: implement, run the narrowest check, report commands and output.
- planner: return tasks with title, files, dependsOn, critical, brief; 1 to 12 tasks.

## Models

Settings, Agents and tools, lists every type with a provider, a model, and a fallback model. The
resolution order is: configured provider and model, then fallback model, then the parent thread's
provider and model. A missing or disabled provider falls back rather than failing the spawn.

Concurrency is capped by `subagentConcurrency` (default 4, max 8); extra children queue.

## Lifecycle

`subagents.spawn` persists a queued row and returns a child id immediately. The service starts
the child when a slot frees, streams `subagent.started`, `subagent.event` and
`subagent.finished` to the parent thread, and writes a summary. `subagents.cancel` stops a queued,
running, or mid-provisioning child. `subagents.list` survives restarts; unfinished children are
marked failed on startup.

The main agent can spawn a child with the `subagent` tool (`{ type, task, model? }`). The tool
returns the child id; the parent polls `subagents.list` or watches `subagent.finished`. Read-only
turns cannot spawn.

## UI

A card appears in the parent thread where the child was spawned. Opening it shows a side pane
with the child timeline, the same block renderer as the main thread, a connector line, tabs for
multiple children, and a cancel action. A compact strip reports running children when the pane is
closed.
