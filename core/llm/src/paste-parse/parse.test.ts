import { describe, expect, it, vi } from "vitest";
import { ADDRESS_SCHEMA, LLM_PRESET_SCHEMA } from "./builtins.js";
import { parseClipboard } from "./parse.js";

describe("parseClipboard", () => {
  it("labeled chinese address", async () => {
    const raw = [
      "收件人：李四",
      "手机：13900139000",
      "地址：浙江省杭州市西湖区文三路100号",
    ].join("\n");
    const r = await parseClipboard(raw, ADDRESS_SCHEMA);
    expect(r.fields.phone?.value).toBe("13900139000");
    expect(r.fields.phone?.source).toBe("regex");
    expect(r.fields.name?.value).toBe("李四");
    expect(r.fields.address?.value).toMatch(/文三路100号/);
    expect(r.fields.province?.value).toBe("浙江省");
    expect(r.fields.city?.value).toBe("杭州市");
    expect(r.fields.district?.value).toBe("西湖区");
    expect(r.needsConfirm).not.toContain("phone");
  });

  it("one-line paste", async () => {
    const r = await parseClipboard(
      "张三 13800138000 广东省深圳市南山区科技园1号",
      ADDRESS_SCHEMA,
    );
    expect(r.fields.phone?.value).toBe("13800138000");
    expect(r.fields.name?.value).toBe("张三");
    expect(r.fields.address?.value).toMatch(/科技园1号/);
    expect(r.fields.province?.value).toBe("广东省");
    expect(r.fields.city?.value).toBe("深圳市");
    expect(r.fields.district?.value).toBe("南山区");
  });

  it("two phones are ambiguous", async () => {
    const r = await parseClipboard(
      "张三 13800138000 13900139000 北京市朝阳区建国路1号",
      ADDRESS_SCHEMA,
    );
    expect(r.fields.phone?.source).toBe("ambiguous");
    expect(r.fields.phone?.candidates).toEqual(
      expect.arrayContaining(["13800138000", "13900139000"]),
    );
    expect(r.needsConfirm).toContain("phone");
  });

  it("email + url", async () => {
    const r = await parseClipboard("联系 邮箱 foo@bar.com 官网 https://example.com/path", {
      fields: [
        { name: "email", extract: "email" },
        { name: "url", extract: "url" },
      ],
    });
    expect(r.fields.email?.value).toBe("foo@bar.com");
    expect(r.fields.url?.value).toBe("https://example.com/path");
    expect(r.leftovers).not.toMatch(/foo@bar.com/);
  });

  it("llm preset paste", async () => {
    const r = await parseClipboard(
      [
        "api_key: sk-abcDEF1234567890",
        "base_url: https://api.openai.com/v1",
        "model: gpt-4o",
      ].join("\n"),
      LLM_PRESET_SCHEMA,
      { probeModels: false },
    );
    expect(r.fields.api_key?.value).toBe("sk-abcDEF1234567890");
    expect(r.fields.base_url?.value).toBe("https://api.openai.com/v1");
    expect(r.fields.protocol?.value).toBe("openai");
    expect(r.fields.model?.value).toBe("gpt-4o");
    expect(r.needsConfirm).toEqual([]);
  });

  it("empty input leaves required fields for confirm", async () => {
    const r = await parseClipboard("", ADDRESS_SCHEMA);
    expect(r.fields).toEqual({});
    expect(r.leftovers).toBe("");
    expect(r.needsConfirm).toEqual(expect.arrayContaining(["name", "phone", "address"]));
  });

  it("llm does not overwrite high-confidence regex", async () => {
    const callJson = vi.fn(async () => ({
      phone: "19900001111",
      name: "应被采用",
    }));
    const r = await parseClipboard("手机：13800138000", ADDRESS_SCHEMA, {
      llm: { callJson },
    });
    expect(r.fields.phone?.value).toBe("13800138000");
    expect(r.fields.phone?.source).toBe("regex");
    expect(r.fields.name?.value).toBe("应被采用");
    expect(r.fields.name?.source).toBe("llm");
    expect(callJson).toHaveBeenCalledOnce();
  });

  it("accepts json schema properties", async () => {
    const r = await parseClipboard("手机 18600001111", {
      type: "object",
      properties: {
        phone: { type: "string", "x-extract": "phone" },
        note: { type: "string" },
      },
      required: ["phone"],
    });
    expect(r.fields.phone?.value).toBe("18600001111");
    expect(r.needsConfirm).not.toContain("phone");
    expect(r.needsConfirm).not.toContain("note");
  });

  it("normalizes fullwidth digits", async () => {
    const r = await parseClipboard("手机：１３８００１３８０００", ADDRESS_SCHEMA);
    expect(r.fields.phone?.value).toBe("13800138000");
  });

  it("accepts dashed mobile numbers", async () => {
    const r = await parseClipboard("李四 138-0013-8000 上海市浦东新区世纪大道1号", ADDRESS_SCHEMA);
    expect(r.fields.phone?.value).toBe("13800138000");
    expect(r.fields.city?.value).toBe("上海市");
  });
});
