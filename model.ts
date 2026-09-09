import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export const MODEL_PROVIDERS = ['anthropic', 'openai', 'google', 'groq', 'bedrock', 'ollama', 'lmstudio'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

const DEFAULT_MODELS: Record<ModelProvider, string | undefined> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
  google: 'gemini-2.0-flash',
  groq: 'qwen/qwen3.8-27b',
  // Claude Haiku 4.5 via the US cross-region inference profile — the base ID
  // (anthropic.claude-haiku-4-5-20251001-v1:0) is not available in-Region in US Regions.
  bedrock: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  ollama: 'llama3.1',
  lmstudio: undefined, // depends on which model you downloaded — MODEL_ID is required
};

export interface ModelSelection {
  provider: ModelProvider;
  modelId: string;
}

/** Read MODEL_PROVIDER / MODEL_ID from the environment, applying defaults. */
export function getModelSelection(env: NodeJS.ProcessEnv = process.env): ModelSelection {
  const raw = (env.MODEL_PROVIDER ?? 'anthropic').toLowerCase();
  if (!MODEL_PROVIDERS.includes(raw as ModelProvider)) {
    throw new Error(
      `Unknown MODEL_PROVIDER "${raw}". Supported providers: ${MODEL_PROVIDERS.join(', ')}.`,
    );
  }
  const provider = raw as ModelProvider;
  const modelId = env.MODEL_ID ?? DEFAULT_MODELS[provider];
  if (!modelId) {
    throw new Error(
      `MODEL_ID is required for provider "${provider}" — set it to the model you loaded on your local server.`,
    );
  }
  return { provider, modelId };
}

/**
 * Read MAX_OUTPUT_TOKENS from the environment. Returns undefined when unset,
 * which leaves the provider's default behavior unchanged. Some providers
 * (e.g. Groq's free tier) reject requests whose implicit output-token budget
 * exceeds the tier's per-minute cap, so this caps it explicitly.
 */
export function getMaxOutputTokens(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.MAX_OUTPUT_TOKENS;
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid MAX_OUTPUT_TOKENS "${raw}" — expected a positive integer.`);
  }
  return value;
}

/** Create the chat model for a selection. No network calls happen here. */
export function createModel({ provider, modelId }: ModelSelection): LanguageModel {
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: process.env.ANTHROPIC_AI_API_KEY || '' })(modelId);
    case 'openai':
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY || '' })(modelId);
    case 'google':
      return createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '' })(modelId);
    case 'groq':
      return createOpenAICompatible({
        name: 'groq',
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey: process.env.GROQ_API_KEY || '',
      })(modelId);
    case 'bedrock':
      // Auth resolves automatically: AWS_BEARER_TOKEN_BEDROCK (Bedrock API key) first,
      // then SigV4 via AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY. Region comes from
      // AWS_REGION (falls back to us-east-1 so the client always builds).
      return createAmazonBedrock({ region: process.env.AWS_REGION ?? 'us-east-1' })(modelId);
    case 'ollama':
      return createOpenAICompatible({
        name: 'ollama',
        baseURL: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
        apiKey: process.env.OLLAMA_API_KEY ?? 'ollama', // Ollama ignores auth; the SDK requires a value
      })(modelId);
    case 'lmstudio':
      return createOpenAICompatible({
        name: 'lmstudio',
        baseURL: process.env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1',
        apiKey: process.env.LMSTUDIO_API_KEY ?? 'lm-studio', // LM Studio ignores auth; the SDK requires a value
      })(modelId);
  }
}

/** The model the agent runs with, driven entirely by env vars. */
export function getModel(): LanguageModel {
  return createModel(getModelSelection());
}
