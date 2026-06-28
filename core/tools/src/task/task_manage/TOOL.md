## 使用指引

- 仅在用户给出多步骤复杂任务时使用。简单对话、单步操作不需要创建任务。
- action=create：创建任务列表，每项需指定 id、desc、deps、status。
- action=replace：替换整个任务列表（用于大幅调整计划）。
- action=delete：删除任务列表。
- deps 是依赖关系：任务 B 依赖任务 A，则 B 的 deps 包含 A 的 id。无依赖设空数组 []。
- 任务创建后，每完成一步用 edit 修改 status：pending → in_progress → completed。
- 不要过度规划——3 步以内的简单任务直接做，不需要 task_manage。
