import fs from 'fs';
import path from 'path';
import { cases } from './cases.js';
import {
  BACKUP_PATH, EVALS_DIR, backupDb, restoreDb, runCase,
  type CaseResult,
} from './lib.js';

interface Report {
  runAt: string;
  passed: number;
  failed: number;
  total: number;
  results: CaseResult[];
}

const DEFAULT_OUT = path.resolve(EVALS_DIR, 'results.json');

async function main() {
  const args = process.argv.slice(2);
  const outFlagIdx = args.indexOf('--out');
  const outPath = outFlagIdx !== -1 ? path.resolve(args[outFlagIdx + 1]) : DEFAULT_OUT;
  const filter = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out');

  const toRun = filter ? cases.filter(c => c.id === filter) : cases;

  if (toRun.length === 0) {
    console.error(`No cases match "${filter}"`);
    process.exit(1);
  }

  console.log(`\n=== Booking Agent Evals — ${toRun.length} case(s) ===\n`);

  backupDb();
  const results: CaseResult[] = [];

  try {
    for (const c of toRun) {
      process.stdout.write(`  ${c.id} ... `);
      const result = await runCase(c);
      results.push(result);

      if (result.passed) {
        console.log('PASS');
      } else {
        console.log(`FAIL\n    ✗ ${result.reason}`);
        console.log(`    Tools per turn: ${result.toolsCalledPerTurn.map((t, i) => `turn ${i + 1}: [${t.join(', ')}]`).join('  |  ')}`);
      }
    }
  } finally {
    restoreDb();
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;

  const report: Report = {
    runAt: new Date().toISOString(),
    passed,
    failed,
    total: results.length,
    results,
  };

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`\n${passed}/${results.length} passed  —  results written to ${path.relative(process.cwd(), outPath)}\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  if (fs.existsSync(BACKUP_PATH)) restoreDb();
  process.exit(1);
});
