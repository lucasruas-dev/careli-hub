"use client";

import { Building2, KeyRound, Loader2, Plus, RefreshCw, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

// GESTÃO DOS ACESSOS DE INCORPORADOR (ferramenta interna).
//
// "eu preciso ter um local que eu crio o login e senha desses usuarios e vincula-los ao perfil
// correto" (Lucas, 12/08/2026). Até aqui isso era INSERT manual no Supabase, e com Recanto do
// Pará, Vista Alegre e Lavra do Ouro entrando, uma linha errada em empreendimentos é um cliente
// vendo a carteira do outro.
//
// A tela tem duas coisas e nada mais: o incorporador (nome, endereço de acesso, o que ele
// enxerga) e as contas que entram por ele. Marca só no login — o portal é Panteon para todos.

type EmpreendimentoDisponivel = { code: string; enterpriseId: string; nome: string };
type Usuario = {
  ativo: boolean;
  email: string;
  id: string;
  nome: string;
  ultimoLoginEm: null | string;
};
type Incorporador = {
  ativo: boolean;
  empreendimentos: { carteiraAdministrada: boolean; enterpriseId: string }[];
  id: string;
  logoEscuraPath: null | string;
  logoPath: null | string;
  nome: string;
  slug: string;
  usuarios: Usuario[];
};

/** O mesmo `normalizarSlug` do servidor, para a tela mostrar o endereço antes de gravar. */
function slugDe(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const dataCurta = (iso: null | string): string => {
  if (!iso) return "nunca entrou";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "nunca entrou"
    : `último acesso ${d.toLocaleDateString("pt-BR")}`;
};

const INPUT =
  "h-9 w-full rounded-lg border border-black/10 bg-canvas px-3 text-sm text-ink dark:border-white/10";
const BOTAO =
  "inline-flex items-center gap-2 rounded-lg border border-black/10 px-3 py-1.5 text-sm font-semibold text-ink hover:bg-black/[0.03] disabled:opacity-40 dark:border-white/10";

export function GestaoIncorporadores() {
  const [lista, setLista] = useState<Incorporador[]>([]);
  const [empreendimentos, setEmpreendimentos] = useState<EmpreendimentoDisponivel[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);
  const [salvando, setSalvando] = useState(false);

  // Qual formulário está aberto. `null` = nenhum; "novo" = incorporador novo; id = editando.
  const [editando, setEditando] = useState<null | string>(null);
  const [form, setForm] = useState({ empreendimentos: [] as string[], nome: "", slug: "" });
  // Formulário de conta: guarda o incorporador dono e, quando é edição, o id do usuário.
  const [conta, setConta] = useState<
    null | { email: string; incorporadorId: string; nome: string; senha: string; usuarioId: null | string }
  >(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/apolo/incorporadores", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const c = (await r.json()) as {
        data?: { empreendimentos: EmpreendimentoDisponivel[]; incorporadores: Incorporador[] };
        error?: string;
      };
      if (!r.ok) setErro(c.error ?? `Falha (${r.status}).`);
      else {
        setLista(c.data?.incorporadores ?? []);
        setEmpreendimentos(c.data?.empreendimentos ?? []);
      }
    } catch (e) {
      setErro((e as Error).message);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const nomeDoEmpreendimento = useMemo(() => {
    const mapa = new Map(empreendimentos.map((e) => [e.enterpriseId, `${e.code} · ${e.nome}`]));
    return (id: string) => mapa.get(id) ?? `Empreendimento ${id}`;
  }, [empreendimentos]);

  function abrirNovo() {
    setConta(null);
    setEditando("novo");
    setForm({ empreendimentos: [], nome: "", slug: "" });
  }

  function abrirEdicao(inc: Incorporador) {
    setConta(null);
    setEditando(inc.id);
    setForm({
      empreendimentos: inc.empreendimentos.map((e) => e.enterpriseId),
      nome: inc.nome,
      slug: inc.slug,
    });
  }

  async function salvarIncorporador() {
    setSalvando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const anterior = lista.find((i) => i.id === editando);
      const r = await fetch("/api/apolo/incorporadores", {
        body: JSON.stringify({
          empreendimentos: form.empreendimentos.map((enterpriseId) => ({
            // "Carteira (quando tiver)": preserva o que já estava marcado; a aba de recebimento
            // depende disso e não dá para derivar do C2X.
            carteiraAdministrada: Boolean(
              anterior?.empreendimentos.find((e) => e.enterpriseId === enterpriseId)
                ?.carteiraAdministrada,
            ),
            enterpriseId,
          })),
          id: editando === "novo" ? null : editando,
          nome: form.nome,
          slug: form.slug || form.nome,
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const c = (await r.json()) as { error?: string };
      if (!r.ok) setErro(c.error ?? `Falha (${r.status}).`);
      else {
        setEditando(null);
        await carregar();
      }
    } catch (e) {
      setErro((e as Error).message);
    }
    setSalvando(false);
  }

  async function salvarConta() {
    if (!conta) return;
    setSalvando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/apolo/incorporadores/usuarios", {
        body: JSON.stringify({
          email: conta.email,
          id: conta.usuarioId,
          incorporadorId: conta.incorporadorId,
          nome: conta.nome,
          // Vazio na edição = mantém a senha atual. O servidor trata; a tela avisa no rótulo.
          senha: conta.senha || null,
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const c = (await r.json()) as { error?: string };
      if (!r.ok) setErro(c.error ?? `Falha (${r.status}).`);
      else {
        setConta(null);
        await carregar();
      }
    } catch (e) {
      setErro((e as Error).message);
    }
    setSalvando(false);
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-canvas">
      <header className="flex flex-wrap items-center gap-3 border-b border-black/[0.07] px-5 py-3 dark:border-white/[0.08]">
        <div>
          <h1 className="m-0 text-base font-bold text-ink">Acessos de incorporador</h1>
          <p className="m-0 text-xs text-ink-soft">
            Cada incorporador enxerga só os empreendimentos marcados aqui. Quem entra pelo portal
            usa as contas desta tela.
          </p>
        </div>
        <button className={`${BOTAO} ml-auto`} onClick={abrirNovo} type="button">
          <Plus size={15} />
          Novo incorporador
        </button>
        <button className={BOTAO} disabled={carregando} onClick={() => void carregar()} type="button">
          {carregando ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
          Atualizar
        </button>
      </header>

      <div className="p-5">
        {erro ? (
          <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {erro}
          </p>
        ) : null}

        {editando ? (
          <section className="mb-5 rounded-xl border border-[#A07C3B]/30 bg-[#A07C3B]/[0.05] p-4">
            <p className="m-0 text-sm font-bold text-ink">
              {editando === "novo" ? "Novo incorporador" : "Editar incorporador"}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-ink-soft">
                Nome
                <input
                  className={`${INPUT} mt-1`}
                  onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                  placeholder="Cecílio Rocha"
                  value={form.nome}
                />
              </label>
              <label className="text-xs font-semibold text-ink-soft">
                Endereço de acesso
                <input
                  className={`${INPUT} mt-1`}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                  placeholder="cecilio-rocha"
                  value={form.slug}
                />
                <span className="mt-1 block font-normal text-ink-soft">
                  c2x.app.br/incorporador/{slugDe(form.slug || form.nome) || "…"}
                </span>
              </label>
            </div>

            <p className="mb-1 mt-4 text-xs font-semibold text-ink-soft">
              O que este incorporador enxerga
            </p>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {empreendimentos.length === 0 ? (
                <p className="m-0 text-xs text-ink-soft">
                  A lista do C2X não carregou. Dá para salvar o cadastro e marcar os
                  empreendimentos depois.
                </p>
              ) : (
                empreendimentos.map((e) => (
                  <label
                    className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-ink hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                    key={e.enterpriseId}
                  >
                    <input
                      checked={form.empreendimentos.includes(e.enterpriseId)}
                      onChange={(ev) =>
                        setForm((f) => ({
                          ...f,
                          empreendimentos: ev.target.checked
                            ? [...f.empreendimentos, e.enterpriseId]
                            : f.empreendimentos.filter((id) => id !== e.enterpriseId),
                        }))
                      }
                      type="checkbox"
                    />
                    <span className="font-semibold">{e.code}</span>
                    <span className="truncate text-ink-soft">{e.nome}</span>
                  </label>
                ))
              )}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                className="inline-flex items-center gap-2 rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-canvas disabled:opacity-40"
                disabled={salvando || !form.nome.trim()}
                onClick={() => void salvarIncorporador()}
                type="button"
              >
                {salvando ? <Loader2 className="animate-spin" size={15} /> : null}
                Salvar
              </button>
              <button className={BOTAO} onClick={() => setEditando(null)} type="button">
                <X size={15} />
                Cancelar
              </button>
            </div>
          </section>
        ) : null}

        {carregando && lista.length === 0 ? (
          <p className="text-sm text-ink-soft">Carregando…</p>
        ) : null}

        <div className="grid gap-3">
          {lista.map((inc) => (
            <article
              className="rounded-xl border border-black/[0.07] p-4 dark:border-white/[0.08]"
              key={inc.id}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Building2 className="text-ink-soft" size={16} />
                <span className="text-sm font-bold text-ink">{inc.nome}</span>
                <span className="text-xs text-ink-soft">/incorporador/{inc.slug}</span>
                {inc.ativo ? null : (
                  <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[11px] font-semibold text-ink-soft dark:bg-white/[0.08]">
                    inativo
                  </span>
                )}
                <button
                  className={`${BOTAO} ml-auto`}
                  onClick={() => abrirEdicao(inc)}
                  type="button"
                >
                  Editar
                </button>
                <button
                  className={BOTAO}
                  onClick={() =>
                    setConta({
                      email: "",
                      incorporadorId: inc.id,
                      nome: "",
                      senha: "",
                      usuarioId: null,
                    })
                  }
                  type="button"
                >
                  <UserPlus size={15} />
                  Nova conta
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                {inc.empreendimentos.length === 0 ? (
                  <span className="text-xs text-red-600 dark:text-red-400">
                    Sem empreendimento: quem entrar por aqui não vê nada.
                  </span>
                ) : (
                  inc.empreendimentos.map((e) => (
                    <span
                      className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] text-ink-soft dark:bg-white/[0.07]"
                      key={e.enterpriseId}
                    >
                      {nomeDoEmpreendimento(e.enterpriseId)}
                      {e.carteiraAdministrada ? " · carteira" : ""}
                    </span>
                  ))
                )}
              </div>

              <div className="mt-3 grid gap-1">
                {inc.usuarios.length === 0 ? (
                  <p className="m-0 text-xs text-ink-soft">Nenhuma conta criada ainda.</p>
                ) : (
                  inc.usuarios.map((u) => (
                    <div
                      className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                      key={u.id}
                    >
                      <span className="font-semibold text-ink">{u.nome}</span>
                      <span className="text-ink-soft">{u.email}</span>
                      <span className="text-xs text-ink-soft">{dataCurta(u.ultimoLoginEm)}</span>
                      {u.ativo ? null : (
                        <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[11px] font-semibold text-ink-soft dark:bg-white/[0.08]">
                          inativo
                        </span>
                      )}
                      <button
                        className={`${BOTAO} ml-auto`}
                        onClick={() =>
                          setConta({
                            email: u.email,
                            incorporadorId: inc.id,
                            nome: u.nome,
                            senha: "",
                            usuarioId: u.id,
                          })
                        }
                        type="button"
                      >
                        <KeyRound size={14} />
                        Editar
                      </button>
                    </div>
                  ))
                )}
              </div>

              {conta?.incorporadorId === inc.id ? (
                <div className="mt-3 rounded-lg border border-black/10 p-3 dark:border-white/10">
                  <p className="m-0 text-xs font-bold text-ink">
                    {conta.usuarioId ? "Editar conta" : "Nova conta"}
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <input
                      className={INPUT}
                      onChange={(e) => setConta({ ...conta, nome: e.target.value })}
                      placeholder="Nome da pessoa"
                      value={conta.nome}
                    />
                    <input
                      className={INPUT}
                      onChange={(e) => setConta({ ...conta, email: e.target.value })}
                      placeholder="email@empresa.com.br"
                      value={conta.email}
                    />
                    <input
                      className={INPUT}
                      onChange={(e) => setConta({ ...conta, senha: e.target.value })}
                      placeholder={
                        conta.usuarioId ? "Nova senha (vazio mantém)" : "Senha do primeiro acesso"
                      }
                      type="text"
                      value={conta.senha}
                    />
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      className="inline-flex items-center gap-2 rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-canvas disabled:opacity-40"
                      disabled={salvando}
                      onClick={() => void salvarConta()}
                      type="button"
                    >
                      {salvando ? <Loader2 className="animate-spin" size={15} /> : null}
                      Salvar conta
                    </button>
                    <button className={BOTAO} onClick={() => setConta(null)} type="button">
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
