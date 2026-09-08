import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export const MODEL_PROVIDERS = ['anthropic', 'openai', 'google', 'ollama', 'lmstudio'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

const DEFAULT_MODELS: Record<ModelProvider, string | undefined> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
  google: 'gemini-2.0-flash',
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

/** Create the chat model for a selection. No network calls happen here. */
export function createModel({ provider, modelId }: ModelSelection): LanguageModel {
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: process.env.ANTHROPIC_AI_API_KEY || '' })(modelId);
    case 'openai':
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY || '' })(modelId);
    case 'google':
      return createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '' })(modelId);
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
