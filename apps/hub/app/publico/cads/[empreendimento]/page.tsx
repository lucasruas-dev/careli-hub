import type { Metadata } from "next";

import { loadCadRecords } from "@/lib/analytics/cad-source";
import {
  CadPublicDashboard,
  type CadPublicItem,
} from "@/modules/cads/CadPublicDashboard";

// Página PÚBLICA (sem login, fora do menu do HUB) do dashboard de CADs de UM empreendimento.
// Server component: lê o Asana Central de CAD server-side (ASANA_ACCESS_TOKEN), filtra pelo
// empreendimento do slug e entrega os registros ao dashboard interativo. Genérica: qualquer
// empreendimento pela URL (/publico/cads/<slug>). noindex — tem nome de prospect, não deve
// ser indexada por busca. Ver [[reference-panteon-super-motor]] (fonte cad-source.ts).

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Central de CADs | Careli",
};

function normalize(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function slugToLabel(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default async function CadPublicRoute({
  params,
}: {
  params: Promise<{ empreendimento: string }>;
}) {
  const { empreendimento } = await params;
  const slugLabel = slugToLabel(empreendimento);
  const target = normalize(slugLabel);

  const all = await loadCadRecords();
  const disponivel = all !== null;

  const matched = (all ?? []).filter((record) => {
    const emp = normalize(record.empreendimento);

    return emp.length > 0 && (emp.includes(target) || target.includes(emp));
  });

  const label = matched[0]?.empreendimento?.trim() || slugLabel;

  const records: CadPublicItem[] = matched.map((record) => ({
    cliente: record.cliente,
    criadoEm: record.criadoEm,
    etapa: record.etapa?.trim() || "Sem etapa",
    imobiliaria: record.imobiliaria?.trim() || "Sem imobiliária",
  }));

  return (
    <CadPublicDashboard
      disponivel={disponivel}
      empreendimento={label}
      records={records}
    />
  );
}
