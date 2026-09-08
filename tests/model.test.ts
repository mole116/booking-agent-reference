import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const { getModelSelection, getMaxOutputTokens, createModel, MODEL_PROVIDERS } = await import('../model.js');

test('defaults to Anthropic claude-sonnet-4-6 when no env is set', () => {
  const selection = getModelSelection({});
  assert.deepEqual(selection, { provider: 'anthropic', modelId: 'claude-sonnet-4-6' });
});

test('provider name is case-insensitive', () => {
  const selection = getModelSelection({ MODEL_PROVIDER: 'OpenAI' });
  assert.equal(selection.provider, 'openai');
});

test('rejects an unknown provider with a helpful error', () => {
  assert.throws(() => getModelSelection({ MODEL_PROVIDER: 'mistral' }), /Unknown MODEL_PROVIDER "mistral"/);
});

test('MODEL_ID overrides the provider default', () => {
  const selection = getModelSelection({ MODEL_PROVIDER: 'google', MODEL_ID: 'gemini-2.5-pro' });
  assert.deepEqual(selection, { provider: 'google', modelId: 'gemini-2.5-pro' });
});

test('groq defaults to qwen/qwen3.8-27b', () => {
  const selection = getModelSelection({ MODEL_PROVIDER: 'groq' });
  assert.deepEqual(selection, { provider: 'groq', modelId: 'qwen/qwen3.8-27b' });
});

test('lmstudio requires MODEL_ID — no default exists for a local server', () => {
  assert.throws(() => getModelSelection({ MODEL_PROVIDER: 'lmstudio' }), /MODEL_ID is required/);
});

test('createModel builds a model for every provider without any network calls', () => {
  for (const provider of MODEL_PROVIDERS) {
    const model = createModel({ provider, modelId: 'test-model' });
    assert.ok(model, `no model returned for ${provider}`);
    assert.equal(typeof (model as { modelId?: unknown }).modelId, 'string');
  }
});

test('MAX_OUTPUT_TOKENS is undefined when unset or blank', () => {
  assert.equal(getMaxOutputTokens({}), undefined);
  assert.equal(getMaxOutputTokens({ MAX_OUTPUT_TOKENS: '' }), undefined);
  assert.equal(getMaxOutputTokens({ MAX_OUTPUT_TOKENS: '  ' }), undefined);
});

test('MAX_OUTPUT_TOKENS parses a positive integer', () => {
  assert.equal(getMaxOutputTokens({ MAX_OUTPUT_TOKENS: '800' }), 800);
});

test('MAX_OUTPUT_TOKENS rejects invalid values with a helpful error', () => {
  assert.throws(() => getMaxOutputTokens({ MAX_OUTPUT_TOKENS: 'abc' }), /Invalid MAX_OUTPUT_TOKENS "abc"/);
  assert.throws(() => getMaxOutputTokens({ MAX_OUTPUT_TOKENS: '0' }), /Invalid MAX_OUTPUT_TOKENS "0"/);
  assert.throws(() => getMaxOutputTokens({ MAX_OUTPUT_TOKENS: '-100' }), /Invalid MAX_OUTPUT_TOKENS "-100"/);
});
