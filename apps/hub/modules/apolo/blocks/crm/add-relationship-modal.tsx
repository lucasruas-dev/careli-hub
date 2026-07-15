import { Briefcase, Check, Loader2, Search, UserPlus, X } from "lucide-react";
import { useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

// Níveis de relacionamento por tipo. Trabalho = papel comercial; Contato = vínculo pessoal.
const TRABALHO_TIPOS = [
  "Comprador",
  "Prospect",
  "Corretor",
  "Imobiliaria",
  "Incorporador",
  "Socio",
  "Parceiro",
  "Fornecedor",
];
const CONTATO_TIPOS = [
  "Mae",
  "Pai",
  "Conjuge",
  "Filho(a)",
  "Irmao(a)",
  "Tio(a)",
  "Avo(o)",
  "Amigo(a)",
  "Funcionario(a)",
  "Socio(a)",
  "Outro",
];

type SearchEntity = { id: string; name: string };

export function AddRelationshipModal({
  entityId,
  open,
  onClose,
  onCreated,
}: {
  entityId: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [kind, setKind] = useState<"trabalho" | "contato" | null>(null);
  const [relType, setRelType] = useState("");
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

  function reset() {
    setKind(null);
    setRelType("");
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

  async function runSearch() {
    const term = query.trim();
    if (!term) {
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const token = await getApoloAccessToken();
      const response = await fetch(
        `/api/apolo/relationships?q=${encodeURIComponent(term)}`,
        { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
      );
      const payload = (await response.json()) as {
        data?: { entities?: Array<{ id: string; displayName: string }> };
      };
      const entities = (payload.data?.entities ?? [])
        .filter((entity) => entity.id !== entityId)
        .slice(0, 8)
        .map((entity) => ({ id: entity.id, name: entity.displayName }));
      setResults(entities);
    } catch {
      setError("Falha na busca. Tente de novo.");
    } finally {
      setSearching(false);
    }
  }

  async function save() {
    if (!kind || !relType.trim()) {
      setError("Escolha o nivel de relacionamento.");
      return;
    }
    const label = kind === "trabalho" ? selected?.name : name.trim();
    if (kind === "trabalho" && !selected) {
      setError("Busque e selecione a entidade.");
      return;
    }
    if (kind === "contato" && (!name.trim() || !phone.trim() || !email.trim())) {
      setError("Nome, telefone e e-mail sao obrigatorios.");
      return;
    }
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
          relatedEntityId: kind === "trabalho" ? selected?.id : undefined,
          email: kind === "contato" ? email.trim() : undefined,
          phone: kind === "contato" ? phone.trim() : undefined,
          cpf: kind === "contato" ? cpf.trim() : undefined,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Nao foi possivel salvar.");
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
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={close}
    >
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
              className="flex flex-col items-start gap-2 rounded-xl border border-line bg-subtle p-4 text-left transition-colors hover:border-[#A07C3B]/35 hover:bg-[#A07C3B]/5"
              onClick={() => setKind("trabalho")}
              type="button"
            >
              <Briefcase className="size-5 text-[#A07C3B]" />
              <span className="text-sm font-semibold text-ink">Trabalho</span>
              <span className="text-xs text-ink-muted">Liga a uma entidade do Apolo</span>
            </button>
            <button
              className="flex flex-col items-start gap-2 rounded-xl border border-line bg-subtle p-4 text-left transition-colors hover:border-[#b5623a]/35 hover:bg-[#b5623a]/5"
              onClick={() => setKind("contato")}
              type="button"
            >
              <UserPlus className="size-5 text-[#b5623a]" />
              <span className="text-sm font-semibold text-ink">Contato</span>
              <span className="text-xs text-ink-muted">Pessoa (mae, tio, amigo...)</span>
            </button>
          </div>
        ) : null}

        {/* Passo 2 - Trabalho: busca de entidade */}
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
                  <div className="grid max-h-44 gap-1 overflow-y-auto">
                    {results.map((entity) => (
                      <button
                        className="rounded-lg px-3 py-2 text-left text-sm font-medium text-ink-soft transition-colors hover:bg-subtle"
                        key={entity.id}
                        onClick={() => setSelected(entity)}
                        type="button"
                      >
                        {entity.name}
                      </button>
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

        {/* Nivel de relacionamento */}
        {kind ? (
          <div className="mt-4">
            <label className="text-xs font-semibold text-ink-muted">Nivel de relacionamento</label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {tipos.map((tipo) => (
                <button
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition-colors ${
                    relType === tipo
                      ? "bg-[#A07C3B]/12 text-[#7a5e2c] dark:text-[#d9b877] ring-[#A07C3B]/25"
                      : "bg-subtle text-ink-soft ring-line hover:bg-[#A07C3B]/5"
                  }`}
                  key={tipo}
                  onClick={() => setRelType(tipo)}
                  type="button"
                >
                  {tipo}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {error ? <p className="m-0 mt-3 text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p> : null}

        {kind ? (
          <div className="mt-5 flex items-center justify-between">
            <button
              className="text-sm font-semibold text-ink-muted hover:text-ink"
              onClick={() => {
                setKind(null);
                setRelType("");
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
