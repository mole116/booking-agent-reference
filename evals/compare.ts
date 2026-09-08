import fs from 'fs';
import path from 'path';
import { buildSystemPrompt, type TokenUsage } from '../agent.js';
import { createModel, getModelSelection } from '../model.js';
import { cases } from './cases.js';
import { matrix, type MatrixEntry } from './compare.config.js';
import {
  BACKUP_PATH, EVALS_DIR, backupDb, restoreDb, runCase, withTimeout,
  CaseTimeoutError, ZERO_USAGE,
  type CaseResult, type EvalCase,
} from './lib.js';
import { parseCompareArgs, selectConfigs, selectCases } from './select.js';

interface ConfigResult {
  name: string;
  provider: string;
  modelId: string;
  promptVariant: string;
  passed: number;
  failed: number;
  totalDurationMs: number;
  totalUsage: TokenUsage;
  results: CaseResult[];
  /** Set when the configuration itself failed (bad model, missing key, ...) — its cases never ran. */
  error?: string;
}

interface MatrixReport {
  runAt: string;
  caseTimeoutMs: number;
  configs: ConfigResult[];
}

const DEFAULT_OUT = path.resolve(EVALS_DIR, 'compare-results.json');

function sumUsage(results: CaseResult[]): TokenUsage {
  return results.reduce<TokenUsage>(
    (acc, r) => ({
      inputTokens: acc.inputTokens + r.usage.inputTokens,
      outputTokens: acc.outputTokens + r.usage.outputTokens,
      totalTokens: acc.totalTokens + r.usage.totalTokens,
    }),
    { ...ZERO_USAGE },
  );
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmtSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Run the selected scenarios for one matrix entry. */
async function runConfig(
  entry: MatrixEntry,
  selectedCases: EvalCase[],
  timeoutMs: number,
): Promise<ConfigResult> {
  // Resolve the model: entry fields win over the env defaults, and an entry
  // that names only a provider still gets that provider's default model.
  const env = { ...process.env };
  if (entry.provider) env.MODEL_PROVIDER = entry.provider;
  if (entry.modelId) env.MODEL_ID = entry.modelId;
  const selection = getModelSelection(env);
  const model = createModel(selection);

  let systemPrompt: string | undefined;
  let promptVariant = 'default';
  if (typeof entry.prompt === 'function') {
    const today = new Date().toISOString().split('T')[0];
    systemPrompt = entry.prompt(buildSystemPrompt(today));
    promptVariant = 'custom';
  }

  console.log(`\n[${entry.name}]  ${selection.provider}/${selection.modelId}  ·  prompt: ${promptVariant}`);

  const results: CaseResult[] = [];
  for (const c of selectedCases) {
    process.stdout.write(`  ${c.id} ... `);
    const startedAt = Date.now();
    let result: CaseResult;
    try {
      result = await withTimeout(runCase(c, { model, systemPrompt }), timeoutMs, `${entry.name}/${c.id}`);
    } catch (err) {
      // A timed-out (or otherwise crashed) case is marked failed and the run
      // continues with the next case. The timed-out agent may still finish in
      // the background; its late result is discarded.
      result = {
        id: c.id,
        description: c.description,
        passed: false,
        reason:
          err instanceof CaseTimeoutError
            ? `Timeout after ${Math.round(timeoutMs / 1000)}s`
            : `Runner error: ${err instanceof Error ? err.message : err}`,
        toolsCalledPerTurn: [],
        durationMs: Date.now() - startedAt,
        usage: { ...ZERO_USAGE },
      };
    }
    results.push(result);
    const metrics = `${fmtSeconds(result.durationMs)}, ${fmtTokens(result.usage.totalTokens)} tok`;
    console.log(result.passed ? `PASS  (${metrics})` : `FAIL  (${result.reason}; ${metrics})`);
  }

  const passed = results.filter(r => r.passed).length;
  return {
    name: entry.name,
    provider: selection.provider,
    modelId: selection.modelId,
    promptVariant,
    passed,
    failed: results.length - passed,
    totalDurationMs: results.reduce((acc, r) => acc + r.durationMs, 0),
    totalUsage: sumUsage(results),
    results,
  };
}

/** Print the case × configuration matrix plus a per-config summary row. */
function printMatrix(configs: ConfigResult[], selectedCases: EvalCase[]): void {
  const caseIds = selectedCases.map(c => c.id);
  const nameWidth = Math.max(...configs.map(c => c.name.length), 4) + 2;
  const caseWidth = Math.max(...caseIds.map(id => id.length), 4) + 2;

  console.log('\n=== Case × configuration matrix ===\n');
  console.log('  ' + ''.padEnd(caseWidth) + configs.map(c => c.name.padEnd(nameWidth)).join(''));

  for (let i = 0; i < caseIds.length; i++) {
    const row = configs.map(c =>
      (c.error ? 'ERR' : c.results[i]?.passed ? 'PASS' : 'FAIL').padEnd(nameWidth),
    );
    console.log('  ' + caseIds[i].padEnd(caseWidth) + row.join(''));
  }

  console.log('');
  for (const c of configs) {
    const total = c.passed + c.failed;
    let line =
      `  ${c.name}: ${c.passed}/${total} passed` +
      `  ·  ${fmtSeconds(c.totalDurationMs)} total` +
      `  ·  ${fmtTokens(c.totalUsage.totalTokens)} tokens` +
      ` (in ${fmtTokens(c.totalUsage.inputTokens)} / out ${fmtTokens(c.totalUsage.outputTokens)})` +
      `  (${c.provider}/${c.modelId}, prompt: ${c.promptVariant})`;
    if (c.error) line += `  — configuration error: ${c.error}`;
    console.log(line);
  }
  console.log('');
}

async function main() {
  if (matrix.length === 0) {
    console.error('The matrix in evals/compare.config.ts is empty — add at least one entry.');
    process.exit(1);
  }

  const options = parseCompareArgs(process.argv.slice(2));
  const outPath = options.out ? path.resolve(options.out) : DEFAULT_OUT;
  const selectedConfigs = selectConfigs(matrix, options.configNames);
  const selectedCases = selectCases(cases, options.caseIds);

  console.log(
    `\n=== Eval matrix — ${selectedConfigs.length} configuration(s) × ${selectedCases.length} case(s)` +
    `  ·  per-case timeout: ${Math.round(options.timeoutMs / 1000)}s ===`,
  );

  backupDb();
  const configs: ConfigResult[] = [];

  try {
    for (const entry of selectedConfigs) {
      try {
        configs.push(await runConfig(entry, selectedCases, options.timeoutMs));
      } catch (err) {
        // A configuration that fails outright (bad provider, missing API key,
        // model server down) is recorded and the matrix continues with the
        // next configuration instead of dying.
        const message = err instanceof Error ? err.message : String(err);
        console.log(`  ✗ configuration "${entry.name}" failed: ${message} — continuing`);
        configs.push({
          name: entry.name,
          provider: entry.provider ?? process.env.MODEL_PROVIDER ?? 'anthropic',
          modelId: entry.modelId ?? '(provider default)',
          promptVariant: typeof entry.prompt === 'function' ? 'custom' : 'default',
          passed: 0,
          failed: selectedCases.length,
          totalDurationMs: 0,
          totalUsage: { ...ZERO_USAGE },
          results: [],
          error: message,
        });
      }
    }
  } finally {
    restoreDb();
  }

  printMatrix(configs, selectedCases);

  const report: MatrixReport = {
    runAt: new Date().toISOString(),
    caseTimeoutMs: options.timeoutMs,
    configs,
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Results written to ${path.relative(process.cwd(), outPath)}\n`);

  if (configs.some(c => c.failed > 0)) process.exit(1);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  if (fs.existsSync(BACKUP_PATH)) restoreDb();
  process.exit(1);
});
