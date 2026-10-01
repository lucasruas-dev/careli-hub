"use client";

import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
} from "lucide-react";
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
// ⚠️ ANTES DA APROVAÇÃO NÃO EXISTE FICHA (segunda rodada de revisão, 01/10/2026). O que a pessoa
// digitou e os documentos que ela mandou ficam no PEDIDO, e é daqui que a coordenação os confere. A
// ficha nasce, ou é acrescentada, na aprovação; só então o botão "Abrir ficha" aparece.
//
// ⚠️ SÓ A COORDENAÇÃO (admin e líder) lê a fila e decide. Para os outros papéis as rotas respondem 403,
// e a tela mostra a frase do servidor.

// O endereço que o time manda para o corretor. É o mesmo de LINK_DO_CADASTRO_DO_AUTONOMO
// (lib/apolo/autonomo-do-link.ts), que é server-only; aqui vai como texto para não arrastar o
// módulo do servidor para o bundle da tela.
const LINK_PUBLICO = "https://c2x.app.br/publico/autonomo";

type Estado = "aprovado" | "correcao" | "em-analise" | "indeferido";

type Proposta = {
  endereco: Record<string, string | undefined>;
  identidade: Record<string, string | undefined>;
  perfil: Record<string, string | undefined>;
};

type Item = {
  codigo: null | string;
  cpfMascarado: null | string;
  decididoEm: null | string;
  documentos: Array<{ categoria: string; fileName: string }>;
  entityId: null | string;
  enviadoEm: string;
  estado: Estado;
  /** A ficha que o CPF já tem e que a aprovação usaria (null = CPF novo). */
  fichaExistente: null | { entityId: string; nome: string; papeis: string[] };
  interesse: Array<{ id: string; label: string }>;
  motivos: string[];
  pedidoId: string;
  proposta: Proposta;
  /** O que a aprovação grava, dito pelo servidor com a mesma régua da aprovação. */
  seraGravado: string[];
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

const ROTULO_DO_ESTADO: Record<Estado, string> = {
  aprovado: "Aprovado",
  correcao: "Em correção",
  "em-analise": "Em análise",
  indeferido: "Indeferido",
};

const ROTULO_DO_DOCUMENTO: Record<string, string> = {
  comprovante_endereco: "Comprovante de endereço",
  identificacao: "Identificação",
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
  const [truncado, setTruncado] = useState(false);
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
      const dados = await chamar<{ itens: Item[]; truncado?: boolean }>(
        "/api/apolo/corretores-autonomos/fila",
      );
      setItens(dados?.itens ?? []);
      setTruncado(Boolean(dados?.truncado));
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
            Quem se cadastrou pelo link público espera aqui, e nada vira cadastro antes da
            aprovação. Aprovar cria a ficha e dá o código CA; os empreendimentos se liberam um a um,
            na aba Habilitação, e o coordenador de cada um é avisado.
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

      {truncado ? (
        <p className="m-0 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          Há pedidos demais para mostrar de uma vez: os mais antigos ficaram de fora desta tela. Fale com a
          equipe do Panteon.
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
                key={item.pedidoId}
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

function Linha({ rotulo, valor }: { rotulo: string; valor?: string }) {
  if (!valor) return null;
  return (
    <p className="m-0 text-xs text-ink-soft">
      <span className="text-ink-muted">{rotulo}:</span> {valor}
    </p>
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
  const [documentos, setDocumentos] = useState<
    null | Array<{ categoria: string; fileName: string; url: null | string }>
  >(null);
  const [abrindoDocumentos, setAbrindoDocumentos] = useState(false);

  const { endereco, identidade, perfil } = item.proposta;
  const nome = identidade.nome || "Sem nome";

  const abrirDocumentos = async () => {
    setAbrindoDocumentos(true);
    setErro(null);
    try {
      const dados = await chamar<{
        documentos: Array<{ categoria: string; fileName: string; url: null | string }>;
      }>(`/api/apolo/corretores-autonomos/pedidos/${encodeURIComponent(item.pedidoId)}/documentos`);
      setDocumentos(dados?.documentos ?? []);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAbrindoDocumentos(false);
    }
  };

  const decidir = async (acao: "aprovar" | "correcao" | "indeferir") => {
    setSalvando(true);
    setErro(null);
    try {
      const resultado = await chamar<{
        aviso: { enviado: boolean; erro: null | string };
        codigo: null | string;
        documentos: { falhas: string[]; salvos: number };
      }>(`/api/apolo/corretores-autonomos/pedidos/${encodeURIComponent(item.pedidoId)}/decisao`, {
        body: JSON.stringify({
          acao,
          motivos: acao === "aprovar" ? [] : [motivo.trim()].filter(Boolean),
        }),
        method: "POST",
      });
      const aviso = resultado?.aviso?.enviado
        ? "O corretor foi avisado no WhatsApp."
        : `O aviso no WhatsApp não saiu (${resultado?.aviso?.erro ?? "sem motivo"}): avise por outro canal.`;
      const falhas = resultado?.documentos?.falhas ?? [];
      setFeito(
        acao === "aprovar"
          ? `Aprovado com o código ${resultado?.codigo ?? ""}. ${aviso}` +
              (falhas.length
                ? ` ATENÇÃO: ${falhas.length} documento(s) não foram para a ficha; anexe pela ficha (${falhas.join("; ")}).`
                : "")
          : acao === "correcao"
            ? `Correção pedida. ${aviso}`
            : "Indeferido. A pessoa não é avisada pelo WhatsApp, e os documentos do pedido foram apagados.",
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
  const enderecoTexto = [
    [endereco.logradouro, endereco.numero].filter(Boolean).join(", "),
    endereco.bairro,
    [endereco.cidade, endereco.uf].filter(Boolean).join("/"),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 truncate text-sm font-semibold text-ink">{nome}</h2>
          <p className="m-0 mt-0.5 text-xs text-ink-muted">
            CPF {item.cpfMascarado ?? "não informado"} · enviado em {quando(item.enviadoEm)}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-subtle px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
          {item.codigo ?? ROTULO_DO_ESTADO[item.estado]}
        </span>
      </div>

      {/* ⚠️ O LINK NÃO PROVA QUE QUEM DIGITA É DONO DO CPF. CPF que já tem ficha pode ser de outra
          pessoa: a coordenação abre a ficha e compara com o que foi digitado antes de aprovar. */}
      {item.fichaExistente && aberto ? (
        <div className="mt-3 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="m-0 font-semibold">
            Este CPF já tem ficha na Careli: {item.fichaExistente.nome}
            {item.fichaExistente.papeis.length ? ` (${item.fichaExistente.papeis.join(", ")})` : " (sem papel)"}.
          </p>
          <p className="m-0 mt-0.5">
            Compare com os dados digitados abaixo antes de aprovar: se não baterem, o pedido pode ser de
            outra pessoa. Os dados digitados NÃO entram nessa ficha.
          </p>
          {onOpenEntity ? (
            <button
              className="mt-1.5 inline-flex h-7 items-center gap-1.5 rounded-lg border border-amber-400/60 px-2.5 text-[11px] font-semibold hover:bg-amber-100 dark:hover:bg-amber-500/20"
              onClick={() => onOpenEntity(item.fichaExistente!.nome, item.fichaExistente!.entityId)}
              type="button"
            >
              <ExternalLink aria-hidden="true" className="size-3" />
              Abrir a ficha existente
            </button>
          ) : null}
        </div>
      ) : null}

      {aberto && item.seraGravado.length ? (
        <div className="mt-3 rounded-lg bg-subtle px-3 py-2 text-xs text-ink-soft">
          <p className="m-0 font-semibold text-ink">Se aprovar, fica gravado:</p>
          <ul className="m-0 mt-1 grid gap-0.5 pl-4">
            {item.seraGravado.map((linha) => (
              <li key={linha}>{linha}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 grid gap-0.5">
        <Linha rotulo="Celular" valor={perfil.telefone} />
        <Linha rotulo="E-mail" valor={perfil.email} />
        <Linha rotulo="Nascimento" valor={identidade.dataNascimento} />
        <Linha rotulo="Naturalidade" valor={identidade.naturalidade} />
        <Linha rotulo="Mãe" valor={identidade.nomeMae} />
        <Linha rotulo="Endereço" valor={enderecoTexto} />
        <Linha
          rotulo="Interesse"
          valor={
            item.interesse.length
              ? item.interesse.map((emp) => emp.label).join(", ")
              : "não indicou empreendimento"
          }
        />
      </div>

      <div className="mt-3">
        {documentos === null ? (
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold text-ink-soft hover:bg-subtle disabled:opacity-50"
            disabled={abrindoDocumentos || item.documentos.length === 0}
            onClick={() => void abrirDocumentos()}
            type="button"
          >
            {abrindoDocumentos ? (
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            ) : (
              <FileText aria-hidden="true" className="size-3.5" />
            )}
            {item.documentos.length ? `Ver documentos (${item.documentos.length})` : "Sem documentos"}
          </button>
        ) : (
          <ul className="m-0 grid gap-1 p-0">
            {documentos.map((doc, indice) => (
              <li className="list-none text-xs" key={`${doc.categoria}-${indice}`}>
                {doc.url ? (
                  <a
                    className="font-semibold text-[#7a5e2c] underline dark:text-[#d9b877]"
                    href={doc.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {ROTULO_DO_DOCUMENTO[doc.categoria] ?? doc.categoria}: {doc.fileName}
                  </a>
                ) : (
                  <span className="text-ink-muted">
                    {ROTULO_DO_DOCUMENTO[doc.categoria] ?? doc.categoria}: não abriu
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
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
          <label className="text-xs font-semibold text-ink-soft" htmlFor={`motivo-${item.pedidoId}`}>
            {pedindoMotivo === "correcao"
              ? "O que ele precisa corrigir? (ele lê esta frase no WhatsApp)"
              : "Por que o cadastro não foi aprovado? (fica registrado; a pessoa não é avisada pelo WhatsApp)"}
          </label>
          <textarea
            className="min-h-20 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            id={`motivo-${item.pedidoId}`}
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
        {onOpenEntity && item.entityId ? (
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold text-ink-soft hover:bg-subtle"
            onClick={() => onOpenEntity(nome, String(item.entityId))}
            type="button"
          >
            <ExternalLink aria-hidden="true" className="size-3.5" />
            Abrir ficha
          </button>
        ) : null}
        {aberto && !pedindoMotivo && !feito ? (
          <>
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              disabled={salvando}
              onClick={() => {
                if (window.confirm(`Aprovar ${nome} como corretor autônomo? A ficha é gravada e ele recebe o código CA.`)) {
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
