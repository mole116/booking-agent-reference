import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const { parseCompareArgs, selectConfigs, selectCases, DEFAULT_CASE_TIMEOUT_MS } = await import('../evals/select.js');
const { withTimeout, CaseTimeoutError, ZERO_USAGE } = await import('../evals/lib.js');

test('parseCompareArgs defaults: no filters, default timeout', () => {
  const options = parseCompareArgs([]);
  assert.equal(options.configNames, undefined);
  assert.equal(options.caseIds, undefined);
  assert.equal(options.timeoutMs, DEFAULT_CASE_TIMEOUT_MS);
  assert.equal(options.out, undefined);
});

test('parseCompareArgs reads --out and --timeout (seconds → ms)', () => {
  const options = parseCompareArgs(['--out', 'out.json', '--timeout', '60']);
  assert.equal(options.out, 'out.json');
  assert.equal(options.timeoutMs, 60_000);
});

test('parseCompareArgs collects repeated and comma-separated --config/--case', () => {
  const options = parseCompareArgs(['--config', 'a', '--config', 'b,c', '--case', 'x,y']);
  assert.deepEqual(options.configNames, ['a', 'b', 'c']);
  assert.deepEqual(options.caseIds, ['x', 'y']);
});

test('parseCompareArgs rejects a non-numeric --timeout', () => {
  assert.throws(() => parseCompareArgs(['--timeout', 'soon']), /Invalid --timeout/);
});

test('selectConfigs filters by name, unknown name fails loudly', () => {
  const matrix = [{ name: 'default' }, { name: 'local', provider: 'ollama' }] as any[];
  assert.deepEqual(selectConfigs(matrix, ['local']), [matrix[1]]);
  assert.throws(() => selectConfigs(matrix, ['nope']), /Unknown configuration "nope".*default.*local/s);
});

test('selectCases filters by id, unknown id fails loudly', () => {
  const cases = [{ id: 'a' }, { id: 'b' }] as any[];
  assert.deepEqual(selectCases(cases, ['b']), [cases[1]]);
  assert.deepEqual(selectCases(cases), cases);
  assert.throws(() => selectCases(cases, ['nope']), /Unknown case "nope".*a.*b/s);
});

test('withTimeout resolves with the value when the promise settles in time', async () => {
  const value = await withTimeout(Promise.resolve(42), 1000, 'fast');
  assert.equal(value, 42);
});

test('withTimeout rejects with CaseTimeoutError when the promise hangs', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 50, 'slow-case'),
    (err: unknown) => {
      assert.ok(err instanceof CaseTimeoutError);
      assert.match(err.message, /Timed out after 0s: slow-case/);
      return true;
    },
  );
});

test('ZERO_USAGE is a zeroed token counter', () => {
  assert.deepEqual(ZERO_USAGE, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
});
