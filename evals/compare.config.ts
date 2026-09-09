import type { ModelProvider } from '../model.js';

export interface MatrixEntry {
  /** Display name for this configuration. */
  name: string;
  /** Model to run with. Omit both fields to use the env default (MODEL_PROVIDER / MODEL_ID). */
  provider?: ModelProvider;
  modelId?: string;
  /**
   * System-prompt variant. Omit (or 'default') to use the production prompt;
   * pass a function that receives the production prompt and returns a modified one.
   */
  prompt?: 'default' | ((productionPrompt: string) => string);
}

/**
 * The comparison matrix: one entry per configuration. Every entry runs the
 * full scenario suite from cases.ts. Examples:
 *
 *   { name: 'gpt-4o-mini',  provider: 'openai', modelId: 'gpt-4o-mini' },
 *   { name: 'llama-local',  provider: 'ollama', modelId: 'llama3.1' },
 *   { name: 'strict-dates', prompt: (p) => p + '\nNever guess a date the user did not state.' },
 *
 * Bedrock entries (billable — require AWS credentials and model access enabled
 * in your Bedrock region, so they stay commented out by default):
 *
 *   { name: 'bedrock-haiku-4.5', provider: 'bedrock', modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' },
 *   { name: 'bedrock-nova-lite', provider: 'bedrock', modelId: 'us.amazon.nova-lite-v1:0' },
 */
export const matrix: MatrixEntry[] = [
  { name: 'default' },
];
