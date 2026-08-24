# get_goal

Read the current `/goal` contract.

Use goal tools for one long-running completion objective in the current session. create_goal may infer goal intent from a direct human request in any language; do not create a goal for routine single-turn work. Call get_goal before update_goal and copy its exact goal_id and revision. After session resume or fork, an active goal is disarmed: when a human asks to continue or resume in any wording or language, use update_goal action resume to rearm it. During a goal-mode round, report progress with `<task_completion>` instead of update_goal complete/blocked. This is not the host-verified `/ultragoal`.
