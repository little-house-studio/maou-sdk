import { normalizePasteText, peelRegion, punchSpans } from "./extractors.js";
import { fillLowConfidenceWithLlm } from "./llm-fill.js";
import {
  builtinCatalogModelIds,
  collectModelIds,
  extractModelGuesses,
  fetchModelIds,
  fetchPublicCatalogIds,
  matchAllModelsInText,
  MODEL_CATALOG_TIMEOUT_MS,
  pickPrimaryModel,
} from "./model-name.js";
import { DEFAULT_PROTOCOL, guessProtocolFromUrl } from "./request-url.js";
import { collectFieldSpecs, type FieldSpec } from "./schema.js";
import type {
  ParseClipboardOptions,
  ParseClipboardResult,
  ParseClipboardSchema,
  ParsedField,
  SpanHit,
} from "./types.js";

const DEFAULT_CONFIRM = 0.85;

function pickBest(hits: SpanHit[]): SpanHit | undefined {
  if (!hits.length) return undefined;
  return [...hits].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (a.labeled !== b.labeled) return a.labeled ? -1 : 1;
    return a.start - b.start;
  })[0];
}

function applyPeel(
  fields: Record<string, ParsedField>,
  specs: FieldSpec[],
  addressValue: string,
): void {
  const peeled = peelRegion(addressValue);
  const map: Array<[keyof typeof peeled, string[]]> = [
    ["province", ["province", "省"]],
    ["city", ["city", "市"]],
    ["district", ["district", "区", "县"]],
    ["detail", ["detail", "address_detail", "street"]],
  ];
  for (const [key, aliases] of map) {
    const value = peeled[key];
    if (!value) continue;
    const spec = specs.find((s) => aliases.includes(s.name) || aliases.includes(s.hint));
    if (!spec) continue;
    const existing = fields[spec.name];
    if (existing && existing.confidence >= 0.85) continue;
    fields[spec.name] = {
      value,
      confidence: 0.8,
      source: "regex",
    };
  }
}

function needsConfirmFor(
  spec: FieldSpec,
  field: ParsedField | undefined,
  threshold: number,
): boolean {
  if (spec.required && (field == null || field.value == null || field.value === "")) return true;
  if (!field) return false;
  if (field.source === "ambiguous") return true;
  return field.confidence < threshold;
}

export async function parseClipboard(
  raw: string,
  schema: ParseClipboardSchema,
  options: ParseClipboardOptions = {},
): Promise<ParseClipboardResult> {
  const specs = collectFieldSpecs(schema);
  const fields: Record<string, ParsedField> = {};
  const used: SpanHit[] = [];
  const text = normalizePasteText(raw);

  for (const spec of specs) {
    if (spec.extractor === "model") continue;
    const hits = spec.extract(text);
    if (hits.length >= 2 && hits[0]!.confidence >= 0.85 && hits[1]!.confidence >= 0.85) {
      const a = hits[0]!;
      const b = hits[1]!;
      if (a.value !== b.value) {
        fields[spec.name] = {
          value: a.value,
          confidence: Math.min(a.confidence, 0.7),
          source: "ambiguous",
          candidates: [...new Set(hits.map((h) => h.value))],
        };
        used.push(a);
        continue;
      }
    }
    const best = pickBest(hits);
    if (!best) continue;
    fields[spec.name] = {
      value: best.value,
      confidence: best.confidence,
      source: "regex",
    };
    if (spec.extractor !== "protocol") used.push(best);
  }

  const addressField = specs.find((s) => s.extractor === "address" && fields[s.name]?.value);
  if (addressField && typeof fields[addressField.name]?.value === "string") {
    applyPeel(fields, specs, String(fields[addressField.name]!.value));
  }

  const protocolSpec = specs.find((s) => s.extractor === "protocol");
  if (protocolSpec && !fields[protocolSpec.name]?.value) {
    const urlSpec = specs.find((s) => s.extractor === "base_url" || s.extractor === "url");
    const url = urlSpec ? String(fields[urlSpec.name]?.value ?? "") : "";
    const fromUrl = url ? guessProtocolFromUrl(url) : undefined;
    fields[protocolSpec.name] = {
      value: fromUrl ?? DEFAULT_PROTOCOL,
      confidence: fromUrl ? 0.88 : url ? 0.86 : 0.8,
      source: "regex",
    };
  }

  const modelSpec = specs.find((s) => s.extractor === "model");
  if (modelSpec && !fields[modelSpec.name]?.value) {
    const urlSpec = specs.find((s) => s.extractor === "base_url" || s.extractor === "url");
    const keySpec = specs.find((s) => s.extractor === "api_key");
    const url = urlSpec ? String(fields[urlSpec.name]?.value ?? "") : "";
    const key = keySpec ? String(fields[keySpec.name]?.value ?? "") : "";
    const proto = protocolSpec ? String(fields[protocolSpec.name]?.value ?? "") : "";
    const wantNet = options.probeModels !== false;

    const [providerIds, catalogIds] = await Promise.all([
      wantNet && url
        ? fetchModelIds({
            url,
            key: key || undefined,
            protocol: proto || undefined,
            timeoutMs: options.modelListTimeoutMs,
            fetchImpl: options.fetchImpl,
          })
        : Promise.resolve([] as string[]),
      options.catalogModelIds
        ? Promise.resolve(options.catalogModelIds)
        : wantNet
          ? fetchPublicCatalogIds({
              timeoutMs: options.modelListTimeoutMs ?? MODEL_CATALOG_TIMEOUT_MS,
              fetchImpl: options.fetchImpl,
            })
          : Promise.resolve(builtinCatalogModelIds()),
    ]);

    const listedIds = [...new Set([...providerIds, ...catalogIds].map((id) => id.trim()).filter(Boolean))];
    const collected = collectModelIds(text, listedIds);
    const primary = pickPrimaryModel(text, collected);
    if (primary) {
      const spans = matchAllModelsInText(text, collected);
      fields[modelSpec.name] = {
        value: primary,
        confidence: 0.95,
        source: "list",
        candidates: collected.length > 1 ? collected : undefined,
      };
      if (spans.length) used.push(...spans);
    }
  }
  if (modelSpec && !fields[modelSpec.name]?.value) {
    const guess = pickBest(extractModelGuesses(text, used));
    if (guess) {
      fields[modelSpec.name] = {
        value: guess.value,
        confidence: guess.confidence,
        source: "regex",
      };
      used.push(guess);
    }
  }

  const leftovers = punchSpans(text, used);

  if (options.llm) {
    await fillLowConfidenceWithLlm(fields, specs, leftovers, options.llm);
  }

  const threshold = options.confirmBelow ?? DEFAULT_CONFIRM;
  const needsConfirm = specs
    .filter((s) => needsConfirmFor(s, fields[s.name], threshold))
    .map((s) => s.name);

  return { fields, leftovers, needsConfirm };
}
