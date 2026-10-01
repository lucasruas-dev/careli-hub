"use client";

import { AlertTriangle, Check, Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

// CORRETORES AUTÔNOMOS — a validação de quem se cadastrou pelo link público e a habilitação de
// quem já foi aprovado (01/10/2026).
//
// Lucas, escolhendo onde o time valida: uma tela nova no Apolo, com as MESMAS três ações da
// imobiliária (aprovar, pedir correção, indeferir), e na mesma tela o botão de habilitar o autônomo
// num empreendimento — que até aqui só existia no servidor
// (`/api/apolo/corretores-autonomos/[id]/habilitar`), sem botão em tela nenhuma.
//
// ⚠️ OS DOCUMENTOS FICAM NA FICHA DO CRM, e o botão "Abrir ficha" leva até ela. Repetir aqui o leitor
// de documentos seria uma segunda tela de documentos para manter.

// O endereço que o time manda para o corretor. É o mesmo de LINK_DO_CADASTRO_DO_AUTONOMO
// (lib/apolo/autonomo-do-link.ts), que é server-only; aqui vai como texto para não arrastar o
// módulo do servidor para o bundle da tela.
const LINK_PUBLICO = "https://c2x.app.br/publico/autonomo";

type Estado = "aprovado" | "correcao" | "em-analise" | "indeferido";

type Item = {
  codigo: null | string;
  contatoInformado: { email: null | string; telefone: null | string };
  fichaExistia: boolean;
  nomeInformado: null | string;
  papelAntes: null | string;
  cpfMascarado: null | string;
  decididoEm: null | string;
  email: null | string;
  enviadoEm: string;
  entityId: string;
  estado: Estado;
  interesse: Array<{ id: string; label: string }>;
  motivos: string[];
  nome: string;
  telefone: null | string;
};

type Autonomo = { codigo: string; entityId: string; nome: string };
type Empreendimento = { id: string; name: string };

type Aba = "analise" | "correcao" | "decididos" | "habilitacao";

const ABAS: Array<{ id: Aba; label: string }> = [
  { id: "analise", label: "Em análise" },
  { id: "correcao", label: "Em correção" },
  { id: "decididos", label: "Decididos (30 dias)" },
  { id: "habilitacao", label: "Habilitação" },
];

const ROTULO_DO_PAPEL: Record<string, string> = {
  active: "ativo",
  archived: "arquivado",
  blocked: "bloqueado",
  review: "em análise",
};

const ROTULO_DO_ESTADO: Record<Estado, string> = {
  aprovado: "Aprovado",
  correcao: "Em correção",
  "em-analise": "Em análise",
  indeferido: "Indeferido",
};

function quando(iso: null | string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  });
}

async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
  const token = await getApoloAccessToken();
  const resposta = await fetch(caminho, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
    },
  });
  const corpo = (await resposta.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!resposta.ok) throw new Error(corpo.error ?? "Não foi possível concluir agora.");
  return corpo.data as T;
}

export function AutonomosView({
  onOpenEntity,
}: {
  onOpenEntity?: (nome: string, entityId: string) => void;
}) {
  const [aba, setAba] = useState<Aba>("analise");
  const [itens, setItens] = useState<Item[]>([]);
  const [erro, setErro] = useState<null | string>(null);
  const [carregando, setCarregando] = useState(true);
  const [copiado, setCopiado] = useState(false);

  const copiarLink = async () => {
    try {
      await navigator.clipboard.writeText(LINK_PUBLICO);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      window.prompt("Copie o link do cadastro:", LINK_PUBLICO);
    }
  };

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const dados = await chamar<{ itens: Item[] }>("/api/apolo/corretores-autonomos/fila");
      setItens(dados?.itens ?? []);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const porAba = useMemo(
    () => ({
      analise: itens.filter((item) => item.estado === "em-analise"),
      correcao: itens.filter((item) => item.estado === "correcao"),
      decididos: itens.filter((item) => item.estado === "aprovado" || item.estado === "indeferido"),
    }),
    [itens],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-base font-bold text-ink">Corretores autônomos</h1>
          <p className="m-0 mt-0.5 text-xs text-ink-muted">
            Quem se cadastrou pelo link público espera aqui. Aprovar dá o código CA e libera o
            cadastro; os empreendimentos se liberam um a um, na aba Habilitação, e o coordenador de
            cada um é avisado.
          </p>
        </div>
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold text-ink-soft hover:bg-subtle"
          onClick={() => void copiarLink()}
          title={LINK_PUBLICO}
          type="button"
        >
          {copiado ? (
            <Check aria-hidden="true" className="size-3.5" />
          ) : (
            <Copy aria-hidden="true" className="size-3.5" />
          )}
          {copiado ? "Copiado" : "Copiar link do cadastro"}
        </button>
        <button
          aria-label="Atualizar"
          className="inline-flex size-8 items-center justify-center rounded-lg border border-line text-ink-soft hover:bg-subtle"
          onClick={() => void carregar()}
          type="button"
        >
          <RefreshCw aria-hidden="true" className={carregando ? "size-4 animate-spin" : "size-4"} />
        </button>
      </header>

      <nav className="flex flex-wrap gap-1.5">
        {ABAS.map((opcao) => {
          const total = opcao.id === "habilitacao" ? null : porAba[opcao.id].length;
          return (
            <button
              className={`h-8 rounded-lg px-3 text-xs font-semibold transition-colors ${
                aba === opcao.id
                  ? "bg-inverse text-brand-ink"
                  : "border border-line text-ink-soft hover:bg-subtle"
              }`}
              key={opcao.id}
              onClick={() => setAba(opcao.id)}
              type="button"
            >
              {opcao.label}
              {total !== null ? ` · ${total}` : ""}
            </button>
          );
        })}
      </nav>

      {erro ? (
        <p className="m-0 flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {erro}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {aba === "habilitacao" ? (
          <Habilitacao />
        ) : carregando && itens.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">Carregando…</p>
        ) : porAba[aba].length === 0 ? (
          <p className="m-0 rounded-xl bg-subtle px-4 py-3 text-sm text-ink-soft">
            {aba === "analise"
              ? "Nenhum cadastro esperando análise."
              : aba === "correcao"
                ? "Ninguém em correção."
                : "Nenhuma decisão nos últimos 30 dias."}
          </p>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {porAba[aba].map((item) => (
              <CartaoDoPedido
                item={item}
                key={item.entityId}
                onDecidido={() => void carregar()}
                onOpenEntity={onOpenEntity}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CartaoDoPedido({
  item,
  onDecidido,
  onOpenEntity,
}: {
  item: Item;
  onDecidido: () => void;
  onOpenEntity?: (nome: string, entityId: string) => void;
}) {
  // A ação que pede motivo abre o campo antes de gravar; aprovar grava direto.
  const [pedindoMotivo, setPedindoMotivo] = useState<null | "correcao" | "indeferir">(null);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<null | string>(null);
  const [feito, setFeito] = useState<null | string>(null);

  const decidir = async (acao: "aprovar" | "correcao" | "indeferir") => {
    setSalvando(true);
    setErro(null);
    try {
      const resultado = await chamar<{
        aviso: { enviado: boolean; erro: null | string };
        codigo: null | string;
      }>(`/api/apolo/corretores-autonomos/${encodeURIComponent(item.entityId)}/decisao`, {
        body: JSON.stringify({
          acao,
          motivos: acao === "aprovar" ? [] : [motivo.trim()].filter(Boolean),
        }),
        method: "POST",
      });
      const aviso = resultado?.aviso?.enviado
        ? "O corretor foi avisado no WhatsApp."
        : `O aviso no WhatsApp não saiu (${resultado?.aviso?.erro ?? "sem motivo"}).`;
      setFeito(
        acao === "aprovar"
          ? `Aprovado com o código ${resultado?.codigo ?? ""}. ${aviso}`
          : `${acao === "correcao" ? "Correção pedida" : "Indeferido"}. ${aviso}`,
      );
      setPedindoMotivo(null);
      setMotivo("");
      onDecidido();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  const aberto = item.estado === "em-analise" || item.estado === "correcao";

  return (
    <article className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 truncate text-sm font-semibold text-ink">{item.nome}</h2>
          <p className="m-0 mt-0.5 text-xs text-ink-muted">
            CPF {item.cpfMascarado ?? "não informado"} · enviado em {quando(item.enviadoEm)}
          </p>
          <p className="m-0 mt-0.5 text-xs text-ink-muted">
            {[item.telefone, item.email].filter(Boolean).join(" · ") || "Sem contato informado"}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-subtle px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
          {item.codigo ?? ROTULO_DO_ESTADO[item.estado]}
        </span>
      </div>

      {/* ⚠️ O LINK NÃO PROVA QUE QUEM DIGITA É DONO DO CPF (revisão adversarial de 01/10/2026). Em
          ficha que já existia, o que foi digitado não entrou na ficha: a tela mostra os dois lados
          para o time conferir antes de aprovar. Contato ou nome diferentes = desconfie. */}
      {item.fichaExistia ? (
        <div className="mt-3 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="m-0 font-semibold">
            Este CPF já tinha ficha na Careli
            {item.papelAntes
              ? `, e já era corretor (${ROTULO_DO_PAPEL[item.papelAntes] ?? item.papelAntes})`
              : ""}
            . Confira se quem pediu é mesmo a pessoa.
          </p>
          <p className="m-0 mt-1">
            Digitado no link: {item.nomeInformado ?? "sem nome"}
            {" · "}
            {[item.contatoInformado.telefone, item.contatoInformado.email].filter(Boolean).join(" · ") ||
              "sem contato"}
          </p>
          <p className="m-0 mt-0.5">
            O aviso da decisão vai para o contato que já estava na ficha (acima), e não para o digitado.
          </p>
        </div>
      ) : null}

      <div className="mt-3">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Interesse
        </p>
        <p className="m-0 mt-1 text-xs text-ink-soft">
          {item.interesse.length
            ? item.interesse.map((emp) => emp.label).join(", ")
            : "Não indicou empreendimento."}
        </p>
      </div>

      {item.motivos.length ? (
        <div className="mt-3 rounded-lg bg-subtle px-3 py-2 text-xs text-ink-soft">
          <span className="font-semibold">
            {item.estado === "correcao" ? "Pedido de correção" : "Motivo"}
            {item.decididoEm ? ` (${quando(item.decididoEm)})` : ""}:
          </span>{" "}
          {item.motivos.join(" · ")}
        </div>
      ) : null}

      {pedindoMotivo ? (
        <div className="mt-3 grid gap-2">
          <label className="text-xs font-semibold text-ink-soft" htmlFor={`motivo-${item.entityId}`}>
            {pedindoMotivo === "correcao"
              ? "O que ele precisa corrigir? (ele lê esta frase no WhatsApp)"
              : "Por que o cadastro não foi aprovado? (ele lê esta frase no WhatsApp)"}
          </label>
          <textarea
            className="min-h-20 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            id={`motivo-${item.entityId}`}
            onChange={(event) => setMotivo(event.target.value)}
            value={motivo}
          />
          <div className="flex gap-2">
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-inverse px-3 text-xs font-semibold text-brand-ink disabled:opacity-50"
              disabled={salvando || !motivo.trim()}
              onClick={() => void decidir(pedindoMotivo)}
              type="button"
            >
              {salvando ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null}
              {pedindoMotivo === "correcao" ? "Pedir correção" : "Indeferir"}
            </button>
            <button
              className="h-8 rounded-lg border border-line px-3 text-xs font-semibold text-ink-soft hover:bg-subtle"
              onClick={() => {
                setPedindoMotivo(null);
                setMotivo("");
              }}
              type="button"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {feito ? (
        <p className="m-0 mt-3 flex items-start gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-500/12 dark:text-emerald-300">
          <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {feito}
        </p>
      ) : null}
      {erro ? (
        <p className="m-0 mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">
          {erro}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {onOpenEntity ? (
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold text-ink-soft hover:bg-subtle"
            onClick={() => onOpenEntity(item.nome, item.entityId)}
            type="button"
          >
            <ExternalLink aria-hidden="true" className="size-3.5" />
            Abrir ficha e documentos
          </button>
        ) : null}
        {aberto && !pedindoMotivo && !feito ? (
          <>
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              disabled={salvando}
              onClick={() => {
                if (window.confirm(`Aprovar ${item.nome} como corretor autônomo? Ele recebe o código CA.`)) {
                  void decidir("aprovar");
                }
              }}
              type="button"
            >
              {salvando ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null}
              Aprovar
            </button>
            {item.estado === "em-analise" ? (
              <button
                className="h-8 rounded-lg border border-line px-3 text-xs font-semibold text-ink-soft hover:bg-subtle"
                onClick={() => setPedindoMotivo("correcao")}
                type="button"
              >
                Pedir correção
              </button>
            ) : null}
            <button
              className="h-8 rounded-lg border border-rose-300 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
              onClick={() => setPedindoMotivo("indeferir")}
              type="button"
            >
              Indeferir
            </button>
          </>
        ) : null}
      </div>
    </article>
  );
}

// A HABILITAÇÃO, empreendimento a empreendimento, de TODO autônomo aprovado (os que o time cadastrou
// por dentro também). Reusa as rotas que já existem: a lista de autônomos, os empreendimentos de cada
// um e o POST de habilitar, que grava a auditoria e avisa o coordenador.
function Habilitacao() {
  const [autonomos, setAutonomos] = useState<Autonomo[]>([]);
  const [empreendimentos, setEmpreendimentos] = useState<Empreendimento[]>([]);
  const [erro, setErro] = useState<null | string>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const [lista, ativos] = await Promise.all([
          chamar<{ corretores: Autonomo[] }>("/api/apolo/corretores-autonomos"),
          chamar<{ empreendimentos: Empreendimento[] }>("/api/apolo/credenciamento"),
        ]);
        if (!vivo) return;
        setAutonomos(lista?.corretores ?? []);
        setEmpreendimentos(
          (ativos?.empreendimentos ?? []).map((emp) => ({ id: String(emp.id), name: emp.name })),
        );
      } catch (e) {
        if (vivo) setErro((e as Error).message);
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  if (carregando) return <p className="m-0 text-sm text-ink-muted">Carregando…</p>;
  if (erro) {
    return (
      <p className="m-0 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:bg-rose-500/10 dark:text-rose-200">
        {erro}
      </p>
    );
  }
  if (autonomos.length === 0) {
    return (
      <p className="m-0 rounded-xl bg-subtle px-4 py-3 text-sm text-ink-soft">
        Nenhum corretor autônomo aprovado ainda.
      </p>
    );
  }

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {autonomos.map((autonomo) => (
        <LinhaDeHabilitacao autonomo={autonomo} empreendimentos={empreendimentos} key={autonomo.entityId} />
      ))}
    </div>
  );
}

function LinhaDeHabilitacao({
  autonomo,
  empreendimentos,
}: {
  autonomo: Autonomo;
  empreendimentos: Empreendimento[];
}) {
  const [habilitados, setHabilitados] = useState<null | Array<{ enterpriseId: string; nome: string }>>(
    null,
  );
  const [escolhido, setEscolhido] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<null | { ok: boolean; texto: string }>(null);

  const carregar = useCallback(async () => {
    try {
      const dados = await chamar<{ empreendimentos: Array<{ enterpriseId: string; nome: string }> }>(
        `/api/apolo/corretores-autonomos/${encodeURIComponent(autonomo.entityId)}/empreendimentos`,
      );
      setHabilitados(dados?.empreendimentos ?? []);
    } catch {
      setHabilitados([]);
    }
  }, [autonomo.entityId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const habilitar = async () => {
    const empreendimento = empreendimentos.find((emp) => emp.id === escolhido);
    if (!empreendimento) return;
    setSalvando(true);
    setMensagem(null);
    try {
      const resposta = await chamar<{
        coordenadores: { avisados: number; falharam: number };
        jaHabilitado: boolean;
      }>(`/api/apolo/corretores-autonomos/${encodeURIComponent(autonomo.entityId)}/habilitar`, {
        body: JSON.stringify({ enterpriseId: empreendimento.id, label: empreendimento.name }),
        method: "POST",
      });
      // O POST de habilitar devolve o corpo na raiz (`{ data, ok }`), e `chamar` já tira o `data`.
      setMensagem({
        ok: true,
        texto: resposta?.jaHabilitado
          ? `${autonomo.nome} já estava habilitado em ${empreendimento.name}.`
          : `Habilitado em ${empreendimento.name}. Coordenador avisado: ${resposta?.coordenadores?.avisados ?? 0}` +
            (resposta?.coordenadores?.falharam ? `, falhou: ${resposta.coordenadores.falharam}.` : "."),
      });
      setEscolhido("");
      await carregar();
    } catch (e) {
      setMensagem({ ok: false, texto: (e as Error).message });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <article className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="m-0 truncate text-sm font-semibold text-ink">{autonomo.nome}</h2>
        <span className="shrink-0 rounded-full bg-subtle px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
          {autonomo.codigo}
        </span>
      </div>
      <p className="m-0 mt-2 text-xs text-ink-soft">
        {habilitados === null
          ? "Carregando empreendimentos…"
          : habilitados.length
            ? `Habilitado em: ${habilitados.map((emp) => emp.nome).join(", ")}`
            : "Ainda não habilitado em nenhum empreendimento."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <select
          aria-label={`Empreendimento para habilitar ${autonomo.nome}`}
          className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-xs text-ink"
          onChange={(event) => setEscolhido(event.target.value)}
          value={escolhido}
        >
          <option value="">Escolha o empreendimento</option>
          {empreendimentos.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name}
            </option>
          ))}
        </select>
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-inverse px-3 text-xs font-semibold text-brand-ink disabled:opacity-50"
          disabled={!escolhido || salvando}
          onClick={() => void habilitar()}
          type="button"
        >
          {salvando ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null}
          Habilitar
        </button>
      </div>
      {mensagem ? (
        <p
          className={`m-0 mt-2 rounded-lg px-3 py-2 text-xs ${
            mensagem.ok
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/12 dark:text-emerald-300"
              : "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200"
          }`}
        >
          {mensagem.texto}
        </p>
      ) : null}
    </article>
  );
}
