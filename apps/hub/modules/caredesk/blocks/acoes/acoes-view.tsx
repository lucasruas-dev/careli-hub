"use client";

import { ImagePlus, Loader2, Phone, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  Acao,
  AcaoAlvo,
  ContatoCanal,
  Perfil,
  UnidadesInteresse,
} from "@/lib/apolo/acoes";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// A aba AÇÕES da Iris: campanhas de contato em massa, longe da fila de atendimento. O operador
// desce a lista dos alvos e, por cliente, marca o CONTATO: Telefônico (falou → preenche perfil +
// unidades) ou WhatsApp (não falou → marca; o disparo do template entra na Fase 2). Ver a decisão
// do Lucas: lista corrida com filtros.

type Resumo = {
  contatados: number;
  perfilInvestimento: number;
  perfilMoradia: number;
  porTelefone: number;
  porWhatsapp: number;
  respostas: number;
  total: number;
};

const LABEL_UNIDADES: Record<UnidadesInteresse, string> = {
  "1": "1 unidade",
  "2_3": "2 a 3",
  acima_3: "acima de 3",
};

// Um helper para os dois modos: no HUB autentica com o Bearer da sessão do hub; na tela PÚBLICA,
// com o token da campanha (header x-acao-sessao). `tokenPublico` presente = modo público.
async function pedir<T>(
  url: string,
  init?: RequestInit,
  tokenPublico?: string | null,
): Promise<T | null> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (tokenPublico) headers["x-acao-sessao"] = tokenPublico;
  else headers.Authorization = `Bearer ${await getApoloAccessToken()}`;
  const resp = await fetch(url, { ...init, headers });
  const json = (await resp.json().catch(() => null)) as { data?: T; error?: string } | null;
  if (!resp.ok || !json?.data) throw new Error(json?.error ?? "Falha na requisição.");
  return json.data;
}

export function AcoesView({ tokenPublico }: { tokenPublico?: string } = {}) {
  const [acao, setAcao] = useState<Acao | null>(null);
  const [alvos, setAlvos] = useState<AcaoAlvo[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todos" | "pendentes" | "pix">("todos");
  const [busca, setBusca] = useState("");
  // Alvo com o formulário do telefônico aberto + o rascunho de perfil/unidades.
  const [aberto, setAberto] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<{
    perfil: Perfil | null;
    unidades: UnidadesInteresse | null;
  }>({ perfil: null, unidades: null });
  const [salvando, setSalvando] = useState<string | null>(null);
  // Criação do template do convite na Meta (o operador escolhe a arte; o resto é hardcoded no servidor).
  const inputImagemRef = useRef<HTMLInputElement>(null);
  const [criandoTemplate, setCriandoTemplate] = useState(false);
  const [msgTemplate, setMsgTemplate] = useState<string | null>(null);

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    try {
      // Público: a ação vem do token (uma só). Hub: pega a primeira da lista.
      let det: { acao: Acao; alvos: AcaoAlvo[]; resumo: Resumo } | null;
      if (tokenPublico) {
        det = await pedir("/api/publico/acao", undefined, tokenPublico);
      } else {
        const lista = await pedir<{ acoes: Acao[] }>("/api/apolo/acoes");
        const primeira = lista?.acoes[0];
        if (!primeira) {
          setErro("Nenhuma ação cadastrada.");
          setCarregando(false);
          return;
        }
        det = await pedir(`/api/apolo/acoes/${primeira.id}`);
      }
      if (det) {
        setAcao(det.acao);
        setAlvos(det.alvos);
        setResumo(det.resumo);
      }
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
    } finally {
      setCarregando(false);
    }
  }, [tokenPublico]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar(alvo: AcaoAlvo, canal: ContatoCanal, extra?: {
    perfil?: Perfil | null;
    unidades?: UnidadesInteresse | null;
  }) {
    if (!acao) return;
    setSalvando(alvo.id);
    try {
      if (tokenPublico) {
        await pedir(
          "/api/publico/acao",
          { body: JSON.stringify({ alvoId: alvo.id, canal, op: "contato", ...extra }), method: "POST" },
          tokenPublico,
        );
      } else {
        await pedir(`/api/apolo/acoes/${acao.id}`, {
          body: JSON.stringify({ alvoId: alvo.id, canal, ...extra }),
          method: "PATCH",
        });
      }
      setAberto(null);
      await carregar(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSalvando(null);
    }
  }

  function abrirTelefonico(alvo: AcaoAlvo) {
    setAberto(alvo.id);
    setRascunho({ perfil: alvo.perfil, unidades: alvo.unidadesInteresse });
  }

  // Cria o template do convite na Meta com a arte escolhida (multipart, sem Content-Type manual: o
  // navegador põe o boundary). O texto e os botões são fixos no servidor.
  async function criarTemplate(file: File) {
    if (!acao) return;
    setCriandoTemplate(true);
    setMsgTemplate(null);
    try {
      const token = await getApoloAccessToken();
      const fd = new FormData();
      fd.append("imagem", file);
      const resp = await fetch(`/api/apolo/acoes/${acao.id}/template`, {
        body: fd,
        headers: { Authorization: `Bearer ${token}` },
        method: "POST",
      });
      const json = (await resp.json().catch(() => null)) as {
        data?: { name: string; status?: string };
        error?: string;
      } | null;
      setMsgTemplate(
        resp.ok && json?.data
          ? `Template "${json.data.name}" enviado para a Meta aprovar.`
          : (json?.error ?? "Falha ao criar o template."),
      );
      await carregar(true);
    } catch (e) {
      setMsgTemplate(e instanceof Error ? e.message : "Falha ao criar o template.");
    } finally {
      setCriandoTemplate(false);
    }
  }

  // WhatsApp = não falou por telefone: dispara o convite (template) pelo 4143 e marca o canal.
  async function disparar(alvo: AcaoAlvo) {
    if (!acao) return;
    if (!acao.templateMetaName) {
      setErro("Crie o template do convite (botão no canto) antes de disparar.");
      return;
    }
    setSalvando(alvo.id);
    setErro(null);
    try {
      if (tokenPublico) {
        await pedir(
          "/api/publico/acao",
          { body: JSON.stringify({ alvoId: alvo.id, op: "disparar" }), method: "POST" },
          tokenPublico,
        );
      } else {
        await pedir(`/api/apolo/acoes/${acao.id}/disparar`, {
          body: JSON.stringify({ alvoId: alvo.id }),
          method: "POST",
        });
      }
      await carregar(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao disparar o convite.");
    } finally {
      setSalvando(null);
    }
  }

  const termo = busca.trim().toLowerCase();
  const filtrados = useMemo(
    () =>
      alvos.filter((a) => {
        if (filtro === "pendentes" && a.contatoCanal) return false;
        if (filtro === "pix" && !a.pixPago) return false;
        if (!termo) return true;
        return (
          (a.nome ?? "").toLowerCase().includes(termo) ||
          (a.imobiliaria ?? "").toLowerCase().includes(termo) ||
          (a.cpf ?? "").includes(termo)
        );
      }),
    [alvos, filtro, termo],
  );

  if (carregando) {
    return (
      <div className="flex h-full items-center justify-center text-ink-muted">
        <Loader2 aria-hidden="true" className="mr-2 size-5 animate-spin" /> Carregando a ação...
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-6 py-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-[#A07C3B]">
            Ações · contato em massa
          </p>
          <h1 className="m-0 mt-1 text-2xl font-black text-ink">{acao?.nome ?? "Ações"}</h1>
        </div>
        {tokenPublico ? null : (
          <div className="flex flex-col items-end gap-1">
            <input
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void criarTemplate(f);
                e.target.value = "";
              }}
              ref={inputImagemRef}
              type="file"
            />
            <button
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink disabled:opacity-50"
              disabled={criandoTemplate}
              onClick={() => inputImagemRef.current?.click()}
              type="button"
            >
              {criandoTemplate ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <ImagePlus aria-hidden="true" className="size-4" />
              )}
              {acao?.templateMetaName ? "Recriar template do convite" : "Criar template do convite"}
            </button>
            {msgTemplate ? (
              <span className="max-w-xs text-right text-xs text-ink-muted">{msgTemplate}</span>
            ) : null}
          </div>
        )}
      </header>

      {erro ? (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {erro}
        </p>
      ) : null}

      {resumo ? (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Total" valor={resumo.total} />
          <Kpi label="Contatados" valor={resumo.contatados} />
          <Kpi label="Telefônico" valor={resumo.porTelefone} />
          <Kpi label="WhatsApp" valor={resumo.porWhatsapp} />
          <Kpi label="Investimento" valor={resumo.perfilInvestimento} />
          <Kpi label="Respostas" valor={resumo.respostas} />
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-black/[0.04] p-1 dark:bg-white/[0.06]">
          {(
            [
              ["todos", `Todos (${alvos.length})`],
              ["pendentes", `Não contatados (${alvos.filter((a) => !a.contatoCanal).length})`],
              ["pix", `Pagou PIX (${alvos.filter((a) => a.pixPago).length})`],
            ] as const
          ).map(([id, rotulo]) => (
            <button
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                filtro === id ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"
              }`}
              key={id}
              onClick={() => setFiltro(id)}
              type="button"
            >
              {rotulo}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          />
          <input
            className="h-9 w-64 rounded-lg border border-line bg-surface pl-8 pr-3 text-sm text-ink"
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome, imobiliária ou CPF"
            value={busca}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-line text-left">
              {["Cliente", "Imobiliária", "Telefone", "PIX", "Contato", "Perfil / Unidades"].map((h) => (
                <th
                  className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted"
                  key={h}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtrados.map((a) => (
              <LinhaAlvo
                aberto={aberto === a.id}
                alvo={a}
                key={a.id}
                onAbrirTelefonico={() => abrirTelefonico(a)}
                onCancelar={() => setAberto(null)}
                onRascunho={setRascunho}
                onSalvarTelefonico={() =>
                  void salvar(a, "telefonico", {
                    perfil: rascunho.perfil,
                    unidades: rascunho.unidades,
                  })
                }
                onWhatsapp={() => void disparar(a)}
                rascunho={rascunho}
                salvando={salvando === a.id}
              />
            ))}
          </tbody>
        </table>
        {filtrados.length === 0 ? (
          <p className="m-0 py-10 text-center text-sm text-ink-muted">Nada nesta lista.</p>
        ) : null}
      </div>
    </div>
  );
}

function Kpi({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="text-2xl font-black tabular-nums text-ink">{valor}</div>
      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </div>
    </div>
  );
}

function LinhaAlvo(props: {
  aberto: boolean;
  alvo: AcaoAlvo;
  onAbrirTelefonico: () => void;
  onCancelar: () => void;
  onRascunho: (r: { perfil: Perfil | null; unidades: UnidadesInteresse | null }) => void;
  onSalvarTelefonico: () => void;
  onWhatsapp: () => void;
  rascunho: { perfil: Perfil | null; unidades: UnidadesInteresse | null };
  salvando: boolean;
}) {
  const { alvo } = props;
  const canal = alvo.contatoCanal;

  return (
    <>
      <tr className="border-b border-line last:border-0">
        <td className="px-3 py-2.5">
          <div className="font-semibold text-ink">{alvo.nome ?? "—"}</div>
          <div className="text-xs text-ink-muted">{alvo.cpf ?? ""}</div>
        </td>
        <td className="px-3 py-2.5 text-ink-muted">
          {alvo.imobiliaria ?? "—"}
          {alvo.corretor ? <div className="text-xs">{alvo.corretor}</div> : null}
        </td>
        <td className="px-3 py-2.5 tabular-nums text-ink">{alvo.telefone ?? "—"}</td>
        <td className="px-3 py-2.5">
          {alvo.pixPago ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
              Pago
            </span>
          ) : (
            <span className="text-xs text-ink-muted">—</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          {canal ? (
            <div className="flex flex-col gap-1">
              <span
                className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                  canal === "telefonico"
                    ? "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400"
                    : alvo.disparoStatus === "falhou"
                      ? "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400"
                      : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                }`}
                title={
                  canal === "whatsapp" && alvo.disparoStatus === "falhou"
                    ? (alvo.disparoErro ?? undefined)
                    : undefined
                }
              >
                {canal === "telefonico"
                  ? "Telefônico"
                  : alvo.disparoStatus === "falhou"
                    ? "WhatsApp · falhou"
                    : alvo.disparoStatus === "enviado"
                      ? "WhatsApp · enviado"
                      : "WhatsApp"}
              </span>
              {canal === "whatsapp" && alvo.disparoStatus === "falhou" && alvo.disparoErro ? (
                <span className="max-w-[220px] text-[11px] leading-tight text-red-600 dark:text-red-400">
                  {alvo.disparoErro}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="flex gap-1.5">
              <button
                className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink transition hover:border-ink disabled:opacity-50"
                disabled={props.salvando}
                onClick={props.onAbrirTelefonico}
                type="button"
              >
                <Phone aria-hidden="true" className="size-3.5" /> Telefônico
              </button>
              <button
                className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink transition hover:border-ink disabled:opacity-50"
                disabled={props.salvando}
                onClick={props.onWhatsapp}
                type="button"
              >
                WhatsApp
              </button>
            </div>
          )}
        </td>
        <td className="px-3 py-2.5 text-xs text-ink-muted">
          {alvo.respostaEm ? (
            <span className="mb-1 inline-flex w-fit items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
              Respondeu
            </span>
          ) : null}
          <div>
            {alvo.perfil ? (alvo.perfil === "moradia" ? "Moradia" : "Investimento") : ""}
            {alvo.unidadesInteresse ? (
              <span className="ml-1">
                {alvo.perfil ? "· " : ""}
                {LABEL_UNIDADES[alvo.unidadesInteresse]}
                {alvo.unidadesOrigem === "cliente" ? " (cliente)" : ""}
              </span>
            ) : alvo.respostaTexto ? (
              <span className="ml-1 italic">{alvo.respostaTexto}</span>
            ) : null}
          </div>
        </td>
      </tr>
      {props.aberto ? (
        <tr className="border-b border-line bg-black/[0.02] dark:bg-white/[0.03]">
          <td className="px-3 py-3" colSpan={6}>
            <div className="flex flex-wrap items-end gap-4">
              <Campo label="Perfil">
                {(["moradia", "investimento"] as const).map((p) => (
                  <Opcao
                    ativo={props.rascunho.perfil === p}
                    key={p}
                    onClick={() => props.onRascunho({ ...props.rascunho, perfil: p })}
                    rotulo={p === "moradia" ? "Moradia" : "Investimento"}
                  />
                ))}
              </Campo>
              <Campo label="Unidades de interesse">
                {(Object.keys(LABEL_UNIDADES) as UnidadesInteresse[]).map((u) => (
                  <Opcao
                    ativo={props.rascunho.unidades === u}
                    key={u}
                    onClick={() => props.onRascunho({ ...props.rascunho, unidades: u })}
                    rotulo={LABEL_UNIDADES[u]}
                  />
                ))}
              </Campo>
              <div className="ml-auto flex gap-2">
                <button
                  className="rounded-lg px-3 py-1.5 text-sm font-semibold text-ink-muted hover:text-ink"
                  onClick={props.onCancelar}
                  type="button"
                >
                  Cancelar
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-lg bg-[#A07C3B] px-4 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                  disabled={props.salvando}
                  onClick={props.onSalvarTelefonico}
                  type="button"
                >
                  {props.salvando ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                  Salvar contato
                </button>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Campo({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <div className="flex gap-1.5">{children}</div>
    </div>
  );
}

function Opcao({ ativo, onClick, rotulo }: { ativo: boolean; onClick: () => void; rotulo: string }) {
  return (
    <button
      className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
        ativo
          ? "border-[#A07C3B] bg-[#A07C3B]/10 text-[#A07C3B]"
          : "border-line bg-surface text-ink hover:border-ink"
      }`}
      onClick={onClick}
      type="button"
    >
      {rotulo}
    </button>
  );
}
