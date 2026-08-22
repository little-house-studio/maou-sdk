import type { PasteSchema } from "./types.js";

export const ADDRESS_SCHEMA: PasteSchema = {
  id: "address",
  title: "快递地址",
  fields: [
    { name: "name", extract: "name", required: true },
    { name: "phone", extract: "phone", required: true },
    { name: "address", extract: "address", required: true },
    { name: "province", extract: "province" },
    { name: "city", extract: "city" },
    { name: "district", extract: "district" },
    { name: "postal", extract: "postal" },
    { name: "tracking", extract: "tracking" },
  ],
};

export const LLM_PRESET_SCHEMA: PasteSchema = {
  id: "llm_preset",
  title: "LLM 预设",
  fields: [
    { name: "api_key", extract: "api_key", required: true },
    { name: "base_url", extract: "base_url" },
    { name: "protocol", extract: "protocol" },
    { name: "model", extract: "model" },
  ],
};
