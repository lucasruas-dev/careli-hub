import type { ApoloEntity, ApoloRelationship } from "@/lib/apolo/types";

import { PanelTitle } from "../shared/apolo-ui";

// Aba Relacionamentos (F1: lista). A rede visual (grafo navegável) entra no F3.
// Dois tipos de vínculo: trabalho (imobiliária/responsável comercial, empreendimentos,
// clientes vinculados) e contato (pessoas: cônjuge, representante legal, assinante,
// familiar, sócio, indicação).
function isContato(rel: ApoloRelationship): boolean {
  return /familiar|c[ôo]njuge|indica|s[óo]ci|represent|assina/i.test(rel.relation);
}

// Clientes que a imobiliária cadastrou (vinculed_by_id). Viram um grupo próprio com
// resumo (contagem) + lista, porque uma imob grande tem 100+.
function isVinculado(rel: ApoloRelationship): boolean {
  return rel.relation === "Comprador vinculado" || rel.relation === "Prospect vinculado";
}

export function RelationshipsPanel({ entity }: { entity: ApoloEntity }) {
  const contato = entity.relationships.filter(isContato);
  const vinculados = entity.relationships.filter(isVinculado);
  const trabalho = entity.relationships.filter(
    (rel) => !isContato(rel) && !isVinculado(rel),
  );

  return (
    <div className="grid gap-5">
      <section className="rounded-xl border border-line bg-surface p-5">
        <PanelTitle eyebrow="Rede" title="Relacionamentos" />
        <p className="m-0 mt-2 text-sm font-medium text-ink-muted">
          A rede visual (grafo navegável) entra na próxima fase. Por enquanto, os
          vínculos em lista, separados por tipo.
        </p>
        <RelGroup items={trabalho} tone="gold" />
        <VinculadosGroup items={vinculados} />
        <RelGroup items={contato} tone="clay" />
        {entity.relationships.length === 0 ? (
          <p className="m-0 mt-4 text-sm font-medium text-ink-muted">
            Nenhum relacionamento cadastrado ainda.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function VinculadosGroup({ items }: { items: ApoloRelationship[] }) {
  if (!items.length) {
    return null;
  }

  const compradores = items.filter(
    (rel) => rel.relation === "Comprador vinculado",
  ).length;
  const prospects = items.length - compradores;
  const parts = [
    compradores ? `${compradores} comprador${compradores === 1 ? "" : "es"}` : null,
    prospects ? `${prospects} prospect${prospects === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          Clientes vinculados
        </p>
        <p className="m-0 text-[11px] font-semibold text-ink-soft">
          {items.length} vinculado{items.length === 1 ? "" : "s"}
          {parts.length ? `: ${parts.join(", ")}` : ""}
        </p>
      </div>
      <div className="mt-2 grid gap-2">
        {items.map((rel) => (
          <RelRow key={`${rel.label}-${rel.relation}`} rel={rel} tone="gold" />
        ))}
      </div>
    </div>
  );
}

function RelGroup({
  items,
  tone,
}: {
  items: ApoloRelationship[];
  tone: "clay" | "gold";
}) {
  if (!items.length) {
    return null;
  }

  return (
    <div className="mt-5">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
        {tone === "gold" ? "Trabalho" : "Contato"}
      </p>
      <div className="mt-2 grid gap-2">
        {items.map((rel) => (
          <RelRow key={`${rel.label}-${rel.relation}`} rel={rel} tone={tone} />
        ))}
      </div>
    </div>
  );
}

function RelRow({
  rel,
  tone,
}: {
  rel: ApoloRelationship;
  tone: "clay" | "gold";
}) {
  const isGold = tone === "gold";

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-subtle px-3 py-2.5">
      <div className="min-w-0">
        <p className="m-0 truncate text-sm font-semibold text-ink">{rel.label}</p>
        <p className="m-0 text-xs text-ink-muted">{rel.relation}</p>
      </div>
      <span
        className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ${
          isGold
            ? "bg-[#A07C3B]/8 text-[#7a5e2c] dark:text-[#d9b877] ring-[#A07C3B]/15"
            : "bg-[#b5623a]/10 text-[#8a4526] ring-[#b5623a]/20"
        }`}
      >
        {isGold ? "Trabalho" : "Contato"}
      </span>
    </div>
  );
}
