import { createToolScaffold, ToolRegistry, DynamicToolLoader } from "@little-house-studio/tools";
createToolScaffold("my_tool", "./_toolinit_test/tools/my_tool", { description: "测试工具" });
const reg = new ToolRegistry();
const r = await DynamicToolLoader.loadFromDir("./_toolinit_test/tools", reg);
const schemas = reg.nativeToolSchemas();
console.log("RESULT loaded=" + JSON.stringify(r.loaded) + " failed=" + r.failed.length + " 工具=" + schemas.map((s:any)=>s.function?.name||s.name).join(","));
