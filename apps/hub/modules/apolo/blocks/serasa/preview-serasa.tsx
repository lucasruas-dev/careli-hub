"use client";

import { useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

// Massa de teste que o Serasa liberou (Downloads/Docs_API_PF_PJ.txt, 21/jul). So os CPFs — os
// compradores sao PF. Ficam num seletor para o Lucas nao precisar digitar.
const CPFS_TESTE = [
  "00001223194", "00097152587", "00665923805", "02366396767", "03195325853",
  "08030634404", "09028514899", "11896850510", "14193359875", "26995867815",
  "00001300520", "00132640600", "02028815981", "03610381868", "07454550851",
  "10072107618", "12345678909", "15836149828", "21401325807", "00436094908",
  "01101593814", "02609823002", "04112828594",
];

type Resumo = {
  cobrado?: boolean;
  consultasAnteriores?: number;
  faixa?: string;
  mensagemScore?: string;
  negativacoes?: number;
  nome?: string;
  origemScore?: string;
  protestos?: number;
  score?: number;
  situacao?: string;
};

type Veredito = { aprovado: boolean; limite: number; motivo: string; total: number };
type Resultado = { cru: unknown; reportName: string; resumo: Resumo; tipo: string; veredito: Veredito };

function mascararCpf(v: string): string {
  return v.length === 11 ? `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}` : v;
}

function moeda(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return "—";
  return v.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

// Le as restricoes detalhadas (count + valor) do cru, que o resumo nao carrega.
function restricoes(cru: unknown): Array<{ balance: number; count: number; rotulo: string }> {
  const rep = (cru as { reports?: Array<{ negativeData?: Record<string, { summary?: { balance?: number; count?: number } }> }> })?.reports?.[0];
  const nd = rep?.negativeData ?? {};
  const rotulos: Record<string, string> = {
    check: "Cheques sem fundo",
    collectionRecords: "Dividas vencidas",
    notary: "Protestos (cartorio)",
    pefin: "Pendencias financeiras (Pefin)",
    refin: "Refin",
  };
  return Object.entries(rotulos).map(([chave, rotulo]) => ({
    balance: Number(nd[chave]?.summary?.balance ?? 0),
    count: Number(nd[chave]?.summary?.count ?? 0),
    rotulo,
  }));
}

function dadosCadastrais(cru: unknown): Record<string, string> {
  const reg = (cru as { reports?: Array<{ registration?: Record<string, unknown> }> })?.reports?.[0]?.registration ?? {};
  const t = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "—");
  return {
    Documento: t(reg.documentNumber),
    "Nome": t(reg.consumerName ?? reg.companyName),
    "Nascimento": t(reg.birthDate ?? reg.foundationDate),
    "Sexo": reg.consumerGender === "M" ? "Masculino" : reg.consumerGender === "F" ? "Feminino" : "—",
    "Nome da mae": t(reg.motherName),
    "Situacao": t(reg.statusRegistration),
  };
}

export function PreviewSerasa() {
  const [documento, setDocumento] = useState(CPFS_TESTE[0]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [res, setRes] = useState<Resultado | null>(null);
  const [verCru, setVerCru] = useState(false);
  // Setup (uma vez) dos templates Meta de reprovação de crédito.
  const [criandoTpl, setCriandoTpl] = useState(false);
  const [tplMsg, setTplMsg] = useState("");

  type LinhaTpl = {
    error?: string;
    jaExistia: boolean;
    name: string;
    ok: boolean;
    status: string | null;
  };

  const criarTemplates = async () => {
    setCriandoTpl(true);
    setTplMsg("");
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch("/api/apolo/serasa/setup-template", {
        headers: { Authorization: `Bearer ${token}` },
        method: "POST",
      });
      const json = (await resposta.json()) as {
        data?: { coordenador: LinhaTpl; corretor: LinhaTpl };
        error?: string;
      };
      if (!json.data) {
        setTplMsg(json.error ?? "Falha ao criar os templates.");
        return;
      }
      const linha = (t: LinhaTpl) =>
        t.ok
          ? `✓ ${t.name}: ${t.jaExistia ? "já existia" : `criado (${t.status ?? "PENDING"})`}`
          : `✕ ${t.name}: ${t.error ?? "erro"}`;
      setTplMsg([linha(json.data.coordenador), linha(json.data.corretor)].join("\n"));
    } catch (e) {
      setTplMsg((e as Error).message);
    } finally {
      setCriandoTpl(false);
    }
  };

  // Teste do disparo: manda as duas mensagens (coordenador com CAD anexa + corretor) pro número.
  const [telefoneTeste, setTelefoneTeste] = useState("31983013616");
  const [cpfTeste, setCpfTeste] = useState("");
  const [testando, setTestando] = useState(false);
  const [testeMsg, setTesteMsg] = useState("");

  const testarDisparo = async () => {
    setTestando(true);
    setTesteMsg("");
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch("/api/apolo/serasa/testar-disparo", {
        body: JSON.stringify({ cpf: cpfTeste, telefone: telefoneTeste }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const json = (await resposta.json()) as {
        data?: {
          coordenador: { error?: string; ok: boolean };
          corretor: { error?: string; ok: boolean };
        };
        error?: string;
      };
      if (!json.data) {
        setTesteMsg(json.error ?? "Falha no disparo.");
        return;
      }
      const linha = (nome: string, t: { error?: string; ok: boolean }) =>
        t.ok ? `✓ ${nome} enviado` : `✕ ${nome}: ${t.error ?? "erro"}`;
      setTesteMsg(
        [
          linha("Coordenador (com CAD)", json.data.coordenador),
          linha("Corretor", json.data.corretor),
        ].join("\n"),
      );
    } catch (e) {
      setTesteMsg((e as Error).message);
    } finally {
      setTestando(false);
    }
  };

  const consultar = async () => {
    setCarregando(true);
    setErro("");
    setRes(null);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch("/api/apolo/serasa/preview", {
        body: JSON.stringify({ documento }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const json = (await resposta.json()) as { data?: Resultado; error?: string };
      if (!resposta.ok || !json.data) {
        setErro(json.error ?? "Nao foi possivel consultar.");
        return;
      }
      setRes(json.data);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="m-0 text-xl font-semibold text-ink">Analise de credito — preview</h1>
        <p className="m-0 mt-1 text-sm text-ink-soft">
          Consulta o Serasa (homologacao) com a massa de teste, para validar o que a integracao
          traz. Cada consulta conta no teto diario (150).
        </p>
      </header>

      {/* Setup (uma vez): cria os templates Meta de reprovação de crédito no número 4143. */}
      <div className="mb-4 rounded-xl border border-line bg-surface p-4">
        <p className="m-0 text-sm font-semibold text-ink">Templates Meta da reprovação de crédito</p>
        <p className="m-0 mt-1 text-xs text-ink-soft">
          Cria os dois templates no número 4143: coordenador (com anexo da CAD) e corretor (só
          aviso). Pode clicar mais de uma vez, se já existirem não duplica.
        </p>
        <button
          className="mt-3 rounded-lg bg-inverse px-4 py-2 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:opacity-50"
          disabled={criandoTpl}
          onClick={criarTemplates}
          type="button"
        >
          {criandoTpl ? "Criando..." : "Criar templates de reprovação no Meta"}
        </button>
        {tplMsg ? (
          <pre className="m-0 mt-3 whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3 text-xs text-ink-soft">
            {tplMsg}
          </pre>
        ) : null}
      </div>

      {/* Teste do disparo pro WhatsApp (precisa dos templates JÁ APROVADOS pela Meta). */}
      <div className="mb-4 rounded-xl border border-line bg-surface p-4">
        <p className="m-0 text-sm font-semibold text-ink">Testar disparo pro meu número</p>
        <p className="m-0 mt-1 text-xs text-ink-soft">
          Manda as duas mensagens (coordenador com a CAD anexa e corretor) pro número abaixo. Só
          funciona depois que a Meta aprovar os templates.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-muted">
              WhatsApp (com DDD)
            </span>
            <input
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
              onChange={(e) => setTelefoneTeste(e.target.value)}
              value={telefoneTeste}
            />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-muted">
              CPF do cliente (CAD real, opcional)
            </span>
            <input
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
              onChange={(e) => setCpfTeste(e.target.value)}
              placeholder="vazio = CAD de exemplo"
              value={cpfTeste}
            />
          </label>
          <button
            className="rounded-lg bg-inverse px-4 py-2 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:opacity-50"
            disabled={testando || !telefoneTeste.trim()}
            onClick={testarDisparo}
            type="button"
          >
            {testando ? "Enviando..." : "Testar disparo"}
          </button>
        </div>
        {testeMsg ? (
          <pre className="m-0 mt-3 whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3 text-xs text-ink-soft">
            {testeMsg}
          </pre>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            CPF da massa de teste
          </span>
          <select
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            onChange={(e) => setDocumento(e.target.value)}
            value={documento}
          >
            {CPFS_TESTE.map((cpf) => (
              <option key={cpf} value={cpf}>
                {mascararCpf(cpf)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="rounded-lg bg-inverse px-5 py-2 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:opacity-50"
          disabled={carregando}
          onClick={consultar}
          type="button"
        >
          {carregando ? "Consultando..." : "Consultar"}
        </button>
      </div>

      {erro ? (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          {erro}
        </div>
      ) : null}

      {res ? (
        <div className="mt-6 space-y-4">
          {/* Veredito: aprovado x reprovado (regra do empreendimento) */}
          <div
            className={`flex items-center justify-between rounded-xl border p-5 ${
              res.veredito.aprovado
                ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
                : "border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10"
            }`}
          >
            <div>
              <p className="m-0 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Resultado
              </p>
              <p
                className={`m-0 text-2xl font-bold ${
                  res.veredito.aprovado
                    ? "text-emerald-700 dark:text-emerald-300"
                    : "text-rose-700 dark:text-rose-300"
                }`}
              >
                {res.veredito.aprovado ? "APROVADO" : "REPROVADO"}
              </p>
              <p className="m-0 mt-1 text-xs text-ink-soft">{res.veredito.motivo}</p>
            </div>
          </div>

          {/* Score + situacao em destaque */}
          <div className="flex items-center justify-between rounded-xl border border-line bg-surface p-5">
            <div>
              <p className="m-0 text-xs font-semibold uppercase tracking-wide text-ink-muted">Score</p>
              <p className="m-0 text-4xl font-bold text-ink">
                {res.resumo.score ?? "—"}
                {res.resumo.faixa ? (
                  <span className="ml-2 align-middle text-sm font-medium text-ink-muted">
                    modelo {res.resumo.faixa}
                  </span>
                ) : null}
              </p>
              {res.resumo.mensagemScore ? (
                <p className="m-0 mt-1 text-xs text-ink-muted">{res.resumo.mensagemScore}</p>
              ) : null}
            </div>
            <div className="text-right">
              <p className="m-0 text-xs font-semibold uppercase tracking-wide text-ink-muted">Situacao</p>
              <p className="m-0 text-lg font-semibold text-ink">{res.resumo.situacao ?? "—"}</p>
              <p className="m-0 mt-1 text-xs text-ink-muted">
                {res.resumo.cobrado ? "Consulta cobrada" : "Nao cobrada"}
              </p>
            </div>
          </div>

          {/* Dados cadastrais */}
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="m-0 mb-3 text-sm font-semibold text-ink">Dados cadastrais</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
              {Object.entries(dadosCadastrais(res.cru)).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-ink-muted">{k}</dt>
                  <dd className="m-0 text-sm font-medium text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Restricoes */}
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="m-0 mb-3 text-sm font-semibold text-ink">
              Restricoes — {res.resumo.negativacoes ?? 0} negativacoes, {res.resumo.protestos ?? 0} protestos
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                  <th className="pb-2 font-semibold">Tipo</th>
                  <th className="pb-2 text-center font-semibold">Qtd</th>
                  <th className="pb-2 text-right font-semibold">Valor</th>
                </tr>
              </thead>
              <tbody>
                {restricoes(res.cru).map((r) => (
                  <tr key={r.rotulo} className="border-t border-line">
                    <td className="py-2 text-ink">{r.rotulo}</td>
                    <td className={`py-2 text-center font-semibold ${r.count > 0 ? "text-rose-600 dark:text-rose-300" : "text-ink-muted"}`}>
                      {r.count}
                    </td>
                    <td className="py-2 text-right text-ink">{moeda(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="m-0 mt-3 text-xs text-ink-muted">
              Consultas anteriores nos ultimos meses: {res.resumo.consultasAnteriores ?? 0}
            </p>
          </section>

          {/* Cru */}
          <section className="rounded-xl border border-line bg-surface p-5">
            <button
              className="text-sm font-semibold text-ink-soft hover:text-ink"
              onClick={() => setVerCru((v) => !v)}
              type="button"
            >
              {verCru ? "Ocultar" : "Ver"} retorno cru (relatorio {res.reportName})
            </button>
            {verCru ? (
              <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-subtle p-3 text-xs text-ink-soft">
                {JSON.stringify(res.cru, null, 2)}
              </pre>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
