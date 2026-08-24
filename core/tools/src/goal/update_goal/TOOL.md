# update_goal

Update the exact current `/goal` revision. Call get_goal first and copy its id and revision. Disabled while a host-verified `/ultragoal` is open.

- `edit` / `pause` / `resume` require a direct human turn on the top-level agent.
- During a goal-mode round, report progress with `<task_completion>` instead of `complete` / `blocked`.
- `complete` / `blocked` remain available on a direct human turn.
