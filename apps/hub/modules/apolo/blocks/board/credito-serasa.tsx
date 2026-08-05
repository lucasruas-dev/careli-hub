"use client";

import {
  AlertTriangle,
  Check,
  CheckCheck,
  CreditCard,
  FileText,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";
import {
  ResultadoCredito,
  type ResumoCredito,
  type VeredicoCredito,
} from "../serasa/resultado-credito";

// ANÁLISE DE CRÉDITO — consulta ao Serasa Experian.
//
// A consulta é PAGA, então a tela segue a mesma disciplina da leitura de documentos da MOST:
// mostra a situação primeiro (ambiente, consulta anterior, quanto já se consultou hoje) e só
// chama depois de confirmação explícita.
//
// Enquanto a integração não estiver configurada (faltam respostas do Serasa sobre endpoint de
// token, host e nomes dos relatórios), a tela DIZ o que falta em vez de oferecer um botão que
// não funciona.

type EnvioResultado = {
  destinatario?: string | null;
  error?: string;
  ok: boolean;
  pulado?: boolean;
};

type Disparo = {
  created_at: string;
  delivered_at?: string | null;
  destinatario?: string | null;
  erro?: string | null;
  origem?: string | null;
  read_at?: string | null;
  sent_at?: string | null;
  status: string; // enviado | entregue | lido | falhou
  telefone?: string | null;
  tipo: string; // coordenador | corretor
};

type Situacao = {
  ambiente?: "homologacao" | "producao";
  avisoAmbiente?: string | null;
  configurado: boolean;
  // Estado civil e CPF do cônjuge vêm da ficha da esteira, resolvidos no servidor. O CPF em si
  // NÃO trafega: só o "tem ou não tem", que é o que a tela precisa para decidir o botão.
  conjuge?: { nome: string; temCpf: boolean; temConjuge: boolean };
  consultasHoje?: number;
  disparos?: Disparo[];
  ehAdmin?: boolean;
  // Etapa PERSISTIDA da esteira. "revisao" = crédito reprovado; é o que decide o painel de aviso.
  etapa?: string | null;
  faltando?: string[];
  tetoDiario?: number | null;
  ultimaConsulta?: {
    ambiente: string;
    created_at: string;
    id: string;
    report_name: string;
    resposta?: unknown;
    resumo: ResumoCredito;
    veredito?: VeredicoCredito | null;
  } | null;
};

export function CreditoSerasa({
  entityId,
  onResultado,
}: {
  entityId: string;
  // Avisa o Board quando a consulta resolve: o servidor já moveu a etapa (aprovado -> pré-venda,
  // reprovado -> revisão) e a tela precisa refletir sem esperar reload.
  onResultado?: (r: { aprovado: boolean; etapa?: string }) => void;
}) {
  const [situacao, setSituacao] = useState<Situacao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [consultando, setConsultando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [reenviando, setReenviando] = useState<"coordenador" | "corretor" | null>(null);
  const [avisoReenvio, setAvisoReenvio] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<"cad" | "comprovante" | null>(null);
  const [avisoDoc, setAvisoDoc] = useState<string | null>(null);
  // Resultado da consulta do cônjuge. Estado próprio porque ele NÃO entra no painel de baixo,
  // que mostra a última consulta do titular.
  const [resultadoConjuge, setResultadoConjuge] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch(
        `/api/apolo/serasa/consultar?entityId=${encodeURIComponent(entityId)}`,
        { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
      );
      const corpo = (await resposta.json()) as { data?: Situacao };
      setSituacao(corpo.data ?? { configurado: false });
    } catch {
      setSituacao({ configurado: false });
    } finally {
      setCarregando(false);
    }
  }, [entityId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // BANCADA: as combinações que a documentação do Serasa deixa em aberto. São poucas — dá
  // para descobrir a certa em menos de dez chamadas, bem abaixo do teto diário.
  const COMBINACOES = [
    {
      authUrl: "https://uat-api.serasaexperian.com.br/security/iam/v1/client-identities/login",
      clientIdNaQuery: false,
      nome: "uat-api · client-identities",
    },
    {
      authUrl: "https://uat-api.serasaexperian.com.br/security/iam/v1/user-identities/login",
      clientIdNaQuery: true,
      nome: "uat-api · user-identities?clientId=",
    },
    {
      authUrl: "https://sandbox-api.serasaexperian.com.br/security/iam/v1/client-identities/login",
      clientIdNaQuery: false,
      nome: "sandbox-api · client-identities",
    },
    {
      authUrl: "https://sandbox-api.serasaexperian.com.br/security/iam/v1/user-identities/login",
      clientIdNaQuery: true,
      nome: "sandbox-api · user-identities?clientId=",
    },
  ];

  const [testando, setTestando] = useState<string | null>(null);
  const [resultados, setResultados] = useState<
    { camposDaResposta: string[]; httpStatus: number | null; nome: string; respostaCrua: string | null; sucesso: boolean; temToken: boolean }[]
  >([]);

  const testar = async (combinacao: (typeof COMBINACOES)[number]) => {
    setTestando(combinacao.nome);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch("/api/apolo/serasa/bancada", {
        body: JSON.stringify({
          authUrl: combinacao.authUrl,
          clientIdNaQuery: combinacao.clientIdNaQuery,
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const corpo = (await resposta.json()) as {
        data?: {
          camposDaResposta: string[];
          httpStatus: number | null;
          respostaCrua: string | null;
          sucesso: boolean;
          temToken: boolean;
        };
        error?: string;
      };
      if (!resposta.ok || !corpo.data) {
        setResultados((r) => [
          ...r,
          {
            camposDaResposta: [],
            httpStatus: resposta.status,
            nome: combinacao.nome,
            respostaCrua: corpo.error ?? null,
            sucesso: false,
            temToken: false,
          },
        ]);
        return;
      }
      setResultados((r) => [...r, { ...corpo.data!, nome: combinacao.nome }]);
    } finally {
      setTestando(null);
    }
  };

  // `alvo` decide de quem é a consulta. O CPF do cônjuge o servidor pega da ficha; daqui só vai
  // a intenção, porque a rota nunca aceita documento vindo da tela.
  const consultar = async (forcar: boolean, alvo: "titular" | "conjuge" = "titular") => {
    setConsultando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch("/api/apolo/serasa/consultar", {
        body: JSON.stringify({
          alvo,
          confirmado: true,
          entityId,
          forcar,
          // RELATORIO_BASICO_PF_PME: o relatório de triagem, escolhido pelo Lucas (21/jul) por ser
          // o mais barato e trazer as restrições (que é o que decide aprovado/reprovado). Em
          // HOMOLOGAÇÃO o básico dava 412 USER-NOT-AUTHORIZED [BPCB], mas em PRODUÇÃO o contrato o
          // autoriza (confirmado com a credencial de prod). Segue por env para trocar sem deploy.
          reportName:
            process.env.NEXT_PUBLIC_SERASA_REPORT_PF ?? "RELATORIO_BASICO_PF_PME",
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const corpo = (await resposta.json()) as {
        data?: {
          alvo?: string;
          etapa?: string | null;
          veredito?: { aprovado?: boolean; motivo?: string };
        };
        error?: string;
      };
      if (!resposta.ok) setErro(corpo.error ?? `Falha (${resposta.status}).`);
      else {
        // RESULTADO DO CÔNJUGE PRECISA APARECER. Ele não entra no painel de baixo, que é
        // montado a partir da última consulta DO TITULAR — sem esta linha o operador paga a
        // consulta, a tela fica idêntica, e ele clica de novo achando que não funcionou.
        if (corpo.data?.alvo === "conjuge" && corpo.data.veredito) {
          const aprovado = Boolean(corpo.data.veredito.aprovado);
          setResultadoConjuge(
            aprovado
              ? "Crédito do cônjuge APROVADO. O credenciamento pode seguir."
              : `Crédito do cônjuge reprovado. ${corpo.data.veredito.motivo ?? ""}`.trim() +
                  " A ficha do titular não foi alterada.",
          );
        }

        // O servidor já moveu a etapa pela regra do crédito. Avisa o Board na hora.
        // `etapa` vem NULA quando nada se moveu (cônjuge reprovado não mexe na ficha do
        // titular); aí não avisamos o Board, senão a tela mudaria sem o banco ter mudado.
        if (corpo.data?.veredito && corpo.data.etapa) {
          onResultado?.({
            aprovado: Boolean(corpo.data.veredito.aprovado),
            etapa: corpo.data.etapa,
          });
        }
      }
      // Recarrega SEMPRE, inclusive no erro: a tentativa que falhou também conta no teto
      // diário do Serasa, e o contador da tela precisa refletir isso.
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setConsultando(false);
    }
  };

  // Reenvio manual do aviso de reprovação (só admin). O servidor blinda de novo por papel; aqui
  // é conveniência de UI. Recarrega ao fim pra puxar o novo disparo com o status.
  const reenviar = async (destinatario: "coordenador" | "corretor") => {
    setReenviando(destinatario);
    setAvisoReenvio(null);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch("/api/apolo/serasa/reenviar-reprovacao", {
        body: JSON.stringify({ destinatario, entityId }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const corpo = (await resposta.json()) as {
        data?: { coordenador: EnvioResultado; corretor: EnvioResultado };
        error?: string;
      };
      if (!resposta.ok) {
        setAvisoReenvio(corpo.error ?? `Falha (${resposta.status}).`);
      } else {
        const alvo = corpo.data?.[destinatario];
        if (alvo?.ok) setAvisoReenvio(`Aviso reenviado ao ${destinatario}.`);
        else if (alvo?.pulado) setAvisoReenvio(`O ${destinatario} não tem telefone cadastrado.`);
        else setAvisoReenvio(alvo?.error ?? "Não foi possível reenviar.");
      }
      await carregar();
    } catch (e) {
      setAvisoReenvio((e as Error).message);
    } finally {
      setReenviando(null);
    }
  };

  // Baixa o comprovante da consulta (gera se preciso) ou salva a CAD nos documentos. Abre o PDF
  // numa aba nova; o documento também fica na aba Documentos da ficha.
  const baixarDocumento = async (tipo: "cad" | "comprovante") => {
    setBaixando(tipo);
    setAvisoDoc(null);
    try {
      const token = await getApoloAccessToken();
      const rota = tipo === "comprovante" ? "comprovante" : "salvar-cad";
      const resposta = await fetch(`/api/apolo/board/${entityId}/${rota}`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "POST",
      });
      const corpo = (await resposta.json()) as { data?: { url?: string | null }; error?: string };
      if (!resposta.ok) {
        setAvisoDoc(corpo.error ?? `Falha (${resposta.status}).`);
      } else {
        if (corpo.data?.url) window.open(corpo.data.url, "_blank", "noopener");
        setAvisoDoc(tipo === "cad" ? "CAD aberta." : "Comprovante aberto.");
      }
    } catch (e) {
      setAvisoDoc((e as Error).message);
    } finally {
      setBaixando(null);
    }
  };

  if (carregando) {
    return (
      <div className="mt-4 flex items-center justify-center rounded-xl border border-line bg-surface py-12">
        <Loader2 aria-hidden="true" className="size-5 animate-spin text-ink-muted" />
      </div>
    );
  }

  // Ainda não configurado: dizer O QUE falta é mais útil que um botão morto.
  if (!situacao?.configurado) {
    return (
      <div className="mt-4 rounded-xl border border-line bg-surface p-5">
        <p className="m-0 flex items-center gap-2 text-sm font-bold text-ink">
          <ShieldCheck aria-hidden="true" className="size-4" />
          Integração com o Serasa ainda não configurada
        </p>
        <p className="m-0 mt-2 text-xs text-ink-soft">
          Faltam as respostas do Serasa sobre o endpoint de token, o host de homologação e a
          grafia dos relatórios contratados. Assim que chegarem, basta preencher as variáveis de
          ambiente: nenhuma alteração de código é necessária.
        </p>
        <BancadaTeste
          combinacoes={COMBINACOES}
          resultados={resultados}
          testando={testando}
          testar={testar}
        />

        {situacao?.faltando?.length ? (
          <ul className="m-0 mt-2 list-none p-0 text-[11px] text-ink-muted">
            {situacao.faltando.map((f) => (
              <li key={f}>· {f}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  const ehTeste = situacao.ambiente === "homologacao";
  const anterior = situacao.ultimaConsulta;
  // Botão do cônjuge só para casado/união estável. Sem CPF do cônjuge o botão continua visível
  // de propósito (decisão do Lucas): o operador clica e recebe o aviso dizendo onde preencher,
  // em vez de ficar sem entender por que a opção não existe.
  const temConjuge = Boolean(situacao.conjuge?.temConjuge);

  return (
    <div className="mt-4 grid gap-3">
      {/* O ambiente fica SEMPRE visível: score de homologação não pode ser confundido com real. */}
      <div
        className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs ${
          ehTeste
            ? "border border-amber-300 bg-amber-50/70 text-amber-900 dark:bg-amber-950/25 dark:text-amber-300"
            : "border border-line bg-subtle/40 text-ink-soft"
        }`}
      >
        <b>{ehTeste ? "Ambiente de homologação" : "Produção"}</b>
        {ehTeste ? <span>os resultados são de teste e não valem para decisão</span> : null}
        {situacao.tetoDiario ? (
          <span className="ml-auto">
            {situacao.consultasHoje ?? 0} de {situacao.tetoDiario} consultas hoje
          </span>
        ) : null}
      </div>

      {situacao.avisoAmbiente ? (
        <p className="m-0 flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
          <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
          {situacao.avisoAmbiente}
        </p>
      ) : null}

      {anterior ? (
        <>
          {/* Resultado completo: veredito, score, dados cadastrais e restrições (dívidas vencidas). */}
          <ResultadoCredito
            cru={anterior.resposta}
            resumo={anterior.resumo}
            veredito={anterior.veredito ?? undefined}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
            <p className="m-0 text-xs text-ink-muted">
              {anterior.report_name} · consultado em{" "}
              {new Date(anterior.created_at).toLocaleString("pt-BR")}
              {anterior.ambiente === "homologacao" ? " · homologação" : ""}
            </p>

            <button
              className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-subtle disabled:opacity-60"
              disabled={consultando}
              onClick={() => void consultar(true)}
              type="button"
            >
              {consultando ? (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw aria-hidden="true" className="size-3.5" />
              )}
              Consultar de novo (gera nova cobrança)
            </button>
          </div>

          {/* CRÉDITO DO CÔNJUGE (pedido do Lucas 27/07). Aparece só para casado ou união
              estável. É o caminho de resgate: titular reprovado manda a ficha para revisão, e o
              cônjuge aprovado libera o credenciamento, porque é a renda dele que sustenta a
              compra. Cônjuge reprovado não muda nada, para não derrubar quem tem crédito.
              Sem CPF do cônjuge na ficha, o servidor devolve o aviso dizendo onde preencher. */}
          {temConjuge ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
              <p className="m-0 text-xs text-ink-muted">
                Cliente casado. Dá para consultar o crédito do cônjuge: aprovado, o
                credenciamento segue mesmo com o titular em revisão.
              </p>

              <button
                className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-subtle disabled:opacity-60"
                disabled={consultando}
                onClick={() => void consultar(true, "conjuge")}
                type="button"
              >
                {consultando ? (
                  <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                ) : (
                  <Users aria-hidden="true" className="size-3.5" />
                )}
                Consultar crédito do cônjuge (gera cobrança)
              </button>

              {resultadoConjuge ? (
                <p className="m-0 w-full rounded-lg border border-line bg-subtle px-3 py-2 text-xs font-semibold text-ink">
                  {resultadoConjuge}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Documentos desta ficha: comprovante (com QR) e CAD são salvos AUTOMATICAMENTE na
              consulta, na pasta do cliente. Os botões apenas abrem/baixam o que já foi salvo. */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3">
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-subtle disabled:opacity-60"
              disabled={baixando !== null}
              onClick={() => void baixarDocumento("comprovante")}
              type="button"
            >
              {baixando === "comprovante" ? (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              ) : (
                <FileText aria-hidden="true" className="size-3.5" />
              )}
              Baixar comprovante
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-subtle disabled:opacity-60"
              disabled={baixando !== null}
              onClick={() => void baixarDocumento("cad")}
              type="button"
            >
              {baixando === "cad" ? (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              ) : (
                <FileText aria-hidden="true" className="size-3.5" />
              )}
              Baixar CAD
            </button>
            {avisoDoc ? <span className="text-xs text-ink-muted">{avisoDoc}</span> : null}
          </div>

          {erro ? (
            <p className="m-0 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
              {erro}
            </p>
          ) : null}

          {/* Reprovado: aviso automático ao coordenador (+ corretor se houver telefone), com a
              devolutiva de entrega e o reenvio manual (só admin). O gatilho é a ETAPA persistida
              ("revisao"), não o veredito recomputado — que oscila com limite/C2X e poderia exibir o
              painel (e o reenvio) para um cliente aprovado. */}
          {situacao.etapa === "revisao" ? (
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="m-0 flex items-center gap-2 text-sm font-bold text-ink">
                <Send aria-hidden="true" className="size-4" />
                Aviso de reprovação
              </p>
              <p className="m-0 mt-1 text-xs text-ink-soft">
                O coordenador do empreendimento é avisado automaticamente, com a CAD anexa. O
                corretor recebe também quando tem telefone cadastrado.
              </p>

              {situacao.disparos?.length ? (
                <ul className="m-0 mt-3 grid list-none gap-1.5 p-0">
                  {situacao.disparos.map((d, i) => (
                    <li
                      className="flex flex-wrap items-center gap-2 text-xs"
                      key={`${d.tipo}-${d.created_at}-${i}`}
                    >
                      <StatusEntrega status={d.status} />
                      <span className="font-semibold capitalize text-ink">{d.tipo}</span>
                      {d.destinatario ? (
                        <span className="text-ink-soft">· {d.destinatario}</span>
                      ) : null}
                      {d.origem === "reenvio" ? (
                        <span className="text-ink-muted">· reenvio</span>
                      ) : null}
                      <span className="ml-auto text-ink-muted">
                        {new Date(d.created_at).toLocaleString("pt-BR")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 mt-3 text-xs text-ink-muted">Nenhum aviso enviado ainda.</p>
              )}

              {situacao.ehAdmin ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-subtle disabled:opacity-60"
                    disabled={reenviando !== null}
                    onClick={() => void reenviar("coordenador")}
                    type="button"
                  >
                    {reenviando === "coordenador" ? (
                      <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw aria-hidden="true" className="size-3.5" />
                    )}
                    Reenviar ao coordenador
                  </button>
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-subtle disabled:opacity-60"
                    disabled={reenviando !== null}
                    onClick={() => void reenviar("corretor")}
                    type="button"
                  >
                    {reenviando === "corretor" ? (
                      <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw aria-hidden="true" className="size-3.5" />
                    )}
                    Reenviar ao corretor
                  </button>
                </div>
              ) : null}

              {avisoReenvio ? (
                <p className="m-0 mt-3 rounded-lg border border-line bg-subtle/40 px-3 py-2 text-xs text-ink-soft">
                  {avisoReenvio}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <div className="rounded-xl border border-line bg-surface p-5">
          <p className="m-0 text-sm font-bold text-ink">Nenhuma consulta para esta ficha</p>
          <p className="m-0 mt-1 text-xs text-ink-soft">
            A consulta usa o documento que está no cadastro e fica registrada com o seu usuário,
            para conferência posterior.
          </p>
          <button
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-inverse px-3.5 py-2 text-sm font-bold text-brand-ink disabled:opacity-60"
            disabled={consultando}
            onClick={() => void consultar(false)}
            type="button"
          >
            {consultando ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <CreditCard aria-hidden="true" className="size-4" />
            )}
            {consultando ? "Consultando…" : "Consultar Serasa"}
          </button>

          {erro ? (
            <p className="m-0 mt-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
              {erro}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

// Devolutiva de entrega da Meta, no vocabulário do WhatsApp: um tique = enviado, dois = entregue,
// dois azuis = lido. Falha aparece em vermelho.
function StatusEntrega({ status }: { status: string }) {
  if (status === "lido") {
    return (
      <span className="inline-flex items-center gap-1 text-sky-600" title="Lido">
        <CheckCheck aria-hidden="true" className="size-4" />
        Lido
      </span>
    );
  }
  if (status === "entregue") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600" title="Entregue">
        <CheckCheck aria-hidden="true" className="size-4" />
        Entregue
      </span>
    );
  }
  if (status === "falhou") {
    return (
      <span className="inline-flex items-center gap-1 text-red-600" title="Falhou">
        <AlertTriangle aria-hidden="true" className="size-3.5" />
        Falhou
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-ink-muted" title="Enviado">
      <Check aria-hidden="true" className="size-4" />
      Enviado
    </span>
  );
}

// BANCADA — descobrir por tentativa o que a documentação do Serasa não responde.
//
// UMA chamada por clique, sem retry e sem lote. O risco em homologação não é a tentativa
// consciente (são poucas), é o laço automático: passar de 200 chamadas no dia bloqueia o IP,
// e a liberação exige formalização com eles.
//
// A resposta de SUCESSO não é exibida inteira porque carrega o token; o que interessa é a
// ESTRUTURA (quais campos vieram). Já a de ERRO aparece crua, que é onde está o diagnóstico.
function BancadaTeste({
  combinacoes,
  resultados,
  testando,
  testar,
}: {
  combinacoes: { authUrl: string; clientIdNaQuery: boolean; nome: string }[];
  resultados: {
    camposDaResposta: string[];
    httpStatus: number | null;
    nome: string;
    respostaCrua: string | null;
    sucesso: boolean;
    temToken: boolean;
  }[];
  testando: string | null;
  testar: (c: { authUrl: string; clientIdNaQuery: boolean; nome: string }) => Promise<void>;
}) {
  return (
    <div className="mt-4 rounded-lg border border-line bg-subtle/30 p-3">
      <p className="m-0 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-ink">
        <Wrench aria-hidden="true" className="size-3.5" />
        Bancada de teste da autenticação
      </p>
      <p className="m-0 mt-1 text-xs text-ink-soft">
        A documentação do Serasa publica dois caminhos de token e dois hosts de teste, sem dizer
        qual vale para a nossa credencial. Cada botão faz <b>uma</b> chamada e mostra o que
        voltou. Sem repetição automática: o limite diário deles bloqueia o IP.
      </p>

      <div className="mt-3 grid gap-1.5">
        {combinacoes.map((c) => {
          const feito = resultados.find((r) => r.nome === c.nome);
          return (
            <div className="flex flex-wrap items-center gap-2" key={c.nome}>
              <button
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-subtle disabled:opacity-60"
                disabled={Boolean(testando)}
                onClick={() => void testar(c)}
                type="button"
              >
                {testando === c.nome ? (
                  <Loader2 aria-hidden="true" className="size-3 animate-spin" />
                ) : null}
                {c.nome}
              </button>

              {feito ? (
                <span
                  className={`text-[11px] font-semibold ${
                    feito.sucesso ? "text-emerald-600" : "text-ink-muted"
                  }`}
                >
                  {feito.sucesso ? "✓ autenticou" : "✕"} HTTP {feito.httpStatus ?? "—"}
                  {feito.temToken ? " · token recebido" : ""}
                  {feito.camposDaResposta.length
                    ? ` · campos: ${feito.camposDaResposta.join(", ")}`
                    : ""}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {resultados.some((r) => r.respostaCrua) ? (
        <div className="mt-3 grid gap-2">
          {resultados
            .filter((r) => r.respostaCrua)
            .map((r, i) => (
              <div key={`${r.nome}-${i}`}>
                <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  {r.nome}
                </p>
                <pre className="m-0 max-h-40 overflow-auto rounded bg-canvas p-2 text-[10px] text-ink-soft">
                  {r.respostaCrua}
                </pre>
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}
