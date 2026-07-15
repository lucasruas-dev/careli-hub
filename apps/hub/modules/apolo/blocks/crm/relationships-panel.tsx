import {
  ArrowDownUp,
  Briefcase,
  Building2,
  ChevronRight,
  Contact,
  Mail,
  Phone,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";

import type { ApoloEntity, ApoloRelationship } from "@/lib/apolo/types";

import { normalizeText } from "../../data/apolo-derive";
import { PanelTitle } from "../shared/apolo-ui";
import { AddRelationshipModal } from "./add-relationship-modal";

// Classificação dos relacionamentos em categorias (cada uma vira um card de resumo).
function isContato(rel: ApoloRelationship): boolean {
  if (rel.kind === "contato") {
    return true;
  }
  if (rel.kind === "trabalho") {
    return false;
  }
  return /familiar|c[ôo]njuge|indica|s[óo]ci|represent|assina/i.test(rel.relation);
}
function isVinculado(rel: ApoloRelationship): boolean {
  return rel.relation === "Comprador vinculado" || rel.relation === "Prospect vinculado";
}
function isEmpreendimento(rel: ApoloRelationship): boolean {
  return /empreendimento/i.test(rel.relation);
}

// Mesma pessoa em papéis diferentes vira UMA linha, juntando os papéis.
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

type GroupKey = "empreendimentos" | "vinculados" | "trabalho" | "contatos";
type Group = {
  icon: LucideIcon;
  items: ApoloRelationship[];
  key: GroupKey;
  label: string;
  sub: string | null;
  tone: "clay" | "gold";
};

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
  const [openGroup, setOpenGroup] = useState<GroupKey | null>(null);

  const groups = useMemo<Group[]>(() => {
    const rels = entity.relationships;
    const empreendimentos = mergeByLabel(rels.filter(isEmpreendimento));
    const vinculados = rels.filter(isVinculado);
    const contatos = mergeByLabel(rels.filter(isContato));
    const trabalho = mergeByLabel(
      rels.filter(
        (rel) => !isContato(rel) && !isVinculado(rel) && !isEmpreendimento(rel),
      ),
    );
    const compradores = vinculados.filter(
      (rel) => rel.relation === "Comprador vinculado",
    ).length;
    const prospects = vinculados.length - compradores;

    return [
      {
        icon: Building2,
        items: empreendimentos,
        key: "empreendimentos",
        label: "Empreendimentos",
        sub: null,
        tone: "gold",
      },
      {
        icon: Users,
        items: vinculados,
        key: "vinculados",
        label: "Clientes vinculados",
        sub: [
          compradores ? `${compradores} comprador${compradores === 1 ? "" : "es"}` : null,
          prospects ? `${prospects} prospect${prospects === 1 ? "" : "s"}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        tone: "gold",
      },
      {
        icon: Briefcase,
        items: trabalho,
        key: "trabalho",
        label: "Vinculos comerciais",
        sub: null,
        tone: "gold",
      },
      {
        icon: Contact,
        items: contatos,
        key: "contatos",
        label: "Contatos",
        sub: null,
        tone: "clay",
      },
    ].filter((group) => group.items.length > 0) as Group[];
  }, [entity.relationships]);

  const trabalhoGroups = groups.filter((group) => group.tone === "gold");
  const contatoGroups = groups.filter((group) => group.tone === "clay");
  const active = groups.find((group) => group.key === openGroup) ?? null;

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

        {groups.length === 0 ? (
          <p className="m-0 mt-4 text-sm font-medium text-ink-muted">
            Nenhum relacionamento cadastrado ainda.
          </p>
        ) : null}

        {trabalhoGroups.length ? (
          <GroupBand
            groups={trabalhoGroups}
            onOpen={setOpenGroup}
            title="Trabalho"
          />
        ) : null}
        {contatoGroups.length ? (
          <GroupBand groups={contatoGroups} onOpen={setOpenGroup} title="Contato" />
        ) : null}
      </section>

      <AddRelationshipModal
        entityId={entity.id}
        onClose={() => setModalOpen(false)}
        onCreated={onCreated}
        onOpenEntity={onOpenEntity}
        open={modalOpen}
      />

      {active ? (
        <RelationshipListModal
          group={active}
          onClose={() => setOpenGroup(null)}
          onOpenEntity={onOpenEntity}
        />
      ) : null}
    </div>
  );
}

function GroupBand({
  groups,
  onOpen,
  title,
}: {
  groups: Group[];
  onOpen: (key: GroupKey) => void;
  title: string;
}) {
  return (
    <div className="mt-5">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
        {title}
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {groups.map((group) => (
          <SummaryCard group={group} key={group.key} onClick={() => onOpen(group.key)} />
        ))}
      </div>
    </div>
  );
}

function SummaryCard({ group, onClick }: { group: Group; onClick: () => void }) {
  const Icon = group.icon;
  const isGold = group.tone === "gold";

  return (
    <button
      className="flex items-center gap-3 rounded-xl border border-line bg-subtle px-3.5 py-3 text-left transition-colors hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5"
      onClick={onClick}
      type="button"
    >
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-lg ring-1 ${
          isGold
            ? "bg-[#A07C3B]/10 text-[#A07C3B] ring-[#A07C3B]/15"
            : "bg-[#b5623a]/10 text-[#b5623a] ring-[#b5623a]/20"
        }`}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-sm font-semibold text-ink">{group.label}</p>
        <p className="m-0 text-xs text-ink-muted">
          {group.items.length} {group.items.length === 1 ? "vinculo" : "vinculos"}
          {group.sub ? ` · ${group.sub}` : ""}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-ink-muted" />
    </button>
  );
}

function RelationshipListModal({
  group,
  onClose,
  onOpenEntity,
}: {
  group: Group;
  onClose: () => void;
  onOpenEntity: (label: string, entityId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [asc, setAsc] = useState(true);
  const [buyerFilter, setBuyerFilter] = useState<"all" | "comprador" | "prospect">("all");
  const canBuyerFilter = group.key === "vinculados";

  const items = useMemo(() => {
    const term = normalizeText(search);
    return group.items
      .filter((rel) => {
        if (canBuyerFilter && buyerFilter !== "all") {
          const wanted =
            buyerFilter === "comprador" ? "Comprador vinculado" : "Prospect vinculado";
          if (rel.relation !== wanted) {
            return false;
          }
        }
        if (!term) {
          return true;
        }
        return normalizeText(`${rel.label} ${rel.relation} ${rel.email ?? ""}`).includes(term);
      })
      .sort((a, b) =>
        asc
          ? a.label.localeCompare(b.label, "pt-BR")
          : b.label.localeCompare(a.label, "pt-BR"),
      );
  }, [group.items, search, asc, buyerFilter, canBuyerFilter]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface shadow-[0_24px_64px_rgba(15,23,42,0.24)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="m-0 text-base font-semibold text-ink">{group.label}</h3>
            <p className="m-0 text-xs text-ink-muted">
              {group.items.length} no total
              {group.sub ? ` · ${group.sub}` : ""}
            </p>
          </div>
          <button
            aria-label="Fechar"
            className="rounded-lg p-1 text-ink-muted transition-colors hover:bg-subtle"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Toolbar: filtro + ordenação */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          <div className="flex min-w-40 flex-1 items-center gap-2 rounded-lg border border-line bg-subtle px-3 py-1.5 text-ink-muted">
            <Search className="size-3.5 shrink-0" />
            <input
              className="w-full bg-transparent text-xs text-ink outline-none placeholder:text-ink-muted"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filtrar por nome"
              value={search}
            />
          </div>
          {canBuyerFilter ? (
            <div className="flex items-center gap-1 rounded-lg border border-line bg-subtle p-0.5">
              {(["all", "comprador", "prospect"] as const).map((option) => (
                <button
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                    buyerFilter === option
                      ? "bg-[#A07C3B]/12 text-[#7a5e2c] dark:text-[#d9b877]"
                      : "text-ink-muted hover:text-ink"
                  }`}
                  key={option}
                  onClick={() => setBuyerFilter(option)}
                  type="button"
                >
                  {option === "all" ? "Todos" : option === "comprador" ? "Compradores" : "Prospects"}
                </button>
              ))}
            </div>
          ) : null}
          <button
            className="inline-flex items-center gap-1 rounded-lg border border-line bg-subtle px-2.5 py-1.5 text-[11px] font-semibold text-ink-soft transition-colors hover:border-[#A07C3B]/25"
            onClick={() => setAsc((current) => !current)}
            type="button"
          >
            <ArrowDownUp className="size-3.5" />
            {asc ? "A-Z" : "Z-A"}
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {items.length ? (
            items.map((rel) => (
              <RelRow
                key={`${rel.label}-${rel.relation}`}
                onOpenEntity={(label, entityId) => {
                  onOpenEntity(label, entityId);
                  onClose();
                }}
                rel={rel}
                tone={group.tone}
              />
            ))
          ) : (
            <p className="m-0 py-6 text-center text-sm font-medium text-ink-muted">
              Nada encontrado.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Card padrão: Nome · Telefone · E-mail · Nível. Clicável quando é uma entidade Apolo.
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
                {rel.phone}
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
