import type { QueueClient, WorkflowStage } from "@/modules/guardian/attendance/types";
import { workflowStages } from "@/modules/guardian/attendance/workflow";

export type QueueWorkflowStageCount = {
  count: number;
  stage: WorkflowStage;
};

export function buildWorkflowStageCounts(
  clients: QueueClient[],
): QueueWorkflowStageCount[] {
  return workflowStages.map((stage) => ({
    count: clients.filter((client) => client.workflow.stage === stage).length,
    stage,
  }));
}

export function getActiveWorkflowStageCounts(
  stageCounts: QueueWorkflowStageCount[],
) {
  return stageCounts.filter((item) => item.count > 0);
}

export function getWorkflowStageCount(
  stageCounts: QueueWorkflowStageCount[],
  stage: WorkflowStage,
) {
  return stageCounts.find((item) => item.stage === stage)?.count ?? 0;
}
