import type { OverdueRangeFilter } from "@/modules/guardian/attendance/profile-scope";

export const overdueRangeLabels: Record<OverdueRangeFilter, string> = {
  "1-30": "1-30",
  "31-60": "31-60",
  "60+": "Acima de 60",
  all: "Todos",
};

export const overdueRangeOptions: Array<{
  label: string;
  value: OverdueRangeFilter;
}> = [
  { label: "Todos", value: "all" },
  { label: "1-30", value: "1-30" },
  { label: "31-60", value: "31-60" },
  { label: "60+", value: "60+" },
];
