import type { ApoloEntity, ApoloRelationship } from "@/lib/apolo/types";

import { PanelTitle } from "../shared/apolo-ui";

// Aba Relacionamentos (F1: lista). A rede visual (grafo navegável) entra no F3.
// Dois tipos de vínculo: trabalho e contato.
function isContato(rel: ApoloRelationship): boolean {
  return /respons|familiar|contato|c[ôo]njuge|indica|s[óo]ci|represent|assina/i.test(
    rel.relation,
  );
}

export function RelationshipsPanel({ entity }: { entity: ApoloEntity }) {
  const contato = entity.relationships.filter(isContato);
  const trabalho = entity.relationships.filter((rel) => !isContato(rel));

  return (
    <div className="grid gap-5">
      <section className="rounded-xl border border-line bg-surface p-5">
        <PanelTitle eyebrow="Rede" title="Relacionamentos" />
        <p className="m-0 mt-2 text-sm font-medium text-ink-muted">
          A rede visual (grafo navegável) entra na próxima fase. Por enquanto, os
          vínculos em lista, separados por tipo.
        </p>
        <RelGroup items={trabalho} tone="gold" />
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

  const isGold = tone === "gold";

  return (
    <div className="mt-5">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
        {isGold ? "Trabalho" : "Contato"}
      </p>
      <div className="mt-2 grid gap-2">
        {items.map((rel) => (
          <div
            key={`${rel.label}-${rel.relation}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-line bg-subtle px-3 py-2.5"
          >
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
        ))}
      </div>
    </div>
  );
}
