import type { OverdueRangeFilter } from "@/modules/guardian/attendance/profile-scope";
import { overdueRangeLabels } from "@/modules/guardian/attendance/queue-filter-options";
import type {
  AttendancePriority,
  WorkflowStage,
} from "@/modules/guardian/attendance/types";

export type QueueActiveFilter = {
  clear: () => void;
  label: string;
  value: string;
};

type BuildQueueActiveFiltersInput = {
  onEnterpriseChange: (enterprise: string) => void;
  onOverdueRangeChange: (range: OverdueRangeFilter) => void;
  onPriorityChange: (priority: AttendancePriority | "Todos") => void;
  onStageChange: (stage: WorkflowStage | "Todas") => void;
  overdueRange: OverdueRangeFilter;
  overdueRangeEnabled: boolean;
  selectedEnterprise: string;
  selectedPriority: AttendancePriority | "Todos";
  selectedStage: WorkflowStage | "Todas";
};

export function buildQueueActiveFilters({
  onEnterpriseChange,
  onOverdueRangeChange,
  onPriorityChange,
  onStageChange,
  overdueRange,
  overdueRangeEnabled,
  selectedEnterprise,
  selectedPriority,
  selectedStage,
}: BuildQueueActiveFiltersInput): QueueActiveFilter[] {
  return [
    selectedEnterprise !== "Todos"
      ? {
          clear: () => onEnterpriseChange("Todos"),
          label: "Empreendimento",
          value: selectedEnterprise,
        }
      : null,
    overdueRangeEnabled && overdueRange !== "all"
      ? {
          clear: () => onOverdueRangeChange("all"),
          label: "Atraso",
          value: overdueRangeLabels[overdueRange],
        }
      : null,
    selectedPriority !== "Todos"
      ? {
          clear: () => onPriorityChange("Todos"),
          label: "Prioridade",
          value: selectedPriority,
        }
      : null,
    selectedStage !== "Todas"
      ? {
          clear: () => onStageChange("Todas"),
          label: "Workflow",
          value: selectedStage,
        }
      : null,
  ].filter((item): item is QueueActiveFilter => Boolean(item));
}
