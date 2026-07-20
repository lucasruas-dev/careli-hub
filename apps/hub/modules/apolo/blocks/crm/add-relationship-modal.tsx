import {
  Briefcase,
  Check,
  ExternalLink,
  Loader2,
  Search,
  UserPlus,
  X,
} from "lucide-react";
import { useState } from "react";

import { apoloProfileLabels } from "@/lib/apolo/catalog";
import type { ApoloProfile } from "@/lib/apolo/types";

import { getApoloAccessToken } from "../../data/apolo-operations";

// Níveis por tipo. Trabalho = papel comercial; Contato = vínculo pessoal.
const TRABALHO_TIPOS = [
  "Comprador",
  "Prospect",
  "Corretor",
  "Imobiliária",
  "Incorporador",
  "Empreendimento",
  "Sócio",
  "Parceiro",
  "Fornecedor",
  "Funcionário",
];
const CONTATO_TIPOS = [
  "Mãe",
  "Pai",
  "Cônjuge",
  "Filho(a)",
  "Irmão(ã)",
  "Tio(a)",
  "Avô(ó)",
  "Amigo(a)",
  "Funcionário(a)",
  "Sócio(a)",
  "Outro",
];
// Lista rica de cargos (aparece quando o nível é Funcionário).
const CARGOS = [
  "Corretor",
  "Captador",
  "Gerente comercial",
  "Coordenador de vendas",
  "Diretor",
  "Sócio",
  "Vendedor",
  "Assistente administrativo",
  "Auxiliar administrativo",
  "Financeiro",
  "Cobrança",
  "Recepcionista",
  "Secretária",
  "Marketing",
  "TI",
  "RH",
  "Jurídico",
  "Contador",
  "Analista",
  "Estagiário",
];

const NON_ROLE = new Set(["usuario", "pessoa_fisica", "pessoa_juridica", "acesso_incorporador"]);

type SearchEntity = {
  id: string;
  name: string;
  document: string;
  location: string;
  profiles: ApoloProfile[];
};

export function AddRelationshipModal({
  entityId,
  open,
  onClose,
  onCreated,
  onOpenEntity,
}: {
  entityId: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  onOpenEntity: (label: string, entityId: string) => void;
}) {
  const [kind, setKind] = useState<"trabalho" | "contato" | null>(null);
  const [relType, setRelType] = useState("");
  const [cargo, setCargo] = useState("");
  // trabalho
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchEntity[]>([]);
  const [selected, setSelected] = useState<SearchEntity | null>(null);
  const [searching, setSearching] = useState(false);
  // contato
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [cpf, setCpf] = useState("");
  // comum
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return null;
  }

  const isFuncionario = /funcion/i.test(relType);
  // Empreendimento NÃO é entidade do Apolo: vive no C2X. A busca por entidade nunca o acha, então
  // este nível procura na lista de empreendimentos e salva o vínculo por id no metadata.
  const isEmpreendimento = /empreendimento/i.test(relType);

  function reset() {
    setKind(null);
    setRelType("");
    setCargo("");
    setQuery("");
    setResults([]);
    setSelected(null);
    setName("");
    setPhone("");
    setEmail("");
    setCpf("");
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  function runSearch() {
    return runSearchPara(relType);
  }

  // Recebe o nível por PARÂMETRO: quando o usuário clica num chip, o `relType` do estado ainda
  // é o anterior (setState não é síncrono), e a busca sairia pela fonte errada.
  async function runSearchPara(tipo: string) {
    const term = query.trim();
    if (!term) {
      return;
    }
    setSearching(true);
    setError(null);

    // Empreendimento tem fonte própria (C2X), não a busca de entidades.
    if (/empreendimento/i.test(tipo)) {
      try {
        const token = await getApoloAccessToken();
        const response = await fetch("/api/apolo/empreendimentos", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = (await response.json()) as {
          data?: { rows?: Array<{ code: string; id: string; name: string }> };
        };
        const alvo = term.toLowerCase();
        setResults(
          (payload.data?.rows ?? [])
            .filter(
              (row) =>
                row.name?.toLowerCase().includes(alvo) ||
                row.code?.toLowerCase().includes(alvo),
            )
            .slice(0, 8)
            .map((row) => ({
              id: row.id,
              name: row.name || row.code,
              document: row.code ?? "",
              location: "",
              profiles: [],
            })),
        );
      } catch {
        setError("Falha ao buscar empreendimentos. Tente de novo.");
      } finally {
        setSearching(false);
      }
      return;
    }

    try {
      const token = await getApoloAccessToken();
      const response = await fetch(
        `/api/apolo/relationships?q=${encodeURIComponent(term)}`,
        { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
      );
      const payload = (await response.json()) as {
        data?: {
          entities?: Array<{
            id: string;
            displayName: string;
            documentMasked: string;
            locationLabel: string;
            profiles: ApoloProfile[];
          }>;
        };
      };
      const entities = (payload.data?.entities ?? [])
        .filter((entity) => entity.id !== entityId)
        .slice(0, 8)
        .map((entity) => ({
          id: entity.id,
          name: entity.displayName,
          document: entity.documentMasked,
          location: entity.locationLabel,
          profiles: entity.profiles,
        }));
      setResults(entities);
    } catch {
      setError("Falha na busca. Tente de novo.");
    } finally {
      setSearching(false);
    }
  }

  async function save() {
    if (!kind || !relType.trim()) {
      setError("Escolha o nível de relacionamento.");
      return;
    }
    if (kind === "trabalho" && !selected) {
      setError("Busque e selecione a entidade.");
      return;
    }
    if (kind === "contato" && (!name.trim() || !phone.trim() || !email.trim())) {
      setError("Nome, telefone e e-mail são obrigatórios.");
      return;
    }
    if (isFuncionario && !cargo.trim()) {
      setError("Informe o cargo do funcionário.");
      return;
    }
    const label = kind === "trabalho" ? selected?.name : name.trim();
    setSaving(true);
    setError(null);
    try {
      const token = await getApoloAccessToken();
      const response = await fetch("/api/apolo/relationships/create", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          entityId,
          kind,
          relationshipType: relType.trim(),
          label,
          cargo: isFuncionario ? cargo.trim() : undefined,
          // Empreendimento vai por enterpriseId (não tem entidade Apolo); o resto por entidade.
          relatedEntityId:
            kind === "trabalho" && !isEmpreendimento ? selected?.id : undefined,
          enterpriseId: isEmpreendimento ? selected?.id : undefined,
          email: kind === "contato" ? email.trim() : undefined,
          phone: kind === "contato" ? phone.trim() : undefined,
          cpf: kind === "contato" ? cpf.trim() : undefined,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Não foi possível salvar.");
      }
      onCreated();
      close();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  const tipos = kind === "trabalho" ? TRABALHO_TIPOS : CONTATO_TIPOS;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={close}>
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-[0_24px_64px_rgba(15,23,42,0.24)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="m-0 text-base font-semibold text-ink">Adicionar relacionamento</h3>
          <button
            aria-label="Fechar"
            className="rounded-lg p-1 text-ink-muted transition-colors hover:bg-subtle"
            onClick={close}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Passo 1: Trabalho ou Contato */}
        {!kind ? (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              className="flex flex-col items-center gap-2 rounded-xl border border-line bg-subtle p-5 transition-colors hover:border-[#A07C3B]/35 hover:bg-[#A07C3B]/5"
              onClick={() => setKind("trabalho")}
              type="button"
            >
              <Briefcase className="size-6 text-[#A07C3B]" />
              <span className="text-sm font-semibold text-ink">Trabalho</span>
            </button>
            <button
              className="flex flex-col items-center gap-2 rounded-xl border border-line bg-subtle p-5 transition-colors hover:border-[#b5623a]/35 hover:bg-[#b5623a]/5"
              onClick={() => setKind("contato")}
              type="button"
            >
              <UserPlus className="size-6 text-[#b5623a]" />
              <span className="text-sm font-semibold text-ink">Contato</span>
            </button>
          </div>
        ) : null}

        {/* Passo 2 - Trabalho: busca de entidade (com perfis + abrir cadastro) */}
        {kind === "trabalho" ? (
          <div className="mt-5 grid gap-3">
            {selected ? (
              <div className="flex items-center justify-between rounded-lg border border-[#A07C3B]/30 bg-[#A07C3B]/5 px-3 py-2">
                <span className="truncate text-sm font-semibold text-ink">{selected.name}</span>
                <button
                  className="text-xs font-semibold text-ink-muted hover:text-ink"
                  onClick={() => setSelected(null)}
                  type="button"
                >
                  trocar
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 rounded-lg border border-line bg-subtle px-3 py-2">
                  <Search className="size-4 shrink-0 text-ink-muted" />
                  <input
                    className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void runSearch();
                      }
                    }}
                    placeholder="Buscar entidade e apertar Enter"
                    value={query}
                  />
                  {searching ? <Loader2 className="size-4 animate-spin text-ink-muted" /> : null}
                </div>
                {results.length ? (
                  <div className="grid max-h-56 gap-1 overflow-y-auto">
                    {results.map((entity) => (
                      <SearchResultRow
                        entity={entity}
                        key={entity.id}
                        onOpen={() => {
                          onOpenEntity(entity.name, entity.id);
                          close();
                        }}
                        onSelect={() => setSelected(entity)}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {/* Passo 2 - Contato: form */}
        {kind === "contato" ? (
          <div className="mt-5 grid gap-3">
            <Field label="Nome" onChange={setName} required value={name} />
            <Field label="Telefone" onChange={setPhone} required value={phone} />
            <Field label="E-mail" onChange={setEmail} required type="email" value={email} />
            <Field label="CPF (opcional)" onChange={setCpf} value={cpf} />
          </div>
        ) : null}

        {/* Nível de relacionamento (obrigatório) */}
        {kind ? (
          <div className="mt-4">
            <label className="text-xs font-semibold text-ink-muted">
              Nível de relacionamento <span className="text-rose-500">*</span>
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {tipos.map((tipo) => (
                <button
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition-colors ${
                    relType === tipo
                      ? "bg-[#A07C3B]/12 text-[#7a5e2c] dark:text-[#d9b877] ring-[#A07C3B]/25"
                      : "bg-subtle text-ink-soft ring-line hover:bg-[#A07C3B]/5"
                  }`}
                  key={tipo}
                  onClick={() => {
                    setRelType(tipo);
                    // Trocar o nível troca a FONTE da busca (empreendimento vem do C2X, o resto
                    // de apolo_entities). Quem já digitou antes de escolher o nível ficaria com
                    // resultado da fonte errada — ou com nenhum. Refaz a busca e limpa o que
                    // estava selecionado, que pode não pertencer à nova fonte.
                    setSelected(null);
                    setResults([]);
                    if (query.trim()) {
                      void runSearchPara(tipo);
                    }
                  }}
                  type="button"
                >
                  {tipo}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Cargo (quando o nível é Funcionário) */}
        {kind && isFuncionario ? (
          <div className="mt-4">
            <Field label="Cargo" onChange={setCargo} required value={cargo} />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {CARGOS.map((option) => (
                <button
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 transition-colors ${
                    cargo === option
                      ? "bg-[#A07C3B]/12 text-[#7a5e2c] dark:text-[#d9b877] ring-[#A07C3B]/25"
                      : "bg-subtle text-ink-muted ring-line hover:bg-[#A07C3B]/5"
                  }`}
                  key={option}
                  onClick={() => setCargo(option)}
                  type="button"
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="m-0 mt-3 text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p>
        ) : null}

        {kind ? (
          <div className="mt-5 flex items-center justify-between">
            <button
              className="text-sm font-semibold text-ink-muted hover:text-ink"
              onClick={() => {
                setKind(null);
                setRelType("");
                setCargo("");
                setError(null);
              }}
              type="button"
            >
              Voltar
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-[#A07C3B] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#8a6a32] disabled:opacity-60"
              disabled={saving}
              onClick={() => void save()}
              type="button"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Salvar
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SearchResultRow({
  entity,
  onOpen,
  onSelect,
}: {
  entity: SearchEntity;
  onOpen: () => void;
  onSelect: () => void;
}) {
  const papeis = entity.profiles
    .filter((profile) => !NON_ROLE.has(profile))
    .map((profile) => apoloProfileLabels[profile] ?? profile);
  const sub = [entity.document, entity.location].filter((value) => value && value !== "-");

  return (
    <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 transition-colors hover:bg-subtle">
      <button className="min-w-0 flex-1 text-left" onClick={onSelect} type="button">
        <p className="m-0 truncate text-sm font-semibold text-ink">{entity.name}</p>
        <p className="m-0 mt-0.5 truncate text-[11px] text-ink-muted">
          {sub.length ? sub.join(" · ") : "Sem documento"}
          {papeis.length ? ` · ${papeis.join(", ")}` : ""}
        </p>
      </button>
      <button
        aria-label="Abrir cadastro"
        className="shrink-0 rounded-md p-1.5 text-ink-muted transition-colors hover:bg-[#A07C3B]/10 hover:text-[#A07C3B]"
        onClick={onOpen}
        title="Abrir o cadastro desta entidade"
        type="button"
      >
        <ExternalLink className="size-3.5" />
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  required,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  required?: boolean;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-semibold text-ink-muted">
        {label}
        {required ? <span className="text-rose-500"> *</span> : null}
      </span>
      <input
        className="rounded-lg border border-line bg-subtle px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-[#A07C3B]/35"
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}
