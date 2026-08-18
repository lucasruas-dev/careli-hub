"use client";

import { Badge, Tooltip } from "@repo/uix";
import {
  Building2,
  ExternalLink,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

// GESTÃO DOS ACESSOS DE INCORPORADOR — hoje uma ABA DO SETUP (pedido do Lucas, 18/08/2026:
// "essa tela poderia estar dentro do setup ... podia também colocar uma parte que eu adiciono
// os usuários"). Nasceu em /apolo/incorporadores, que agora só redireciona para cá.
//
// "eu preciso ter um local que eu crio o login e senha desses usuarios e vincula-los ao perfil
// correto" (Lucas, 12/08/2026). Antes disso era INSERT manual no Supabase, e com Recanto do
// Pará, Vista Alegre e Lavra do Ouro entrando, uma linha errada em empreendimentos é um cliente
// vendo a carteira do outro.
//
// A tela tem duas coisas e nada mais: o incorporador (nome, endereço de acesso, o que ele
// enxerga) e as contas que entram por ele. Marca só no login — o portal é Panteon para todos.
//
// ⚠️ Senha: entra pelo formulário, vira scrypt no servidor e NUNCA volta em resposta nem em log.
// E-mail: único POR PORTAL (migration 0094) — o mesmo e-mail pode ter conta em incorporadores
// diferentes, então esta tela não bloqueia repetição entre portais.

type EmpreendimentoDisponivel = { code: string; enterpriseId: string; nome: string };
type Usuario = {
  ativo: boolean;
  criadoEm: null | string;
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

const dataCurta = (iso: null | string): null | string => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR");
};

// Classes no padrão do Setup (grafite com preto; dourado só no anel de foco, nunca como estado).
const INPUT =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-[#A07C3B]";
const BOTAO_ICONE =
  "grid h-8 w-8 place-items-center rounded-md text-ink-muted outline-none transition hover:bg-subtle hover:text-ink focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-40";
const BOTAO_PRIMARIO =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md bg-inverse px-3 text-sm font-semibold text-brand-ink outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-40";
const BOTAO_SECUNDARIO =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink outline-none transition hover:bg-subtle focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-40";

export function GestaoIncorporadores() {
  const [lista, setLista] = useState<Incorporador[]>([]);
  const [empreendimentos, setEmpreendimentos] = useState<EmpreendimentoDisponivel[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);
  const [salvando, setSalvando] = useState(false);

  // Qual formulário está aberto. `null` = nenhum; "novo" = incorporador novo; id = editando.
  const [editando, setEditando] = useState<null | string>(null);
  // Cada empreendimento marcado carrega a própria chave de carteira: antes a tela só PRESERVAVA
  // o valor anterior, então incorporador novo nascia sempre sem carteira e a aba Carteira do
  // portal não aparecia (caso real: Lagoa Bonita/LBF, 18/08).
  const [form, setForm] = useState({
    empreendimentos: [] as { carteiraAdministrada: boolean; enterpriseId: string }[],
    nome: "",
    slug: "",
  });
  // Formulário de conta: guarda o incorporador dono e, quando é edição, o id do usuário.
  // `ativo` viaja junto para a edição não reativar sem querer uma conta desativada.
  const [conta, setConta] = useState<
    null | {
      ativo: boolean;
      email: string;
      incorporadorId: string;
      nome: string;
      senha: string;
      usuarioId: null | string;
    }
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
      empreendimentos: inc.empreendimentos.map((e) => ({
        carteiraAdministrada: e.carteiraAdministrada,
        enterpriseId: e.enterpriseId,
      })),
      nome: inc.nome,
      slug: inc.slug,
    });
  }

  async function salvarIncorporador() {
    setSalvando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/apolo/incorporadores", {
        body: JSON.stringify({
          // "Carteira (quando tiver)": agora a chave é marcada aqui na tela, empreendimento a
          // empreendimento; a aba de recebimento do portal depende disso e não deriva do C2X.
          empreendimentos: form.empreendimentos,
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

  /** Grava a conta do formulário. A senha NÃO entra em log e a resposta nunca a devolve. */
  async function salvarConta() {
    if (!conta) return;
    setSalvando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/apolo/incorporadores/usuarios", {
        body: JSON.stringify({
          ativo: conta.ativo,
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

  /** Liga/desliga o acesso sem abrir formulário. Senha nula = intocada. */
  async function alternarAtivo(inc: Incorporador, u: Usuario) {
    setSalvando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/apolo/incorporadores/usuarios", {
        body: JSON.stringify({
          ativo: !u.ativo,
          email: u.email,
          id: u.id,
          incorporadorId: inc.id,
          nome: u.nome,
          senha: null,
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const c = (await r.json()) as { error?: string };
      if (!r.ok) setErro(c.error ?? `Falha (${r.status}).`);
      else await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
    setSalvando(false);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-base font-semibold text-ink">Portais de incorporador</h2>
          <p className="m-0 mt-1 text-xs text-ink-muted">
            Cada incorporador enxerga só os empreendimentos marcados aqui. Quem entra pelo portal
            usa as contas desta tela.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip content="Novo incorporador">
            <button
              aria-label="Novo incorporador"
              className="grid h-9 w-9 place-items-center rounded-md bg-inverse text-brand-ink outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onClick={abrirNovo}
              type="button"
            >
              <Plus aria-hidden="true" size={15} />
            </button>
          </Tooltip>
          <Tooltip content="Atualizar">
            <button
              aria-label="Atualizar"
              className="grid h-9 w-9 place-items-center rounded-md border border-line bg-surface text-ink outline-none transition hover:bg-subtle focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-40"
              disabled={carregando}
              onClick={() => void carregar()}
              type="button"
            >
              {carregando ? (
                <Loader2 aria-hidden="true" className="animate-spin" size={15} />
              ) : (
                <RefreshCw aria-hidden="true" size={15} />
              )}
            </button>
          </Tooltip>
        </div>
      </div>

      {erro ? (
        <p className="m-0 rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/12 p-3 text-sm font-semibold text-amber-800 dark:text-amber-300">
          {erro}
        </p>
      ) : null}

      {editando ? (
        <section className="rounded-md border border-line bg-subtle p-4">
          <p className="m-0 text-sm font-semibold text-ink">
            {editando === "novo" ? "Novo incorporador" : "Editar incorporador"}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-semibold text-ink-muted">
              Nome
              <input
                className={INPUT}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                placeholder="Cecílio Rocha"
                value={form.nome}
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-ink-muted">
              Endereço de acesso
              <input
                className={INPUT}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder="cecilio-rocha"
                value={form.slug}
              />
              <span className="block font-normal text-ink-muted">
                c2x.app.br/incorporador/{slugDe(form.slug || form.nome) || "…"}
              </span>
            </label>
          </div>

          <p className="mb-1 mt-4 text-xs font-semibold text-ink-muted">
            O que este incorporador enxerga
          </p>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {empreendimentos.length === 0 ? (
              <p className="m-0 text-xs text-ink-muted">
                A lista do C2X não carregou. Dá para salvar o cadastro e marcar os
                empreendimentos depois.
              </p>
            ) : (
              empreendimentos.map((e) => {
                const marcado = form.empreendimentos.find(
                  (m) => m.enterpriseId === e.enterpriseId,
                );

                return (
                  <div
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-ink hover:bg-surface"
                    key={e.enterpriseId}
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input
                        checked={Boolean(marcado)}
                        className="h-4 w-4 rounded border-line accent-[#A07C3B]"
                        onChange={(ev) =>
                          setForm((f) => ({
                            ...f,
                            empreendimentos: ev.target.checked
                              ? [
                                  ...f.empreendimentos,
                                  { carteiraAdministrada: false, enterpriseId: e.enterpriseId },
                                ]
                              : f.empreendimentos.filter(
                                  (m) => m.enterpriseId !== e.enterpriseId,
                                ),
                          }))
                        }
                        type="checkbox"
                      />
                      <span className="font-semibold">{e.code}</span>
                      <span className="truncate text-ink-muted">{e.nome}</span>
                    </label>
                    {marcado ? (
                      <Tooltip content="Carteira administrada pela Careli: liga a aba Carteira no portal deste incorporador">
                        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-semibold text-ink-muted transition hover:text-ink">
                          <input
                            checked={marcado.carteiraAdministrada}
                            className="h-3.5 w-3.5 rounded border-line accent-[#A07C3B]"
                            onChange={(ev) =>
                              setForm((f) => ({
                                ...f,
                                empreendimentos: f.empreendimentos.map((m) =>
                                  m.enterpriseId === e.enterpriseId
                                    ? { ...m, carteiraAdministrada: ev.target.checked }
                                    : m,
                                ),
                              }))
                            }
                            type="checkbox"
                          />
                          carteira
                        </label>
                      </Tooltip>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              className={BOTAO_PRIMARIO}
              disabled={salvando || !form.nome.trim()}
              onClick={() => void salvarIncorporador()}
              type="button"
            >
              {salvando ? <Loader2 aria-hidden="true" className="animate-spin" size={15} /> : null}
              Salvar
            </button>
            <button className={BOTAO_SECUNDARIO} onClick={() => setEditando(null)} type="button">
              <X aria-hidden="true" size={15} />
              Cancelar
            </button>
          </div>
        </section>
      ) : null}

      {carregando && lista.length === 0 ? (
        <p className="m-0 text-sm text-ink-muted">Carregando…</p>
      ) : null}

      <div className="grid gap-3">
        {lista.map((inc) => (
          <article className="rounded-md border border-line bg-surface p-4" key={inc.id}>
            <div className="flex flex-wrap items-center gap-2">
              <Building2 aria-hidden="true" className="text-ink-muted" size={16} />
              <span className="text-sm font-semibold text-ink">{inc.nome}</span>
              {/* Link de verdade: o dono tentou abrir o caminho em texto e caiu num 404 relativo.
                  Href ABSOLUTO e aba nova — a tela do Setup fica aberta. */}
              <a
                className="inline-flex items-center gap-1 text-xs text-ink-muted underline-offset-2 outline-none transition hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                href={`/incorporador/${inc.slug}`}
                rel="noopener noreferrer"
                target="_blank"
                title="Abrir o portal em outra aba"
              >
                /incorporador/{inc.slug}
                <ExternalLink aria-hidden="true" size={12} />
              </a>
              {inc.ativo ? null : <Badge variant="warning">inativo</Badge>}
              <div className="ml-auto flex items-center gap-1">
                <Tooltip content="Editar incorporador">
                  <button
                    aria-label={`Editar ${inc.nome}`}
                    className={BOTAO_ICONE}
                    onClick={() => abrirEdicao(inc)}
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={14} />
                  </button>
                </Tooltip>
                <Tooltip content="Nova conta de acesso">
                  <button
                    aria-label={`Nova conta em ${inc.nome}`}
                    className={BOTAO_ICONE}
                    onClick={() =>
                      setConta({
                        ativo: true,
                        email: "",
                        incorporadorId: inc.id,
                        nome: "",
                        senha: "",
                        usuarioId: null,
                      })
                    }
                    type="button"
                  >
                    <UserPlus aria-hidden="true" size={14} />
                  </button>
                </Tooltip>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {inc.empreendimentos.length === 0 ? (
                <span className="text-xs font-semibold text-red-700 dark:text-red-300">
                  Sem empreendimento: quem entrar por aqui não vê nada.
                </span>
              ) : (
                inc.empreendimentos.map((e) => (
                  <span
                    className="rounded-full bg-subtle px-2 py-0.5 text-[11px] text-ink-muted"
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
                <p className="m-0 text-xs text-ink-muted">Nenhuma conta criada ainda.</p>
              ) : (
                inc.usuarios.map((u) => (
                  <div
                    className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1 text-sm transition hover:bg-subtle"
                    key={u.id}
                  >
                    <span className="font-semibold text-ink">{u.nome}</span>
                    <span className="text-ink-muted">{u.email}</span>
                    <span className="text-xs text-ink-muted">
                      {dataCurta(u.criadoEm) ? `criado em ${dataCurta(u.criadoEm)}` : null}
                      {dataCurta(u.criadoEm) ? " · " : null}
                      {dataCurta(u.ultimoLoginEm)
                        ? `último acesso ${dataCurta(u.ultimoLoginEm)}`
                        : "nunca entrou"}
                    </span>
                    {u.ativo ? null : <Badge variant="warning">inativo</Badge>}
                    <div className="ml-auto flex items-center gap-1">
                      <Tooltip content="Editar conta / trocar senha">
                        <button
                          aria-label={`Editar conta de ${u.nome}`}
                          className={BOTAO_ICONE}
                          onClick={() =>
                            setConta({
                              ativo: u.ativo,
                              email: u.email,
                              incorporadorId: inc.id,
                              nome: u.nome,
                              senha: "",
                              usuarioId: u.id,
                            })
                          }
                          type="button"
                        >
                          <KeyRound aria-hidden="true" size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip content={u.ativo ? "Desativar acesso" : "Reativar acesso"}>
                        <button
                          aria-label={
                            u.ativo
                              ? `Desativar acesso de ${u.nome}`
                              : `Reativar acesso de ${u.nome}`
                          }
                          className={BOTAO_ICONE}
                          disabled={salvando}
                          onClick={() => void alternarAtivo(inc, u)}
                          type="button"
                        >
                          <Power aria-hidden="true" size={14} />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                ))
              )}
            </div>

            {conta?.incorporadorId === inc.id ? (
              <div className="mt-3 rounded-md border border-line bg-subtle p-3">
                <p className="m-0 text-xs font-semibold text-ink">
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
                    type="email"
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
                <p className="m-0 mt-2 text-xs text-ink-muted">
                  O mesmo e-mail pode ter conta em outros portais de incorporador (a URL decide
                  onde ele entra); só não repete dentro deste portal.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    className={BOTAO_PRIMARIO}
                    disabled={salvando}
                    onClick={() => void salvarConta()}
                    type="button"
                  >
                    {salvando ? (
                      <Loader2 aria-hidden="true" className="animate-spin" size={15} />
                    ) : null}
                    Salvar conta
                  </button>
                  <button className={BOTAO_SECUNDARIO} onClick={() => setConta(null)} type="button">
                    Cancelar
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
