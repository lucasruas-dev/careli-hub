import { ChevronRight, Mail, Phone, Plus } from "lucide-react";
import { useState } from "react";

import type { ApoloEntity, ApoloRelationship } from "@/lib/apolo/types";

import { displayText } from "../../data/apolo-derive";
import { PanelTitle } from "../shared/apolo-ui";
import { AddRelationshipModal } from "./add-relationship-modal";

// Aba Relacionamentos (F1: lista). A rede visual (grafo navegável) entra no F3.
// Dois tipos de vínculo: trabalho (imobiliária/responsável comercial, empreendimentos,
// clientes vinculados) e contato (pessoas: cônjuge, representante legal, assinante,
// familiar, sócio, indicação). Padrão de todo card: Nome · Telefone · E-mail · Nível.
function isContato(rel: ApoloRelationship): boolean {
  if (rel.kind === "contato") {
    return true;
  }
  if (rel.kind === "trabalho") {
    return false;
  }
  return /familiar|c[ôo]njuge|indica|s[óo]ci|represent|assina/i.test(rel.relation);
}

// Clientes que a imobiliária cadastrou (vinculed_by_id). Viram um grupo próprio com
// resumo (contagem) + lista, porque uma imob grande tem 100+.
function isVinculado(rel: ApoloRelationship): boolean {
  return rel.relation === "Comprador vinculado" || rel.relation === "Prospect vinculado";
}

// Mesma pessoa em papéis diferentes (ex.: representante legal E assinante) vira UMA
// linha, juntando os papéis. Preserva telefone/e-mail/entidade do primeiro registro.
function mergeByLabel(items: ApoloRelationship[]): ApoloRelationship[] {
  const byLabel = new Map<string, ApoloRelationship>();
  for (const rel of items) {
    const existing = byLabel.get(rel.label);
    if (!existing) {
      byLabel.set(rel.label, { ...rel });
      continue;
    }
    if (!existing.relation.split(" · ").includes(rel.relation)) {
      existing.relation = `${existing.relation} · ${rel.relation}`;
    }
    existing.phone = existing.phone ?? rel.phone;
    existing.email = existing.email ?? rel.email;
    existing.entityId = existing.entityId ?? rel.entityId;
  }
  return [...byLabel.values()];
}

export function RelationshipsPanel({
  entity,
  onCreated,
  onOpenEntity,
}: {
  entity: ApoloEntity;
  onCreated: () => void;
  onOpenEntity: (label: string, entityId: string) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const contato = mergeByLabel(entity.relationships.filter(isContato));
  const vinculados = entity.relationships.filter(isVinculado);
  const trabalho = mergeByLabel(
    entity.relationships.filter((rel) => !isContato(rel) && !isVinculado(rel)),
  );

  return (
    <div className="grid gap-5">
      <section className="rounded-xl border border-line bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <PanelTitle eyebrow="Rede" title="Relacionamentos" />
          <button
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#A07C3B]/30 bg-[#A07C3B]/8 px-3 py-1.5 text-xs font-semibold text-[#7a5e2c] dark:text-[#d9b877] transition-colors hover:bg-[#A07C3B]/15"
            onClick={() => setModalOpen(true)}
            type="button"
          >
            <Plus className="size-3.5" />
            Adicionar
          </button>
        </div>
        <p className="m-0 mt-2 text-sm font-medium text-ink-muted">
          A rede visual (grafo navegável) entra na próxima fase. Por enquanto, os
          vínculos em lista, separados por tipo.
        </p>
        <RelGroup items={trabalho} onOpenEntity={onOpenEntity} tone="gold" />
        <VinculadosGroup items={vinculados} onOpenEntity={onOpenEntity} />
        <RelGroup items={contato} onOpenEntity={onOpenEntity} tone="clay" />
        {entity.relationships.length === 0 ? (
          <p className="m-0 mt-4 text-sm font-medium text-ink-muted">
            Nenhum relacionamento cadastrado ainda.
          </p>
        ) : null}
      </section>
      <AddRelationshipModal
        entityId={entity.id}
        onClose={() => setModalOpen(false)}
        onCreated={onCreated}
        onOpenEntity={onOpenEntity}
        open={modalOpen}
      />
    </div>
  );
}

function VinculadosGroup({
  items,
  onOpenEntity,
}: {
  items: ApoloRelationship[];
  onOpenEntity: (label: string, entityId: string) => void;
}) {
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
          <RelRow
            key={`${rel.label}-${rel.relation}`}
            onOpenEntity={onOpenEntity}
            rel={rel}
            tone="gold"
          />
        ))}
      </div>
    </div>
  );
}

function RelGroup({
  items,
  onOpenEntity,
  tone,
}: {
  items: ApoloRelationship[];
  onOpenEntity: (label: string, entityId: string) => void;
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
          <RelRow
            key={`${rel.label}-${rel.relation}`}
            onOpenEntity={onOpenEntity}
            rel={rel}
            tone={tone}
          />
        ))}
      </div>
    </div>
  );
}

// Card padrão: Nome (label) · Telefone · E-mail · Nível (relation). Clicável quando o
// relacionamento é uma entidade Apolo (entityId) — abre o cadastro dela.
function RelRow({
  onOpenEntity,
  rel,
  tone,
}: {
  onOpenEntity: (label: string, entityId: string) => void;
  rel: ApoloRelationship;
  tone: "clay" | "gold";
}) {
  const isGold = tone === "gold";
  const clickable = Boolean(rel.entityId);
  const badgeClass = isGold
    ? "bg-[#A07C3B]/8 text-[#7a5e2c] dark:text-[#d9b877] ring-[#A07C3B]/15"
    : "bg-[#b5623a]/10 text-[#8a4526] dark:text-[#e0a586] ring-[#b5623a]/20";

  const content = (
    <>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="m-0 truncate text-sm font-semibold text-ink">{rel.label}</p>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${badgeClass}`}
          >
            {rel.relation}
          </span>
        </div>
        {rel.phone || rel.email ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-muted">
            {rel.phone ? (
              <span className="inline-flex items-center gap-1">
                <Phone aria-hidden="true" className="size-3" />
                {displayText(rel.phone)}
              </span>
            ) : null}
            {rel.email ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <Mail aria-hidden="true" className="size-3 shrink-0" />
                <span className="truncate">{rel.email}</span>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {clickable ? (
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
      ) : null}
    </>
  );

  if (clickable && rel.entityId) {
    return (
      <button
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-subtle px-3 py-2.5 text-left transition-colors hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5"
        onClick={() => onOpenEntity(rel.label, rel.entityId as string)}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-subtle px-3 py-2.5">
      {content}
    </div>
  );
}
