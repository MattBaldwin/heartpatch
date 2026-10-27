import { basename } from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * CI only: prints each spec's test time as one GitHub notice, so E2E_GROUPS
 * (playwright.config.ts) can be rebalanced from the check run's annotations
 * (`gh api repos/<owner>/<repo>/check-runs/<id>/annotations`) when the job
 * logs and the report artifact can't be read.
 *
 * The message is JSON: seconds per spec (`battle` for battle.spec.ts), every
 * try of every test summed (a retry's time counts, it ran), plus `_total`
 * (all specs) and `_wall` (the run's wall clock). One line of a few hundred
 * bytes, far under an annotation's 64 KB.
 */
export default class SpecTimingReporter implements Reporter {
  private readonly seconds = new Map<string, number>();
  private project = '';

  onTestEnd(test: TestCase, result: TestResult): void {
    const spec = basename(test.location.file).replace(/\.spec\.ts$/, '');
    this.seconds.set(spec, (this.seconds.get(spec) ?? 0) + result.duration / 1000);
    this.project ||= test.parent.project()?.name ?? '';
  }

  onEnd(result: FullResult): void {
    const specs = [...this.seconds].sort(([a], [b]) => a.localeCompare(b));
    const timing: Record<string, number> = {};
    let total = 0;
    for (const [spec, seconds] of specs) {
      timing[spec] = Math.round(seconds);
      total += seconds;
    }
    timing['_total'] = Math.round(total);
    timing['_wall'] = Math.round(result.duration / 1000);
    const group = process.env['HP_E2E_GROUP'] ?? 'all';
    // Workflow commands: a title can't hold `:` or `,`, and neither part a newline.
    const title = `spec-timing ${this.project} ${group}`.replace(/[:,\r\n]/g, '-');
    console.log(`::notice title=${title}::${JSON.stringify(timing)}`);
  }

  printsToStdio(): boolean {
    return false;
  }
}
