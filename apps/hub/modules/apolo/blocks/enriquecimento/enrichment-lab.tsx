"use client";

import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Coins,
  Copy,
  ListChecks,
  Loader2,
  MailCheck,
  Search,
  ShieldCheck,
  Timer,
  Zap,
} from "lucide-react";

import {
  ABAS,
  CAMPOS,
  type AbaId,
  type CampoSpec,
  type Custo,
  type Persona,
  type Politica,
  IMAGENS_POR_CADASTRO_PADRAO,
  QUERIES,
  calcularCusto,
  formatarCampo,
  pickValue,
  temValor,
} from "@/lib/apolo/enrichment-spec";
import {
  type PlanoId,
  PLANOS,
  PLANO_ATUAL,
  PRECO_CARO,
  RATE_LIMIT_OCR_MENSAL,
  faturaMensal,
  precoDataset,
  reais,
} from "@/lib/apolo/most-precos";
import { getHubSupabaseClient } from "@/lib/supabase/client";

// Laboratorio de enriquecimento: roda as queries do MOST sob demanda, mostra o
// dado real campo a campo e deixa o Lucas decidir o que entra automatico no CAD,
// o que fica sob demanda do operador e o que sai. O custo (recolhido) acompanha
// a decisao em reais e compara a fatura do mes nos tres planos da MOST.

type ProbeDataset = { data: unknown; name: string; status: string };

type ProbeResult = {
  datasets: ProbeDataset[];
  documento: string;
  elapsedMs: number;
  query: string;
  raw?: unknown;
  source: "mock" | "mostqi" | "unavailable";
  warnings: string[];
};

type QueryState = {
  datasets: number;
  elapsedMs: number;
  erro?: string;
  simulado: boolean;
};

const POLITICAS: Array<{ label: string; value: Politica }> = [
  { label: "Automático", value: "auto" },
  { label: "Sob demanda", value: "operador" },
  { label: "Fora", value: "fora" },
];

async function accessToken() {
  const supabase = getHubSupabaseClient();
  const session = await supabase?.auth.getSession();
  return session?.data.session?.access_token ?? "";
}

function soDigitos(value: string) {
  return value.replace(/\D/g, "");
}

// O AuthScore quer DDD + numero (10 a 11 digitos). Se o telefone veio com o
// codigo do pais (+55), tira o 55 pra nao mandar 13 digitos e ser recusado.
function telefoneAuthScore(raw: string) {
  const d = soDigitos(raw);
  return d.length > 11 && d.startsWith("55") ? d.slice(2) : d;
}

type CampoResolvido = {
  // Dataset que de fato entregou o valor (pode diferir do declarado na spec:
  // a CARELI_PF_03, por exemplo, empacota tudo num unico "pf_gold").
  nome?: string;
  valor: unknown;
};

// Procura o valor no dataset declarado. Se ele nao veio, varre os datasets
// recebidos: assim o campo aparece mesmo quando o MOST usa outro nome, e o selo
// "veio de X" revela qual e o nome real.
function resolverCampo(
  campo: CampoSpec,
  dados: Record<string, ProbeDataset>,
): CampoResolvido {
  const declarado = dados[campo.dataset];
  if (declarado) {
    const valor = pickValue(declarado.data, campo.keys);
    if (temValor(valor)) return { nome: campo.dataset, valor };
    return { nome: campo.dataset, valor: undefined };
  }

  for (const dataset of Object.values(dados)) {
    const valor = pickValue(dataset.data, campo.keys);
    if (temValor(valor)) return { nome: dataset.name, valor };
  }

  return { valor: undefined };
}

export function EnrichmentLab() {
  const [persona, setPersona] = useState<Persona>("pf");
  const [documento, setDocumento] = useState("");
  const [aba, setAba] = useState<AbaId>("identificacao");
  const [imagens, setImagens] = useState(IMAGENS_POR_CADASTRO_PADRAO);

  const [dados, setDados] = useState<Record<string, ProbeDataset>>({});
  const [queries, setQueries] = useState<Record<string, QueryState>>({});
  const [rodando, setRodando] = useState<string | null>(null);
  const [rodandoTudo, setRodandoTudo] = useState(false);
  const [tempoTotal, setTempoTotal] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [politicas, setPoliticas] = useState<Record<string, Politica>>({});
  const [emailOk, setEmailOk] = useState<boolean | null>(null);
  const [cepComprovante, setCepComprovante] = useState("");
  const [copiado, setCopiado] = useState(false);
  // Custo e referencia por enquanto: o plano mensal do Lucas esta em revisao
  // com a MOST, entao a decisao aqui e de VALOR OPERACIONAL do campo.
  const [mostrarCusto, setMostrarCusto] = useState(false);
  const [plano, setPlano] = useState<PlanoId>(PLANO_ATUAL);
  const [cadastrosMes, setCadastrosMes] = useState(100);
  // Validacao de contato (AuthScore / CARELI_PF_05): precisa do contato declarado.
  const [contato, setContato] = useState({
    addressLine1: "",
    addressLine2: "",
    cep: "",
    city: "",
    email: "",
    neighborhood: "",
    phone: "",
    state: "",
  });

  const camposPersona = useMemo(
    () => CAMPOS.filter((campo) => campo.persona === persona),
    [persona],
  );
  const queriesPersona = useMemo(
    () => QUERIES.filter((item) => item.persona === persona),
    [persona],
  );
  const custo: Custo = useMemo(
    () => calcularCusto(camposPersona, politicas, persona, imagens, plano),
    [camposPersona, imagens, persona, plano, politicas],
  );

  // Compara a fatura do mes nos tres planos, com a mesma decisao e o mesmo
  // volume. O faturamento minimo entra aqui: abaixo dele, paga-se o minimo.
  const comparacao = useMemo(
    () =>
      PLANOS.map((item) => {
        const c = calcularCusto(camposPersona, politicas, persona, imagens, item.id);
        const consumo = (c.custoAuto + c.custoOcr) * cadastrosMes;
        return { fatura: faturaMensal(consumo, item.id), consumo, plano: item };
      }),
    [cadastrosMes, camposPersona, imagens, persona, politicas],
  );
  const melhorFatura = Math.min(...comparacao.map((item) => item.fatura));

  const politicaDe = useCallback(
    (campo: CampoSpec) => politicas[campo.id] ?? campo.politica,
    [politicas],
  );

  const documentoValido = useCallback(() => {
    const digits = soDigitos(documento);
    const esperado = persona === "pf" ? 11 : 14;
    if (digits.length !== esperado) {
      setErro(
        persona === "pf"
          ? "Digite um CPF com 11 dígitos."
          : "Digite um CNPJ com 14 dígitos.",
      );
      return "";
    }
    return digits;
  }, [documento, persona]);

  // Faz o fetch cru de UMA query e atualiza dados/queries. Nao mexe no estado de
  // "rodando" (quem chama controla), pra permitir rodar varias em paralelo.
  const rodarQuery = useCallback(
    async (digits: string, query: string, params?: Record<string, unknown>) => {
      try {
        const token = await accessToken();
        const response = await fetch("/api/apolo/mostqi", {
          body: JSON.stringify({ action: "probe", documento: digits, params, query }),
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          method: "POST",
        });
        const json = (await response.json().catch(() => null)) as {
          data?: ProbeResult;
          error?: string;
        } | null;
        if (!response.ok || !json?.data) {
          throw new Error(json?.error ?? `HTTP ${response.status}`);
        }
        const probe = json.data;

        setDados((anterior) => {
          const proximo = { ...anterior };
          for (const dataset of probe.datasets) proximo[dataset.name] = dataset;
          return proximo;
        });
        setQueries((anterior) => ({
          ...anterior,
          [query]: {
            datasets: probe.datasets.length,
            elapsedMs: probe.elapsedMs,
            erro: probe.source === "unavailable" ? probe.warnings.join(" · ") : undefined,
            simulado: probe.source === "mock",
          },
        }));
      } catch (error) {
        setQueries((anterior) => ({
          ...anterior,
          [query]: { datasets: 0, elapsedMs: 0, erro: (error as Error).message, simulado: false },
        }));
        throw error;
      }
    },
    [],
  );

  const consultar = useCallback(
    async (query: string, params?: Record<string, unknown>) => {
      const digits = documentoValido();
      if (!digits) return;
      setErro(null);
      setRodando(query);
      try {
        await rodarQuery(digits, query, params);
      } catch (error) {
        setErro((error as Error).message);
      } finally {
        setRodando(null);
      }
    },
    [documentoValido, rodarQuery],
  );

  // Roda tudo de uma vez, em paralelo (as certidoes sozinhas levam ~190s;
  // sequencial somaria). Cronometra o tempo total de parede.
  const rodarTudo = useCallback(async () => {
    const digits = documentoValido();
    if (!digits) return;
    setErro(null);
    setTempoTotal(null);
    setRodandoTudo(true);
    const inicio = performance.now();
    const tick = window.setInterval(
      () => setTempoTotal(performance.now() - inicio),
      100,
    );

    // Queries normais (por CPF) + a validacao de contato SE houver dado declarado.
    const alvos = queriesPersona
      .filter((item) => !item.contato)
      .map((item) => ({ params: undefined as Record<string, unknown> | undefined, query: item.query }));
    if (contato.phone || contato.email || contato.cep) {
      alvos.push({
        params: {
          addressLine1: contato.addressLine1,
          addressLine2: contato.addressLine2,
          cep: soDigitos(contato.cep),
          city: contato.city,
          email: contato.email,
          modelCode: "scorealgorithmimpl",
          neighborhood: contato.neighborhood,
          phone: telefoneAuthScore(contato.phone),
          state: contato.state,
        },
        query: "CARELI_PF_05",
      });
    }

    try {
      await Promise.allSettled(
        alvos.map((alvo) => rodarQuery(digits, alvo.query, alvo.params)),
      );
    } finally {
      window.clearInterval(tick);
      setTempoTotal(performance.now() - inicio);
      setRodandoTudo(false);
    }
  }, [contato, documentoValido, queriesPersona, rodarQuery]);

  // AuthScore (CARELI_PF_05): valida o contato declarado. modelCode e fixo.
  const validarContato = useCallback(() => {
    if (!contato.phone && !contato.email && !contato.cep) {
      setErro("Preencha ao menos telefone, e-mail ou CEP para validar.");
      return;
    }
    void consultar("CARELI_PF_05", {
      addressLine1: contato.addressLine1,
      addressLine2: contato.addressLine2,
      cep: soDigitos(contato.cep),
      city: contato.city,
      email: contato.email,
      modelCode: "scorealgorithmimpl",
      neighborhood: contato.neighborhood,
      phone: telefoneAuthScore(contato.phone),
      state: contato.state,
    });
  }, [consultar, contato]);

  const copiarDecisoes = useCallback(async () => {
    const linhas: string[] = [
      `DECISÃO DE ENRIQUECIMENTO · ${persona === "pf" ? "PESSOA FÍSICA" : "PESSOA JURÍDICA"}`,
      `Plano: ${PLANOS.find((item) => item.id === plano)?.label ?? plano}`,
      `Custo por cadastro: ${reais(custo.custoAuto + custo.custoOcr)} (enriquecimento ${reais(custo.custoAuto)} + leitura de ${imagens} imagens ${reais(custo.custoOcr)})`,
      `Se o operador acionar tudo sob demanda: + ${reais(custo.custoOperador)}`,
      "",
    ];
    for (const politica of POLITICAS) {
      const hits = camposPersona.filter((campo) => politicaDe(campo) === politica.value);
      if (!hits.length) continue;
      linhas.push(`${politica.label.toUpperCase()} (${hits.length})`);
      for (const campo of hits) {
        const preco = precoDataset(persona, campo.dataset, plano);
        linhas.push(
          `  - ${campo.label} [${campo.dataset}${preco ? ` · ${preco.codigo} · ${reais(preco.preco)}` : " · sem preço na proposta"}]${campo.novo ? " (NOVO, pedir ao MOST)" : ""}`,
        );
      }
      linhas.push("");
    }
    if (custo.novosPendentes.length) {
      linhas.push(`DATASETS A PEDIR AO MOST: ${custo.novosPendentes.join(", ")}`);
    }
    try {
      await navigator.clipboard.writeText(linhas.join("\n").trim());
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErro("Não consegui copiar. Copie manualmente.");
    }
  }, [camposPersona, custo, imagens, persona, plano, politicaDe]);

  const camposDaAba = camposPersona.filter((campo) => campo.aba === aba);
  const algumaConsulta = Object.keys(queries).length > 0;

  return (
    <section className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 overflow-y-auto pb-16">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#A07C3B]">
            Apolo · Laboratório
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">
            Enriquecimento · o que vale a pena trazer
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            Rode a consulta, olhe o dado real e decida campo a campo o que serve
            pra operação: entra automático no cadastro, fica sob demanda pro
            operador, ou sai. Nada é gravado.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-surface p-1">
          {(["pf", "pj"] as Persona[]).map((item) => (
            <button
              className={[
                "rounded-md px-4 py-1.5 text-sm font-semibold transition-colors",
                persona === item
                  ? "bg-inverse text-brand-ink"
                  : "text-ink-muted hover:text-ink",
              ].join(" ")}
              key={item}
              onClick={() => {
                setPersona(item);
                setAba("identificacao");
              }}
              type="button"
            >
              {item === "pf" ? "Pessoa física" : "Pessoa jurídica"}
            </button>
          ))}
        </div>
      </header>

      {/* Consulta */}
      <div className="rounded-xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Search className="size-4 text-[#A07C3B]" aria-hidden="true" />
          Consulta
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          Cada botão dispara uma query e é cobrado por dataset. Rode só o que
          precisa: a tela acumula os resultados.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            className="h-9 w-52 rounded-lg border border-line px-3 text-sm outline-none focus:border-[#A07C3B]/40"
            inputMode="numeric"
            onChange={(event) => setDocumento(event.target.value)}
            placeholder={persona === "pf" ? "CPF (só números)" : "CNPJ (só números)"}
            value={documento}
          />
          {queriesPersona
            .filter((item) => !item.contato)
            .map((item) => {
            const estado = queries[item.query];
            const rodandoEsta = rodando === item.query || rodandoTudo;
            return (
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-inverse px-3 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse disabled:opacity-50"
                disabled={rodando !== null || rodandoTudo}
                key={item.query}
                onClick={() => void consultar(item.query)}
                title={item.descricao}
                type="button"
              >
                {rodandoEsta && !estado ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : estado && !estado.erro ? (
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                ) : null}
                {item.label}
                {estado && !estado.erro ? (
                  <span className="font-mono text-[11px] opacity-70">
                    {estado.datasets}
                  </span>
                ) : null}
              </button>
            );
          })}

          <button
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#A07C3B] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:opacity-50"
            disabled={rodando !== null || rodandoTudo}
            onClick={() => void rodarTudo()}
            title="Dispara todas as consultas em paralelo e cronometra o total"
            type="button"
          >
            {rodandoTudo ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Zap className="size-4" aria-hidden="true" />
            )}
            Rodar tudo
          </button>

          {tempoTotal !== null ? (
            <span
              className={[
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold tabular-nums",
                rodandoTudo
                  ? "border-[#A07C3B]/40 bg-[#A07C3B]/5 text-[#A07C3B]"
                  : "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
              ].join(" ")}
            >
              <Timer className="size-4" aria-hidden="true" />
              {(tempoTotal / 1000).toFixed(1)}s
              {rodandoTudo ? "" : " · total"}
            </span>
          ) : null}
        </div>

        {erro ? (
          <p className="mt-3 flex items-center gap-2 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/12 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            {erro}
          </p>
        ) : null}

        {Object.keys(dados).length ? (
          <div className="mt-3 rounded-lg border border-line bg-subtle px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              Datasets recebidos ({Object.keys(dados).length})
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {Object.values(dados).map((dataset) => (
                <span
                  className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-soft"
                  key={dataset.name}
                  title={`status ${dataset.status}`}
                >
                  {dataset.name}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {algumaConsulta ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(queries).map(([query, estado]) => (
              <span
                className={[
                  "inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium",
                  estado.erro
                    ? "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300"
                    : estado.simulado
                      ? "bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300"
                      : "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
                ].join(" ")}
                key={query}
              >
                <span className="font-mono">{query}</span>
                {estado.erro ? (
                  estado.erro.slice(0, 70)
                ) : (
                  <>
                    {estado.datasets} datasets · {(estado.elapsedMs / 1000).toFixed(1)}s
                    {estado.simulado ? " · simulado" : ""}
                  </>
                )}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Validacao de contato (AuthScore / CARELI_PF_05) */}
      {queriesPersona.some((item) => item.contato) ? (
        <details className="rounded-xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink">
            <ShieldCheck className="size-4 text-[#A07C3B]" aria-hidden="true" />
            Validação de contato (AuthScore)
          </summary>
          <p className="mt-2 text-xs text-ink-muted">
            Diferente das outras: o AuthScore recebe o que a pessoa declarou e
            responde se confere com a base. É a etapa do fim do cadastro. Preencha
            e rode; alimenta as respostas de telefone, e-mail e endereço nas abas.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <ContatoInput
              label="Telefone (DDD + número)"
              onChange={(value) => setContato((c) => ({ ...c, phone: value }))}
              placeholder="31991234567"
              value={contato.phone}
            />
            <ContatoInput
              label="E-mail"
              onChange={(value) => setContato((c) => ({ ...c, email: value }))}
              placeholder="cliente@exemplo.com"
              value={contato.email}
            />
            <ContatoInput
              label="CEP"
              onChange={(value) => setContato((c) => ({ ...c, cep: value }))}
              placeholder="30110001"
              value={contato.cep}
            />
            <ContatoInput
              label="Logradouro"
              onChange={(value) => setContato((c) => ({ ...c, addressLine1: value }))}
              placeholder="Rua das Flores"
              value={contato.addressLine1}
            />
            <ContatoInput
              label="Número e complemento"
              onChange={(value) => setContato((c) => ({ ...c, addressLine2: value }))}
              placeholder="100, apto 302"
              value={contato.addressLine2}
            />
            <ContatoInput
              label="Bairro"
              onChange={(value) => setContato((c) => ({ ...c, neighborhood: value }))}
              placeholder="Centro"
              value={contato.neighborhood}
            />
            <ContatoInput
              label="Cidade"
              onChange={(value) => setContato((c) => ({ ...c, city: value }))}
              placeholder="Belo Horizonte"
              value={contato.city}
            />
            <ContatoInput
              label="UF"
              onChange={(value) => setContato((c) => ({ ...c, state: value }))}
              placeholder="MG"
              value={contato.state}
            />
          </div>
          <button
            className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink hover:bg-inverse disabled:opacity-50"
            disabled={rodando !== null || rodandoTudo}
            onClick={validarContato}
            type="button"
          >
            {rodando === "CARELI_PF_05" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="size-4" aria-hidden="true" />
            )}
            Validar (CARELI_PF_05)
          </button>
        </details>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Abas + campos */}
        <div className="min-w-0">
          <nav className="flex flex-wrap gap-1 border-b border-line pb-2">
            {ABAS.filter((item) =>
              camposPersona.some((campo) => campo.aba === item.id),
            ).map((item) => {
              const total = camposPersona.filter((campo) => campo.aba === item.id).length;
              return (
                <button
                  className={[
                    "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    aba === item.id
                      ? "bg-inverse text-brand-ink"
                      : "text-ink-muted hover:bg-subtle hover:text-ink",
                  ].join(" ")}
                  key={item.id}
                  onClick={() => setAba(item.id)}
                  type="button"
                >
                  {item.label}
                  <span className="ml-1.5 font-mono text-[10px] opacity-60">{total}</span>
                </button>
              );
            })}
          </nav>

          {aba === "endereco" ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-subtle px-3 py-2">
              <span className="text-xs font-semibold text-ink-soft">
                CEP do comprovante
              </span>
              <input
                className="h-8 w-36 rounded-md border border-line px-2 font-mono text-xs outline-none focus:border-[#A07C3B]/40"
                inputMode="numeric"
                onChange={(event) => setCepComprovante(event.target.value)}
                placeholder="30110001"
                value={cepComprovante}
              />
              <span className="text-[11px] text-ink-muted">
                Comparamos com a base. Se divergir, seguimos com o comprovante e
                só registramos a divergência.
              </span>
            </div>
          ) : null}

          <div className="mt-3 flex flex-col gap-2">
            {camposDaAba.map((campo) => (
              <CampoRow
                campo={campo}
                cepComprovante={soDigitos(cepComprovante)}
                emailOk={emailOk}
                key={campo.id}
                mostrarCusto={mostrarCusto}
                onEmailOk={setEmailOk}
                plano={plano}
                onPolitica={(value) =>
                  setPoliticas((anterior) => ({ ...anterior, [campo.id]: value }))
                }
                politica={politicaDe(campo)}
                queryRodada={Boolean(queries[campo.query])}
                resolvido={resolverCampo(campo, dados)}
              />
            ))}
          </div>
        </div>

        {/* Decisao + custo (referencia) */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-2 lg:self-start">
          <div className="rounded-xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ListChecks className="size-4 text-[#A07C3B]" aria-hidden="true" />
              O mundo ideal
            </div>
            <p className="mt-1 text-[11px] text-ink-muted">
              O que a operação precisa, sem pensar em preço ainda.
            </p>

            <div className="mt-4 grid gap-2">
              {POLITICAS.map((item) => {
                const total = camposPersona.filter(
                  (campo) => politicaDe(campo) === item.value,
                ).length;
                return (
                  <div
                    className="flex items-center justify-between gap-2 rounded-lg border border-line bg-subtle px-3 py-2"
                    key={item.value}
                  >
                    <span className="text-xs font-medium text-ink-soft">
                      {item.value === "auto"
                        ? "Automático no cadastro"
                        : item.value === "operador"
                          ? "Sob demanda do operador"
                          : "Não serve"}
                    </span>
                    <span
                      className={[
                        "text-lg font-semibold tabular-nums",
                        item.value === "auto"
                          ? "text-emerald-700 dark:text-emerald-300"
                          : item.value === "operador"
                            ? "text-amber-700 dark:text-amber-300"
                            : "text-ink-muted",
                      ].join(" ")}
                    >
                      {total}
                    </span>
                  </div>
                );
              })}
            </div>

            {custo.novosPendentes.length ? (
              <div className="mt-4 rounded-lg border border-[#A07C3B]/30 bg-[#A07C3B]/[0.05] p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#A07C3B]">
                  Pedir ao MOST ({custo.novosPendentes.length})
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-ink-muted">
                  Datasets que você marcou mas que nenhuma query CARELI entrega
                  hoje. Sem eles em produção, o dado não aparece.
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {custo.novosPendentes.map((dataset) => (
                    <span
                      className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-soft"
                      key={dataset}
                    >
                      {dataset}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <button
              className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#A07C3B] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35]"
              onClick={() => void copiarDecisoes()}
              type="button"
            >
              {copiado ? (
                <ClipboardCheck className="size-4" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
              {copiado ? "Copiado" : "Copiar decisões"}
            </button>
          </div>

          <div className="rounded-xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <button
              className="flex w-full items-center justify-between gap-2 text-sm font-semibold text-ink"
              onClick={() => setMostrarCusto((valor) => !valor)}
              type="button"
            >
              <span className="flex items-center gap-2">
                <Coins className="size-4 text-[#A07C3B]" aria-hidden="true" />
                Custo (referência)
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`size-4 text-ink-muted transition-transform ${mostrarCusto ? "rotate-180" : ""}`}
              />
            </button>

            {!mostrarCusto ? (
              <p className="mt-1 text-[11px] text-ink-muted">
                Deixado de lado por enquanto. Desenhe o ideal primeiro.
              </p>
            ) : null}

            <div className={mostrarCusto ? "" : "hidden"}>
            <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              Plano contratado
            </label>
            <select
              className="mt-1 h-9 w-full rounded-lg border border-line bg-surface px-2 text-sm outline-none focus:border-[#A07C3B]/40"
              onChange={(event) => setPlano(event.target.value as PlanoId)}
              value={plano}
            >
              {PLANOS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.id === PLANO_ATUAL ? " (atual)" : ""}
                </option>
              ))}
            </select>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  Imagens lidas
                </label>
                <input
                  className="mt-1 h-9 w-full rounded-lg border border-line px-2 font-mono text-sm outline-none focus:border-[#A07C3B]/40"
                  inputMode="numeric"
                  onChange={(event) => setImagens(Number(soDigitos(event.target.value)) || 0)}
                  value={imagens}
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  Cadastros por mês
                </label>
                <input
                  className="mt-1 h-9 w-full rounded-lg border border-line px-2 font-mono text-sm outline-none focus:border-[#A07C3B]/40"
                  inputMode="numeric"
                  onChange={(event) => setCadastrosMes(Number(soDigitos(event.target.value)) || 0)}
                  value={cadastrosMes}
                />
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              <Metrica
                destaque
                label="Cada cadastro custa"
                sub={`${reais(custo.custoAuto)} de dados + ${reais(custo.custoOcr)} de leitura`}
                valor={reais(custo.custoAuto + custo.custoOcr)}
              />
              <Metrica
                label="Sob demanda, se pedir tudo"
                sub={`${custo.datasetsOperador.length} datasets, só quando o operador clicar`}
                valor={reais(custo.custoOperador)}
              />
            </div>

            <div className="mt-4">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                A fatura do mês, em cada plano
              </div>
              <div className="mt-1.5 flex flex-col gap-1">
                {comparacao.map((item) => {
                  const vencedor = item.fatura === melhorFatura;
                  const noPiso = item.fatura > item.consumo;
                  return (
                    <div
                      className={[
                        "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5",
                        vencedor
                          ? "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/12"
                          : "border-line bg-subtle",
                      ].join(" ")}
                      key={item.plano.id}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] font-medium text-ink">
                          {item.plano.label}
                        </span>
                        {noPiso ? (
                          <span className="block text-[9px] text-amber-600 dark:text-amber-300">
                            consumo {reais(item.consumo)}, paga o mínimo
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={[
                          "shrink-0 text-sm font-semibold tabular-nums",
                          vencedor ? "text-emerald-700 dark:text-emerald-300" : "text-ink-muted",
                        ].join(" ")}
                      >
                        {reais(item.fatura)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-ink-muted">
                O que sobra abaixo do faturamento mínimo não acumula pro mês
                seguinte. O desconto do enriquecimento é pequeno (9% e 17%), mas
                a leitura de documentos e a IA generativa caem de 32% a 68%.
              </p>
            </div>

            {custo.datasetsAuto.length ? (
              <div className="mt-4">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  Onde o dinheiro vai
                </div>
                <div className="mt-1.5 flex flex-col gap-1">
                  {custo.datasetsAuto.slice(0, 5).map((linha) => (
                    <div
                      className="flex items-center justify-between gap-2 text-[11px]"
                      key={linha.dataset}
                    >
                      <span className="truncate font-mono text-ink-muted" title={linha.codigo}>
                        {linha.dataset}
                      </span>
                      <span
                        className={[
                          "shrink-0 tabular-nums",
                          linha.preco >= PRECO_CARO
                            ? "font-semibold text-rose-600 dark:text-rose-300"
                            : "text-ink-muted",
                        ].join(" ")}
                      >
                        {reais(linha.preco)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {custo.semPreco.length ? (
              <p className="mt-3 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/12 px-2.5 py-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                Sem preço na proposta: {custo.semPreco.join(", ")}. Pedir cotação
                antes de ligar.
              </p>
            ) : null}

            <p className="mt-3 text-[10px] leading-relaxed text-ink-muted">
              O limite de {RATE_LIMIT_OCR_MENSAL.toLocaleString("pt-BR")} do
              contrato é um teto mensal de páginas lidas pelo OCR, ajustável por
              e-mail. Não se aplica ao enriquecimento.
            </p>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

function ContatoInput({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      <input
        className="mt-1 h-9 w-full rounded-lg border border-line px-2 text-sm outline-none focus:border-[#A07C3B]/40"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function Metrica({
  destaque = false,
  label,
  sub,
  valor,
}: {
  destaque?: boolean;
  label: string;
  sub: string;
  valor: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-subtle px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <div
        className={[
          "mt-0.5 font-semibold tabular-nums",
          destaque ? "text-2xl text-[#A07C3B]" : "text-lg text-ink",
        ].join(" ")}
      >
        {valor}
      </div>
      <div className="text-[10px] text-ink-muted">{sub}</div>
    </div>
  );
}

function CampoRow({
  campo,
  cepComprovante,
  emailOk,
  mostrarCusto,
  onEmailOk,
  onPolitica,
  plano,
  politica,
  queryRodada,
  resolvido,
}: {
  campo: CampoSpec;
  cepComprovante: string;
  emailOk: boolean | null;
  mostrarCusto: boolean;
  onEmailOk: (value: boolean) => void;
  onPolitica: (value: Politica) => void;
  plano: PlanoId;
  politica: Politica;
  queryRodada: boolean;
  resolvido: CampoResolvido;
}) {
  const bruto = resolvido.valor;
  const linhas = formatarCampo(campo, bruto);
  const veio = temValor(bruto);
  const outroDataset = resolvido.nome && resolvido.nome !== campo.dataset;
  const preco = precoDataset(campo.persona, campo.dataset, plano);

  return (
    <div
      className={[
        "grid grid-cols-1 gap-3 rounded-xl border bg-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:grid-cols-[minmax(0,1fr)_auto]",
        politica === "fora" ? "border-line opacity-55" : "border-line",
      ].join(" ")}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink">{campo.label}</span>
          <code className="rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
            {campo.dataset}
          </code>
          {campo.novo ? (
            <span className="rounded-full bg-[#A07C3B]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#A07C3B]">
              novo
            </span>
          ) : (
            <span className="rounded-full bg-emerald-50 dark:bg-emerald-500/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              {campo.query.replace("CARELI_", "")}
            </span>
          )}
          {mostrarCusto && preco ? (
            <span
              className={[
                "rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums",
                preco.preco >= PRECO_CARO
                  ? "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300"
                  : "bg-subtle text-ink-muted",
              ].join(" ")}
              title={preco.codigo}
            >
              {reais(preco.preco)}
            </span>
          ) : null}
          {campo.origem === "bestinfo" ? (
            <span className="rounded-full bg-sky-50 dark:bg-sky-500/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
              best info
            </span>
          ) : null}
          {outroDataset ? (
            <span className="rounded-full bg-amber-50 dark:bg-amber-500/12 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              veio de {resolvido.nome}
            </span>
          ) : null}
        </div>

        {campo.nota ? (
          <p className="mt-1 text-[11px] text-ink-muted">{campo.nota}</p>
        ) : null}

        <div className="mt-2">
          {!queryRodada && !veio ? (
            <p className="text-xs text-ink-muted">
              {campo.query === "CARELI_PF_05" ? (
                "Ainda não validado. Preencha e rode a Validação de contato."
              ) : (
                <>
                  Ainda não consultado. Rode a query{" "}
                  <span className="font-mono">{campo.query}</span>.
                </>
              )}
            </p>
          ) : !veio ? (
            <p className="text-xs text-amber-600 dark:text-amber-300">
              A consulta rodou, mas este campo voltou vazio.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {linhas.map((linha, index) => (
                <li
                  className="break-words text-sm text-ink"
                  key={`${campo.id}-${index}`}
                >
                  {campo.id === "enderecos" || campo.id === "pjEnderecos" ? (
                    <EnderecoLinha cep={cepComprovante} linha={linha} />
                  ) : (
                    linha
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {campo.id === "emailSugerido" && veio ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              className={[
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                emailOk === true
                  ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                  : "border-line text-ink-soft hover:bg-subtle",
              ].join(" ")}
              onClick={() => onEmailOk(true)}
              type="button"
            >
              <MailCheck className="size-3.5" aria-hidden="true" />
              E-mail correto
            </button>
            <button
              className={[
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                emailOk === false
                  ? "border-amber-300 bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300"
                  : "border-line text-ink-soft hover:bg-subtle",
              ].join(" ")}
              onClick={() => onEmailOk(false)}
              type="button"
            >
              Corrigir no cadastro
            </button>
            {emailOk !== null ? (
              <span className="text-[11px] text-ink-muted">
                {emailOk
                  ? "Vai pro CAD com a tag confirmado."
                  : "O operador digita o e-mail certo; o sugerido fica como alternativa."}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex h-fit shrink-0 overflow-hidden rounded-lg border border-line">
        {POLITICAS.map((item) => (
          <button
            className={[
              "border-r border-line px-3 py-1.5 text-[11px] font-semibold transition-colors last:border-r-0",
              politica === item.value
                ? item.value === "auto"
                  ? "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                  : item.value === "operador"
                    ? "bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300"
                    : "bg-subtle text-ink-muted"
                : "text-ink-muted hover:bg-subtle",
            ].join(" ")}
            key={item.value}
            onClick={() => onPolitica(item.value)}
            type="button"
          >
            {politica === item.value && item.value !== "fora" ? (
              <Check className="mr-1 inline size-3" aria-hidden="true" />
            ) : null}
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Marca se o endereco da base bate com o CEP do comprovante. O comprovante e a
// verdade: a divergencia so e registrada.
function EnderecoLinha({ cep, linha }: { cep: string; linha: string }) {
  if (!cep) return <>{linha}</>;
  const cepsNaLinha = linha.replace(/\D/g, "");
  const confere = cepsNaLinha.includes(cep);
  return (
    <span className="flex flex-wrap items-center gap-2">
      {linha}
      <span
        className={[
          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          confere ? "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300",
        ].join(" ")}
      >
        {confere ? "confere" : "diverge"}
      </span>
    </span>
  );
}
