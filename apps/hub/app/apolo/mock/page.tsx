"use client";

import { useState } from "react";

import { mockApoloEntity } from "@/lib/apolo/mock-entity";
import { RecordWorkspace } from "@/modules/apolo/blocks/crm/record-workspace";
import type { ApoloTab } from "@/modules/apolo/types/apolo-local";

// Preview local da ficha do Apolo com uma entidade de exemplo, para iterar a
// UI (chips de papel, abas adaptativas, relacionamentos) sem depender do
// read-model real. Rota interna de desenvolvimento.
export default function ApoloMockPage() {
  const [tab, setTab] = useState<ApoloTab>("resumo");
  const entity = mockApoloEntity();

  return (
    <div className="h-full min-h-0 p-4">
      <RecordWorkspace
        activeTab={tab}
        entity={entity}
        loading={false}
        onChangeTab={setTab}
        onOpenCommercialRelationship={() => {}}
      />
    </div>
  );
}
