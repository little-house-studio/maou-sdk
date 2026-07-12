import { describe, expect, it } from "vitest";
import {
  digitCoreVariants,
  entityHitScore,
  extractQueryCore,
  filterHeadTokenFalseHits,
  isHeadTokenCollapsed,
  looksLikeDictionaryHeadwordPage,
  phraseQueryVariants,
  softRecoverEntityHits,
} from "./query_core.js";

describe("query_core head-token fix", () => {
  it("extracts multi-char core from 是什么梗 questions", () => {
    expect(extractQueryCore("巧乐兹火车头是什么梗")).toBe("巧乐兹火车头");
    expect(extractQueryCore("特异人士什么梗 全文")).toContain("特异人士");
    expect(extractQueryCore("粘连科技怎么死了")).toBe("粘连科技");
    expect(extractQueryCore("飞8分钱是什么梗")).toBe("飞8分钱");
  });

  it("rejects dictionary single-char page for multi-char core", () => {
    const hit = entityHitScore("巧（汉字）_百度百科 拼音 qiǎo", "巧乐兹火车头是什么梗");
    expect(hit.score).toBe(0);
    expect(hit.reason).toMatch(/head-token|no-core|partial-head/);
  });

  it("accepts title containing multi-char entity span", () => {
    const hit = entityHitScore(
      "巧乐兹火车头是什么梗 抖音视频",
      "巧乐兹火车头是什么梗",
    );
    expect(hit.score).toBeGreaterThan(0.5);
  });

  it("brand-prefix 巧乐兹 is weak hit not zero; 单字巧 is zero", () => {
    const brand = entityHitScore("巧乐兹 夫妇 是什么意思 哔哩哔哩", "巧乐兹火车头是什么梗");
    expect(brand.score).toBeGreaterThan(0.3);
    expect(brand.score).toBeLessThan(0.5);
    expect(brand.reason).toMatch(/brand-prefix/);
    const head = entityHitScore("巧（汉字）_百度百科 拼音", "巧乐兹火车头是什么梗");
    expect(head.score).toBe(0);
  });

  it("accepts co-occurrence 巧乐兹 + 火车头 covering full core", () => {
    const hit = entityHitScore("火车头 巧乐兹 meme 解释", "巧乐兹火车头是什么梗");
    expect(hit.score).toBeGreaterThan(0.7);
    expect(hit.coverage).toBeGreaterThan(0.9);
  });

  it("filterHeadTokenFalseHits drops 巧 dictionary, keeps full and brand-prefix", () => {
    const { kept, dropped } = filterHeadTokenFalseHits(
      [
        {
          title: "巧（汉字）_百度百科",
          url: "https://baike.baidu.com/item/巧/1",
          snippet: "汉字",
        },
        {
          title: "巧乐兹火车头是什么梗",
          url: "https://www.douyin.com/video/1",
          snippet: "巧乐兹 火车头 梗解释",
        },
        {
          title: "巧乐兹夫妇是什么意思",
          url: "https://bilibili.com/x",
          snippet: "下头夫妇",
        },
        {
          title: "粘连的病因",
          url: "https://dayi.org.cn/x",
          snippet: "手术后粘连",
        },
      ],
      "巧乐兹火车头是什么梗",
    );
    expect(dropped).toBeGreaterThanOrEqual(1);
    expect(kept.some((r) => r.title.includes("火车头"))).toBe(true);
    expect(kept.every((r) => !/^巧（/.test(r.title))).toBe(true);
    // 品牌前缀可保留；医学「粘连」与字典「巧」必须丢
    expect(kept.every((r) => !r.title.includes("粘连的病因"))).toBe(true);
  });

  it("looksLikeDictionaryHeadwordPage", () => {
    expect(
      looksLikeDictionaryHeadwordPage("巧（汉字）_百度百科", "https://baike.baidu.com/item/x"),
    ).toBe(true);
    expect(
      looksLikeDictionaryHeadwordPage("巧乐兹火车头是什么梗", "https://bilibili.com/v"),
    ).toBe(false);
  });

  it("phraseQueryVariants quotes core and splits long entity", () => {
    const v = phraseQueryVariants("巧乐兹火车头是什么梗");
    expect(v.some((x) => x.includes('"巧乐兹火车头"'))).toBe(true);
    expect(v.some((x) => /巧乐兹\s+火车头/.test(x))).toBe(true);
  });

  it("digit meme core requires 飞8分钱 not 让子弹飞分钱", () => {
    expect(entityHitScore("让子弹飞分钱 经典语录", "飞8分钱是什么梗").score).toBe(0);
    expect(
      entityHitScore("飞8分钱是谐音飞爸坟前 张顺飞直播", "飞8分钱是什么梗").score,
    ).toBeGreaterThan(0.5);
  });

  it("digit core accepts 飞八分钱 synonym without relying on URL digits", () => {
    const hit = entityHitScore(
      "飞八分钱是什么梗 烂科普",
      "飞8分钱是什么梗",
      { url: "https://www.bilibili.com/video/av238407246" },
    );
    expect(hit.score).toBeGreaterThan(0.5);
    // URL-only 8 must not rescue unrelated 飞分钱
    const bad = entityHitScore("让子弹飞分钱", "飞8分钱是什么梗", {
      url: "https://example.com/page/8/detail",
    });
    expect(bad.score).toBe(0);
  });

  it("digitCoreVariants includes 八 form", () => {
    expect(digitCoreVariants("飞8分钱").some((v) => v.includes("八"))).toBe(true);
  });

  it("粘连科技 keeps entity, medical 粘连 alone is miss", () => {
    expect(entityHitScore("粘连科技 StickTech B站", "粘连科技怎么死了").score).toBe(1);
    expect(entityHitScore("术后肠粘连的病因与治疗", "粘连科技怎么死了").score).toBe(0);
  });

  it("softRecover never revives dictionary headword pages", () => {
    const recovered = softRecoverEntityHits(
      [
        {
          title: "巧（汉字）_百度百科",
          url: "https://baike.baidu.com/item/巧/1",
          snippet: "汉字",
        },
        {
          title: "巧乐兹夫妇",
          url: "https://bilibili.com",
          snippet: "下头",
        },
      ],
      "巧乐兹火车头是什么梗",
    );
    expect(recovered.every((r) => !r.title.includes("汉字"))).toBe(true);
    // brand-prefix 现已有弱分，硬过滤即可留下；软回收也不回灌字典
    expect(recovered.some((r) => r.title.includes("巧乐兹"))).toBe(true);
  });

  it("isHeadTokenCollapsed detects dictionary-only SERP", () => {
    expect(
      isHeadTokenCollapsed(
        [
          { title: "巧（汉字）_百度百科", url: "https://baike.baidu.com/item/x", snippet: "" },
          { title: "巧 qiǎo - 汉典", url: "https://www.zdic.net/x", snippet: "" },
          { title: "巧的拼音", url: "https://dict.com/x", snippet: "字典" },
        ],
        "巧乐兹火车头是什么梗",
      ),
    ).toBe(true);
    expect(
      isHeadTokenCollapsed(
        [{ title: "粘连科技 StickTech", url: "https://bilibili.com", snippet: "UP主" }],
        "粘连科技怎么死了",
      ),
    ).toBe(false);
  });

  it("3-char core 大狗叫 full match", () => {
    expect(entityHitScore("大狗叫是什么梗 叮咚鸡", "大狗叫是什么梗").score).toBe(1);
    expect(entityHitScore("大狗是人类的朋友", "大狗叫是什么梗").score).toBe(0);
  });
});
