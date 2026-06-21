// ⚠️ 自动生成（scripts/generate-models.mjs，数据源 models.dev/api.json）。
// 请勿手改——重新运行脚本即可更新。
// 生成时间：2026-06-21
// 模型总数：609，厂商：16
import type { ProviderSpec } from "./types.js";
export const CATALOG_GENERATED: ProviderSpec[] = [
  {
    "id": "xai",
    "name": "xAI",
    "protocol": "openai",
    "baseUrl": "https://api.x.ai/v1/chat/completions",
    "envKey": "XAI_API_KEY",
    "models": [
      {
        "id": "grok-4.20-0309-non-reasoning",
        "provider": "xai",
        "name": "Grok 4.20 (Non-Reasoning)",
        "protocol": "openai",
        "baseUrl": "https://api.x.ai/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 30000,
        "pricing": {
          "input": 1.25,
          "output": 2.5,
          "cacheRead": 0.2,
          "currency": "USD"
        }
      },
      {
        "id": "grok-4.3",
        "provider": "xai",
        "name": "Grok 4.3",
        "protocol": "openai",
        "baseUrl": "https://api.x.ai/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 30000,
        "pricing": {
          "input": 1.25,
          "output": 2.5,
          "cacheRead": 0.2,
          "currency": "USD"
        }
      },
      {
        "id": "grok-4.20-0309-reasoning",
        "provider": "xai",
        "name": "Grok 4.20 (Reasoning)",
        "protocol": "openai",
        "baseUrl": "https://api.x.ai/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 30000,
        "pricing": {
          "input": 1.25,
          "output": 2.5,
          "cacheRead": 0.2,
          "currency": "USD"
        }
      },
      {
        "id": "grok-build-0.1",
        "provider": "xai",
        "name": "Grok Build 0.1",
        "protocol": "openai",
        "baseUrl": "https://api.x.ai/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 256000,
        "pricing": {
          "input": 1,
          "output": 2,
          "cacheRead": 0.2,
          "currency": "USD"
        }
      }
    ]
  },
  {
    "id": "moonshotai",
    "name": "Moonshot AI",
    "protocol": "openai",
    "baseUrl": "https://api.moonshot.ai/v1/chat/completions",
    "envKey": "MOONSHOT_API_KEY",
    "models": [
      {
        "id": "kimi-k2-0905-preview",
        "provider": "moonshotai",
        "name": "Kimi K2 0905",
        "protocol": "openai",
        "baseUrl": "https://api.moonshot.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.6,
          "output": 2.5,
          "cacheRead": 0.15,
          "currency": "USD"
        },
        "knowledge": "2024-10"
      },
      {
        "id": "kimi-k2-thinking-turbo",
        "provider": "moonshotai",
        "name": "Kimi K2 Thinking Turbo",
        "protocol": "openai",
        "baseUrl": "https://api.moonshot.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 1.15,
          "output": 8,
          "cacheRead": 0.15,
          "currency": "USD"
        },
        "knowledge": "2024-08"
      },
      {
        "id": "kimi-k2.7-code",
        "provider": "moonshotai",
        "name": "Kimi K2.7 Code",
        "protocol": "openai",
        "baseUrl": "https://api.moonshot.ai/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.95,
          "output": 4,
          "cacheRead": 0.19,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "kimi-k2-thinking",
        "provider": "moonshotai",
        "name": "Kimi K2 Thinking",
        "protocol": "openai",
        "baseUrl": "https://api.moonshot.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.6,
          "output": 2.5,
          "cacheRead": 0.15,
          "currency": "USD"
        },
        "knowledge": "2024-08"
      },
      {
        "id": "kimi-k2-0711-preview",
        "provider": "moonshotai",
        "name": "Kimi K2 0711",
        "protocol": "openai",
        "baseUrl": "https://api.moonshot.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.6,
          "output": 2.5,
          "cacheRead": 0.15,
          "currency": "USD"
        },
        "knowledge": "2024-10"
      },
      {
        "id": "kimi-k2-turbo-preview",
        "provider": "moonshotai",
        "name": "Kimi K2 Turbo",
        "protocol": "openai",
        "baseUrl": "https://api.moonshot.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 2.4,
          "output": 10,
          "cacheRead": 0.6,
          "currency": "USD"
        },
        "knowledge": "2024-10"
      },
      {
        "id": "kimi-k2.5",
        "provider": "moonshotai",
        "name": "Kimi K2.5",
        "protocol": "openai",
        "baseUrl": "https://api.moonshot.ai/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.6,
          "output": 3,
          "cacheRead": 0.1,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "kimi-k2.6",
        "provider": "moonshotai",
        "name": "Kimi K2.6",
        "protocol": "openai",
        "baseUrl": "https://api.moonshot.ai/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.95,
          "output": 4,
          "cacheRead": 0.16,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "kimi-k2.7-code-highspeed",
        "provider": "moonshotai",
        "name": "Kimi K2.7 Code HighSpeed",
        "protocol": "openai",
        "baseUrl": "https://api.moonshot.ai/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 1.9,
          "output": 8,
          "cacheRead": 0.38,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      }
    ]
  },
  {
    "id": "zhipuai",
    "name": "Zhipu AI",
    "protocol": "openai",
    "baseUrl": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "envKey": "ZHIPU_API_KEY",
    "models": [
      {
        "id": "glm-5.1",
        "provider": "zhipuai",
        "name": "GLM-5.1",
        "protocol": "openai",
        "baseUrl": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 131072,
        "pricing": {
          "input": 6,
          "output": 24,
          "cacheRead": 1.3,
          "cacheWrite": 0,
          "currency": "USD"
        }
      },
      {
        "id": "glm-5.2",
        "provider": "zhipuai",
        "name": "GLM-5.2",
        "protocol": "openai",
        "baseUrl": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 131072,
        "pricing": {
          "input": 1.4,
          "output": 4.4,
          "cacheRead": 0.26,
          "cacheWrite": 0,
          "currency": "USD"
        }
      },
      {
        "id": "glm-5v-turbo",
        "provider": "zhipuai",
        "name": "GLM-5V-Turbo",
        "protocol": "openai",
        "baseUrl": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        "input": [
          "text",
          "image",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 131072,
        "pricing": {
          "input": 5,
          "output": 22,
          "cacheRead": 1.2,
          "cacheWrite": 0,
          "currency": "USD"
        }
      },
      {
        "id": "glm-5",
        "provider": "zhipuai",
        "name": "GLM-5",
        "protocol": "openai",
        "baseUrl": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 204800,
        "maxTokens": 131072,
        "pricing": {
          "input": 1,
          "output": 3.2,
          "cacheRead": 0.2,
          "cacheWrite": 0,
          "currency": "USD"
        }
      },
      {
        "id": "glm-4.5-flash",
        "provider": "zhipuai",
        "name": "GLM-4.5-Flash",
        "protocol": "openai",
        "baseUrl": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 98304,
        "pricing": {
          "input": 0,
          "output": 0,
          "cacheRead": 0,
          "cacheWrite": 0,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "glm-4.7-flash",
        "provider": "zhipuai",
        "name": "GLM-4.7-Flash",
        "protocol": "openai",
        "baseUrl": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 131072,
        "pricing": {
          "input": 0,
          "output": 0,
          "cacheRead": 0,
          "cacheWrite": 0,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "glm-4.5-air",
        "provider": "zhipuai",
        "name": "GLM-4.5-Air",
        "protocol": "openai",
        "baseUrl": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 98304,
        "pricing": {
          "input": 0.2,
          "output": 1.1,
          "cacheRead": 0.03,
          "cacheWrite": 0,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "glm-4.6v",
        "provider": "zhipuai",
        "name": "GLM-4.6V",
        "protocol": "openai",
        "baseUrl": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.3,
          "output": 0.9,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "glm-4.6",
        "provider": "zhipuai",
        "name": "GLM-4.6",
        "protocol": "openai",
        "baseUrl": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 204800,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.6,
          "output": 2.2,
          "cacheRead": 0.11,
          "cacheWrite": 0,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "glm-4.7-flashx",
        "provider": "zhipuai",
        "name": "GLM-4.7-FlashX",
        "protocol": "openai",
        "baseUrl": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.07,
          "output": 0.4,
          "cacheRead": 0.01,
          "cacheWrite": 0,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "glm-4.5",
        "provider": "zhipuai",
        "name": "GLM-4.5",
        "protocol": "openai",
        "baseUrl": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 98304,
        "pricing": {
          "input": 0.6,
          "output": 2.2,
          "cacheRead": 0.11,
          "cacheWrite": 0,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "glm-4.5v",
        "provider": "zhipuai",
        "name": "GLM-4.5V",
        "protocol": "openai",
        "baseUrl": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 64000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.6,
          "output": 1.8,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "glm-4.7",
        "provider": "zhipuai",
        "name": "GLM-4.7",
        "protocol": "openai",
        "baseUrl": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 204800,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.6,
          "output": 2.2,
          "cacheRead": 0.11,
          "cacheWrite": 0,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      }
    ]
  },
  {
    "id": "mistral",
    "name": "Mistral",
    "protocol": "mistral",
    "baseUrl": "https://api.mistral.ai/v1/chat/completions",
    "envKey": "MISTRAL_API_KEY",
    "models": [
      {
        "id": "codestral-latest",
        "provider": "mistral",
        "name": "Codestral (latest)",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0.3,
          "output": 0.9,
          "currency": "USD"
        },
        "knowledge": "2024-10"
      },
      {
        "id": "mistral-large-latest",
        "provider": "mistral",
        "name": "Mistral Large (latest)",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.5,
          "output": 1.5,
          "currency": "USD"
        },
        "knowledge": "2024-11"
      },
      {
        "id": "open-mistral-7b",
        "provider": "mistral",
        "name": "Mistral 7B",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 8000,
        "maxTokens": 8000,
        "pricing": {
          "input": 0.25,
          "output": 0.25,
          "currency": "USD"
        },
        "knowledge": "2023-12"
      },
      {
        "id": "devstral-small-2507",
        "provider": "mistral",
        "name": "Devstral Small",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.1,
          "output": 0.3,
          "currency": "USD"
        },
        "knowledge": "2025-05"
      },
      {
        "id": "ministral-3b-latest",
        "provider": "mistral",
        "name": "Ministral 3B (latest)",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.04,
          "output": 0.04,
          "currency": "USD"
        },
        "knowledge": "2024-10"
      },
      {
        "id": "pixtral-large-latest",
        "provider": "mistral",
        "name": "Pixtral Large (latest)",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 128000,
        "pricing": {
          "input": 2,
          "output": 6,
          "currency": "USD"
        },
        "knowledge": "2024-11"
      },
      {
        "id": "mistral-nemo",
        "provider": "mistral",
        "name": "Mistral Nemo",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.15,
          "output": 0.15,
          "currency": "USD"
        },
        "knowledge": "2024-07"
      },
      {
        "id": "mistral-small-2506",
        "provider": "mistral",
        "name": "Mistral Small 3.2",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.1,
          "output": 0.3,
          "currency": "USD"
        },
        "knowledge": "2025-03"
      },
      {
        "id": "ministral-8b-latest",
        "provider": "mistral",
        "name": "Ministral 8B (latest)",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.1,
          "output": 0.1,
          "currency": "USD"
        },
        "knowledge": "2024-10"
      },
      {
        "id": "open-mixtral-8x22b",
        "provider": "mistral",
        "name": "Mixtral 8x22B",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 64000,
        "maxTokens": 64000,
        "pricing": {
          "input": 2,
          "output": 6,
          "currency": "USD"
        },
        "knowledge": "2024-04"
      },
      {
        "id": "mistral-medium-latest",
        "provider": "mistral",
        "name": "Mistral Medium (latest)",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.4,
          "output": 2,
          "currency": "USD"
        },
        "knowledge": "2025-05"
      },
      {
        "id": "devstral-small-2505",
        "provider": "mistral",
        "name": "Devstral Small 2505",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.1,
          "output": 0.3,
          "currency": "USD"
        },
        "knowledge": "2025-05"
      },
      {
        "id": "magistral-small",
        "provider": "mistral",
        "name": "Magistral Small",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.5,
          "output": 1.5,
          "currency": "USD"
        },
        "knowledge": "2025-06"
      },
      {
        "id": "mistral-medium-2604",
        "provider": "mistral",
        "name": "Mistral Medium 3.5",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 1.5,
          "output": 7.5,
          "currency": "USD"
        }
      },
      {
        "id": "mistral-small-latest",
        "provider": "mistral",
        "name": "Mistral Small (latest)",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 256000,
        "pricing": {
          "input": 0.15,
          "output": 0.6,
          "currency": "USD"
        },
        "knowledge": "2025-06"
      },
      {
        "id": "open-mixtral-8x7b",
        "provider": "mistral",
        "name": "Mixtral 8x7B",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 32000,
        "maxTokens": 32000,
        "pricing": {
          "input": 0.7,
          "output": 0.7,
          "currency": "USD"
        },
        "knowledge": "2024-01"
      },
      {
        "id": "devstral-latest",
        "provider": "mistral",
        "name": "Devstral 2",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.4,
          "output": 2,
          "currency": "USD"
        },
        "knowledge": "2025-12"
      },
      {
        "id": "mistral-small-2603",
        "provider": "mistral",
        "name": "Mistral Small 4",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 256000,
        "pricing": {
          "input": 0.15,
          "output": 0.6,
          "currency": "USD"
        },
        "knowledge": "2025-06"
      },
      {
        "id": "mistral-medium-2505",
        "provider": "mistral",
        "name": "Mistral Medium 3",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.4,
          "output": 2,
          "currency": "USD"
        },
        "knowledge": "2025-05"
      },
      {
        "id": "mistral-large-2411",
        "provider": "mistral",
        "name": "Mistral Large 2.1",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 16384,
        "pricing": {
          "input": 2,
          "output": 6,
          "currency": "USD"
        },
        "knowledge": "2024-11"
      },
      {
        "id": "mistral-medium-2508",
        "provider": "mistral",
        "name": "Mistral Medium 3.1",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.4,
          "output": 2,
          "currency": "USD"
        },
        "knowledge": "2025-05"
      },
      {
        "id": "open-mistral-nemo",
        "provider": "mistral",
        "name": "Open Mistral Nemo",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.15,
          "output": 0.15,
          "currency": "USD"
        },
        "knowledge": "2024-07"
      },
      {
        "id": "magistral-medium-latest",
        "provider": "mistral",
        "name": "Magistral Medium (latest)",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 2,
          "output": 5,
          "currency": "USD"
        },
        "knowledge": "2025-06"
      },
      {
        "id": "devstral-medium-latest",
        "provider": "mistral",
        "name": "Devstral 2 (latest)",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.4,
          "output": 2,
          "currency": "USD"
        },
        "knowledge": "2025-12"
      },
      {
        "id": "devstral-2512",
        "provider": "mistral",
        "name": "Devstral 2",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.4,
          "output": 2,
          "currency": "USD"
        },
        "knowledge": "2025-12"
      },
      {
        "id": "labs-devstral-small-2512",
        "provider": "mistral",
        "name": "Devstral Small 2",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 256000,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2025-12"
      },
      {
        "id": "pixtral-12b",
        "provider": "mistral",
        "name": "Pixtral 12B",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.15,
          "output": 0.15,
          "currency": "USD"
        },
        "knowledge": "2024-09"
      },
      {
        "id": "mistral-large-2512",
        "provider": "mistral",
        "name": "Mistral Large 3",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.5,
          "output": 1.5,
          "currency": "USD"
        },
        "knowledge": "2024-11"
      },
      {
        "id": "devstral-medium-2507",
        "provider": "mistral",
        "name": "Devstral Medium",
        "protocol": "mistral",
        "baseUrl": "https://api.mistral.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.4,
          "output": 2,
          "currency": "USD"
        },
        "knowledge": "2025-05"
      }
    ]
  },
  {
    "id": "google",
    "name": "Google",
    "protocol": "google",
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
    "envKey": "GEMINI_API_KEY",
    "models": [
      {
        "id": "gemini-3.1-flash-lite",
        "provider": "google",
        "name": "Gemini 3.1 Flash Lite",
        "protocol": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.25,
          "output": 1.5,
          "cacheRead": 0.025,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "gemini-2.5-pro",
        "provider": "google",
        "name": "Gemini 2.5 Pro",
        "protocol": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.125,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "gemini-2.5-flash",
        "provider": "google",
        "name": "Gemini 2.5 Flash",
        "protocol": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.3,
          "output": 2.5,
          "cacheRead": 0.03,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "gemini-3.5-flash",
        "provider": "google",
        "name": "Gemini 3.5 Flash",
        "protocol": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 1.5,
          "output": 9,
          "cacheRead": 0.15,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "gemma-4-31b-it",
        "provider": "google",
        "name": "Gemma 4 31B IT",
        "protocol": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 32768
      },
      {
        "id": "gemini-2.0-flash",
        "provider": "google",
        "name": "Gemini 2.0 Flash",
        "protocol": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.1,
          "output": 0.4,
          "cacheRead": 0.025,
          "currency": "USD"
        },
        "knowledge": "2024-06"
      },
      {
        "id": "gemini-3.1-pro-preview-customtools",
        "provider": "google",
        "name": "Gemini 3.1 Pro Preview Custom Tools",
        "protocol": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 2,
          "output": 12,
          "cacheRead": 0.2,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "gemini-flash-lite-latest",
        "provider": "google",
        "name": "Gemini Flash-Lite Latest",
        "protocol": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.1,
          "output": 0.4,
          "cacheRead": 0.025,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "gemini-2.5-flash-lite",
        "provider": "google",
        "name": "Gemini 2.5 Flash-Lite",
        "protocol": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.1,
          "output": 0.4,
          "cacheRead": 0.01,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "gemini-3.1-pro-preview",
        "provider": "google",
        "name": "Gemini 3.1 Pro Preview",
        "protocol": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 2,
          "output": 12,
          "cacheRead": 0.2,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "gemma-4-26b-a4b-it",
        "provider": "google",
        "name": "Gemma 4 26B A4B IT",
        "protocol": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 32768
      },
      {
        "id": "gemini-3-pro-preview",
        "provider": "google",
        "name": "Gemini 3 Pro Preview",
        "protocol": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 2,
          "output": 12,
          "cacheRead": 0.2,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "gemini-3-flash-preview",
        "provider": "google",
        "name": "Gemini 3 Flash Preview",
        "protocol": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.5,
          "output": 3,
          "cacheRead": 0.05,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "gemini-flash-latest",
        "provider": "google",
        "name": "Gemini Flash Latest",
        "protocol": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.3,
          "output": 2.5,
          "cacheRead": 0.075,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "gemini-3.1-flash-lite-preview",
        "provider": "google",
        "name": "Gemini 3.1 Flash Lite Preview",
        "protocol": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.25,
          "output": 1.5,
          "cacheRead": 0.025,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "gemini-2.0-flash-lite",
        "provider": "google",
        "name": "Gemini 2.0 Flash-Lite",
        "protocol": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.075,
          "output": 0.3,
          "currency": "USD"
        },
        "knowledge": "2024-06"
      }
    ]
  },
  {
    "id": "openai",
    "name": "OpenAI",
    "protocol": "openai",
    "baseUrl": "https://api.openai.com/v1",
    "envKey": "OPENAI_API_KEY",
    "models": [
      {
        "id": "o3",
        "provider": "openai",
        "name": "o3",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 100000,
        "pricing": {
          "input": 2,
          "output": 8,
          "cacheRead": 0.5,
          "currency": "USD"
        },
        "knowledge": "2024-05"
      },
      {
        "id": "gpt-5.2-pro",
        "provider": "openai",
        "name": "GPT-5.2 Pro",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 21,
          "output": 168,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "gpt-5",
        "provider": "openai",
        "name": "GPT-5",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.125,
          "currency": "USD"
        },
        "knowledge": "2024-09-30"
      },
      {
        "id": "gpt-5-pro",
        "provider": "openai",
        "name": "GPT-5 Pro",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 272000,
        "pricing": {
          "input": 15,
          "output": 120,
          "currency": "USD"
        },
        "knowledge": "2024-09-30"
      },
      {
        "id": "gpt-4o",
        "provider": "openai",
        "name": "GPT-4o",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 2.5,
          "output": 10,
          "cacheRead": 1.25,
          "currency": "USD"
        },
        "knowledge": "2023-09"
      },
      {
        "id": "gpt-4",
        "provider": "openai",
        "name": "GPT-4",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 8192,
        "maxTokens": 8192,
        "pricing": {
          "input": 30,
          "output": 60,
          "currency": "USD"
        },
        "knowledge": "2023-11"
      },
      {
        "id": "o4-mini",
        "provider": "openai",
        "name": "o4-mini",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 100000,
        "pricing": {
          "input": 1.1,
          "output": 4.4,
          "cacheRead": 0.275,
          "currency": "USD"
        },
        "knowledge": "2024-05"
      },
      {
        "id": "o3-pro",
        "provider": "openai",
        "name": "o3-pro",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 100000,
        "pricing": {
          "input": 20,
          "output": 80,
          "currency": "USD"
        },
        "knowledge": "2024-05"
      },
      {
        "id": "gpt-4o-2024-05-13",
        "provider": "openai",
        "name": "GPT-4o (2024-05-13)",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 5,
          "output": 15,
          "currency": "USD"
        },
        "knowledge": "2023-09"
      },
      {
        "id": "gpt-5.4-nano",
        "provider": "openai",
        "name": "GPT-5.4 nano",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.2,
          "output": 1.25,
          "cacheRead": 0.02,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "gpt-5.1-codex",
        "provider": "openai",
        "name": "GPT-5.1 Codex",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.125,
          "currency": "USD"
        },
        "knowledge": "2024-09-30"
      },
      {
        "id": "gpt-5.3-codex-spark",
        "provider": "openai",
        "name": "GPT-5.3 Codex Spark",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 32000,
        "pricing": {
          "input": 1.75,
          "output": 14,
          "cacheRead": 0.175,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "gpt-5.1-codex-max",
        "provider": "openai",
        "name": "GPT-5.1 Codex Max",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.125,
          "currency": "USD"
        },
        "knowledge": "2024-09-30"
      },
      {
        "id": "gpt-5.3-chat-latest",
        "provider": "openai",
        "name": "GPT-5.3 Chat (latest)",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 1.75,
          "output": 14,
          "cacheRead": 0.175,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "gpt-4o-2024-08-06",
        "provider": "openai",
        "name": "GPT-4o (2024-08-06)",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 2.5,
          "output": 10,
          "cacheRead": 1.25,
          "currency": "USD"
        },
        "knowledge": "2023-09"
      },
      {
        "id": "o3-mini",
        "provider": "openai",
        "name": "o3-mini",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 100000,
        "pricing": {
          "input": 1.1,
          "output": 4.4,
          "cacheRead": 0.55,
          "currency": "USD"
        },
        "knowledge": "2024-05"
      },
      {
        "id": "gpt-5.2",
        "provider": "openai",
        "name": "GPT-5.2",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.75,
          "output": 14,
          "cacheRead": 0.175,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "gpt-5.3-codex",
        "provider": "openai",
        "name": "GPT-5.3 Codex",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.75,
          "output": 14,
          "cacheRead": 0.175,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "gpt-5.1-codex-mini",
        "provider": "openai",
        "name": "GPT-5.1 Codex mini",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.25,
          "output": 2,
          "cacheRead": 0.025,
          "currency": "USD"
        },
        "knowledge": "2024-09-30"
      },
      {
        "id": "gpt-5.1-chat-latest",
        "provider": "openai",
        "name": "GPT-5.1 Chat",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.125,
          "currency": "USD"
        },
        "knowledge": "2024-09-30"
      },
      {
        "id": "gpt-5.2-chat-latest",
        "provider": "openai",
        "name": "GPT-5.2 Chat",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 1.75,
          "output": 14,
          "cacheRead": 0.175,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "o4-mini-deep-research",
        "provider": "openai",
        "name": "o4-mini-deep-research",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 100000,
        "pricing": {
          "input": 2,
          "output": 8,
          "cacheRead": 0.5,
          "currency": "USD"
        },
        "knowledge": "2024-05"
      },
      {
        "id": "gpt-4.1-nano",
        "provider": "openai",
        "name": "GPT-4.1 nano",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1047576,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.1,
          "output": 0.4,
          "cacheRead": 0.025,
          "currency": "USD"
        },
        "knowledge": "2024-04"
      },
      {
        "id": "gpt-4o-2024-11-20",
        "provider": "openai",
        "name": "GPT-4o (2024-11-20)",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 2.5,
          "output": 10,
          "cacheRead": 1.25,
          "currency": "USD"
        },
        "knowledge": "2023-09"
      },
      {
        "id": "o1",
        "provider": "openai",
        "name": "o1",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 100000,
        "pricing": {
          "input": 15,
          "output": 60,
          "cacheRead": 7.5,
          "currency": "USD"
        },
        "knowledge": "2023-09"
      },
      {
        "id": "o1-pro",
        "provider": "openai",
        "name": "o1-pro",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 100000,
        "pricing": {
          "input": 150,
          "output": 600,
          "currency": "USD"
        },
        "knowledge": "2023-09"
      },
      {
        "id": "gpt-5.4",
        "provider": "openai",
        "name": "GPT-5.4",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1050000,
        "maxTokens": 128000,
        "pricing": {
          "input": 2.5,
          "output": 15,
          "cacheRead": 0.25,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "gpt-5.4-mini",
        "provider": "openai",
        "name": "GPT-5.4 mini",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.75,
          "output": 4.5,
          "cacheRead": 0.075,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "gpt-4.1",
        "provider": "openai",
        "name": "GPT-4.1",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1047576,
        "maxTokens": 32768,
        "pricing": {
          "input": 2,
          "output": 8,
          "cacheRead": 0.5,
          "currency": "USD"
        },
        "knowledge": "2024-04"
      },
      {
        "id": "o3-deep-research",
        "provider": "openai",
        "name": "o3-deep-research",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 100000,
        "pricing": {
          "input": 10,
          "output": 40,
          "cacheRead": 2.5,
          "currency": "USD"
        },
        "knowledge": "2024-05"
      },
      {
        "id": "gpt-5-mini",
        "provider": "openai",
        "name": "GPT-5 Mini",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.25,
          "output": 2,
          "cacheRead": 0.025,
          "currency": "USD"
        },
        "knowledge": "2024-05-30"
      },
      {
        "id": "gpt-4.1-mini",
        "provider": "openai",
        "name": "GPT-4.1 mini",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1047576,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.4,
          "output": 1.6,
          "cacheRead": 0.1,
          "currency": "USD"
        },
        "knowledge": "2024-04"
      },
      {
        "id": "gpt-4-turbo",
        "provider": "openai",
        "name": "GPT-4 Turbo",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 10,
          "output": 30,
          "currency": "USD"
        },
        "knowledge": "2023-12"
      },
      {
        "id": "gpt-5-nano",
        "provider": "openai",
        "name": "GPT-5 Nano",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.05,
          "output": 0.4,
          "cacheRead": 0.005,
          "currency": "USD"
        },
        "knowledge": "2024-05-30"
      },
      {
        "id": "gpt-5.4-pro",
        "provider": "openai",
        "name": "GPT-5.4 Pro",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1050000,
        "maxTokens": 128000,
        "pricing": {
          "input": 30,
          "output": 180,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "gpt-5.5-pro",
        "provider": "openai",
        "name": "GPT-5.5 Pro",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1050000,
        "maxTokens": 128000,
        "pricing": {
          "input": 30,
          "output": 180,
          "currency": "USD"
        },
        "knowledge": "2025-12-01"
      },
      {
        "id": "gpt-4o-mini",
        "provider": "openai",
        "name": "GPT-4o mini",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.15,
          "output": 0.6,
          "cacheRead": 0.075,
          "currency": "USD"
        },
        "knowledge": "2023-09"
      },
      {
        "id": "gpt-5-codex",
        "provider": "openai",
        "name": "GPT-5-Codex",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.125,
          "currency": "USD"
        },
        "knowledge": "2024-09-30"
      },
      {
        "id": "gpt-5.2-codex",
        "provider": "openai",
        "name": "GPT-5.2 Codex",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.75,
          "output": 14,
          "cacheRead": 0.175,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "gpt-5.1",
        "provider": "openai",
        "name": "GPT-5.1",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.125,
          "currency": "USD"
        },
        "knowledge": "2024-09-30"
      },
      {
        "id": "gpt-5.5",
        "provider": "openai",
        "name": "GPT-5.5",
        "protocol": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1050000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 30,
          "cacheRead": 0.5,
          "currency": "USD"
        },
        "knowledge": "2025-12-01"
      }
    ]
  },
  {
    "id": "groq",
    "name": "Groq",
    "protocol": "openai",
    "baseUrl": "https://api.groq.com/openai/v1/chat/completions",
    "envKey": "GROQ_API_KEY",
    "models": [
      {
        "id": "llama-3.3-70b-versatile",
        "provider": "groq",
        "name": "Llama 3.3 70B",
        "protocol": "openai",
        "baseUrl": "https://api.groq.com/openai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.59,
          "output": 0.79,
          "currency": "USD"
        },
        "knowledge": "2023-12"
      },
      {
        "id": "llama-3.1-8b-instant",
        "provider": "groq",
        "name": "Llama 3.1 8B",
        "protocol": "openai",
        "baseUrl": "https://api.groq.com/openai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.05,
          "output": 0.08,
          "currency": "USD"
        },
        "knowledge": "2023-12"
      },
      {
        "id": "meta-llama/llama-4-scout-17b-16e-instruct",
        "provider": "groq",
        "name": "Llama 4 Scout 17B 16E",
        "protocol": "openai",
        "baseUrl": "https://api.groq.com/openai/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.11,
          "output": 0.34,
          "currency": "USD"
        },
        "knowledge": "2024-08"
      },
      {
        "id": "openai/gpt-oss-safeguard-20b",
        "provider": "groq",
        "name": "Safety GPT OSS 20B",
        "protocol": "openai",
        "baseUrl": "https://api.groq.com/openai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.075,
          "output": 0.3,
          "cacheRead": 0.037,
          "currency": "USD"
        }
      },
      {
        "id": "openai/gpt-oss-120b",
        "provider": "groq",
        "name": "GPT OSS 120B",
        "protocol": "openai",
        "baseUrl": "https://api.groq.com/openai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.15,
          "output": 0.6,
          "cacheRead": 0.075,
          "currency": "USD"
        }
      },
      {
        "id": "openai/gpt-oss-20b",
        "provider": "groq",
        "name": "GPT OSS 20B",
        "protocol": "openai",
        "baseUrl": "https://api.groq.com/openai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.075,
          "output": 0.3,
          "cacheRead": 0.0375,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3-32b",
        "provider": "groq",
        "name": "Qwen3-32B",
        "protocol": "openai",
        "baseUrl": "https://api.groq.com/openai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 40960,
        "pricing": {
          "input": 0.29,
          "output": 0.59,
          "currency": "USD"
        }
      }
    ]
  },
  {
    "id": "cerebras",
    "name": "Cerebras",
    "protocol": "openai",
    "baseUrl": "https://api.cerebras.ai/v1/chat/completions",
    "envKey": "CEREBRAS_API_KEY",
    "models": [
      {
        "id": "gpt-oss-120b",
        "provider": "cerebras",
        "name": "GPT OSS 120B",
        "protocol": "openai",
        "baseUrl": "https://api.cerebras.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 40960,
        "pricing": {
          "input": 0.35,
          "output": 0.75,
          "currency": "USD"
        }
      },
      {
        "id": "zai-glm-4.7",
        "provider": "cerebras",
        "name": "Z.AI GLM-4.7",
        "protocol": "openai",
        "baseUrl": "https://api.cerebras.ai/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 40960,
        "pricing": {
          "input": 2.25,
          "output": 2.75,
          "cacheRead": 0,
          "cacheWrite": 0,
          "currency": "USD"
        }
      }
    ]
  },
  {
    "id": "nvidia",
    "name": "Nvidia",
    "protocol": "openai",
    "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
    "envKey": "NVIDIA_API_KEY",
    "models": [
      {
        "id": "moonshotai/kimi-k2-instruct-0905",
        "provider": "nvidia",
        "name": "Kimi K2 0905",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2024-10"
      },
      {
        "id": "moonshotai/kimi-k2.6",
        "provider": "nvidia",
        "name": "Kimi K2.6",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "minimaxai/minimax-m2.7",
        "provider": "nvidia",
        "name": "MiniMax-M2.7",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 204800,
        "maxTokens": 131072,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "stepfun-ai/step-3.7-flash",
        "provider": "nvidia",
        "name": "Step 3.7 Flash",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "stepfun-ai/step-3.5-flash",
        "provider": "nvidia",
        "name": "Step 3.5 Flash",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "google/gemma-3n-e4b-it",
        "provider": "nvidia",
        "name": "Gemma 3n E4b It",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2024-06"
      },
      {
        "id": "google/gemma-3n-e2b-it",
        "provider": "nvidia",
        "name": "Gemma 3n E2b It",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2024-06"
      },
      {
        "id": "google/gemma-4-31b-it",
        "provider": "nvidia",
        "name": "Gemma-4-31B-IT",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "google/gemma-2-2b-it",
        "provider": "nvidia",
        "name": "Gemma 2 2b It",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "microsoft/phi-4-mini-instruct",
        "provider": "nvidia",
        "name": "Phi-4-Mini",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 8192,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2024-12"
      },
      {
        "id": "z-ai/glm-5.1",
        "provider": "nvidia",
        "name": "GLM-5.1",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 131072,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "openai/gpt-oss-120b",
        "provider": "nvidia",
        "name": "GPT-OSS-120B",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2025-08"
      },
      {
        "id": "openai/gpt-oss-20b",
        "provider": "nvidia",
        "name": "GPT OSS 20B",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 32768,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "bytedance/seed-oss-36b-instruct",
        "provider": "nvidia",
        "name": "ByteDance-Seed/Seed-OSS-36B-Instruct",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262000,
        "maxTokens": 262000,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "mistralai/mistral-7b-instruct-v03",
        "provider": "nvidia",
        "name": "Mistral-7B-Instruct-v0.3",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 65536,
        "maxTokens": 65536,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "mistralai/mixtral-8x7b-instruct",
        "provider": "nvidia",
        "name": "Mistral: Mixtral 8x7B Instruct",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 32768,
        "maxTokens": 16384,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "mistralai/mistral-small-4-119b-2603",
        "provider": "nvidia",
        "name": "mistral-small-4-119b-2603",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "mistralai/mistral-nemotron",
        "provider": "nvidia",
        "name": "mistral-nemotron",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "mistralai/mistral-large-3-675b-instruct-2512",
        "provider": "nvidia",
        "name": "Mistral Large 3 675B Instruct 2512",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "mistralai/mixtral-8x22b-instruct",
        "provider": "nvidia",
        "name": "Mistral: Mixtral 8x22B Instruct",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 65536,
        "maxTokens": 13108,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        "provider": "nvidia",
        "name": "Nemotron 3 Nano Omni",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video",
          "audio"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 65536,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "nvidia/nvidia-nemotron-nano-9b-v2",
        "provider": "nvidia",
        "name": "nvidia-nemotron-nano-9b-v2",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 131072,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2024-09"
      },
      {
        "id": "nvidia/nemotron-voicechat",
        "provider": "nvidia",
        "name": "nemotron-voicechat",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text",
          "audio"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "nvidia/nemotron-3-ultra-550b-a55b",
        "provider": "nvidia",
        "name": "Nemotron 3 Ultra 550B A55B",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.5,
          "output": 2.5,
          "cacheRead": 0.15,
          "currency": "USD"
        }
      },
      {
        "id": "nvidia/nemotron-3-nano-30b-a3b",
        "provider": "nvidia",
        "name": "nemotron-3-nano-30b-a3b",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 131072,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2024-09"
      },
      {
        "id": "nvidia/nemotron-mini-4b-instruct",
        "provider": "nvidia",
        "name": "nemotron-mini-4b-instruct",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "nvidia/nemotron-3-super-120b-a12b",
        "provider": "nvidia",
        "name": "Nemotron 3 Super",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.2,
          "output": 0.8,
          "currency": "USD"
        },
        "knowledge": "2024-04"
      },
      {
        "id": "abacusai/dracarys-llama-3_1-70b-instruct",
        "provider": "nvidia",
        "name": "dracarys-llama-3.1-70b-instruct",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "deepseek-ai/deepseek-v4-flash",
        "provider": "nvidia",
        "name": "DeepSeek V4 Flash",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 393216,
        "pricing": {
          "input": 0.14,
          "output": 0.28,
          "cacheRead": 0.0028,
          "currency": "USD"
        },
        "knowledge": "2025-05"
      },
      {
        "id": "deepseek-ai/deepseek-v4-pro",
        "provider": "nvidia",
        "name": "DeepSeek V4 Pro",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 393216,
        "pricing": {
          "input": 0.435,
          "output": 0.87,
          "cacheRead": 0.003625,
          "currency": "USD"
        },
        "knowledge": "2025-05"
      },
      {
        "id": "qwen/qwen3-next-80b-a3b-instruct",
        "provider": "nvidia",
        "name": "Qwen3-Next-80B-A3B-Instruct",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 16384,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2024-12"
      },
      {
        "id": "qwen/qwen3-coder-480b-a35b-instruct",
        "provider": "nvidia",
        "name": "Qwen3 Coder 480B A35B Instruct",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 66536,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "qwen/qwen2.5-coder-32b-instruct",
        "provider": "nvidia",
        "name": "Qwen2.5 Coder 32b Instruct",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3.5-397b-a17b",
        "provider": "nvidia",
        "name": "Qwen3.5-397B-A17B",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 8192,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2026-01"
      },
      {
        "id": "qwen/qwen3.5-122b-a10b",
        "provider": "nvidia",
        "name": "Qwen3.5 122B-A10B",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video",
          "audio"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 65536,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "sarvamai/sarvam-m",
        "provider": "nvidia",
        "name": "sarvam-m",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "meta/llama-3.1-8b-instruct",
        "provider": "nvidia",
        "name": "Llama 3.1 8B Instruct",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 16000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2023-12"
      },
      {
        "id": "meta/llama-3.1-70b-instruct",
        "provider": "nvidia",
        "name": "Llama 3.1 70b Instruct",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "meta/llama-3.2-1b-instruct",
        "provider": "nvidia",
        "name": "Llama 3.2 1b Instruct",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2023-12"
      },
      {
        "id": "meta/llama-3.2-11b-vision-instruct",
        "provider": "nvidia",
        "name": "Llama 3.2 11b Vision Instruct",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2023-12"
      },
      {
        "id": "meta/llama-3.3-70b-instruct",
        "provider": "nvidia",
        "name": "Llama 3.3 70b Instruct",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "meta/llama-3.2-90b-vision-instruct",
        "provider": "nvidia",
        "name": "Llama-3.2-90B-Vision-Instruct",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2023-12"
      },
      {
        "id": "meta/llama-4-maverick-17b-128e-instruct",
        "provider": "nvidia",
        "name": "Llama 4 Maverick 17b 128e Instruct",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2024-02"
      },
      {
        "id": "upstage/solar-10_7b-instruct",
        "provider": "nvidia",
        "name": "solar-10.7b-instruct",
        "protocol": "openai",
        "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      }
    ]
  },
  {
    "id": "anthropic",
    "name": "Anthropic",
    "protocol": "anthropic",
    "baseUrl": "https://api.anthropic.com/v1/messages",
    "envKey": "ANTHROPIC_API_KEY",
    "models": [
      {
        "id": "claude-opus-4-5",
        "provider": "anthropic",
        "name": "Claude Opus 4.5 (latest)",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "claude-haiku-4-5-20251001",
        "provider": "anthropic",
        "name": "Claude Haiku 4.5",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 1,
          "output": 5,
          "cacheRead": 0.1,
          "cacheWrite": 1.25,
          "currency": "USD"
        },
        "knowledge": "2025-02-28"
      },
      {
        "id": "claude-3-5-haiku-20241022",
        "provider": "anthropic",
        "name": "Claude Haiku 3.5",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.8,
          "output": 4,
          "cacheRead": 0.08,
          "cacheWrite": 1,
          "currency": "USD"
        },
        "knowledge": "2024-07-31"
      },
      {
        "id": "claude-opus-4-0",
        "provider": "anthropic",
        "name": "Claude Opus 4 (latest)",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 32000,
        "pricing": {
          "input": 15,
          "output": 75,
          "cacheRead": 1.5,
          "cacheWrite": 18.75,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "claude-3-opus-20240229",
        "provider": "anthropic",
        "name": "Claude Opus 3",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 4096,
        "pricing": {
          "input": 15,
          "output": 75,
          "cacheRead": 1.5,
          "cacheWrite": 18.75,
          "currency": "USD"
        },
        "knowledge": "2023-08-31"
      },
      {
        "id": "claude-opus-4-1-20250805",
        "provider": "anthropic",
        "name": "Claude Opus 4.1",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 32000,
        "pricing": {
          "input": 15,
          "output": 75,
          "cacheRead": 1.5,
          "cacheWrite": 18.75,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "claude-sonnet-4-5",
        "provider": "anthropic",
        "name": "Claude Sonnet 4.5 (latest)",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-07-31"
      },
      {
        "id": "claude-opus-4-7",
        "provider": "anthropic",
        "name": "Claude Opus 4.7",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2026-01-31"
      },
      {
        "id": "claude-opus-4-5-20251101",
        "provider": "anthropic",
        "name": "Claude Opus 4.5",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "claude-3-5-sonnet-20241022",
        "provider": "anthropic",
        "name": "Claude Sonnet 3.5 v2",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 8192,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2024-04-30"
      },
      {
        "id": "claude-opus-4-8",
        "provider": "anthropic",
        "name": "Claude Opus 4.8",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        }
      },
      {
        "id": "claude-opus-4-20250514",
        "provider": "anthropic",
        "name": "Claude Opus 4",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 32000,
        "pricing": {
          "input": 15,
          "output": 75,
          "cacheRead": 1.5,
          "cacheWrite": 18.75,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "claude-3-5-sonnet-20240620",
        "provider": "anthropic",
        "name": "Claude Sonnet 3.5",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 8192,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2024-04-30"
      },
      {
        "id": "claude-sonnet-4-20250514",
        "provider": "anthropic",
        "name": "Claude Sonnet 4",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "claude-opus-4-1",
        "provider": "anthropic",
        "name": "Claude Opus 4.1 (latest)",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 32000,
        "pricing": {
          "input": 15,
          "output": 75,
          "cacheRead": 1.5,
          "cacheWrite": 18.75,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "claude-3-haiku-20240307",
        "provider": "anthropic",
        "name": "Claude Haiku 3",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0.25,
          "output": 1.25,
          "cacheRead": 0.03,
          "cacheWrite": 0.3,
          "currency": "USD"
        },
        "knowledge": "2023-08-31"
      },
      {
        "id": "claude-fable-5",
        "provider": "anthropic",
        "name": "Claude Fable 5",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 10,
          "output": 50,
          "cacheRead": 1,
          "cacheWrite": 12.5,
          "currency": "USD"
        }
      },
      {
        "id": "claude-sonnet-4-0",
        "provider": "anthropic",
        "name": "Claude Sonnet 4 (latest)",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "claude-3-7-sonnet-20250219",
        "provider": "anthropic",
        "name": "Claude Sonnet 3.7",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2024-10-31"
      },
      {
        "id": "claude-haiku-4-5",
        "provider": "anthropic",
        "name": "Claude Haiku 4.5 (latest)",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 1,
          "output": 5,
          "cacheRead": 0.1,
          "cacheWrite": 1.25,
          "currency": "USD"
        },
        "knowledge": "2025-02-28"
      },
      {
        "id": "claude-opus-4-6",
        "provider": "anthropic",
        "name": "Claude Opus 4.6",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2025-05-31"
      },
      {
        "id": "claude-sonnet-4-5-20250929",
        "provider": "anthropic",
        "name": "Claude Sonnet 4.5",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-07-31"
      },
      {
        "id": "claude-3-sonnet-20240229",
        "provider": "anthropic",
        "name": "Claude Sonnet 3",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 4096,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 0.3,
          "currency": "USD"
        },
        "knowledge": "2023-08-31"
      },
      {
        "id": "claude-sonnet-4-6",
        "provider": "anthropic",
        "name": "Claude Sonnet 4.6",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "claude-3-5-haiku-latest",
        "provider": "anthropic",
        "name": "Claude Haiku 3.5 (latest)",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com/v1/messages",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.8,
          "output": 4,
          "cacheRead": 0.08,
          "cacheWrite": 1,
          "currency": "USD"
        },
        "knowledge": "2024-07-31"
      }
    ]
  },
  {
    "id": "amazon-bedrock",
    "name": "Amazon Bedrock",
    "protocol": "bedrock",
    "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
    "envKey": "AWS_BEARER_TOKEN_BEDROCK",
    "models": [
      {
        "id": "global.anthropic.claude-haiku-4-5-20251001-v1:0",
        "provider": "amazon-bedrock",
        "name": "Claude Haiku 4.5 (Global)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 1,
          "output": 5,
          "cacheRead": 0.1,
          "cacheWrite": 1.25,
          "currency": "USD"
        },
        "knowledge": "2025-02-28"
      },
      {
        "id": "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "provider": "amazon-bedrock",
        "name": "Claude Sonnet 4.5 (Global)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-07-31"
      },
      {
        "id": "us.meta.llama4-scout-17b-instruct-v1:0",
        "provider": "amazon-bedrock",
        "name": "Llama 4 Scout 17B Instruct (US)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 3500000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.17,
          "output": 0.66,
          "currency": "USD"
        },
        "knowledge": "2024-08"
      },
      {
        "id": "minimax.minimax-m2",
        "provider": "amazon-bedrock",
        "name": "MiniMax M2",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 204608,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.3,
          "output": 1.2,
          "currency": "USD"
        }
      },
      {
        "id": "anthropic.claude-opus-4-7",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.7",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2026-01-31"
      },
      {
        "id": "eu.anthropic.claude-sonnet-4-6",
        "provider": "amazon-bedrock",
        "name": "Claude Sonnet 4.6 (EU)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3.3,
          "output": 16.5,
          "cacheRead": 0.33,
          "cacheWrite": 4.125,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "mistral.voxtral-small-24b-2507",
        "provider": "amazon-bedrock",
        "name": "Voxtral Small 24B 2507",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "audio"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 32000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.15,
          "output": 0.35,
          "currency": "USD"
        }
      },
      {
        "id": "mistral.ministral-3-3b-instruct",
        "provider": "amazon-bedrock",
        "name": "Ministral 3 3B",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.1,
          "output": 0.1,
          "currency": "USD"
        }
      },
      {
        "id": "openai.gpt-oss-20b",
        "provider": "amazon-bedrock",
        "name": "gpt-oss-20b",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.07,
          "output": 0.3,
          "currency": "USD"
        }
      },
      {
        "id": "anthropic.claude-opus-4-6-v1",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.6",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2025-05-31"
      },
      {
        "id": "openai.gpt-oss-safeguard-20b",
        "provider": "amazon-bedrock",
        "name": "GPT OSS Safeguard 20B",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.07,
          "output": 0.2,
          "currency": "USD"
        }
      },
      {
        "id": "anthropic.claude-opus-4-5-20251101-v1:0",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.5",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "global.anthropic.claude-fable-5",
        "provider": "amazon-bedrock",
        "name": "Claude Fable 5 (Global)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 10,
          "output": 50,
          "cacheRead": 1,
          "cacheWrite": 12.5,
          "currency": "USD"
        },
        "knowledge": "2026-01-31"
      },
      {
        "id": "openai.gpt-oss-120b-1:0",
        "provider": "amazon-bedrock",
        "name": "gpt-oss-120b",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.15,
          "output": 0.6,
          "currency": "USD"
        }
      },
      {
        "id": "anthropic.claude-sonnet-4-5-20250929-v1:0",
        "provider": "amazon-bedrock",
        "name": "Claude Sonnet 4.5",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-07-31"
      },
      {
        "id": "amazon.nova-pro-v1:0",
        "provider": "amazon-bedrock",
        "name": "Nova Pro",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 300000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.8,
          "output": 3.2,
          "cacheRead": 0.2,
          "currency": "USD"
        },
        "knowledge": "2024-10"
      },
      {
        "id": "qwen.qwen3-coder-next",
        "provider": "amazon-bedrock",
        "name": "Qwen3 Coder Next",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.22,
          "output": 1.8,
          "currency": "USD"
        }
      },
      {
        "id": "us.anthropic.claude-opus-4-7",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.7 (US)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2026-01-31"
      },
      {
        "id": "nvidia.nemotron-nano-9b-v2",
        "provider": "amazon-bedrock",
        "name": "NVIDIA Nemotron Nano 9B v2",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0.06,
          "output": 0.23,
          "currency": "USD"
        }
      },
      {
        "id": "qwen.qwen3-32b-v1:0",
        "provider": "amazon-bedrock",
        "name": "Qwen3 32B (dense)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 16384,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.15,
          "output": 0.6,
          "currency": "USD"
        },
        "knowledge": "2024-04"
      },
      {
        "id": "jp.anthropic.claude-sonnet-4-6",
        "provider": "amazon-bedrock",
        "name": "Claude Sonnet 4.6 (JP)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "deepseek.r1-v1:0",
        "provider": "amazon-bedrock",
        "name": "DeepSeek-R1",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 32768,
        "pricing": {
          "input": 1.35,
          "output": 5.4,
          "currency": "USD"
        },
        "knowledge": "2024-07"
      },
      {
        "id": "mistral.mistral-large-3-675b-instruct",
        "provider": "amazon-bedrock",
        "name": "Mistral Large 3",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.5,
          "output": 1.5,
          "currency": "USD"
        }
      },
      {
        "id": "google.gemma-3-27b-it",
        "provider": "amazon-bedrock",
        "name": "Google Gemma 3 27B Instruct",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 202752,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.12,
          "output": 0.2,
          "currency": "USD"
        },
        "knowledge": "2025-07"
      },
      {
        "id": "anthropic.claude-sonnet-4-6",
        "provider": "amazon-bedrock",
        "name": "Claude Sonnet 4.6",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "amazon.nova-2-lite-v1:0",
        "provider": "amazon-bedrock",
        "name": "Nova 2 Lite",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0.33,
          "output": 2.75,
          "currency": "USD"
        }
      },
      {
        "id": "openai.gpt-oss-safeguard-120b",
        "provider": "amazon-bedrock",
        "name": "GPT OSS Safeguard 120B",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.15,
          "output": 0.6,
          "currency": "USD"
        }
      },
      {
        "id": "mistral.ministral-3-8b-instruct",
        "provider": "amazon-bedrock",
        "name": "Ministral 3 8B",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0.15,
          "output": 0.15,
          "currency": "USD"
        }
      },
      {
        "id": "eu.anthropic.claude-opus-4-6-v1",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.6 (EU)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5.5,
          "output": 27.5,
          "cacheRead": 0.55,
          "cacheWrite": 6.875,
          "currency": "USD"
        },
        "knowledge": "2025-05-31"
      },
      {
        "id": "au.anthropic.claude-opus-4-6-v1",
        "provider": "amazon-bedrock",
        "name": "AU Anthropic Claude Opus 4.6",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 16.5,
          "output": 82.5,
          "cacheRead": 1.65,
          "cacheWrite": 20.625,
          "currency": "USD"
        },
        "knowledge": "2025-05"
      },
      {
        "id": "openai.gpt-oss-120b",
        "provider": "amazon-bedrock",
        "name": "gpt-oss-120b",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.15,
          "output": 0.6,
          "currency": "USD"
        }
      },
      {
        "id": "global.anthropic.claude-opus-4-8",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.8 (Global)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        }
      },
      {
        "id": "us.meta.llama4-maverick-17b-instruct-v1:0",
        "provider": "amazon-bedrock",
        "name": "Llama 4 Maverick 17B Instruct (US)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.24,
          "output": 0.97,
          "currency": "USD"
        },
        "knowledge": "2024-08"
      },
      {
        "id": "openai.gpt-5.4",
        "provider": "amazon-bedrock",
        "name": "GPT-5.4",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 272000,
        "maxTokens": 128000,
        "pricing": {
          "input": 2.75,
          "output": 16.5,
          "cacheRead": 0.275,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "mistral.devstral-2-123b",
        "provider": "amazon-bedrock",
        "name": "Devstral 2 123B",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.4,
          "output": 2,
          "currency": "USD"
        }
      },
      {
        "id": "zai.glm-4.7",
        "provider": "amazon-bedrock",
        "name": "GLM-4.7",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 204800,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.6,
          "output": 2.2,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "writer.palmyra-x4-v1:0",
        "provider": "amazon-bedrock",
        "name": "Palmyra X4",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 122880,
        "maxTokens": 8192,
        "pricing": {
          "input": 2.5,
          "output": 10,
          "currency": "USD"
        }
      },
      {
        "id": "mistral.magistral-small-2509",
        "provider": "amazon-bedrock",
        "name": "Magistral Small 1.2",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 40000,
        "pricing": {
          "input": 0.5,
          "output": 1.5,
          "currency": "USD"
        }
      },
      {
        "id": "qwen.qwen3-coder-480b-a35b-v1:0",
        "provider": "amazon-bedrock",
        "name": "Qwen3 Coder 480B A35B Instruct",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.22,
          "output": 1.8,
          "currency": "USD"
        },
        "knowledge": "2024-04"
      },
      {
        "id": "amazon.nova-micro-v1:0",
        "provider": "amazon-bedrock",
        "name": "Nova Micro",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.035,
          "output": 0.14,
          "cacheRead": 0.00875,
          "currency": "USD"
        },
        "knowledge": "2024-10"
      },
      {
        "id": "mistral.pixtral-large-2502-v1:0",
        "provider": "amazon-bedrock",
        "name": "Pixtral Large (25.02)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 8192,
        "pricing": {
          "input": 2,
          "output": 6,
          "currency": "USD"
        }
      },
      {
        "id": "us.anthropic.claude-opus-4-6-v1",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.6 (US)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2025-05-31"
      },
      {
        "id": "jp.anthropic.claude-opus-4-7",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.7 (JP)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2026-01-31"
      },
      {
        "id": "au.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "provider": "amazon-bedrock",
        "name": "Claude Sonnet 4.5 (AU)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-07-31"
      },
      {
        "id": "deepseek.v3-v1:0",
        "provider": "amazon-bedrock",
        "name": "DeepSeek-V3.1",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 163840,
        "maxTokens": 81920,
        "pricing": {
          "input": 0.58,
          "output": 1.68,
          "currency": "USD"
        },
        "knowledge": "2024-07"
      },
      {
        "id": "anthropic.claude-opus-4-1-20250805-v1:0",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.1",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 32000,
        "pricing": {
          "input": 15,
          "output": 75,
          "cacheRead": 1.5,
          "cacheWrite": 18.75,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "jp.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "provider": "amazon-bedrock",
        "name": "Claude Sonnet 4.5 (JP)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-07-31"
      },
      {
        "id": "google.gemma-3-4b-it",
        "provider": "amazon-bedrock",
        "name": "Gemma 3 4B IT",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0.04,
          "output": 0.08,
          "currency": "USD"
        }
      },
      {
        "id": "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "provider": "amazon-bedrock",
        "name": "Claude Sonnet 4.5 (EU)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3.3,
          "output": 16.5,
          "cacheRead": 0.33,
          "cacheWrite": 4.125,
          "currency": "USD"
        },
        "knowledge": "2025-07-31"
      },
      {
        "id": "qwen.qwen3-vl-235b-a22b",
        "provider": "amazon-bedrock",
        "name": "Qwen/Qwen3-VL-235B-A22B-Instruct",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262000,
        "maxTokens": 262000,
        "pricing": {
          "input": 0.3,
          "output": 1.5,
          "currency": "USD"
        }
      },
      {
        "id": "writer.palmyra-x5-v1:0",
        "provider": "amazon-bedrock",
        "name": "Palmyra X5",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1040000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.6,
          "output": 6,
          "currency": "USD"
        }
      },
      {
        "id": "us.anthropic.claude-sonnet-4-6",
        "provider": "amazon-bedrock",
        "name": "Claude Sonnet 4.6 (US)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "au.anthropic.claude-haiku-4-5-20251001-v1:0",
        "provider": "amazon-bedrock",
        "name": "Claude Haiku 4.5 (AU)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 1,
          "output": 5,
          "cacheRead": 0.1,
          "cacheWrite": 1.25,
          "currency": "USD"
        },
        "knowledge": "2025-02-28"
      },
      {
        "id": "meta.llama3-3-70b-instruct-v1:0",
        "provider": "amazon-bedrock",
        "name": "Llama 3.3 70B Instruct",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0.72,
          "output": 0.72,
          "currency": "USD"
        },
        "knowledge": "2023-12"
      },
      {
        "id": "zai.glm-5",
        "provider": "amazon-bedrock",
        "name": "GLM-5",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 202752,
        "maxTokens": 101376,
        "pricing": {
          "input": 1,
          "output": 3.2,
          "currency": "USD"
        }
      },
      {
        "id": "us.anthropic.claude-opus-4-8",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.8 (US)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        }
      },
      {
        "id": "global.anthropic.claude-opus-4-7",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.7 (Global)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2026-01-31"
      },
      {
        "id": "us.anthropic.claude-fable-5",
        "provider": "amazon-bedrock",
        "name": "Claude Fable 5 (US)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 10,
          "output": 50,
          "cacheRead": 1,
          "cacheWrite": 12.5,
          "currency": "USD"
        },
        "knowledge": "2026-01-31"
      },
      {
        "id": "amazon.nova-lite-v1:0",
        "provider": "amazon-bedrock",
        "name": "Nova Lite",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 300000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.06,
          "output": 0.24,
          "cacheRead": 0.015,
          "currency": "USD"
        },
        "knowledge": "2024-10"
      },
      {
        "id": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "provider": "amazon-bedrock",
        "name": "Claude Haiku 4.5 (US)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 1,
          "output": 5,
          "cacheRead": 0.1,
          "cacheWrite": 1.25,
          "currency": "USD"
        },
        "knowledge": "2025-02-28"
      },
      {
        "id": "mistral.voxtral-mini-3b-2507",
        "provider": "amazon-bedrock",
        "name": "Voxtral Mini 3B 2507",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "audio",
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0.04,
          "output": 0.04,
          "currency": "USD"
        }
      },
      {
        "id": "moonshot.kimi-k2-thinking",
        "provider": "amazon-bedrock",
        "name": "Kimi K2 Thinking",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262143,
        "maxTokens": 16000,
        "pricing": {
          "input": 0.6,
          "output": 2.5,
          "currency": "USD"
        }
      },
      {
        "id": "meta.llama3-1-70b-instruct-v1:0",
        "provider": "amazon-bedrock",
        "name": "Llama 3.1 70B Instruct",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0.72,
          "output": 0.72,
          "currency": "USD"
        },
        "knowledge": "2023-12"
      },
      {
        "id": "us.deepseek.r1-v1:0",
        "provider": "amazon-bedrock",
        "name": "DeepSeek-R1 (US)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 32768,
        "pricing": {
          "input": 1.35,
          "output": 5.4,
          "currency": "USD"
        },
        "knowledge": "2024-07"
      },
      {
        "id": "global.anthropic.claude-sonnet-4-6",
        "provider": "amazon-bedrock",
        "name": "Claude Sonnet 4.6 (Global)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "anthropic.claude-haiku-4-5-20251001-v1:0",
        "provider": "amazon-bedrock",
        "name": "Claude Haiku 4.5",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 1,
          "output": 5,
          "cacheRead": 0.1,
          "cacheWrite": 1.25,
          "currency": "USD"
        },
        "knowledge": "2025-02-28"
      },
      {
        "id": "moonshotai.kimi-k2.5",
        "provider": "amazon-bedrock",
        "name": "Kimi K2.5",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262143,
        "maxTokens": 16000,
        "pricing": {
          "input": 0.6,
          "output": 3,
          "currency": "USD"
        }
      },
      {
        "id": "au.anthropic.claude-opus-4-8",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.8 (AU)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        }
      },
      {
        "id": "nvidia.nemotron-nano-12b-v2",
        "provider": "amazon-bedrock",
        "name": "NVIDIA Nemotron Nano 12B v2 VL BF16",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0.2,
          "output": 0.6,
          "currency": "USD"
        }
      },
      {
        "id": "zai.glm-4.7-flash",
        "provider": "amazon-bedrock",
        "name": "GLM-4.7-Flash",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.07,
          "output": 0.4,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "meta.llama4-scout-17b-instruct-v1:0",
        "provider": "amazon-bedrock",
        "name": "Llama 4 Scout 17B Instruct",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 3500000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.17,
          "output": 0.66,
          "currency": "USD"
        },
        "knowledge": "2024-08"
      },
      {
        "id": "qwen.qwen3-235b-a22b-2507-v1:0",
        "provider": "amazon-bedrock",
        "name": "Qwen3 235B A22B 2507",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.22,
          "output": 0.88,
          "currency": "USD"
        },
        "knowledge": "2024-04"
      },
      {
        "id": "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
        "provider": "amazon-bedrock",
        "name": "Claude Haiku 4.5 (EU)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 1,
          "output": 5,
          "cacheRead": 0.1,
          "cacheWrite": 1.25,
          "currency": "USD"
        },
        "knowledge": "2025-02-28"
      },
      {
        "id": "openai.gpt-oss-20b-1:0",
        "provider": "amazon-bedrock",
        "name": "gpt-oss-20b",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.07,
          "output": 0.3,
          "currency": "USD"
        }
      },
      {
        "id": "jp.anthropic.claude-opus-4-8",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.8 (JP)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        }
      },
      {
        "id": "anthropic.claude-opus-4-8",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.8",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        }
      },
      {
        "id": "qwen.qwen3-coder-30b-a3b-v1:0",
        "provider": "amazon-bedrock",
        "name": "Qwen3 Coder 30B A3B Instruct",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.15,
          "output": 0.6,
          "currency": "USD"
        },
        "knowledge": "2024-04"
      },
      {
        "id": "qwen.qwen3-next-80b-a3b",
        "provider": "amazon-bedrock",
        "name": "Qwen/Qwen3-Next-80B-A3B-Instruct",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262000,
        "maxTokens": 262000,
        "pricing": {
          "input": 0.14,
          "output": 1.4,
          "currency": "USD"
        }
      },
      {
        "id": "openai.gpt-5.5",
        "provider": "amazon-bedrock",
        "name": "GPT-5.5",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 272000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5.5,
          "output": 33,
          "cacheRead": 0.55,
          "currency": "USD"
        },
        "knowledge": "2025-12-01"
      },
      {
        "id": "au.anthropic.claude-sonnet-4-6",
        "provider": "amazon-bedrock",
        "name": "AU Anthropic Claude Sonnet 4.6",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 3.3,
          "output": 16.5,
          "cacheRead": 0.33,
          "cacheWrite": 4.125,
          "currency": "USD"
        },
        "knowledge": "2025-08"
      },
      {
        "id": "us.anthropic.claude-opus-4-5-20251101-v1:0",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.5 (US)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "minimax.minimax-m2.5",
        "provider": "amazon-bedrock",
        "name": "MiniMax M2.5",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 196608,
        "maxTokens": 98304,
        "pricing": {
          "input": 0.3,
          "output": 1.2,
          "currency": "USD"
        }
      },
      {
        "id": "eu.anthropic.claude-opus-4-8",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.8 (EU)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5.5,
          "output": 27.5,
          "cacheRead": 0.55,
          "cacheWrite": 6.875,
          "currency": "USD"
        }
      },
      {
        "id": "eu.anthropic.claude-opus-4-7",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.7 (EU)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5.5,
          "output": 27.5,
          "cacheRead": 0.55,
          "cacheWrite": 6.875,
          "currency": "USD"
        },
        "knowledge": "2026-01-31"
      },
      {
        "id": "meta.llama3-1-8b-instruct-v1:0",
        "provider": "amazon-bedrock",
        "name": "Llama 3.1 8B Instruct",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0.22,
          "output": 0.22,
          "currency": "USD"
        },
        "knowledge": "2023-12"
      },
      {
        "id": "us.anthropic.claude-opus-4-1-20250805-v1:0",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.1 (US)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 32000,
        "pricing": {
          "input": 15,
          "output": 75,
          "cacheRead": 1.5,
          "cacheWrite": 18.75,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "meta.llama4-maverick-17b-instruct-v1:0",
        "provider": "amazon-bedrock",
        "name": "Llama 4 Maverick 17B Instruct",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.24,
          "output": 0.97,
          "currency": "USD"
        },
        "knowledge": "2024-08"
      },
      {
        "id": "global.anthropic.claude-opus-4-5-20251101-v1:0",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.5 (Global)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "nvidia.nemotron-super-3-120b",
        "provider": "amazon-bedrock",
        "name": "NVIDIA Nemotron 3 Super 120B A12B",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.15,
          "output": 0.65,
          "currency": "USD"
        }
      },
      {
        "id": "nvidia.nemotron-nano-3-30b",
        "provider": "amazon-bedrock",
        "name": "NVIDIA Nemotron Nano 3 30B",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0.06,
          "output": 0.24,
          "currency": "USD"
        }
      },
      {
        "id": "eu.anthropic.claude-opus-4-5-20251101-v1:0",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.5 (EU)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "global.anthropic.claude-opus-4-6-v1",
        "provider": "amazon-bedrock",
        "name": "Claude Opus 4.6 (Global)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2025-05-31"
      },
      {
        "id": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "provider": "amazon-bedrock",
        "name": "Claude Sonnet 4.5 (US)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-07-31"
      },
      {
        "id": "minimax.minimax-m2.1",
        "provider": "amazon-bedrock",
        "name": "MiniMax M2.1",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 204800,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.3,
          "output": 1.2,
          "currency": "USD"
        }
      },
      {
        "id": "eu.anthropic.claude-fable-5",
        "provider": "amazon-bedrock",
        "name": "Claude Fable 5 (EU)",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 11,
          "output": 55,
          "cacheRead": 1.1,
          "cacheWrite": 13.75,
          "currency": "USD"
        },
        "knowledge": "2026-01-31"
      },
      {
        "id": "deepseek.v3.2",
        "provider": "amazon-bedrock",
        "name": "DeepSeek-V3.2",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 163840,
        "maxTokens": 81920,
        "pricing": {
          "input": 0.62,
          "output": 1.85,
          "currency": "USD"
        },
        "knowledge": "2024-07"
      },
      {
        "id": "mistral.ministral-3-14b-instruct",
        "provider": "amazon-bedrock",
        "name": "Ministral 14B 3.0",
        "protocol": "bedrock",
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0.2,
          "output": 0.2,
          "currency": "USD"
        }
      }
    ]
  },
  {
    "id": "openrouter",
    "name": "OpenRouter",
    "protocol": "openai",
    "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
    "envKey": "OPENROUTER_API_KEY",
    "models": [
      {
        "id": "inclusionai/ling-2.6-1t",
        "provider": "openrouter",
        "name": "Ling-2.6-1T",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.075,
          "output": 0.625,
          "cacheRead": 0.015,
          "currency": "USD"
        }
      },
      {
        "id": "inclusionai/ring-2.6-1t",
        "provider": "openrouter",
        "name": "Ring-2.6-1T",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.075,
          "output": 0.625,
          "cacheRead": 0.015,
          "currency": "USD"
        }
      },
      {
        "id": "inclusionai/ling-2.6-flash",
        "provider": "openrouter",
        "name": "Ling-2.6-flash",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.01,
          "output": 0.03,
          "cacheRead": 0.002,
          "currency": "USD"
        }
      },
      {
        "id": "ibm-granite/granite-4.1-8b",
        "provider": "openrouter",
        "name": "Granite 4.1 8B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.05,
          "output": 0.1,
          "cacheRead": 0.05,
          "currency": "USD"
        }
      },
      {
        "id": "meta-llama/llama-3.1-8b-instruct",
        "provider": "openrouter",
        "name": "Llama 3.1 8B Instruct",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.02,
          "output": 0.03,
          "currency": "USD"
        },
        "knowledge": "2023-12-31"
      },
      {
        "id": "meta-llama/llama-3.1-70b-instruct",
        "provider": "openrouter",
        "name": "Llama 3.1 70B Instruct",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.4,
          "output": 0.4,
          "currency": "USD"
        },
        "knowledge": "2023-12-31"
      },
      {
        "id": "meta-llama/llama-4-maverick",
        "provider": "openrouter",
        "name": "Llama 4 Maverick",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.15,
          "output": 0.6,
          "currency": "USD"
        },
        "knowledge": "2024-08-31"
      },
      {
        "id": "meta-llama/llama-3.3-70b-instruct:free",
        "provider": "openrouter",
        "name": "Llama 3.3 70B Instruct (free)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 65536,
        "maxTokens": 131072,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2023-12"
      },
      {
        "id": "meta-llama/llama-3.3-70b-instruct",
        "provider": "openrouter",
        "name": "Llama-3.3-70B-Instruct",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.1,
          "output": 0.32,
          "currency": "USD"
        },
        "knowledge": "2023-12"
      },
      {
        "id": "meta-llama/llama-4-scout",
        "provider": "openrouter",
        "name": "Llama 4 Scout",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 327680,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.1,
          "output": 0.3,
          "currency": "USD"
        },
        "knowledge": "2024-08-31"
      },
      {
        "id": "~anthropic/claude-haiku-latest",
        "provider": "openrouter",
        "name": "Anthropic Claude Haiku Latest",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 1,
          "output": 5,
          "cacheRead": 0.1,
          "cacheWrite": 1.25,
          "currency": "USD"
        }
      },
      {
        "id": "~anthropic/claude-fable-latest",
        "provider": "openrouter",
        "name": "Claude Fable Latest",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 10,
          "output": 50,
          "cacheRead": 1,
          "cacheWrite": 12.5,
          "currency": "USD"
        }
      },
      {
        "id": "~anthropic/claude-sonnet-latest",
        "provider": "openrouter",
        "name": "Anthropic Claude Sonnet Latest",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        }
      },
      {
        "id": "~anthropic/claude-opus-latest",
        "provider": "openrouter",
        "name": "Claude Opus Latest",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        }
      },
      {
        "id": "moonshotai/kimi-k2",
        "provider": "openrouter",
        "name": "Kimi K2 0711",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.57,
          "output": 2.3,
          "currency": "USD"
        },
        "knowledge": "2024-12-31"
      },
      {
        "id": "moonshotai/kimi-k2.7-code",
        "provider": "openrouter",
        "name": "Kimi K2.7 Code",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.612,
          "output": 3.069,
          "cacheRead": 0.1296,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "moonshotai/kimi-k2-thinking",
        "provider": "openrouter",
        "name": "Kimi K2 Thinking",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.6,
          "output": 2.5,
          "currency": "USD"
        },
        "knowledge": "2024-08"
      },
      {
        "id": "moonshotai/kimi-k2.5",
        "provider": "openrouter",
        "name": "Kimi K2.5",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.375,
          "output": 2.025,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "moonshotai/kimi-k2.6",
        "provider": "openrouter",
        "name": "Kimi K2.6",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262142,
        "maxTokens": 262142,
        "pricing": {
          "input": 0.66,
          "output": 3.5,
          "cacheRead": 0.33,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "moonshotai/kimi-k2-0905",
        "provider": "openrouter",
        "name": "Kimi K2 0905",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.6,
          "output": 2.5,
          "currency": "USD"
        },
        "knowledge": "2024-12-31"
      },
      {
        "id": "google/gemini-3.1-flash-lite",
        "provider": "openrouter",
        "name": "Gemini 3.1 Flash Lite",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.25,
          "output": 1.5,
          "cacheRead": 0.025,
          "cacheWrite": 0.083333,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "google/gemma-4-26b-a4b-it:free",
        "provider": "openrouter",
        "name": "Gemma 4 26B A4B  (free)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 32768,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "google/gemini-2.5-pro",
        "provider": "openrouter",
        "name": "Gemini 2.5 Pro",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.125,
          "cacheWrite": 0.375,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "google/gemini-2.5-flash",
        "provider": "openrouter",
        "name": "Gemini 2.5 Flash",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65535,
        "pricing": {
          "input": 0.3,
          "output": 2.5,
          "cacheRead": 0.03,
          "cacheWrite": 0.083333,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "google/gemini-3.5-flash",
        "provider": "openrouter",
        "name": "Gemini 3.5 Flash",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 1.5,
          "output": 9,
          "cacheRead": 0.15,
          "cacheWrite": 0.083333,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "google/gemini-2.5-flash-lite-preview-09-2025",
        "provider": "openrouter",
        "name": "Gemini 2.5 Flash Lite Preview 09-2025",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf",
          "audio",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65535,
        "pricing": {
          "input": 0.1,
          "output": 0.4,
          "cacheRead": 0.01,
          "cacheWrite": 0.083333,
          "currency": "USD"
        },
        "knowledge": "2025-01-31"
      },
      {
        "id": "google/gemma-4-31b-it",
        "provider": "openrouter",
        "name": "Gemma 4 31B IT",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.12,
          "output": 0.35,
          "cacheRead": 0.09,
          "currency": "USD"
        }
      },
      {
        "id": "google/gemini-3.1-pro-preview-customtools",
        "provider": "openrouter",
        "name": "Gemini 3.1 Pro Preview Custom Tools",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 2,
          "output": 12,
          "cacheRead": 0.2,
          "cacheWrite": 0.375,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "google/gemini-2.5-flash-lite",
        "provider": "openrouter",
        "name": "Gemini 2.5 Flash-Lite",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65535,
        "pricing": {
          "input": 0.1,
          "output": 0.4,
          "cacheRead": 0.01,
          "cacheWrite": 0.083333,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "google/gemini-2.5-pro-preview-05-06",
        "provider": "openrouter",
        "name": "Gemini 2.5 Pro Preview 05-06",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf",
          "audio",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65535,
        "pricing": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.125,
          "cacheWrite": 0.375,
          "currency": "USD"
        },
        "knowledge": "2025-01-31"
      },
      {
        "id": "google/gemini-3.1-pro-preview",
        "provider": "openrouter",
        "name": "Gemini 3.1 Pro Preview",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 2,
          "output": 12,
          "cacheRead": 0.2,
          "cacheWrite": 0.375,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "google/gemma-4-26b-a4b-it",
        "provider": "openrouter",
        "name": "Gemma 4 26B A4B IT",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.06,
          "output": 0.33,
          "currency": "USD"
        }
      },
      {
        "id": "google/gemini-2.5-pro-preview",
        "provider": "openrouter",
        "name": "Gemini 2.5 Pro Preview 06-05",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "pdf",
          "image",
          "text",
          "audio"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.125,
          "cacheWrite": 0.375,
          "currency": "USD"
        },
        "knowledge": "2025-01-31"
      },
      {
        "id": "google/gemini-3-flash-preview",
        "provider": "openrouter",
        "name": "Gemini 3 Flash Preview",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65535,
        "pricing": {
          "input": 0.5,
          "output": 3,
          "cacheRead": 0.05,
          "cacheWrite": 0.083333,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "google/gemma-3-12b-it",
        "provider": "openrouter",
        "name": "Gemma 3 12B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.05,
          "output": 0.15,
          "currency": "USD"
        },
        "knowledge": "2024-08-31"
      },
      {
        "id": "google/gemma-3-27b-it",
        "provider": "openrouter",
        "name": "Gemma 3 27B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.08,
          "output": 0.16,
          "currency": "USD"
        },
        "knowledge": "2024-08-31"
      },
      {
        "id": "google/gemma-4-31b-it:free",
        "provider": "openrouter",
        "name": "Gemma 4 31B (free)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 8192,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "google/gemini-3-pro-image",
        "provider": "openrouter",
        "name": "Nano Banana Pro (Gemini 3 Pro Image)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text"
        ],
        "output": [
          "image",
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 65536,
        "maxTokens": 32768,
        "pricing": {
          "input": 2,
          "output": 12,
          "cacheRead": 0.2,
          "cacheWrite": 0.375,
          "currency": "USD"
        }
      },
      {
        "id": "google/gemini-3.1-flash-lite-preview",
        "provider": "openrouter",
        "name": "Gemini 3.1 Flash Lite Preview",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.25,
          "output": 1.5,
          "cacheRead": 0.025,
          "cacheWrite": 0.083333,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "liquid/lfm-2.5-1.2b-thinking:free",
        "provider": "openrouter",
        "name": "LFM2.5-1.2B-Thinking (free)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 32768,
        "maxTokens": 32768,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2025-06"
      },
      {
        "id": "x-ai/grok-4.20",
        "provider": "openrouter",
        "name": "Grok 4.20",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 2000000,
        "maxTokens": 2000000,
        "pricing": {
          "input": 1.25,
          "output": 2.5,
          "cacheRead": 0.2,
          "currency": "USD"
        },
        "knowledge": "2025-09-01"
      },
      {
        "id": "x-ai/grok-4.3",
        "provider": "openrouter",
        "name": "Grok 4.3",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 1000000,
        "pricing": {
          "input": 1.25,
          "output": 2.5,
          "cacheRead": 0.2,
          "currency": "USD"
        }
      },
      {
        "id": "x-ai/grok-build-0.1",
        "provider": "openrouter",
        "name": "Grok Build 0.1",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 256000,
        "pricing": {
          "input": 1,
          "output": 2,
          "cacheRead": 0.2,
          "currency": "USD"
        }
      },
      {
        "id": "~google/gemini-pro-latest",
        "provider": "openrouter",
        "name": "Google Gemini Pro Latest",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "audio",
          "pdf",
          "image",
          "text",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 2,
          "output": 12,
          "cacheRead": 0.2,
          "cacheWrite": 0.375,
          "currency": "USD"
        }
      },
      {
        "id": "~google/gemini-flash-latest",
        "provider": "openrouter",
        "name": "Google Gemini Flash Latest",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video",
          "pdf",
          "audio"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 1.5,
          "output": 9,
          "cacheRead": 0.15,
          "cacheWrite": 0.083333,
          "currency": "USD"
        },
        "knowledge": "2025-01-01"
      },
      {
        "id": "poolside/laguna-xs.2",
        "provider": "openrouter",
        "name": "Laguna XS.2",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.1,
          "output": 0.2,
          "cacheRead": 0.05,
          "currency": "USD"
        }
      },
      {
        "id": "poolside/laguna-xs.2:free",
        "provider": "openrouter",
        "name": "Laguna XS.2 (free)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 32768,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "poolside/laguna-m.1",
        "provider": "openrouter",
        "name": "Laguna M.1",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.2,
          "output": 0.4,
          "cacheRead": 0.1,
          "currency": "USD"
        }
      },
      {
        "id": "poolside/laguna-m.1:free",
        "provider": "openrouter",
        "name": "Laguna M.1 (free)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 32768,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "z-ai/glm-4.7",
        "provider": "openrouter",
        "name": "GLM-4.7",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 202752,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.4,
          "output": 1.75,
          "cacheRead": 0.08,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "z-ai/glm-4.5v",
        "provider": "openrouter",
        "name": "GLM-4.5V",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 65536,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.6,
          "output": 1.8,
          "cacheRead": 0.11,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "z-ai/glm-4.5",
        "provider": "openrouter",
        "name": "GLM-4.5",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 98304,
        "pricing": {
          "input": 0.6,
          "output": 2.2,
          "cacheRead": 0.11,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "z-ai/glm-5.1",
        "provider": "openrouter",
        "name": "GLM-5.1",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 202752,
        "maxTokens": 65535,
        "pricing": {
          "input": 0.98,
          "output": 3.08,
          "cacheRead": 0.49,
          "currency": "USD"
        }
      },
      {
        "id": "z-ai/glm-4.6",
        "provider": "openrouter",
        "name": "GLM-4.6",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 202752,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.43,
          "output": 1.74,
          "cacheRead": 0.08,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "z-ai/glm-5.2",
        "provider": "openrouter",
        "name": "GLM-5.2",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 131072,
        "pricing": {
          "input": 1.2,
          "output": 4.1,
          "cacheRead": 0.2,
          "currency": "USD"
        }
      },
      {
        "id": "z-ai/glm-4.6v",
        "provider": "openrouter",
        "name": "GLM-4.6V",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.3,
          "output": 0.9,
          "cacheRead": 0.055,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "z-ai/glm-4.5-air",
        "provider": "openrouter",
        "name": "GLM-4.5-Air",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 98304,
        "pricing": {
          "input": 0.13,
          "output": 0.85,
          "cacheRead": 0.025,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "z-ai/glm-4.7-flash",
        "provider": "openrouter",
        "name": "GLM-4.7-Flash",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 202752,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.06,
          "output": 0.4,
          "cacheRead": 0.01,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "z-ai/glm-5",
        "provider": "openrouter",
        "name": "GLM-5",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 202752,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.6,
          "output": 1.92,
          "cacheRead": 0.12,
          "currency": "USD"
        }
      },
      {
        "id": "z-ai/glm-5-turbo",
        "provider": "openrouter",
        "name": "GLM-5-Turbo",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 131072,
        "pricing": {
          "input": 1.2,
          "output": 4,
          "cacheRead": 0.24,
          "currency": "USD"
        }
      },
      {
        "id": "openai/gpt-4o-mini-2024-07-18",
        "provider": "openrouter",
        "name": "GPT-4o-mini (2024-07-18)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.15,
          "output": 0.6,
          "cacheRead": 0.075,
          "currency": "USD"
        },
        "knowledge": "2023-10-31"
      },
      {
        "id": "openai/gpt-oss-safeguard-20b",
        "provider": "openrouter",
        "name": "gpt-oss-safeguard-20b",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.075,
          "output": 0.3,
          "cacheRead": 0.0375,
          "currency": "USD"
        }
      },
      {
        "id": "openai/gpt-5.2-chat",
        "provider": "openrouter",
        "name": "GPT-5.2 Chat",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "pdf",
          "image",
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 1.75,
          "output": 14,
          "cacheRead": 0.175,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "openai/o3",
        "provider": "openrouter",
        "name": "o3",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 100000,
        "pricing": {
          "input": 2,
          "output": 8,
          "cacheRead": 0.5,
          "currency": "USD"
        },
        "knowledge": "2024-05"
      },
      {
        "id": "openai/o4-mini-high",
        "provider": "openrouter",
        "name": "o4 Mini High",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 100000,
        "pricing": {
          "input": 1.1,
          "output": 4.4,
          "cacheRead": 0.275,
          "currency": "USD"
        },
        "knowledge": "2024-06-30"
      },
      {
        "id": "openai/gpt-audio",
        "provider": "openrouter",
        "name": "GPT Audio",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "audio"
        ],
        "output": [
          "text",
          "audio"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 2.5,
          "output": 10,
          "currency": "USD"
        }
      },
      {
        "id": "openai/gpt-5.2-pro",
        "provider": "openrouter",
        "name": "GPT-5.2 Pro",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 21,
          "output": 168,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "openai/gpt-5",
        "provider": "openrouter",
        "name": "GPT-5",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.125,
          "currency": "USD"
        },
        "knowledge": "2024-09-30"
      },
      {
        "id": "openai/gpt-3.5-turbo",
        "provider": "openrouter",
        "name": "GPT-3.5-turbo",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 16385,
        "maxTokens": 4096,
        "pricing": {
          "input": 0.5,
          "output": 1.5,
          "currency": "USD"
        },
        "knowledge": "2021-09-01"
      },
      {
        "id": "openai/gpt-5-pro",
        "provider": "openrouter",
        "name": "GPT-5 Pro",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 15,
          "output": 120,
          "currency": "USD"
        },
        "knowledge": "2024-09-30"
      },
      {
        "id": "openai/gpt-4o",
        "provider": "openrouter",
        "name": "GPT-4o",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 2.5,
          "output": 10,
          "currency": "USD"
        },
        "knowledge": "2023-09"
      },
      {
        "id": "openai/gpt-4",
        "provider": "openrouter",
        "name": "GPT-4",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 8191,
        "maxTokens": 4096,
        "pricing": {
          "input": 30,
          "output": 60,
          "currency": "USD"
        },
        "knowledge": "2023-11"
      },
      {
        "id": "openai/o4-mini",
        "provider": "openrouter",
        "name": "o4-mini",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 100000,
        "pricing": {
          "input": 1.1,
          "output": 4.4,
          "cacheRead": 0.275,
          "currency": "USD"
        },
        "knowledge": "2024-05"
      },
      {
        "id": "openai/gpt-3.5-turbo-16k",
        "provider": "openrouter",
        "name": "GPT-3.5 Turbo 16k",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 16385,
        "maxTokens": 4096,
        "pricing": {
          "input": 3,
          "output": 4,
          "currency": "USD"
        },
        "knowledge": "2021-09-30"
      },
      {
        "id": "openai/o3-pro",
        "provider": "openrouter",
        "name": "o3-pro",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "pdf",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 100000,
        "pricing": {
          "input": 20,
          "output": 80,
          "currency": "USD"
        },
        "knowledge": "2024-05"
      },
      {
        "id": "openai/gpt-5.1-chat",
        "provider": "openrouter",
        "name": "GPT-5.1 Chat",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "pdf",
          "image",
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 32000,
        "pricing": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.13,
          "currency": "USD"
        },
        "knowledge": "2024-09-30"
      },
      {
        "id": "openai/gpt-4o-2024-05-13",
        "provider": "openrouter",
        "name": "GPT-4o (2024-05-13)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 5,
          "output": 15,
          "currency": "USD"
        },
        "knowledge": "2023-09"
      },
      {
        "id": "openai/gpt-5.4-nano",
        "provider": "openrouter",
        "name": "GPT-5.4 nano",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "pdf",
          "image",
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.2,
          "output": 1.25,
          "cacheRead": 0.02,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "openai/gpt-5.3-chat",
        "provider": "openrouter",
        "name": "GPT-5.3 Chat",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 1.75,
          "output": 14,
          "cacheRead": 0.175,
          "currency": "USD"
        }
      },
      {
        "id": "openai/gpt-3.5-turbo-0613",
        "provider": "openrouter",
        "name": "GPT-3.5 Turbo (older v0613)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 4095,
        "maxTokens": 4096,
        "pricing": {
          "input": 1,
          "output": 2,
          "currency": "USD"
        },
        "knowledge": "2021-09-30"
      },
      {
        "id": "openai/gpt-5.1-codex",
        "provider": "openrouter",
        "name": "GPT-5.1 Codex",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.13,
          "currency": "USD"
        },
        "knowledge": "2024-09-30"
      },
      {
        "id": "openai/gpt-5.1-codex-max",
        "provider": "openrouter",
        "name": "GPT-5.1 Codex Max",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.125,
          "currency": "USD"
        },
        "knowledge": "2024-09-30"
      },
      {
        "id": "openai/gpt-oss-120b:free",
        "provider": "openrouter",
        "name": "gpt-oss-120b (free)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 131072,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2024-06-30"
      },
      {
        "id": "openai/gpt-4o-2024-08-06",
        "provider": "openrouter",
        "name": "GPT-4o (2024-08-06)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 2.5,
          "output": 10,
          "cacheRead": 1.25,
          "currency": "USD"
        },
        "knowledge": "2023-09"
      },
      {
        "id": "openai/o3-mini",
        "provider": "openrouter",
        "name": "o3-mini",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 100000,
        "pricing": {
          "input": 1.1,
          "output": 4.4,
          "cacheRead": 0.55,
          "currency": "USD"
        },
        "knowledge": "2024-05"
      },
      {
        "id": "openai/gpt-5.2",
        "provider": "openrouter",
        "name": "GPT-5.2",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "pdf",
          "image",
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.75,
          "output": 14,
          "cacheRead": 0.175,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "openai/gpt-5.3-codex",
        "provider": "openrouter",
        "name": "GPT-5.3 Codex",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.75,
          "output": 14,
          "cacheRead": 0.175,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "openai/gpt-audio-mini",
        "provider": "openrouter",
        "name": "GPT Audio Mini",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "audio"
        ],
        "output": [
          "text",
          "audio"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.6,
          "output": 2.4,
          "currency": "USD"
        }
      },
      {
        "id": "openai/gpt-5.1-codex-mini",
        "provider": "openrouter",
        "name": "GPT-5.1 Codex mini",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 100000,
        "pricing": {
          "input": 0.25,
          "output": 2,
          "cacheRead": 0.025,
          "currency": "USD"
        },
        "knowledge": "2024-09-30"
      },
      {
        "id": "openai/o4-mini-deep-research",
        "provider": "openrouter",
        "name": "o4-mini-deep-research",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "pdf",
          "image",
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 100000,
        "pricing": {
          "input": 2,
          "output": 8,
          "cacheRead": 0.5,
          "currency": "USD"
        },
        "knowledge": "2024-05"
      },
      {
        "id": "openai/gpt-4.1-nano",
        "provider": "openrouter",
        "name": "GPT-4.1 nano",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1047576,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.1,
          "output": 0.4,
          "cacheRead": 0.025,
          "currency": "USD"
        },
        "knowledge": "2024-04"
      },
      {
        "id": "openai/gpt-oss-120b",
        "provider": "openrouter",
        "name": "gpt-oss-120b",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.039,
          "output": 0.18,
          "currency": "USD"
        },
        "knowledge": "2024-06-30"
      },
      {
        "id": "openai/gpt-4o-2024-11-20",
        "provider": "openrouter",
        "name": "GPT-4o (2024-11-20)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 2.5,
          "output": 10,
          "cacheRead": 1.25,
          "currency": "USD"
        },
        "knowledge": "2023-09"
      },
      {
        "id": "openai/o1",
        "provider": "openrouter",
        "name": "o1",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 100000,
        "pricing": {
          "input": 15,
          "output": 60,
          "cacheRead": 7.5,
          "currency": "USD"
        },
        "knowledge": "2023-09"
      },
      {
        "id": "openai/gpt-chat-latest",
        "provider": "openrouter",
        "name": "GPT Chat Latest",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 30,
          "cacheRead": 0.5,
          "currency": "USD"
        }
      },
      {
        "id": "openai/gpt-5.4",
        "provider": "openrouter",
        "name": "GPT-5.4",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1050000,
        "maxTokens": 128000,
        "pricing": {
          "input": 2.5,
          "output": 15,
          "cacheRead": 0.25,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "openai/gpt-5.4-mini",
        "provider": "openrouter",
        "name": "GPT-5.4 mini",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "pdf",
          "image",
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.75,
          "output": 4.5,
          "cacheRead": 0.075,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "openai/gpt-4.1",
        "provider": "openrouter",
        "name": "GPT-4.1",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1047576,
        "maxTokens": 32768,
        "pricing": {
          "input": 2,
          "output": 8,
          "cacheRead": 0.5,
          "currency": "USD"
        },
        "knowledge": "2024-04"
      },
      {
        "id": "openai/o3-deep-research",
        "provider": "openrouter",
        "name": "o3-deep-research",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 100000,
        "pricing": {
          "input": 10,
          "output": 40,
          "cacheRead": 2.5,
          "currency": "USD"
        },
        "knowledge": "2024-05"
      },
      {
        "id": "openai/gpt-4-turbo-preview",
        "provider": "openrouter",
        "name": "GPT-4 Turbo Preview",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 10,
          "output": 30,
          "currency": "USD"
        },
        "knowledge": "2023-12-31"
      },
      {
        "id": "openai/gpt-5-mini",
        "provider": "openrouter",
        "name": "GPT-5 Mini",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.25,
          "output": 2,
          "cacheRead": 0.025,
          "currency": "USD"
        },
        "knowledge": "2024-05-30"
      },
      {
        "id": "openai/gpt-4.1-mini",
        "provider": "openrouter",
        "name": "GPT-4.1 mini",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1047576,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.4,
          "output": 1.6,
          "cacheRead": 0.1,
          "currency": "USD"
        },
        "knowledge": "2024-04"
      },
      {
        "id": "openai/gpt-4-turbo",
        "provider": "openrouter",
        "name": "GPT-4 Turbo",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4096,
        "pricing": {
          "input": 10,
          "output": 30,
          "currency": "USD"
        },
        "knowledge": "2023-12"
      },
      {
        "id": "openai/gpt-5-nano",
        "provider": "openrouter",
        "name": "GPT-5 Nano",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.05,
          "output": 0.4,
          "cacheRead": 0.01,
          "currency": "USD"
        },
        "knowledge": "2024-05-30"
      },
      {
        "id": "openai/gpt-5.4-pro",
        "provider": "openrouter",
        "name": "GPT-5.4 Pro",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1050000,
        "maxTokens": 128000,
        "pricing": {
          "input": 30,
          "output": 180,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "openai/o3-mini-high",
        "provider": "openrouter",
        "name": "o3 Mini High",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 100000,
        "pricing": {
          "input": 1.1,
          "output": 4.4,
          "cacheRead": 0.55,
          "currency": "USD"
        },
        "knowledge": "2023-10-31"
      },
      {
        "id": "openai/gpt-5.5-pro",
        "provider": "openrouter",
        "name": "GPT-5.5 Pro",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1050000,
        "maxTokens": 128000,
        "pricing": {
          "input": 30,
          "output": 180,
          "currency": "USD"
        },
        "knowledge": "2025-12-01"
      },
      {
        "id": "openai/gpt-4o-mini",
        "provider": "openrouter",
        "name": "GPT-4o mini",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.15,
          "output": 0.6,
          "cacheRead": 0.075,
          "currency": "USD"
        },
        "knowledge": "2023-09"
      },
      {
        "id": "openai/gpt-oss-20b",
        "provider": "openrouter",
        "name": "gpt-oss-20b",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.029,
          "output": 0.14,
          "currency": "USD"
        },
        "knowledge": "2024-06-30"
      },
      {
        "id": "openai/gpt-5-codex",
        "provider": "openrouter",
        "name": "GPT-5-Codex",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.125,
          "currency": "USD"
        },
        "knowledge": "2024-09-30"
      },
      {
        "id": "openai/gpt-5.2-codex",
        "provider": "openrouter",
        "name": "GPT-5.2 Codex",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.75,
          "output": 14,
          "cacheRead": 0.175,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "openai/gpt-oss-20b:free",
        "provider": "openrouter",
        "name": "gpt-oss-20b (free)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 32768,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2024-06-30"
      },
      {
        "id": "openai/gpt-5.1",
        "provider": "openrouter",
        "name": "GPT-5.1",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.13,
          "currency": "USD"
        },
        "knowledge": "2024-09-30"
      },
      {
        "id": "openai/gpt-5.5",
        "provider": "openrouter",
        "name": "GPT-5.5",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1050000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 30,
          "cacheRead": 0.5,
          "currency": "USD"
        },
        "knowledge": "2025-12-01"
      },
      {
        "id": "thedrummer/unslopnemo-12b",
        "provider": "openrouter",
        "name": "UnslopNemo 12B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 32768,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.4,
          "output": 0.4,
          "currency": "USD"
        },
        "knowledge": "2024-04-30"
      },
      {
        "id": "thedrummer/rocinante-12b",
        "provider": "openrouter",
        "name": "Rocinante 12B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 32768,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.17,
          "output": 0.43,
          "currency": "USD"
        },
        "knowledge": "2024-04-30"
      },
      {
        "id": "rekaai/reka-edge",
        "provider": "openrouter",
        "name": "Reka Edge",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 16384,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.1,
          "output": 0.1,
          "currency": "USD"
        }
      },
      {
        "id": "mistralai/mistral-large-2407",
        "provider": "openrouter",
        "name": "Mistral Large 2407",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 131072,
        "pricing": {
          "input": 2,
          "output": 6,
          "cacheRead": 0.2,
          "currency": "USD"
        },
        "knowledge": "2024-03-31"
      },
      {
        "id": "mistralai/mistral-small-3.2-24b-instruct",
        "provider": "openrouter",
        "name": "Mistral Small 3.2 24B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.075,
          "output": 0.2,
          "currency": "USD"
        },
        "knowledge": "2023-10-31"
      },
      {
        "id": "mistralai/mistral-nemo",
        "provider": "openrouter",
        "name": "Mistral Nemo",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.02,
          "output": 0.03,
          "currency": "USD"
        },
        "knowledge": "2024-07"
      },
      {
        "id": "mistralai/mistral-medium-3-5",
        "provider": "openrouter",
        "name": "Mistral Medium 3.5",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 1.5,
          "output": 7.5,
          "currency": "USD"
        }
      },
      {
        "id": "mistralai/ministral-8b-2512",
        "provider": "openrouter",
        "name": "Ministral 3 8B 2512",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.15,
          "output": 0.15,
          "cacheRead": 0.015,
          "currency": "USD"
        }
      },
      {
        "id": "mistralai/mistral-saba",
        "provider": "openrouter",
        "name": "Saba",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 32768,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.2,
          "output": 0.6,
          "cacheRead": 0.02,
          "currency": "USD"
        },
        "knowledge": "2024-09-30"
      },
      {
        "id": "mistralai/mistral-large",
        "provider": "openrouter",
        "name": "Mistral Large",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 128000,
        "pricing": {
          "input": 2,
          "output": 6,
          "cacheRead": 0.2,
          "currency": "USD"
        },
        "knowledge": "2024-11-30"
      },
      {
        "id": "mistralai/mistral-medium-3.1",
        "provider": "openrouter",
        "name": "Mistral Medium 3.1",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.4,
          "output": 2,
          "cacheRead": 0.04,
          "currency": "USD"
        },
        "knowledge": "2025-06-30"
      },
      {
        "id": "mistralai/ministral-3b-2512",
        "provider": "openrouter",
        "name": "Ministral 3 3B 2512",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.1,
          "output": 0.1,
          "cacheRead": 0.01,
          "currency": "USD"
        }
      },
      {
        "id": "mistralai/mistral-small-2603",
        "provider": "openrouter",
        "name": "Mistral Small 4",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.15,
          "output": 0.6,
          "cacheRead": 0.015,
          "currency": "USD"
        },
        "knowledge": "2025-06"
      },
      {
        "id": "mistralai/ministral-14b-2512",
        "provider": "openrouter",
        "name": "Ministral 3 14B 2512",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.2,
          "output": 0.2,
          "cacheRead": 0.02,
          "currency": "USD"
        }
      },
      {
        "id": "mistralai/devstral-2512",
        "provider": "openrouter",
        "name": "Devstral 2",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.4,
          "output": 2,
          "cacheRead": 0.04,
          "currency": "USD"
        },
        "knowledge": "2025-12"
      },
      {
        "id": "mistralai/mixtral-8x22b-instruct",
        "provider": "openrouter",
        "name": "Mixtral 8x22B Instruct",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 65536,
        "maxTokens": 65536,
        "pricing": {
          "input": 2,
          "output": 6,
          "cacheRead": 0.2,
          "currency": "USD"
        },
        "knowledge": "2024-01-31"
      },
      {
        "id": "mistralai/mistral-medium-3",
        "provider": "openrouter",
        "name": "Mistral Medium 3",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.4,
          "output": 2,
          "cacheRead": 0.04,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "mistralai/voxtral-small-24b-2507",
        "provider": "openrouter",
        "name": "Voxtral Small 24B 2507",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 32000,
        "maxTokens": 32000,
        "pricing": {
          "input": 0.1,
          "output": 0.3,
          "cacheRead": 0.01,
          "currency": "USD"
        }
      },
      {
        "id": "mistralai/mistral-large-2512",
        "provider": "openrouter",
        "name": "Mistral Large 3",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.5,
          "output": 1.5,
          "cacheRead": 0.05,
          "currency": "USD"
        },
        "knowledge": "2024-11"
      },
      {
        "id": "mistralai/codestral-2508",
        "provider": "openrouter",
        "name": "Codestral 2508",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 256000,
        "pricing": {
          "input": 0.3,
          "output": 0.9,
          "cacheRead": 0.03,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "bytedance-seed/seed-1.6-flash",
        "provider": "openrouter",
        "name": "Seed 1.6 Flash",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.075,
          "output": 0.3,
          "currency": "USD"
        }
      },
      {
        "id": "bytedance-seed/seed-1.6",
        "provider": "openrouter",
        "name": "Seed 1.6",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.25,
          "output": 2,
          "currency": "USD"
        }
      },
      {
        "id": "bytedance-seed/seed-2.0-mini",
        "provider": "openrouter",
        "name": "Seed-2.0-Mini",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.1,
          "output": 0.4,
          "currency": "USD"
        }
      },
      {
        "id": "bytedance-seed/seed-2.0-lite",
        "provider": "openrouter",
        "name": "Seed-2.0-Lite",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.25,
          "output": 2,
          "currency": "USD"
        }
      },
      {
        "id": "nvidia/nemotron-3-nano-30b-a3b:free",
        "provider": "openrouter",
        "name": "Nemotron 3 Nano 30B A3B (free)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 256000,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "nvidia/nemotron-nano-9b-v2:free",
        "provider": "openrouter",
        "name": "Nemotron Nano 9B V2 (free)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "nvidia/nemotron-nano-12b-v2-vl:free",
        "provider": "openrouter",
        "name": "Nemotron Nano 12B 2 VL (free)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
        "provider": "openrouter",
        "name": "Nemotron 3 Nano Omni (free)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video",
          "audio"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 65536,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "nvidia/nemotron-3-ultra-550b-a55b:free",
        "provider": "openrouter",
        "name": "Nemotron 3 Ultra (free)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 65536,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "nvidia/nemotron-3-ultra-550b-a55b",
        "provider": "openrouter",
        "name": "Nemotron 3 Ultra 550B A55B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.5,
          "output": 2.2,
          "cacheRead": 0.1,
          "currency": "USD"
        }
      },
      {
        "id": "nvidia/nemotron-3-nano-30b-a3b",
        "provider": "openrouter",
        "name": "Nemotron 3 Nano 30B A3B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 228000,
        "pricing": {
          "input": 0.05,
          "output": 0.2,
          "currency": "USD"
        }
      },
      {
        "id": "nvidia/llama-3.3-nemotron-super-49b-v1.5",
        "provider": "openrouter",
        "name": "Llama 3.3 Nemotron Super 49B v1.5",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.4,
          "output": 0.4,
          "currency": "USD"
        }
      },
      {
        "id": "nvidia/nemotron-3-super-120b-a12b:free",
        "provider": "openrouter",
        "name": "Nemotron 3 Super (free)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "nvidia/nemotron-3-super-120b-a12b",
        "provider": "openrouter",
        "name": "Nemotron 3 Super 120B A12B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.09,
          "output": 0.45,
          "currency": "USD"
        }
      },
      {
        "id": "xiaomi/mimo-v2.5",
        "provider": "openrouter",
        "name": "MiMo-V2.5",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "audio",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.14,
          "output": 0.28,
          "cacheRead": 0.0028,
          "currency": "USD"
        },
        "knowledge": "2024-12"
      },
      {
        "id": "xiaomi/mimo-v2.5-pro",
        "provider": "openrouter",
        "name": "MiMo-V2.5-Pro",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.435,
          "output": 0.87,
          "cacheRead": 0.0036,
          "currency": "USD"
        },
        "knowledge": "2024-12"
      },
      {
        "id": "inception/mercury-2",
        "provider": "openrouter",
        "name": "Mercury 2",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 50000,
        "pricing": {
          "input": 0.25,
          "output": 0.75,
          "cacheRead": 0.025,
          "currency": "USD"
        }
      },
      {
        "id": "anthropic/claude-3.5-haiku",
        "provider": "openrouter",
        "name": "Claude 3.5 Haiku",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.8,
          "output": 4,
          "cacheRead": 0.08,
          "cacheWrite": 1,
          "currency": "USD"
        },
        "knowledge": "2024-07-31"
      },
      {
        "id": "anthropic/claude-sonnet-4.5",
        "provider": "openrouter",
        "name": "Claude Sonnet 4.5 (latest)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-07-31"
      },
      {
        "id": "anthropic/claude-sonnet-4",
        "provider": "openrouter",
        "name": "Claude Sonnet 4",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-01-31"
      },
      {
        "id": "anthropic/claude-opus-4.6-fast",
        "provider": "openrouter",
        "name": "Claude Opus 4.6 (Fast)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 30,
          "output": 150,
          "cacheRead": 3,
          "cacheWrite": 37.5,
          "currency": "USD"
        }
      },
      {
        "id": "anthropic/claude-haiku-4.5",
        "provider": "openrouter",
        "name": "Claude Haiku 4.5 (latest)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 1,
          "output": 5,
          "cacheRead": 0.1,
          "cacheWrite": 1.25,
          "currency": "USD"
        },
        "knowledge": "2025-02-28"
      },
      {
        "id": "anthropic/claude-opus-4.7-fast",
        "provider": "openrouter",
        "name": "Claude Opus 4.7 (Fast)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 30,
          "output": 150,
          "cacheRead": 3,
          "cacheWrite": 37.5,
          "currency": "USD"
        }
      },
      {
        "id": "anthropic/claude-opus-4.7",
        "provider": "openrouter",
        "name": "Claude Opus 4.7",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2026-01-31"
      },
      {
        "id": "anthropic/claude-opus-4.8",
        "provider": "openrouter",
        "name": "Claude Opus 4.8",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        }
      },
      {
        "id": "anthropic/claude-opus-4.1",
        "provider": "openrouter",
        "name": "Claude Opus 4.1 (latest)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 32000,
        "pricing": {
          "input": 15,
          "output": 75,
          "cacheRead": 1.5,
          "cacheWrite": 18.75,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "anthropic/claude-opus-4.5",
        "provider": "openrouter",
        "name": "Claude Opus 4.5 (latest)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "anthropic/claude-sonnet-4.6",
        "provider": "openrouter",
        "name": "Claude Sonnet 4.6",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "anthropic/claude-3-haiku",
        "provider": "openrouter",
        "name": "Claude 3 Haiku",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 4096,
        "pricing": {
          "input": 0.25,
          "output": 1.25,
          "cacheRead": 0.03,
          "cacheWrite": 0.3,
          "currency": "USD"
        },
        "knowledge": "2023-08-31"
      },
      {
        "id": "anthropic/claude-opus-4",
        "provider": "openrouter",
        "name": "Claude Opus 4",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 32000,
        "pricing": {
          "input": 15,
          "output": 75,
          "cacheRead": 1.5,
          "cacheWrite": 18.75,
          "currency": "USD"
        },
        "knowledge": "2025-01-31"
      },
      {
        "id": "anthropic/claude-opus-4.8-fast",
        "provider": "openrouter",
        "name": "Claude Opus 4.8 (Fast)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 10,
          "output": 50,
          "cacheRead": 1,
          "cacheWrite": 12.5,
          "currency": "USD"
        }
      },
      {
        "id": "anthropic/claude-opus-4.6",
        "provider": "openrouter",
        "name": "Claude Opus 4.6",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2025-05-31"
      },
      {
        "id": "tencent/hy3-preview",
        "provider": "openrouter",
        "name": "Hy3 preview",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.063,
          "output": 0.21,
          "cacheRead": 0.021,
          "currency": "USD"
        }
      },
      {
        "id": "cohere/command-r-08-2024",
        "provider": "openrouter",
        "name": "Command R",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4000,
        "pricing": {
          "input": 0.15,
          "output": 0.6,
          "currency": "USD"
        },
        "knowledge": "2024-06-01"
      },
      {
        "id": "cohere/command-r-plus-08-2024",
        "provider": "openrouter",
        "name": "Command R+",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 4000,
        "pricing": {
          "input": 2.5,
          "output": 10,
          "currency": "USD"
        },
        "knowledge": "2024-06-01"
      },
      {
        "id": "cohere/north-mini-code:free",
        "provider": "openrouter",
        "name": "North Mini Code (free)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 64000,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "stepfun/step-3.7-flash",
        "provider": "openrouter",
        "name": "Step 3.7 Flash",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 256000,
        "pricing": {
          "input": 0.2,
          "output": 1.15,
          "cacheRead": 0.04,
          "currency": "USD"
        },
        "knowledge": "2026-01-01"
      },
      {
        "id": "stepfun/step-3.5-flash",
        "provider": "openrouter",
        "name": "Step 3.5 Flash",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.09,
          "output": 0.3,
          "cacheRead": 0.02,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "prime-intellect/intellect-3",
        "provider": "openrouter",
        "name": "INTELLECT-3",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.2,
          "output": 1.1,
          "currency": "USD"
        },
        "knowledge": "2024-10"
      },
      {
        "id": "nex-agi/nex-n2-pro:free",
        "provider": "openrouter",
        "name": "Nex-N2-Pro (free)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "~openai/gpt-mini-latest",
        "provider": "openrouter",
        "name": "OpenAI GPT Mini Latest",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "pdf",
          "image",
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.75,
          "output": 4.5,
          "cacheRead": 0.075,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "~openai/gpt-latest",
        "provider": "openrouter",
        "name": "OpenAI GPT Latest",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "pdf",
          "image",
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1050000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 30,
          "cacheRead": 0.5,
          "currency": "USD"
        },
        "knowledge": "2025-12-01"
      },
      {
        "id": "~moonshotai/kimi-latest",
        "provider": "openrouter",
        "name": "MoonshotAI Kimi Latest",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262142,
        "maxTokens": 262142,
        "pricing": {
          "input": 0.66,
          "output": 3.5,
          "cacheRead": 0.33,
          "currency": "USD"
        }
      },
      {
        "id": "relace/relace-search",
        "provider": "openrouter",
        "name": "Relace Search",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1,
          "output": 3,
          "currency": "USD"
        }
      },
      {
        "id": "ai21/jamba-large-1.7",
        "provider": "openrouter",
        "name": "Jamba Large 1.7",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 4096,
        "pricing": {
          "input": 2,
          "output": 8,
          "currency": "USD"
        },
        "knowledge": "2024-08-31"
      },
      {
        "id": "arcee-ai/virtuoso-large",
        "provider": "openrouter",
        "name": "Virtuoso Large",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 64000,
        "pricing": {
          "input": 0.75,
          "output": 1.2,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "arcee-ai/trinity-large-thinking",
        "provider": "openrouter",
        "name": "Trinity Large Thinking",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 80000,
        "pricing": {
          "input": 0.25,
          "output": 0.8,
          "cacheRead": 0.06,
          "currency": "USD"
        }
      },
      {
        "id": "arcee-ai/trinity-mini",
        "provider": "openrouter",
        "name": "Trinity Mini",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.045,
          "output": 0.15,
          "currency": "USD"
        }
      },
      {
        "id": "openrouter/free",
        "provider": "openrouter",
        "name": "Free Models Router",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 8000,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "openrouter/owl-alpha",
        "provider": "openrouter",
        "name": "Owl Alpha",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1048756,
        "maxTokens": 262144,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        }
      },
      {
        "id": "openrouter/auto",
        "provider": "openrouter",
        "name": "Auto Router",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "audio",
          "pdf",
          "video"
        ],
        "output": [
          "text",
          "image"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 2000000,
        "maxTokens": 2000000
      },
      {
        "id": "qwen/qwen3.5-plus-20260420",
        "provider": "openrouter",
        "name": "Qwen3.5 Plus 2026-04-20",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.3,
          "output": 1.8,
          "cacheWrite": 0.375,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3-next-80b-a3b-instruct:free",
        "provider": "openrouter",
        "name": "Qwen3 Next 80B A3B Instruct (free)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "qwen/qwen3-vl-235b-a22b-thinking",
        "provider": "openrouter",
        "name": "Qwen3 VL 235B A22B Thinking",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.26,
          "output": 2.6,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "qwen/qwen3-vl-30b-a3b-thinking",
        "provider": "openrouter",
        "name": "Qwen3 VL 30B A3B Thinking",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.13,
          "output": 1.56,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "qwen/qwen3-coder-plus",
        "provider": "openrouter",
        "name": "Qwen3 Coder Plus",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.65,
          "output": 3.25,
          "cacheRead": 0.13,
          "cacheWrite": 0.8125,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "qwen/qwen-plus",
        "provider": "openrouter",
        "name": "Qwen Plus",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.26,
          "output": 0.78,
          "cacheRead": 0.052,
          "cacheWrite": 0.325,
          "currency": "USD"
        },
        "knowledge": "2024-04"
      },
      {
        "id": "qwen/qwen3-coder-30b-a3b-instruct",
        "provider": "openrouter",
        "name": "Qwen3-Coder 30B-A3B Instruct",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 160000,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.07,
          "output": 0.27,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "qwen/qwen3-32b",
        "provider": "openrouter",
        "name": "Qwen3 32B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 40960,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.08,
          "output": 0.28,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "qwen/qwen3-next-80b-a3b-instruct",
        "provider": "openrouter",
        "name": "Qwen3-Next 80B-A3B Instruct",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.09,
          "output": 1.1,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "qwen/qwen3-vl-8b-instruct",
        "provider": "openrouter",
        "name": "Qwen3 VL 8B Instruct",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.08,
          "output": 0.5,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3.7-plus",
        "provider": "openrouter",
        "name": "Qwen3.7 Plus",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.32,
          "output": 1.28,
          "cacheRead": 0.064,
          "cacheWrite": 0.4,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "qwen/qwen3.6-35b-a3b",
        "provider": "openrouter",
        "name": "Qwen3.6 35B-A3B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.14,
          "output": 1,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3.7-max",
        "provider": "openrouter",
        "name": "Qwen3.7 Max",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 65536,
        "pricing": {
          "input": 1.25,
          "output": 3.75,
          "cacheRead": 0.25,
          "cacheWrite": 1.5625,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3-max",
        "provider": "openrouter",
        "name": "Qwen3 Max",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.78,
          "output": 3.9,
          "cacheRead": 0.156,
          "cacheWrite": 0.975,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "qwen/qwen3-8b",
        "provider": "openrouter",
        "name": "Qwen3 8B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 40960,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.05,
          "output": 0.4,
          "cacheRead": 0.05,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "qwen/qwen-plus-2025-07-28",
        "provider": "openrouter",
        "name": "Qwen Plus 0728",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.26,
          "output": 0.78,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "qwen/qwen3.5-flash-02-23",
        "provider": "openrouter",
        "name": "Qwen3.5-Flash",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.065,
          "output": 0.26,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3-coder:free",
        "provider": "openrouter",
        "name": "Qwen3 Coder 480B A35B (free)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262000,
        "maxTokens": 262000,
        "pricing": {
          "input": 0,
          "output": 0,
          "currency": "USD"
        },
        "knowledge": "2025-06-30"
      },
      {
        "id": "qwen/qwen3-30b-a3b-instruct-2507",
        "provider": "openrouter",
        "name": "Qwen3 30B A3B Instruct 2507",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 32000,
        "pricing": {
          "input": 0.04815,
          "output": 0.19305,
          "currency": "USD"
        },
        "knowledge": "2025-06-30"
      },
      {
        "id": "qwen/qwen3-next-80b-a3b-thinking",
        "provider": "openrouter",
        "name": "Qwen3-Next 80B-A3B (Thinking)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.0975,
          "output": 0.78,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "qwen/qwen3-235b-a22b-thinking-2507",
        "provider": "openrouter",
        "name": "Qwen3 235B A22B Thinking 2507",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.1,
          "output": 0.1,
          "cacheRead": 0.1,
          "currency": "USD"
        },
        "knowledge": "2025-06-30"
      },
      {
        "id": "qwen/qwen3-vl-32b-instruct",
        "provider": "openrouter",
        "name": "Qwen3 VL 32B Instruct",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.104,
          "output": 0.416,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3-coder",
        "provider": "openrouter",
        "name": "Qwen3 Coder 480B A35B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.22,
          "output": 1.8,
          "currency": "USD"
        },
        "knowledge": "2025-06-30"
      },
      {
        "id": "qwen/qwen3.6-flash",
        "provider": "openrouter",
        "name": "Qwen3.6 Flash",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.1875,
          "output": 1.125,
          "cacheWrite": 0.234375,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3.5-plus-02-15",
        "provider": "openrouter",
        "name": "Qwen3.5 Plus 2026-02-15",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.26,
          "output": 1.56,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "qwen/qwen-2.5-7b-instruct",
        "provider": "openrouter",
        "name": "Qwen2.5 7B Instruct",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 32768,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.04,
          "output": 0.1,
          "currency": "USD"
        },
        "knowledge": "2024-06-30"
      },
      {
        "id": "qwen/qwen3-vl-8b-thinking",
        "provider": "openrouter",
        "name": "Qwen3 VL 8B Thinking",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "image",
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.117,
          "output": 1.365,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3-max-thinking",
        "provider": "openrouter",
        "name": "Qwen3 Max Thinking",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.78,
          "output": 3.9,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3-30b-a3b-thinking-2507",
        "provider": "openrouter",
        "name": "Qwen3 30B A3B Thinking 2507",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.08,
          "output": 0.4,
          "cacheRead": 0.08,
          "currency": "USD"
        },
        "knowledge": "2025-06-30"
      },
      {
        "id": "qwen/qwen3.5-27b",
        "provider": "openrouter",
        "name": "Qwen3.5 27B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.195,
          "output": 1.56,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3-235b-a22b",
        "provider": "openrouter",
        "name": "Qwen3 235B-A22B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.455,
          "output": 1.82,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "qwen/qwen-2.5-72b-instruct",
        "provider": "openrouter",
        "name": "Qwen2.5 72B Instruct",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 32768,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.36,
          "output": 0.4,
          "currency": "USD"
        },
        "knowledge": "2024-06-30"
      },
      {
        "id": "qwen/qwen-plus-2025-07-28:thinking",
        "provider": "openrouter",
        "name": "Qwen Plus 0728 (thinking)",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.26,
          "output": 0.78,
          "cacheWrite": 0.325,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "qwen/qwen3-coder-next",
        "provider": "openrouter",
        "name": "Qwen3 Coder Next",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.11,
          "output": 0.8,
          "cacheRead": 0.07,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3.6-27b",
        "provider": "openrouter",
        "name": "Qwen3.6 27B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262140,
        "maxTokens": 262140,
        "pricing": {
          "input": 0.2885,
          "output": 3.17,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3.5-35b-a3b",
        "provider": "openrouter",
        "name": "Qwen3.5 35B-A3B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.14,
          "output": 1,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3.5-9b",
        "provider": "openrouter",
        "name": "Qwen3.5 9B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.1,
          "output": 0.15,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3.5-397b-a17b",
        "provider": "openrouter",
        "name": "Qwen3.5 397B-A17B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.385,
          "output": 2.45,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3-vl-30b-a3b-instruct",
        "provider": "openrouter",
        "name": "Qwen3 VL 30B A3B Instruct",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.13,
          "output": 0.52,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "qwen/qwen3-235b-a22b-2507",
        "provider": "openrouter",
        "name": "Qwen3 235B A22B Instruct 2507",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.09,
          "output": 0.1,
          "currency": "USD"
        },
        "knowledge": "2025-06-30"
      },
      {
        "id": "qwen/qwen3-coder-flash",
        "provider": "openrouter",
        "name": "Qwen3 Coder Flash",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.195,
          "output": 0.975,
          "cacheRead": 0.039,
          "cacheWrite": 0.24375,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "qwen/qwen3-14b",
        "provider": "openrouter",
        "name": "Qwen3 14B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 40960,
        "maxTokens": 40960,
        "pricing": {
          "input": 0.1,
          "output": 0.24,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "qwen/qwen3-vl-235b-a22b-instruct",
        "provider": "openrouter",
        "name": "Qwen3 VL 235B A22B Instruct",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.2,
          "output": 0.88,
          "cacheRead": 0.11,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "qwen/qwen3-30b-a3b",
        "provider": "openrouter",
        "name": "Qwen3 30B A3B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 40960,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.12,
          "output": 0.5,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "qwen/qwen3.6-max-preview",
        "provider": "openrouter",
        "name": "Qwen3.6 Max Preview",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 65536,
        "pricing": {
          "input": 1.04,
          "output": 6.24,
          "cacheWrite": 1.3,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "qwen/qwen3.5-122b-a10b",
        "provider": "openrouter",
        "name": "Qwen3.5 122B-A10B",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.26,
          "output": 2.08,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3.6-plus",
        "provider": "openrouter",
        "name": "Qwen3.6 Plus",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.325,
          "output": 1.95,
          "cacheWrite": 0.40625,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "amazon/nova-lite-v1",
        "provider": "openrouter",
        "name": "Nova Lite 1.0",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 300000,
        "maxTokens": 5120,
        "pricing": {
          "input": 0.06,
          "output": 0.24,
          "currency": "USD"
        },
        "knowledge": "2024-10-31"
      },
      {
        "id": "amazon/nova-premier-v1",
        "provider": "openrouter",
        "name": "Nova Premier 1.0",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 32000,
        "pricing": {
          "input": 2.5,
          "output": 12.5,
          "cacheRead": 0.625,
          "currency": "USD"
        }
      },
      {
        "id": "amazon/nova-pro-v1",
        "provider": "openrouter",
        "name": "Nova Pro 1.0",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 300000,
        "maxTokens": 5120,
        "pricing": {
          "input": 0.8,
          "output": 3.2,
          "currency": "USD"
        },
        "knowledge": "2024-10-31"
      },
      {
        "id": "amazon/nova-micro-v1",
        "provider": "openrouter",
        "name": "Nova Micro 1.0",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 5120,
        "pricing": {
          "input": 0.035,
          "output": 0.14,
          "currency": "USD"
        },
        "knowledge": "2024-10-31"
      },
      {
        "id": "amazon/nova-2-lite-v1",
        "provider": "openrouter",
        "name": "Nova 2 Lite",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 65535,
        "pricing": {
          "input": 0.3,
          "output": 2.5,
          "currency": "USD"
        }
      },
      {
        "id": "sao10k/l3.1-euryale-70b",
        "provider": "openrouter",
        "name": "Llama 3.1 Euryale 70B v2.2",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.85,
          "output": 0.85,
          "currency": "USD"
        },
        "knowledge": "2023-12-31"
      },
      {
        "id": "upstage/solar-pro-3",
        "provider": "openrouter",
        "name": "Solar Pro 3",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.15,
          "output": 0.6,
          "cacheRead": 0.015,
          "currency": "USD"
        }
      },
      {
        "id": "essentialai/rnj-1-instruct",
        "provider": "openrouter",
        "name": "Rnj 1 Instruct",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 32768,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.15,
          "output": 0.15,
          "currency": "USD"
        }
      },
      {
        "id": "deepseek/deepseek-r1-0528",
        "provider": "openrouter",
        "name": "R1 0528",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 163840,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.5,
          "output": 2.15,
          "cacheRead": 0.35,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "deepseek/deepseek-v4-flash",
        "provider": "openrouter",
        "name": "DeepSeek V4 Flash",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.09,
          "output": 0.18,
          "cacheRead": 0.02,
          "currency": "USD"
        },
        "knowledge": "2025-05"
      },
      {
        "id": "deepseek/deepseek-v3.1-terminus",
        "provider": "openrouter",
        "name": "DeepSeek V3.1 Terminus",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 163840,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.27,
          "output": 0.95,
          "cacheRead": 0.13,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "deepseek/deepseek-v4-pro",
        "provider": "openrouter",
        "name": "DeepSeek V4 Pro",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 384000,
        "pricing": {
          "input": 0.435,
          "output": 0.87,
          "cacheRead": 0.003625,
          "currency": "USD"
        },
        "knowledge": "2025-05"
      },
      {
        "id": "deepseek/deepseek-r1",
        "provider": "openrouter",
        "name": "DeepSeek-R1",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 64000,
        "maxTokens": 16000,
        "pricing": {
          "input": 0.7,
          "output": 2.5,
          "currency": "USD"
        },
        "knowledge": "2024-07"
      },
      {
        "id": "deepseek/deepseek-v3.2-exp",
        "provider": "openrouter",
        "name": "DeepSeek V3.2 Exp",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 163840,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.27,
          "output": 0.41,
          "currency": "USD"
        },
        "knowledge": "2025-07-31"
      },
      {
        "id": "deepseek/deepseek-chat-v3-0324",
        "provider": "openrouter",
        "name": "DeepSeek V3 0324",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 163840,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.2,
          "output": 0.77,
          "cacheRead": 0.135,
          "currency": "USD"
        },
        "knowledge": "2024-07-31"
      },
      {
        "id": "deepseek/deepseek-chat",
        "provider": "openrouter",
        "name": "DeepSeek Chat",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16000,
        "pricing": {
          "input": 0.2002,
          "output": 0.8001,
          "currency": "USD"
        },
        "knowledge": "2025-09"
      },
      {
        "id": "deepseek/deepseek-v3.2",
        "provider": "openrouter",
        "name": "DeepSeek V3.2",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 64000,
        "pricing": {
          "input": 0.2288,
          "output": 0.3432,
          "currency": "USD"
        },
        "knowledge": "2024-07"
      },
      {
        "id": "deepseek/deepseek-chat-v3.1",
        "provider": "openrouter",
        "name": "DeepSeek V3.1",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 163840,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.21,
          "output": 0.79,
          "cacheRead": 0.13,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "minimax/minimax-m2.5",
        "provider": "openrouter",
        "name": "MiniMax-M2.5",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 196608,
        "maxTokens": 196608,
        "pricing": {
          "input": 0.15,
          "output": 0.9,
          "cacheRead": 0.05,
          "currency": "USD"
        }
      },
      {
        "id": "minimax/minimax-m2.1",
        "provider": "openrouter",
        "name": "MiniMax-M2.1",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 196608,
        "maxTokens": 196608,
        "pricing": {
          "input": 0.29,
          "output": 0.95,
          "cacheRead": 0.03,
          "currency": "USD"
        }
      },
      {
        "id": "minimax/minimax-m3",
        "provider": "openrouter",
        "name": "MiniMax-M3",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 524288,
        "maxTokens": 512000,
        "pricing": {
          "input": 0.3,
          "output": 1.2,
          "cacheRead": 0.06,
          "currency": "USD"
        }
      },
      {
        "id": "minimax/minimax-m2",
        "provider": "openrouter",
        "name": "MiniMax-M2",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 196608,
        "maxTokens": 196608,
        "pricing": {
          "input": 0.255,
          "output": 1,
          "cacheRead": 0.03,
          "currency": "USD"
        }
      },
      {
        "id": "minimax/minimax-m2.7",
        "provider": "openrouter",
        "name": "MiniMax-M2.7",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 196608,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.25,
          "output": 1,
          "cacheRead": 0.05,
          "currency": "USD"
        }
      },
      {
        "id": "minimax/minimax-m1",
        "provider": "openrouter",
        "name": "MiniMax M1",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 40000,
        "pricing": {
          "input": 0.4,
          "output": 2.2,
          "currency": "USD"
        },
        "knowledge": "2024-06-30"
      },
      {
        "id": "kwaipilot/kat-coder-pro-v2",
        "provider": "openrouter",
        "name": "KAT-Coder-Pro V2",
        "protocol": "openai",
        "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 256000,
        "maxTokens": 80000,
        "pricing": {
          "input": 0.3,
          "output": 1.2,
          "cacheRead": 0.06,
          "currency": "USD"
        }
      }
    ]
  },
  {
    "id": "google-vertex",
    "name": "Vertex",
    "protocol": "google-vertex",
    "baseUrl": "https://aiplatform.googleapis.com",
    "envKey": "GOOGLE_VERTEX_API_KEY",
    "models": [
      {
        "id": "claude-haiku-4-5@20251001",
        "provider": "google-vertex",
        "name": "Claude Haiku 4.5",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 1,
          "output": 5,
          "cacheRead": 0.1,
          "cacheWrite": 1.25,
          "currency": "USD"
        },
        "knowledge": "2025-02-28"
      },
      {
        "id": "gemini-3.1-flash-lite",
        "provider": "google-vertex",
        "name": "Gemini 3.1 Flash Lite",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.25,
          "output": 1.5,
          "cacheRead": 0.025,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "gemini-2.5-pro",
        "provider": "google-vertex",
        "name": "Gemini 2.5 Pro",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.125,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "gemini-2.5-flash",
        "provider": "google-vertex",
        "name": "Gemini 2.5 Flash",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.3,
          "output": 2.5,
          "cacheRead": 0.075,
          "cacheWrite": 0.383,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "gemini-3.5-flash",
        "provider": "google-vertex",
        "name": "Gemini 3.5 Flash",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 1.5,
          "output": 9,
          "cacheRead": 0.15,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "claude-opus-4@20250514",
        "provider": "google-vertex",
        "name": "Claude Opus 4",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 32000,
        "pricing": {
          "input": 15,
          "output": 75,
          "cacheRead": 1.5,
          "cacheWrite": 18.75,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "claude-opus-4-1@20250805",
        "provider": "google-vertex",
        "name": "Claude Opus 4.1",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 32000,
        "pricing": {
          "input": 15,
          "output": 75,
          "cacheRead": 1.5,
          "cacheWrite": 18.75,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "claude-opus-4-5@20251101",
        "provider": "google-vertex",
        "name": "Claude Opus 4.5",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "claude-3-5-haiku@20241022",
        "provider": "google-vertex",
        "name": "Claude Haiku 3.5",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.8,
          "output": 4,
          "cacheRead": 0.08,
          "cacheWrite": 1,
          "currency": "USD"
        },
        "knowledge": "2024-07-31"
      },
      {
        "id": "gemini-3.1-pro-preview-customtools",
        "provider": "google-vertex",
        "name": "Gemini 3.1 Pro Preview Custom Tools",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 2,
          "output": 12,
          "cacheRead": 0.2,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "gemini-flash-lite-latest",
        "provider": "google-vertex",
        "name": "Gemini Flash-Lite Latest",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.1,
          "output": 0.4,
          "cacheRead": 0.025,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "claude-sonnet-4@20250514",
        "provider": "google-vertex",
        "name": "Claude Sonnet 4",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "gemini-2.5-flash-lite",
        "provider": "google-vertex",
        "name": "Gemini 2.5 Flash-Lite",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.1,
          "output": 0.4,
          "cacheRead": 0.01,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "claude-opus-4-7@default",
        "provider": "google-vertex",
        "name": "Claude Opus 4.7",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2026-01-31"
      },
      {
        "id": "gemini-3.1-pro-preview",
        "provider": "google-vertex",
        "name": "Gemini 3.1 Pro Preview",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 2,
          "output": 12,
          "cacheRead": 0.2,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "claude-sonnet-4-5@20250929",
        "provider": "google-vertex",
        "name": "Claude Sonnet 4.5",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-07-31"
      },
      {
        "id": "gemini-3-flash-preview",
        "provider": "google-vertex",
        "name": "Gemini 3 Flash Preview",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.5,
          "output": 3,
          "cacheRead": 0.05,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "claude-opus-4-6@default",
        "provider": "google-vertex",
        "name": "Claude Opus 4.6",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2025-05-31"
      },
      {
        "id": "gemini-flash-latest",
        "provider": "google-vertex",
        "name": "Gemini Flash Latest",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.3,
          "output": 2.5,
          "cacheRead": 0.075,
          "cacheWrite": 0.383,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "claude-opus-4-8@default",
        "provider": "google-vertex",
        "name": "Claude Opus 4.8",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        }
      },
      {
        "id": "claude-sonnet-4-6@default",
        "provider": "google-vertex",
        "name": "Claude Sonnet 4.6",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "gemini-3.1-flash-lite-preview",
        "provider": "google-vertex",
        "name": "Gemini 3.1 Flash Lite Preview",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.25,
          "output": 1.5,
          "cacheRead": 0.025,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "moonshotai/kimi-k2-thinking-maas",
        "provider": "google-vertex",
        "name": "Kimi K2 Thinking",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 262144,
        "pricing": {
          "input": 0.6,
          "output": 2.5,
          "currency": "USD"
        },
        "knowledge": "2024-08"
      },
      {
        "id": "openai/gpt-oss-120b-maas",
        "provider": "google-vertex",
        "name": "GPT OSS 120B",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.09,
          "output": 0.36,
          "currency": "USD"
        }
      },
      {
        "id": "openai/gpt-oss-20b-maas",
        "provider": "google-vertex",
        "name": "GPT OSS 20B",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 131072,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.07,
          "output": 0.25,
          "currency": "USD"
        }
      },
      {
        "id": "zai-org/glm-4.7-maas",
        "provider": "google-vertex",
        "name": "GLM-4.7",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.6,
          "output": 2.2,
          "currency": "USD"
        },
        "knowledge": "2025-04"
      },
      {
        "id": "zai-org/glm-5-maas",
        "provider": "google-vertex",
        "name": "GLM-5",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 202752,
        "maxTokens": 131072,
        "pricing": {
          "input": 1,
          "output": 3.2,
          "cacheRead": 0.1,
          "currency": "USD"
        }
      },
      {
        "id": "deepseek-ai/deepseek-v3.1-maas",
        "provider": "google-vertex",
        "name": "DeepSeek V3.1",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 163840,
        "maxTokens": 32768,
        "pricing": {
          "input": 0.6,
          "output": 1.7,
          "currency": "USD"
        }
      },
      {
        "id": "deepseek-ai/deepseek-v3.2-maas",
        "provider": "google-vertex",
        "name": "DeepSeek V3.2",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 163840,
        "maxTokens": 65536,
        "pricing": {
          "input": 0.56,
          "output": 1.68,
          "cacheRead": 0.056,
          "currency": "USD"
        }
      },
      {
        "id": "qwen/qwen3-235b-a22b-instruct-2507-maas",
        "provider": "google-vertex",
        "name": "Qwen3 235B A22B Instruct",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 262144,
        "maxTokens": 16384,
        "pricing": {
          "input": 0.22,
          "output": 0.88,
          "currency": "USD"
        }
      },
      {
        "id": "meta/llama-3.3-70b-instruct-maas",
        "provider": "google-vertex",
        "name": "Llama 3.3 70B Instruct",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.72,
          "output": 0.72,
          "currency": "USD"
        },
        "knowledge": "2023-12"
      },
      {
        "id": "meta/llama-4-maverick-17b-128e-instruct-maas",
        "provider": "google-vertex",
        "name": "Llama 4 Maverick 17B 128E Instruct",
        "protocol": "google-vertex",
        "baseUrl": "https://aiplatform.googleapis.com",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 524288,
        "maxTokens": 8192,
        "pricing": {
          "input": 0.35,
          "output": 1.15,
          "currency": "USD"
        },
        "knowledge": "2024-08"
      }
    ]
  },
  {
    "id": "deepseek",
    "name": "DeepSeek",
    "protocol": "openai",
    "baseUrl": "https://api.deepseek.com/v1/chat/completions",
    "envKey": "DEEPSEEK_API_KEY",
    "models": [
      {
        "id": "deepseek-v4-flash",
        "provider": "deepseek",
        "name": "DeepSeek V4 Flash",
        "protocol": "openai",
        "baseUrl": "https://api.deepseek.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 384000,
        "pricing": {
          "input": 0.14,
          "output": 0.28,
          "cacheRead": 0.0028,
          "currency": "USD"
        },
        "knowledge": "2025-05"
      },
      {
        "id": "deepseek-v4-pro",
        "provider": "deepseek",
        "name": "DeepSeek V4 Pro",
        "protocol": "openai",
        "baseUrl": "https://api.deepseek.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 384000,
        "pricing": {
          "input": 0.435,
          "output": 0.87,
          "cacheRead": 0.003625,
          "currency": "USD"
        },
        "knowledge": "2025-05"
      },
      {
        "id": "deepseek-reasoner",
        "provider": "deepseek",
        "name": "DeepSeek Reasoner",
        "protocol": "openai",
        "baseUrl": "https://api.deepseek.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 384000,
        "pricing": {
          "input": 0.14,
          "output": 0.28,
          "cacheRead": 0.0028,
          "currency": "USD"
        },
        "knowledge": "2025-09"
      },
      {
        "id": "deepseek-chat",
        "provider": "deepseek",
        "name": "DeepSeek Chat",
        "protocol": "openai",
        "baseUrl": "https://api.deepseek.com/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 384000,
        "pricing": {
          "input": 0.14,
          "output": 0.28,
          "cacheRead": 0.0028,
          "currency": "USD"
        },
        "knowledge": "2025-09"
      }
    ]
  },
  {
    "id": "minimax",
    "name": "MiniMax (minimax.io)",
    "protocol": "openai",
    "baseUrl": "https://api.minimax.io/v1/chat/completions",
    "envKey": "MINIMAX_API_KEY",
    "models": [
      {
        "id": "MiniMax-M2.1",
        "provider": "minimax",
        "name": "MiniMax-M2.1",
        "protocol": "openai",
        "baseUrl": "https://api.minimax.io/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 204800,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.3,
          "output": 1.2,
          "currency": "USD"
        }
      },
      {
        "id": "MiniMax-M2.5-highspeed",
        "provider": "minimax",
        "name": "MiniMax-M2.5-highspeed",
        "protocol": "openai",
        "baseUrl": "https://api.minimax.io/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 204800,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.6,
          "output": 2.4,
          "cacheRead": 0.06,
          "cacheWrite": 0.375,
          "currency": "USD"
        }
      },
      {
        "id": "MiniMax-M2.7-highspeed",
        "provider": "minimax",
        "name": "MiniMax-M2.7-highspeed",
        "protocol": "openai",
        "baseUrl": "https://api.minimax.io/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 204800,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.6,
          "output": 2.4,
          "cacheRead": 0.06,
          "cacheWrite": 0.375,
          "currency": "USD"
        }
      },
      {
        "id": "MiniMax-M2",
        "provider": "minimax",
        "name": "MiniMax-M2",
        "protocol": "openai",
        "baseUrl": "https://api.minimax.io/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 196608,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.3,
          "output": 1.2,
          "currency": "USD"
        }
      },
      {
        "id": "MiniMax-M2.5",
        "provider": "minimax",
        "name": "MiniMax-M2.5",
        "protocol": "openai",
        "baseUrl": "https://api.minimax.io/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 204800,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.3,
          "output": 1.2,
          "cacheRead": 0.03,
          "cacheWrite": 0.375,
          "currency": "USD"
        }
      },
      {
        "id": "MiniMax-M3",
        "provider": "minimax",
        "name": "MiniMax-M3",
        "protocol": "openai",
        "baseUrl": "https://api.minimax.io/v1/chat/completions",
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 512000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.6,
          "output": 2.4,
          "cacheRead": 0.12,
          "currency": "USD"
        }
      },
      {
        "id": "MiniMax-M2.7",
        "provider": "minimax",
        "name": "MiniMax-M2.7",
        "protocol": "openai",
        "baseUrl": "https://api.minimax.io/v1/chat/completions",
        "input": [
          "text"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 204800,
        "maxTokens": 131072,
        "pricing": {
          "input": 0.3,
          "output": 1.2,
          "cacheRead": 0.06,
          "cacheWrite": 0.375,
          "currency": "USD"
        }
      }
    ]
  },
  {
    "id": "github-copilot",
    "name": "GitHub Copilot",
    "protocol": "github-copilot",
    "baseUrl": "https://api.githubcopilot.com/chat/completions",
    "models": [
      {
        "id": "claude-sonnet-4.5",
        "provider": "github-copilot",
        "name": "Claude Sonnet 4.5 (latest)",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 32000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-07-31"
      },
      {
        "id": "claude-sonnet-4",
        "provider": "github-copilot",
        "name": "Claude Sonnet 4 (latest)",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 216000,
        "maxTokens": 16000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "gemini-2.5-pro",
        "provider": "github-copilot",
        "name": "Gemini 2.5 Pro",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 64000,
        "pricing": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.125,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "claude-haiku-4.5",
        "provider": "github-copilot",
        "name": "Claude Haiku 4.5 (latest)",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 1,
          "output": 5,
          "cacheRead": 0.1,
          "cacheWrite": 1.25,
          "currency": "USD"
        },
        "knowledge": "2025-02-28"
      },
      {
        "id": "gemini-3.5-flash",
        "provider": "github-copilot",
        "name": "Gemini 3.5 Flash",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 1.5,
          "output": 9,
          "cacheRead": 0.15,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "gpt-5.4-nano",
        "provider": "github-copilot",
        "name": "GPT-5.4 nano",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.2,
          "output": 1.25,
          "cacheRead": 0.02,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "claude-opus-4.7",
        "provider": "github-copilot",
        "name": "Claude Opus 4.7",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 32000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2026-01-31"
      },
      {
        "id": "gpt-5.2",
        "provider": "github-copilot",
        "name": "GPT-5.2",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.75,
          "output": 14,
          "cacheRead": 0.175,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "gpt-5.3-codex",
        "provider": "github-copilot",
        "name": "GPT-5.3 Codex",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.75,
          "output": 14,
          "cacheRead": 0.175,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "claude-opus-4.8",
        "provider": "github-copilot",
        "name": "Claude Opus 4.8",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        }
      },
      {
        "id": "claude-fable-5",
        "provider": "github-copilot",
        "name": "Claude Fable 5",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "pricing": {
          "input": 10,
          "output": 50,
          "cacheRead": 1,
          "cacheWrite": 12.5,
          "currency": "USD"
        },
        "knowledge": "2026-01-31"
      },
      {
        "id": "claude-opus-4.5",
        "provider": "github-copilot",
        "name": "Claude Opus 4.5 (latest)",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 32000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2025-03-31"
      },
      {
        "id": "gpt-5.4",
        "provider": "github-copilot",
        "name": "GPT-5.4",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 2.5,
          "output": 15,
          "cacheRead": 0.25,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "gpt-5.4-mini",
        "provider": "github-copilot",
        "name": "GPT-5.4 mini",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 0.75,
          "output": 4.5,
          "cacheRead": 0.075,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "gpt-4.1",
        "provider": "github-copilot",
        "name": "GPT-4.1",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": false,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 16384,
        "pricing": {
          "input": 2,
          "output": 8,
          "cacheRead": 0.5,
          "currency": "USD"
        },
        "knowledge": "2024-04"
      },
      {
        "id": "gemini-3.1-pro-preview",
        "provider": "github-copilot",
        "name": "Gemini 3.1 Pro Preview",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 64000,
        "pricing": {
          "input": 2,
          "output": 12,
          "cacheRead": 0.2,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "claude-sonnet-4.6",
        "provider": "github-copilot",
        "name": "Claude Sonnet 4.6",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 32000,
        "pricing": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "gpt-5-mini",
        "provider": "github-copilot",
        "name": "GPT-5 Mini",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 264000,
        "maxTokens": 64000,
        "pricing": {
          "input": 0.25,
          "output": 2,
          "cacheRead": 0.025,
          "currency": "USD"
        },
        "knowledge": "2024-05-30"
      },
      {
        "id": "gemini-3-flash-preview",
        "provider": "github-copilot",
        "name": "Gemini 3 Flash Preview",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 128000,
        "maxTokens": 64000,
        "pricing": {
          "input": 0.5,
          "output": 3,
          "cacheRead": 0.05,
          "currency": "USD"
        },
        "knowledge": "2025-01"
      },
      {
        "id": "claude-opus-4.6",
        "provider": "github-copilot",
        "name": "Claude Opus 4.6",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 200000,
        "maxTokens": 32000,
        "pricing": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25,
          "currency": "USD"
        },
        "knowledge": "2025-05-31"
      },
      {
        "id": "gpt-5.2-codex",
        "provider": "github-copilot",
        "name": "GPT-5.2 Codex",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 1.75,
          "output": 14,
          "cacheRead": 0.175,
          "currency": "USD"
        },
        "knowledge": "2025-08-31"
      },
      {
        "id": "gpt-5.5",
        "provider": "github-copilot",
        "name": "GPT-5.5",
        "protocol": "github-copilot",
        "baseUrl": "https://api.githubcopilot.com/chat/completions",
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ],
        "reasoning": true,
        "toolCall": true,
        "contextWindow": 400000,
        "maxTokens": 128000,
        "pricing": {
          "input": 5,
          "output": 30,
          "cacheRead": 0.5,
          "currency": "USD"
        },
        "knowledge": "2025-12-01"
      }
    ]
  }
] as const;
