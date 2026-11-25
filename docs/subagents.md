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

- explorer: return a map of files, symbols and line numbers, no edits, no speculation, and the
  searches that returned nothing so the parent does not repeat them.
- reviewer: nine checks (scope, correctness, evidence, tests, secrets, validation, architecture,
  dead weight, criticality) and one verdict: pass, changes-requested, escalate.
- notetaker: return JSON facts with kind, text, tags, importance; the service writes them.
- worker: implement, run the exact acceptance command, report commands and output tails.
- planner: return tasks with title, files, dependsOn, critical, brief; 1 to 12 tasks, each with
  the command that proves it.
- every type: if blocked, return `BLOCKED: <the one missing input>` and stop instead of guessing.

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

Child threads never list as top-level conversations. The sidebar nests them under the parent row
with a type icon, label, status and elapsed time; clicking one opens the parent thread with the
subagent pane on that child. A child never has its own route.

The dock above the composer is a compact chip row: type icons, a running or finished count, and a
chevron. It never shows the task or the prompt. Opening a chip shows the pane with the type,
model and status in its header, the task behind a collapsed `Task brief` disclosure, the child
timeline, and the summary. The right-hand Activity panel lists every child with its state, and
running tool calls expose their output tail.

Council workers and reviewers are child threads too, so they nest under the goal thread.
