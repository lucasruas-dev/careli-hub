"use client";

import { AlertTriangle, CreditCard, Loader2, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

// ANÁLISE DE CRÉDITO — consulta ao Serasa Experian.
//
// A consulta é PAGA, então a tela segue a mesma disciplina da leitura de documentos da MOST:
// mostra a situação primeiro (ambiente, consulta anterior, quanto já se consultou hoje) e só
// chama depois de confirmação explícita.
//
// Enquanto a integração não estiver configurada (faltam respostas do Serasa sobre endpoint de
// token, host e nomes dos relatórios), a tela DIZ o que falta em vez de oferecer um botão que
// não funciona.

type Situacao = {
  ambiente?: "homologacao" | "producao";
  avisoAmbiente?: string | null;
  configurado: boolean;
  consultasHoje?: number;
  faltando?: string[];
  tetoDiario?: number | null;
  ultimaConsulta?: {
    ambiente: string;
    created_at: string;
    id: string;
    report_name: string;
    resumo: { faixa?: string; negativacoes?: number; score?: number };
  } | null;
};

export function CreditoSerasa({ entityId }: { entityId: string }) {
  const [situacao, setSituacao] = useState<Situacao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [consultando, setConsultando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

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

  const consultar = async (forcar: boolean) => {
    setConsultando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch("/api/apolo/serasa/consultar", {
        body: JSON.stringify({
          confirmado: true,
          entityId,
          forcar,
          // O relatório sai de variável de ambiente: os nomes exatos ainda estão sendo
          // confirmados com o Serasa, então não ficam cravados na tela.
          reportName: process.env.NEXT_PUBLIC_SERASA_REPORT_PF ?? "RELATORIO_BASICO_PF_PME",
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const corpo = (await resposta.json()) as { data?: unknown; error?: string };
      if (!resposta.ok) setErro(corpo.error ?? `Falha (${resposta.status}).`);
      // Recarrega SEMPRE, inclusive no erro: a tentativa que falhou também conta no teto
      // diário do Serasa, e o contador da tela precisa refletir isso.
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setConsultando(false);
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

      <div className="rounded-xl border border-line bg-surface p-5">
        {anterior ? (
          <>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  Score
                </p>
                <p className="m-0 text-3xl font-bold text-ink">
                  {anterior.resumo?.score ?? "—"}
                </p>
              </div>
              {anterior.resumo?.faixa ? (
                <div>
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                    Faixa
                  </p>
                  <p className="m-0 text-sm font-semibold text-ink">{anterior.resumo.faixa}</p>
                </div>
              ) : null}
              {anterior.resumo?.negativacoes !== undefined ? (
                <div>
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                    Negativações
                  </p>
                  <p className="m-0 text-sm font-semibold text-ink">
                    {anterior.resumo.negativacoes}
                  </p>
                </div>
              ) : null}
            </div>

            <p className="m-0 mt-3 text-xs text-ink-muted">
              {anterior.report_name} · consultado em{" "}
              {new Date(anterior.created_at).toLocaleString("pt-BR")}
              {anterior.ambiente === "homologacao" ? " · homologação" : ""}
            </p>

            <button
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-subtle disabled:opacity-60"
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
          </>
        ) : (
          <>
            <p className="m-0 text-sm font-bold text-ink">Nenhuma consulta para esta ficha</p>
            <p className="m-0 mt-1 text-xs text-ink-soft">
              A consulta usa o documento que está no cadastro e fica registrada com o seu
              usuário, para conferência posterior.
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
          </>
        )}

        {erro ? (
          <p className="m-0 mt-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
            {erro}
          </p>
        ) : null}
      </div>
    </div>
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
