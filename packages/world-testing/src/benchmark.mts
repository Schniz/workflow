import { expect, test, vi } from 'vitest';
import { hydrateWorkflowReturnValue } from 'workflow/internal/serialization';
import type { benchmark as benchmarkWorkflow } from '../workflows/benchmark.js';
import { createFetcher, startServer } from './util.mjs';

export function benchmark(world: string) {
  test('get benchmark information', async () => {
    const server = await startServer({ world }).then(createFetcher);
    const result = await server.invoke('workflows/benchmark.ts', 'benchmark', [
      new Date().toISOString(),
    ]);
    const run = await vi.waitFor(
      async () => {
        const run = await server.getRun(result.runId);
        expect(run).toMatchObject<Partial<typeof run>>({
          status: 'completed',
        });
        return run;
      },
      {
        interval: 200,
        timeout: 20_000,
      }
    );
    const output: Awaited<ReturnType<typeof benchmarkWorkflow>> =
      await hydrateWorkflowReturnValue(run.output, [], run.runId);

    const msBetween = (later: Date, earlier: Date) =>
      later.getTime() - earlier.getTime();

    const invocationToWorkflowStart = msBetween(
      output.metadataStartedAt,
      output.startedAt
    );
    const invocationToInitialStepRequest = msBetween(
      output.firstStep.startedAt,
      output.startedAt
    );
    const firstStepRequestToStepCreation = msBetween(
      output.firstStep.startedAtMetadata,
      output.firstStep.startedAt
    );
    const firstStepRequestToStepExecution = msBetween(
      output.firstStep.finishedAt,
      output.firstStep.startedAt
    );

    console.log({
      invocationToWorkflowStart,
      invocationToInitialStepRequest,
      firstStepRequestToStepCreation,
      firstStepRequestToStepExecution,
    });
  });
}
