"use client";

import { Loader2, Trash2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  criarOperadorRemoto,
  fetchFila,
  fetchOperadores,
  removerOperadorRemoto,
} from "../../data/prometeu-operations";
import {
  PROMETEU_PAPEIS,
  PROMETEU_ZONAS,
  type PrometeuMesa,
  type PrometeuOperadorResumo,
  type PrometeuPapel,
  type PrometeuZona,
} from "@/lib/prometeu/types";

// Conteúdo da seção "Equipe do lançamento" no Setup: o Lucas cria as CONTAS DE OPERADOR do evento.
// Cada operador loga com nome.sobrenome + senha (login próprio, não é usuário do hub) e só vê o
// Prometeu. Só o CONTEÚDO — o Card (título/moldura) fica no setup-view, pra reusar o visual de lá.
//
// Regra do mockup, aplicada aqui: ATENDENTE só na Secretaria (leva mesa); organizador toca
// recepção/salão; gestor acompanha a operação sem posto fixo.

const PERFIL_LABEL: Record<PrometeuPapel, string> = {
  atendente: "Atendente",
  gestor: "Gestor",
  organizador: "Organizador",
};

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const a = partes[0]?.[0] ?? "";
  const b = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? "") : "";
  return `${a}${b}`.toUpperCase();
}

// Sugere nome.sobrenome a partir do nome completo (sem acento, minúsculas). Só uma sugestão: o
// campo continua editável.
function sugerirUsername(nome: string): string {
  const limpo = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();
  const partes = limpo.split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "";
  if (partes.length === 1) return partes[0] ?? "";
  return `${partes[0]}.${partes[partes.length - 1]}`;
}

export function EquipeConteudo({
  eventoId,
  onErro,
}: {
  eventoId: string;
  onErro: (erro: string) => void;
}) {
  const [operadores, setOperadores] = useState<PrometeuOperadorResumo[]>([]);
  const [mesas, setMesas] = useState<PrometeuMesa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // Formulário de novo operador.
  const [nome, setNome] = useState("");
  const [username, setUsername] = useState("");
  // Enquanto o Lucas não edita o usuário à mão, ele acompanha o nome digitado.
  const [usernameTocado, setUsernameTocado] = useState(false);
  const [senha, setSenha] = useState("");
  const [perfil, setPerfil] = useState<PrometeuPapel>("organizador");
  const [zona, setZona] = useState<PrometeuZona>("recepcao");
  const [mesaId, setMesaId] = useState("");

  const carregar = useCallback(async () => {
    if (!eventoId) return;
    setCarregando(true);
    const [resOperadores, fila] = await Promise.all([
      fetchOperadores(eventoId),
      fetchFila(eventoId),
    ]);
    if (resOperadores.error) onErro(resOperadores.error);
    setOperadores(resOperadores.data ?? []);
    setMesas((fila.data?.mesas ?? []).filter((m) => m.zona === "secretaria"));
    setCarregando(false);
  }, [eventoId, onErro]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Atendente é o único perfil que leva mesa, e só existe na secretaria.
  const ehAtendente = perfil === "atendente";
  // Gestor não tem posto: acompanha a operação inteira.
  const ehGestor = perfil === "gestor";
  // Com perfil atendente a zona é travada em secretaria.
  const zonaEfetiva: PrometeuZona = ehAtendente ? "secretaria" : zona;

  // Mesas já ocupadas por OUTRO operador ficam de fora do seletor.
  const mesasLivres = useMemo(() => {
    const ocupadas = new Set(operadores.map((o) => o.mesaId).filter(Boolean));
    return mesas.filter((m) => !ocupadas.has(m.id));
  }, [mesas, operadores]);

  const trocarNome = (valor: string) => {
    setNome(valor);
    if (!usernameTocado) setUsername(sugerirUsername(valor));
  };

  const criar = async () => {
    if (!nome.trim()) {
      onErro("Informe o nome completo.");
      return;
    }
    if (!username.trim()) {
      onErro("Informe o usuário (nome.sobrenome).");
      return;
    }
    if (!senha.trim()) {
      onErro("Defina uma senha para o operador.");
      return;
    }
    if (ehAtendente && !mesaId) {
      onErro("Atendente da secretaria precisa de uma mesa.");
      return;
    }

    setSalvando(true);
    const { error } = await criarOperadorRemoto({
      eventoId,
      mesaId: ehAtendente ? mesaId : null,
      nome: nome.trim(),
      perfil,
      senha,
      username: username.trim(),
      zona: zonaEfetiva,
    });
    setSalvando(false);
    if (error) {
      onErro(error);
      return;
    }

    setNome("");
    setUsername("");
    setUsernameTocado(false);
    setSenha("");
    setPerfil("organizador");
    setZona("recepcao");
    setMesaId("");
    await carregar();
  };

  const remover = async (id: string) => {
    const { error } = await removerOperadorRemoto(id);
    if (error) {
      onErro(error);
      return;
    }
    await carregar();
  };

  // As colunas são POSTOS: só quem opera um posto entra nelas. O gestor é gravado com uma zona
  // (a coluna do banco é obrigatória), mas ele não trabalha ali — então fica fora e ganha a
  // faixa própria abaixo. Sem isso ele apareceria como se fosse mais um operador da Recepção.
  const porZona = useCallback(
    (z: PrometeuZona) =>
      operadores.filter((o) => o.zona === z && o.perfil !== "gestor"),
    [operadores],
  );
  const gestores = useMemo(
    () => operadores.filter((o) => o.perfil === "gestor"),
    [operadores],
  );

  if (carregando) {
    return (
      <p className="m-0 flex items-center gap-2 text-xs text-ink-muted">
        <Loader2 className="size-3.5 animate-spin" /> Carregando os operadores...
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Operadores, agrupados por posto */}
      <div className="grid gap-3 sm:grid-cols-3">
        {PROMETEU_ZONAS.map((z) => {
          const doPosto = porZona(z.id);
          return (
            <div
              key={z.id}
              className="rounded-lg border border-black/[0.07] p-3 dark:border-white/[0.08]"
            >
              <p className="m-0 mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">
                {z.label}
                <span className="ml-1 text-ink-muted">({doPosto.length})</span>
              </p>
              {doPosto.length === 0 ? (
                <p className="m-0 text-xs text-ink-muted">Ninguém aqui ainda.</p>
              ) : (
                <ul className="m-0 list-none space-y-1.5 p-0">
                  {doPosto.map((o) => (
                    <li
                      key={o.id}
                      className="flex items-center gap-2 rounded-md bg-black/[0.03] px-2 py-1.5 dark:bg-white/[0.04]"
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#101820] text-[10px] font-bold text-[#cba25a]">
                        {iniciais(o.nome)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-ink">
                          {o.nome}
                        </span>
                        <span className="block truncate text-[10px] text-ink-muted">
                          @{o.username} ·{" "}
                          {o.perfil === "atendente"
                            ? `Atendente · Mesa ${o.mesaNumero ?? "?"}`
                            : PERFIL_LABEL[o.perfil]}
                        </span>
                      </span>
                      <button
                        aria-label={`Remover ${o.nome}`}
                        className="shrink-0 rounded-md p-1 text-ink-muted hover:bg-red-500/10 hover:text-red-600"
                        onClick={() => void remover(o.id)}
                        type="button"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* GESTORES: sem posto fixo, acompanham a operação inteira. Faixa própria pra não se
          misturarem com quem está de fato num posto. */}
      {gestores.length > 0 ? (
        <div className="rounded-lg border border-black/[0.07] p-3 dark:border-white/[0.08]">
          <p className="m-0 mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">
            Gestão <span className="ml-1 text-ink-muted">({gestores.length})</span>
            <span className="ml-2 font-normal normal-case tracking-normal text-ink-muted">
              acompanham toda a operação
            </span>
          </p>
          <ul className="m-0 grid list-none gap-1.5 p-0 sm:grid-cols-3">
            {gestores.map((o) => (
              <li
                key={o.id}
                className="flex items-center gap-2 rounded-md bg-black/[0.03] px-2 py-1.5 dark:bg-white/[0.04]"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#101820] text-[10px] font-bold text-[#cba25a]">
                  {iniciais(o.nome)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-ink">
                    {o.nome}
                  </span>
                  <span className="block truncate text-[10px] text-ink-muted">
                    @{o.username} · Gestor
                  </span>
                </span>
                <button
                  aria-label={`Remover ${o.nome}`}
                  className="shrink-0 rounded-md p-1 text-ink-muted hover:bg-red-500/10 hover:text-red-600"
                  onClick={() => void remover(o.id)}
                  type="button"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Novo operador */}
      <div className="rounded-lg border border-black/[0.07] bg-subtle/50 p-3 dark:border-white/[0.08]">
        <p className="m-0 mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">
          Adicionar operador
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid gap-1">
            <span className="text-[11px] text-ink-muted">Nome completo</span>
            <input
              className={inputClasse}
              onChange={(e) => trocarNome(e.target.value)}
              placeholder="Maria Souza"
              value={nome}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] text-ink-muted">Usuário</span>
            <input
              className={inputClasse}
              onChange={(e) => {
                setUsername(e.target.value);
                setUsernameTocado(true);
              }}
              placeholder="maria.souza"
              value={username}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] text-ink-muted">Senha</span>
            <input
              autoComplete="new-password"
              className={inputClasse}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="senha do operador"
              value={senha}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] text-ink-muted">Perfil</span>
            <select
              className={inputClasse}
              onChange={(e) => {
                const novo = e.target.value as PrometeuPapel;
                setPerfil(novo);
                if (novo === "atendente") setZona("secretaria");
              }}
              value={perfil}
            >
              {PROMETEU_PAPEIS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          {/* GESTOR NÃO TEM POSTO: ele acompanha a operação inteira. Mostrar o seletor aqui fazia
              o gestor ser gravado na Recepção (o valor default) e aparecer como operador daquele
              posto na lista e na Central — poluindo justo a visão de "quem está onde" no dia. */}
          <label className="grid gap-1">
            <span className="text-[11px] text-ink-muted">Posto</span>
            {ehGestor ? (
              <div
                className={`${inputClasse} flex items-center text-ink-muted`}
                title="O gestor acompanha a operação inteira, sem posto fixo"
              >
                Toda a operação
              </div>
            ) : (
              <select
                className={`${inputClasse} disabled:opacity-50`}
                disabled={ehAtendente}
                onChange={(e) => setZona(e.target.value as PrometeuZona)}
                title={ehAtendente ? "Atendente só existe na Secretaria" : undefined}
                value={zonaEfetiva}
              >
                {PROMETEU_ZONAS.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.label}
                  </option>
                ))}
              </select>
            )}
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] text-ink-muted">
              Mesa {ehAtendente ? "" : "(só atendente)"}
            </span>
            <select
              className={`${inputClasse} disabled:opacity-50`}
              disabled={!ehAtendente}
              onChange={(e) => setMesaId(e.target.value)}
              value={mesaId}
            >
              <option value="">
                {mesas.length === 0 ? "Sem mesas (salve o Setup)" : "Escolha..."}
              </option>
              {mesasLivres.map((m) => (
                <option key={m.id} value={m.id}>
                  Mesa {m.numero}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#101820] px-3 text-sm font-semibold text-[#e8d5a8] hover:bg-[#1b2732] disabled:opacity-50"
          disabled={salvando || !nome.trim() || !username.trim() || !senha.trim()}
          onClick={() => void criar()}
          type="button"
        >
          {salvando ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <UserPlus className="size-4" />
          )}
          Adicionar operador
        </button>
      </div>
    </div>
  );
}

const inputClasse =
  "h-9 rounded-lg border border-black/10 bg-surface px-2 text-sm text-ink dark:border-white/10";
