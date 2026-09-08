import fs from 'fs';
import path from 'path';
import { buildSystemPrompt } from '../agent.js';
import { createModel, getModelSelection } from '../model.js';
import { cases } from './cases.js';
import { matrix, type MatrixEntry } from './compare.config.js';
import {
  BACKUP_PATH, EVALS_DIR, backupDb, restoreDb, runCase,
  type CaseResult,
} from './lib.js';

interface ConfigResult {
  name: string;
  provider: string;
  modelId: string;
  promptVariant: string;
  passed: number;
  failed: number;
  results: CaseResult[];
}

interface MatrixReport {
  runAt: string;
  configs: ConfigResult[];
}

const DEFAULT_OUT = path.resolve(EVALS_DIR, 'compare-results.json');

/** Run the full scenario suite for one matrix entry. */
async function runConfig(entry: MatrixEntry): Promise<ConfigResult> {
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
  for (const c of cases) {
    process.stdout.write(`  ${c.id} ... `);
    const result = await runCase(c, { model, systemPrompt });
    results.push(result);
    console.log(result.passed ? 'PASS' : `FAIL  (${result.reason})`);
  }

  const passed = results.filter(r => r.passed).length;
  return {
    name: entry.name,
    provider: selection.provider,
    modelId: selection.modelId,
    promptVariant,
    passed,
    failed: results.length - passed,
    results,
  };
}

/** Print the case × configuration matrix. */
function printMatrix(configs: ConfigResult[]): void {
  const caseIds = cases.map(c => c.id);
  const nameWidth = Math.max(...configs.map(c => c.name.length), 4) + 2;
  const caseWidth = Math.max(...caseIds.map(id => id.length)) + 2;

  console.log('\n=== Case × configuration matrix ===\n');
  console.log('  ' + ''.padEnd(caseWidth) + configs.map(c => c.name.padEnd(nameWidth)).join(''));

  for (let i = 0; i < caseIds.length; i++) {
    const row = configs.map(c =>
      (c.results[i]?.passed ? 'PASS' : 'FAIL').padEnd(nameWidth),
    );
    console.log('  ' + caseIds[i].padEnd(caseWidth) + row.join(''));
  }

  console.log('');
  for (const c of configs) {
    console.log(
      `  ${c.name}: ${c.passed}/${c.passed + c.failed} passed` +
      `  (${c.provider}/${c.modelId}, prompt: ${c.promptVariant})`,
    );
  }
  console.log('');
}

async function main() {
  if (matrix.length === 0) {
    console.error('The matrix in evals/compare.config.ts is empty — add at least one entry.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const outFlagIdx = args.indexOf('--out');
  const outPath = outFlagIdx !== -1 ? path.resolve(args[outFlagIdx + 1]) : DEFAULT_OUT;

  console.log(`\n=== Eval matrix — ${matrix.length} configuration(s) × ${cases.length} case(s) ===`);

  backupDb();
  const configs: ConfigResult[] = [];

  try {
    for (const entry of matrix) {
      configs.push(await runConfig(entry));
    }
  } finally {
    restoreDb();
  }

  printMatrix(configs);

  const report: MatrixReport = { runAt: new Date().toISOString(), configs };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Results written to ${path.relative(process.cwd(), outPath)}\n`);

  if (configs.some(c => c.failed > 0)) process.exit(1);
}

main().catch(err => {
  console.error(err);
  if (fs.existsSync(BACKUP_PATH)) restoreDb();
  process.exit(1);
});
