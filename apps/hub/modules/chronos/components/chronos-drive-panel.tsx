import { ClipboardCheck, Radio } from "lucide-react";
import type { ReactNode } from "react";

export type ChronosDriveView = "recordings" | "minutes";

type ChronosDrivePanelProps = {
  activeDriveView: ChronosDriveView;
  children: ReactNode;
  onChangeDriveView: (view: ChronosDriveView) => void;
};

export function ChronosDrivePanel({
  activeDriveView,
  children,
  onChangeDriveView,
}: ChronosDrivePanelProps) {
  const tabs: Array<{
    icon: typeof Radio;
    id: ChronosDriveView;
    label: string;
  }> = [
    { icon: Radio, id: "recordings", label: "Gravacoes" },
    { icon: ClipboardCheck, id: "minutes", label: "Atas" },
  ];

  return (
    <div className="grid min-h-full grid-rows-[auto_minmax(0,1fr)] gap-3">
      <div className="flex gap-1 overflow-x-auto border-b border-[#d9e0e7] pb-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeDriveView === tab.id;

          return (
            <button
              aria-pressed={isActive}
              className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold transition ${
                isActive
                  ? "bg-[#101820] text-white"
                  : "text-[#667085] hover:bg-white hover:text-[#101820]"
              }`}
              key={tab.id}
              onClick={() => onChangeDriveView(tab.id)}
              type="button"
            >
              <Icon aria-hidden="true" size={15} />
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="min-h-0">{children}</div>
    </div>
  );
}
