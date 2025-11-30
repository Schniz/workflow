import { getStepMetadata, getWorkflowMetadata } from 'workflow';

export async function benchmark(startedAt: string) {
  'use workflow';
  const firstStep = await timeTaken(new Date());
  const secondStep = await timeTaken(firstStep.finishedAt);
  return {
    metadataStartedAt: getWorkflowMetadata().workflowStartedAt,
    startedAt: new Date(startedAt),
    firstStep,
    secondStep,
    done: new Date(),
  };
}

async function timeTaken(startedAt: Date) {
  'use step';
  return {
    startedAt,
    finishedAt: new Date(),
    startedAtMetadata: getStepMetadata().stepStartedAt,
  };
}
