"use client";

import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ListChecks,
  Loader2,
  PlugZap,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

import type { ItemLote, ResultadoLote } from "@/lib/apolo/c2x-write-server";
import type { ResultadoEnriquecimento } from "@/lib/apolo/enriquecer-most";
import { getApoloAccessToken } from "../../data/apolo-operations";

// Lote de cadastros Apolo -> C2X. Duas ações: DIAGNOSTICAR (dry-run, só mostra o que sobe e o que
// falta) e ENVIAR PRONTAS (manda ao C2X as que têm todos os campos). O que falta vira a lista de
// trabalho do time — que completa pela edição no CRM e roda o diagnóstico de novo.
type Filtro = "todas" | "pronta" | "faltando" | "conferir" | "enviada" | "erro";

// O motivo de uma ficha ir para conferência vem em duas formas: o NOME DO CAMPO que discorda entre
// a importação e a ficha, ou uma frase pronta (sinal de ficha costurada de duas pessoas). Aqui os
// nomes de campo viram frase, para a linha ler igual nos dois casos.
const MOTIVO_DIVERGENCIA: Record<string, string> = {
  dataNascimento: "data de nascimento diferente da importação",
  nomeMae: "nome da mãe diferente da importação",
};

// Campos que a consulta paga do MOST sabe responder, na chave da ficha.
const CAMPO_MOST: Record<string, string> = {
  dataNascimento: "nascimento",
  nomeMae: "nome da mãe",
  rendaId: "renda",
  sexoId: "sexo",
};

function reais(valor: number): string {
  return valor.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

// O que a sonda de conexão devolve (a chave NUNCA vem na resposta).
type Diagnostico = {
  host: string;
  pronto: boolean;
  resumo: string;
  sondas: {
    ambiente: string;
    caminho: string;
    detalhe: string;
    host: string;
    http: number | null;
    leitura: string;
    nome: string;
  }[];
  temChave: boolean;
};

export function SyncC2xView() {
  const [resultado, setResultado] = useState<ResultadoLote | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  // Sonda da conexão: responde "o host está no ar e a chave é aceita?" sem criar cadastro.
  const [testando, setTestando] = useState(false);
  const [diag, setDiag] = useState<Diagnostico | null>(null);

  // Sonda de OBRIGATÓRIOS: descobre, com a própria API, quais campos ela exige — sem criar
  // ninguém (todas as camadas vão sem `email`, então nenhuma completa o cadastro).
  const [sondando, setSondando] = useState(false);
  const [obrig, setObrig] = useState<{
    aindaPede: string[];
    host: string;
    nenhumCriado: boolean;
    resultados: { camada: string; criou: boolean; http: number | null; ms: number; pediu: string[]; resposta: string }[];
    tempoMedioMs: number;
  } | null>(null);

  // Sonda das UNIDADES: pergunta à API qual é o corpo do POST de enterprise_units, em camadas.
  // Todas vão com um empreendimento inexistente, então nenhuma unidade é criada.
  const [sondandoUnidade, setSondandoUnidade] = useState(false);
  const [unidades, setUnidades] = useState<{
    aindaPede: string[];
    caminho: string;
    host: string;
    nenhumCriado: boolean;
    resultados: { camada: string; criou: boolean; http: number | null; ms: number; pediu: string[]; resposta: string }[];
  } | null>(null);

  async function descobrirCamposDaUnidade() {
    setSondandoUnidade(true);
    setErro(null);
    setUnidades(null);
    try {
      const token = await getApoloAccessToken();
      const resp = await fetch("/api/apolo/c2x-sync/unidades-sonda", {
        body: JSON.stringify({}),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const json = (await resp.json().catch(() => null)) as {
        data?: typeof unidades;
        error?: string;
      } | null;
      if (!resp.ok || !json?.data) setErro(json?.error ?? "Falha ao sondar as unidades.");
      else setUnidades(json.data);
    } catch {
      setErro("Falha ao sondar as unidades.");
    } finally {
      setSondandoUnidade(false);
    }
  }

  async function descobrirObrigatorios() {
    setSondando(true);
    setErro(null);
    setObrig(null);
    try {
      const token = await getApoloAccessToken();
      const resp = await fetch("/api/apolo/c2x-sync/obrigatorios", {
        body: JSON.stringify({ host: "https://sistema.careli.adm.br" }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const json = (await resp.json().catch(() => null)) as {
        data?: typeof obrig;
        error?: string;
      } | null;
      if (!resp.ok || !json?.data) setErro(json?.error ?? "Falha ao sondar os obrigatórios.");
      else setObrig(json.data);
    } catch {
      setErro("Falha ao sondar os obrigatórios.");
    } finally {
      setSondando(false);
    }
  }

  // Completar pelo MOST o que sobrou depois de aproveitar a ficha do operador. Duas etapas de
  // propósito: a consulta é COBRADA por CPF, então primeiro vem a conta (dryRun) e só depois o
  // botão que gasta.
  const [most, setMost] = useState<ResultadoEnriquecimento | null>(null);
  const [consultando, setConsultando] = useState(false);

  async function enriquecer(dryRun: boolean) {
    setConsultando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const resp = await fetch("/api/apolo/c2x-sync/enriquecer", {
        body: JSON.stringify({ dryRun }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const json = (await resp.json().catch(() => null)) as {
        data?: ResultadoEnriquecimento;
        error?: string;
      } | null;
      if (!resp.ok || !json?.data) setErro(json?.error ?? "Falha ao consultar o MOST.");
      else setMost(json.data);
    } catch {
      setErro("Falha ao consultar o MOST.");
    } finally {
      setConsultando(false);
    }
  }

  async function testarConexao() {
    setTestando(true);
    setErro(null);
    setDiag(null);
    try {
      const token = await getApoloAccessToken();
      const resp = await fetch("/api/apolo/c2x-sync/diagnostico", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await resp.json().catch(() => null)) as {
        data?: Diagnostico;
        error?: string;
      } | null;
      if (!resp.ok || !json?.data) setErro(json?.error ?? "Falha ao testar a conexão.");
      else setDiag(json.data);
    } catch {
      setErro("Falha ao testar a conexão.");
    } finally {
      setTestando(false);
    }
  }

  // Quantos cadastros REAIS mandar por rodada. Criar centenas de uma vez não tem desfazer, então o
  // padrão é um lote pequeno: manda, confere no C2X, aumenta.
  const [maxEnvios, setMaxEnvios] = useState(5);

  async function rodar(dryRun: boolean) {
    if (dryRun) setCarregando(true);
    else setEnviando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const resp = await fetch("/api/apolo/c2x-sync/lote", {
        body: JSON.stringify(dryRun ? { dryRun } : { dryRun, maxEnvios }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const json = (await resp.json().catch(() => null)) as {
        data?: ResultadoLote;
        error?: string;
      } | null;
      if (!resp.ok || !json?.data) {
        setErro(json?.error ?? "Falha ao processar o lote.");
      } else {
        setResultado(json.data);
      }
    } catch {
      setErro("Falha ao processar o lote.");
    } finally {
      setCarregando(false);
      setEnviando(false);
    }
  }

  const itens = resultado?.itens ?? [];
  const filtrados =
    filtro === "todas" ? itens : itens.filter((i) => i.status === filtro);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <p className="m-0 text-xs font-semibold uppercase tracking-wide text-[#A07C3B]">
          Integração C2X
        </p>
        <h1 className="m-0 mt-1 text-2xl font-black text-ink">Subir cadastros para o C2X</h1>
        <p className="m-0 mt-2 max-w-2xl text-sm text-ink-muted">
          O diagnóstico mostra quais CADs estão prontas e o que falta nas demais. Complete o que
          falta pela edição no CRM e rode de novo. Depois, envie as prontas ao C2X.
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        {/* TESTAR CONEXÃO: prova o host e a chave SEM criar cadastro (manda corpo vazio; pelo
            contrato, 422 = chave aceita e nada criado; 401 = chave recusada). */}
        <button
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink disabled:opacity-50"
          disabled={testando || carregando || enviando}
          onClick={() => void testarConexao()}
          type="button"
        >
          {testando ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <PlugZap aria-hidden="true" className="size-4" />
          )}
          Testar conexão
        </button>
        {/* Pergunta À API quais campos ela exige, em camadas. Nada é criado: todas as tentativas
            vão sem e-mail, que é obrigatório. */}
        <button
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink disabled:opacity-50"
          disabled={sondando || carregando || enviando || testando}
          onClick={() => void descobrirObrigatorios()}
          type="button"
        >
          {sondando ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <ListChecks aria-hidden="true" className="size-4" />
          )}
          Descobrir campos exigidos
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink disabled:opacity-50"
          disabled={carregando || enviando}
          onClick={() => void rodar(true)}
          type="button"
        >
          {carregando ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <RefreshCw aria-hidden="true" className="size-4" />
          )}
          Diagnosticar
        </button>
        {/* Pergunta À API qual é o corpo do POST de unidades. Manda um empreendimento inexistente
            em todas as camadas, então nenhuma unidade é criada. */}
        <button
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink disabled:opacity-50"
          disabled={sondandoUnidade || carregando || enviando}
          onClick={() => void descobrirCamposDaUnidade()}
          type="button"
        >
          {sondandoUnidade ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Building2 aria-hidden="true" className="size-4" />
          )}
          Descobrir campos das unidades
        </button>
        {/* Levanta quem ainda precisa de consulta paga DEPOIS de aproveitar a ficha. Não gasta:
            devolve a lista e a conta estimada. */}
        <button
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink disabled:opacity-50"
          disabled={consultando || carregando || enviando}
          onClick={() => void enriquecer(true)}
          type="button"
        >
          {consultando ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Sparkles aria-hidden="true" className="size-4" />
          )}
          Ver o que falta no MOST
        </button>
        {/* Quantos mandar nesta rodada. Começa em 5 de propósito: manda, confere no C2X, aumenta. */}
        <label className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-muted">
          Enviar
          <input
            className="w-20 rounded-md border border-line bg-canvas px-2 py-1 text-center text-sm font-semibold text-ink"
            disabled={carregando || enviando}
            max={1000}
            min={1}
            onChange={(e) => setMaxEnvios(Math.max(1, Number(e.target.value) || 1))}
            type="number"
            value={maxEnvios}
          />
          por vez
        </label>
        <button
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          disabled={carregando || enviando || (resultado?.resumo.prontas ?? 0) === 0}
          onClick={() => {
            const prontas = resultado?.resumo.prontas ?? 0;
            const quantos = Math.min(maxEnvios, prontas);
            // O envio cria cadastro de verdade e não tem desfazer. A confirmação diz o DESTINO:
            // em 01/08 oito cadastros foram para o ambiente de teste sem ninguém notar.
            if (
              !window.confirm(
                `Enviar ${quantos} cadastros para ${resultado?.hostDestino ?? "?"}? Isso cria os usuários lá e não tem desfazer.`,
              )
            ) {
              return;
            }
            void rodar(false);
          }}
          type="button"
        >
          {enviando ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Send aria-hidden="true" className="size-4" />
          )}
          Enviar {Math.min(maxEnvios, resultado?.resumo.prontas ?? 0)} de{" "}
          {resultado?.resumo.prontas ?? 0} ao C2X
        </button>
      </div>

      {erro ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {erro}
        </p>
      ) : null}

      {/* Resultado da sonda de OBRIGATÓRIOS: o que a API exige, camada a camada. */}
      {obrig ? (
        <div className="mt-4 rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-ink-muted">
              Campos exigidos em
            </span>
            <code className="rounded bg-black/[0.06] px-2 py-0.5 text-sm font-bold text-ink dark:bg-white/10">
              {obrig.host}
            </code>
            {obrig.nenhumCriado ? (
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                nenhum cadastro criado
              </span>
            ) : (
              <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">
                ⚠️ alguma camada criou registro
              </span>
            )}
            <span className="ml-auto text-xs text-ink-muted">
              tempo médio {obrig.tempoMedioMs} ms
            </span>
          </div>

          {obrig.aindaPede.length ? (
            <p className="m-0 mt-2 text-sm text-ink">
              Mesmo com a ficha completa, a API ainda pede:{" "}
              <b>{obrig.aindaPede.join(", ")}</b>
            </p>
          ) : (
            <p className="m-0 mt-2 text-sm font-semibold text-emerald-700">
              Com os campos da última camada, a API não pede mais nada.
            </p>
          )}

          <ul className="m-0 mt-3 list-none space-y-2 p-0">
            {obrig.resultados.map((r) => (
              <li
                key={r.camada}
                className="rounded-lg border border-line/70 bg-canvas px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-ink">{r.camada}</span>
                  <span className="ml-auto font-mono text-ink-muted">{r.ms} ms</span>
                  <span className="font-mono font-bold text-ink">
                    {r.http ?? "sem resposta"}
                  </span>
                </div>
                <div className="mt-1 text-ink-soft">
                  {r.pediu.length ? (
                    <>
                      pediu: <b>{r.pediu.join(", ")}</b>
                    </>
                  ) : (
                    "não reclamou de nenhum campo"
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Resultado da sonda de conexão. Mostra o HOST (público) e o que cada caminho respondeu —
          nunca a chave. */}
      {diag ? (
        <div className="mt-4 rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-ink-muted">
              Configurado hoje
            </span>
            <code className="rounded bg-black/[0.06] px-2 py-0.5 text-sm font-bold text-ink dark:bg-white/10">
              {diag.host}
            </code>
            {diag.temChave ? null : (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                sem chave configurada
              </span>
            )}
          </div>
          <p className="m-0 mt-2 text-sm font-semibold text-ink">{diag.resumo}</p>
          {diag.sondas.length ? (
            <ul className="m-0 mt-3 list-none space-y-2 p-0">
              {diag.sondas.map((s) => (
                <li
                  key={`${s.host}${s.caminho}`}
                  className="rounded-lg border border-line/70 bg-canvas px-3 py-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-black uppercase ${
                        s.ambiente === "produção"
                          ? "bg-rose-100 text-rose-800"
                          : "bg-sky-100 text-sky-800"
                      }`}
                    >
                      {s.ambiente}
                    </span>
                    <span className="font-bold text-ink">{s.nome}</span>
                    <code className="text-ink-muted">{s.caminho}</code>
                    <span className="ml-auto font-mono font-bold text-ink">
                      {s.http ?? "sem resposta"}
                    </span>
                  </div>
                  <div className="mt-1 text-ink-soft">{s.leitura}</div>
                  {s.detalhe ? (
                    <div className="mt-1 break-all font-mono text-[11px] text-ink-muted">
                      {s.detalhe.slice(0, 200)}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {unidades ? (
        <div className="mt-6 rounded-xl border border-line bg-surface p-4">
          <h2 className="m-0 text-sm font-bold text-ink">
            Corpo do POST de unidades · {unidades.host}
          </h2>
          <p className="m-0 mt-1 text-xs text-ink-muted">
            {unidades.caminho} · todas as tentativas foram com um empreendimento inexistente
            {unidades.nenhumCriado
              ? ", nenhuma unidade foi criada."
              : " — ⚠️ ALGUMA FOI CRIADA, conferir."}
          </p>

          {unidades.aindaPede.length > 0 ? (
            <p className="m-0 mt-3 rounded-lg border border-amber-500 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              Ainda exige: {unidades.aindaPede.join(" · ")}
            </p>
          ) : (
            <p className="m-0 mt-3 text-sm text-emerald-700 dark:text-emerald-400">
              A camada mais completa só reclamou do empreendimento (que é falso de propósito). Os
              nomes dos campos estão certos.
            </p>
          )}

          <ul className="m-0 mt-3 list-none space-y-2 p-0 text-sm">
            {unidades.resultados.map((r) => (
              <li className="rounded-lg bg-black/[0.03] p-2.5 dark:bg-white/[0.04]" key={r.camada}>
                <div className="font-semibold text-ink">
                  {r.camada}{" "}
                  <span className="font-normal text-ink-muted">
                    HTTP {r.http ?? "—"} · {r.ms}ms
                  </span>
                </div>
                {r.pediu.length > 0 ? (
                  <ul className="m-0 mt-1 list-disc pl-5 text-ink-muted">
                    {r.pediu.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-1 break-all font-mono text-xs text-ink-muted">{r.resposta}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {most ? (
        <div className="mt-6 rounded-xl border border-line bg-surface p-4">
          <h2 className="m-0 text-sm font-bold text-ink">
            {most.dryRun ? "O que ainda falta e o MOST sabe responder" : "Resultado da consulta"}
          </h2>

          {most.dryRun ? (
            most.faltantes.length === 0 ? (
              <p className="m-0 mt-2 text-sm text-ink-muted">
                Nada a consultar: o que falta nas fichas restantes o MOST não responde
                (escolaridade e regime de bens são declaratórios).
              </p>
            ) : (
              <>
                <p className="m-0 mt-2 text-sm text-ink-muted">
                  {most.faltantes.length} pessoas, {reais(most.custoEstimado)} no total. A consulta
                  só preenche campo vazio, nunca sobrescreve o que já está na ficha.
                </p>
                <ul className="m-0 mt-3 max-h-56 list-none overflow-auto p-0 text-sm">
                  {most.faltantes.map((f) => (
                    <li className="border-b border-line py-1.5 last:border-0" key={f.entityId}>
                      <span className="font-medium text-ink">{f.nome}</span>{" "}
                      <span className="text-ink-muted">
                        falta {f.campos.map((c) => CAMPO_MOST[c] ?? c).join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                  disabled={consultando}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Consultar ${most.faltantes.length} CPFs no MOST? Custa ${reais(most.custoEstimado)}.`,
                      )
                    ) {
                      return;
                    }
                    void enriquecer(false);
                  }}
                  type="button"
                >
                  {consultando ? (
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <Sparkles aria-hidden="true" className="size-4" />
                  )}
                  Consultar {most.faltantes.length} CPFs ({reais(most.custoEstimado)})
                </button>
              </>
            )
          ) : (
            <>
              <p className="m-0 mt-2 text-sm text-ink-muted">
                {most.resumo.consultados} consultados, {most.resumo.preenchidos} fichas completadas,{" "}
                {most.resumo.comErro} sem resposta. Gasto: {reais(most.custoGasto)}.
              </p>
              <ul className="m-0 mt-3 max-h-56 list-none overflow-auto p-0 text-sm">
                {most.itens.map((i) => (
                  <li className="border-b border-line py-1.5 last:border-0" key={i.entityId}>
                    <span className="font-medium text-ink">{i.nome}</span>{" "}
                    {i.preenchidos.length > 0 ? (
                      <span className="text-emerald-700 dark:text-emerald-400">
                        preencheu {i.preenchidos.map((c) => CAMPO_MOST[c] ?? c).join(", ")}
                      </span>
                    ) : (
                      <span className="text-ink-muted">{i.erro ?? "a base não respondeu"}</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-3 text-xs text-ink-muted">
                Rode o Diagnosticar de novo para ver quantas ficaram prontas.
              </p>
            </>
          )}
        </div>
      ) : null}

      {resultado ? (
        <>
          {/* Para ONDE isto vai. Fica à vista porque o destino invisível foi o que permitiu, em
              01/08, mandar 8 cadastros para o ambiente de teste sem ninguém perceber. */}
          <p
            className={`m-0 mt-6 rounded-lg border px-3 py-2 text-sm ${
              resultado.hostDestino?.startsWith("sistema.")
                ? "border-line text-ink-muted"
                : "border-amber-500 font-semibold text-amber-700 dark:text-amber-400"
            }`}
          >
            Destino dos cadastros: <strong>{resultado.hostDestino ?? "?"}</strong>
            {resultado.hostDestino?.startsWith("sistema.") ? "" : " — este NÃO é o C2X de produção"}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi cor="emerald" label="Prontas" valor={resultado.resumo.prontas} />
            <Kpi cor="amber" label="Faltando campo" valor={resultado.resumo.faltando} />
            <Kpi cor="rose" label="Conferir" valor={resultado.resumo.conferir ?? 0} />
            <Kpi cor="emerald" label="Enviadas" valor={resultado.resumo.enviadas} />
            <Kpi cor="rose" label="Erros" valor={resultado.resumo.erros} />
          </div>

          <div className="mt-6 flex flex-wrap gap-1 rounded-lg bg-black/[0.04] p-1 dark:bg-white/[0.06]">
            {(
              [
                ["todas", `Todas (${itens.length})`],
                ["pronta", `Prontas (${resultado.resumo.prontas})`],
                ["faltando", `Faltando (${resultado.resumo.faltando})`],
                ["conferir", `Conferir (${resultado.resumo.conferir ?? 0})`],
                ["enviada", `Enviadas (${resultado.resumo.enviadas})`],
                ["erro", `Erros (${resultado.resumo.erros})`],
              ] as const
            ).map(([id, rotulo]) => (
              <button
                key={id}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  filtro === id
                    ? "bg-surface text-ink shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
                onClick={() => setFiltro(id)}
                type="button"
              >
                {rotulo}
              </button>
            ))}
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-black/[0.03] text-left dark:bg-white/[0.04]">
                  <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Cliente
                  </th>
                  <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Situação
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtrados.slice(0, 500).map((item) => (
                  <LinhaLote item={item} key={item.entityId} />
                ))}
              </tbody>
            </table>
            {filtrados.length === 0 ? (
              <p className="m-0 py-8 text-center text-sm text-ink-muted">Nada nesta lista.</p>
            ) : null}
          </div>
        </>
      ) : (
        <p className="mt-8 text-center text-sm text-ink-muted">
          Clique em Diagnosticar para ver o estado das CADs.
        </p>
      )}
    </div>
  );
}

function LinhaLote({ item }: { item: ItemLote }) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-4 py-2.5 font-medium text-ink">{item.nome || "—"}</td>
      <td className="px-4 py-2.5">
        {item.status === "pronta" ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 aria-hidden="true" className="size-4" /> Pronta
          </span>
        ) : item.status === "enviada" ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 aria-hidden="true" className="size-4" /> Enviada ao C2X
          </span>
        ) : item.status === "duplicada" ? (
          <span className="text-ink-muted">Já existia no C2X</span>
        ) : item.status === "sem_confirmacao" ? (
          <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
            <AlertTriangle aria-hidden="true" className="size-4" />
            Enviada, mas não achei no C2X — conferir o ambiente
          </span>
        ) : item.status === "erro" ? (
          <span className="inline-flex items-center gap-1.5 text-red-600">
            <AlertTriangle aria-hidden="true" className="size-4" /> {item.erro ?? "Erro"}
          </span>
        ) : item.status === "conferir" ? (
          <span className="inline-flex items-center gap-1.5 text-red-600">
            <AlertTriangle aria-hidden="true" className="size-4" />
            Conferir na CAD:{" "}
            {(item.divergencias ?? [])
              .map((motivo) => MOTIVO_DIVERGENCIA[motivo] ?? motivo)
              .join("; ")}
          </span>
        ) : (
          <span className="text-amber-700 dark:text-amber-400">
            Falta: {item.faltantes.join(", ")}
          </span>
        )}
      </td>
    </tr>
  );
}

const CORES = {
  amber: "text-amber-700 dark:text-amber-400",
  emerald: "text-emerald-700 dark:text-emerald-400",
  rose: "text-red-600",
} as const;

function Kpi({ cor, label, valor }: { cor: keyof typeof CORES; label: string; valor: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className={`text-3xl font-black tabular-nums ${CORES[cor]}`}>{valor}</div>
      <div className="mt-1 text-xs font-semibold text-ink-muted">{label}</div>
    </div>
  );
}
