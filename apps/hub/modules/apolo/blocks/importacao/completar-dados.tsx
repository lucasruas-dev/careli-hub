"use client";

import { AlertTriangle, Check, Loader2, Search, Sparkles, UserCog } from "lucide-react";
import { useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

// COMPLETAR DADOS — releitura do Asana, CUSTO ZERO. Nenhuma consulta à MOST.
//
// Existe porque as CADs importadas antes de 20/jul entraram incompletas por falhas minhas:
//   · profissão, renda, escolaridade e estado civil ficaram vazios nas 275 (a ponte de texto
//     livre para as listas do C2X ficou pronta DEPOIS que a importação rodou);
//   · `chegou_em` nunca foi gravado, então o Board mostrava a hora da importação e a fila
//     inteira aparecia com a mesma data.
//
// Só PREENCHE o que está vazio: o que o operador digitou na validação nunca é sobrescrito.
export function CompletarDados() {
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{
    atualizados: number;
    cads: number;
    datasPreenchidas: number;
    semVinculo: number;
  } | null>(null);
  const [diagnosticando, setDiagnosticando] = useState(false);
  const [diagnostico, setDiagnostico] = useState<{
    analisadas: number;
    resumo: { conferir: number; falta_conjuge: number; ok: number; trocado: number };
  } | null>(null);

  // DIAGNÓSTICO: descobre de quem é cada ficha comparando com o Asana, que é quem sabe dizer
  // proponente x cônjuge. Não altera cadastro nenhum — só grava o laudo para conferência.
  const diagnosticar = async () => {
    setDiagnosticando(true);
    setErro(null);
    setDiagnostico(null);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch("/api/apolo/asana/diagnostico", {
        body: JSON.stringify({
          empreendimento: "Vale do Ouro",
          secoes: ["Finalizado", "Em Cadastro"],
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const corpo = (await resposta.json()) as {
        data?: {
          analisadas: number;
          resumo: { conferir: number; falta_conjuge: number; ok: number; trocado: number };
        };
        error?: string;
      };
      if (!resposta.ok || !corpo.data) throw new Error(corpo.error ?? `Falha (${resposta.status}).`);
      setDiagnostico(corpo.data);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setDiagnosticando(false);
    }
  };

  // CORRIGIR TITULARES — o único caminho aqui que CUSTA: lê o documento do proponente para
  // trazer o CPF dele. Orça primeiro (grátis) e só executa depois de confirmar na tela.
  const [orcamento, setOrcamento] = useState<{
    custoTeto: number;
    documentos: number;
    fichas: number;
    itens: { entityId: string; estaComo: string; proponente: string }[];
  } | null>(null);
  const [corrigindo, setCorrigindo] = useState(false);
  const [correcao, setCorrecao] = useState<{
    corrigidas: number;
    custoBrl: number;
    pendentes: number;
  } | null>(null);

  const orcarCorrecao = async () => {
    setErro(null);
    setCorrecao(null);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch("/api/apolo/asana/corrigir-titular?veredito=trocado", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const corpo = (await resposta.json()) as { data?: typeof orcamento; error?: string };
      if (!resposta.ok || !corpo.data) throw new Error(corpo.error ?? `Falha (${resposta.status}).`);
      setOrcamento(corpo.data);
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  // Roda em lotes de 5, como a leitura de documentos: o gasto vai aparecendo aos poucos em
  // vez de uma chamada longa que pode estourar no meio já tendo pago.
  const corrigir = async () => {
    if (!orcamento) return;
    setCorrigindo(true);
    setErro(null);
    const acumulado = { corrigidas: 0, custoBrl: 0, pendentes: 0 };
    try {
      const token = await getApoloAccessToken();
      const ids = orcamento.itens.map((i) => i.entityId);
      for (let i = 0; i < ids.length; i += 5) {
        const resposta = await fetch("/api/apolo/asana/corrigir-titular", {
          body: JSON.stringify({ confirmado: true, entityIds: ids.slice(i, i + 5) }),
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          method: "POST",
        });
        const corpo = (await resposta.json()) as {
          data?: { corrigidas: number; custoBrl: number; pendentes: number };
          error?: string;
        };
        if (!resposta.ok || !corpo.data) {
          setErro(corpo.error ?? `Falha (${resposta.status}).`);
          break;
        }
        acumulado.corrigidas += corpo.data.corrigidas;
        acumulado.custoBrl += corpo.data.custoBrl;
        acumulado.pendentes += corpo.data.pendentes;
        setCorrecao({ ...acumulado, custoBrl: Number(acumulado.custoBrl.toFixed(2)) });
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCorrigindo(false);
    }
  };

  const rodar = async () => {
    setRodando(true);
    setErro(null);
    setResultado(null);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch("/api/apolo/asana/ficha", {
        body: JSON.stringify({
          empreendimento: "Vale do Ouro",
          secoes: ["Finalizado", "Em Cadastro"],
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const corpo = (await resposta.json()) as {
        data?: {
          atualizados: number;
          cads: number;
          datasPreenchidas: number;
          semVinculo: number;
        };
        error?: string;
      };
      if (!resposta.ok || !corpo.data) {
        throw new Error(corpo.error ?? `Falha (${resposta.status}).`);
      }
      setResultado(corpo.data);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setRodando(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <div className="rounded-xl border border-line bg-surface p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-lg bg-subtle p-2 text-ink-soft">
            <Sparkles size={16} />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-sm font-bold text-ink">
              Completar os dados das CADs já importadas
            </p>
            <p className="m-0 mt-1 text-xs text-ink-soft">
              Relê o formulário do Asana e preenche o que ficou faltando: profissão, renda,
              escolaridade, estado civil e a data de chegada da CAD.
            </p>
            <p className="m-0 mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              Custo zero. Não consulta a MOST e não lê documento.
            </p>
            <p className="m-0 mt-1 text-xs text-ink-muted">
              Só preenche campo vazio — o que o operador já corrigiu na validação fica como está.
            </p>
          </div>
        </div>

        <button
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-inverse px-3.5 py-2 text-sm font-bold text-brand-ink disabled:opacity-60"
          disabled={rodando}
          onClick={() => void rodar()}
          type="button"
        >
          {rodando ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
          {rodando ? "Completando…" : "Completar dados"}
        </button>

        <button
          className="mt-4 ml-2 inline-flex items-center gap-2 rounded-lg border border-line px-3.5 py-2 text-sm font-bold text-ink hover:bg-subtle disabled:opacity-60"
          disabled={diagnosticando}
          onClick={() => void diagnosticar()}
          type="button"
        >
          {diagnosticando ? <Loader2 className="animate-spin" size={15} /> : <Search size={15} />}
          {diagnosticando ? "Analisando…" : "Diagnosticar titulares"}
        </button>

        <button
          className="mt-4 ml-2 inline-flex items-center gap-2 rounded-lg border border-line px-3.5 py-2 text-sm font-bold text-ink hover:bg-subtle"
          onClick={() => void orcarCorrecao()}
          type="button"
        >
          <UserCog size={15} />
          Corrigir titulares…
        </button>

        {erro ? (
          <p className="m-0 mt-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="shrink-0" size={14} />
            {erro}
          </p>
        ) : null}

        {diagnostico ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {[
              ["Fichas corretas", diagnostico.resumo.ok],
              ["Com o cônjuge no lugar", diagnostico.resumo.trocado],
              ["Falta o cônjuge", diagnostico.resumo.falta_conjuge],
              ["Conferir à mão", diagnostico.resumo.conferir],
            ].map(([label, valor]) => (
              <div className="rounded-lg border border-line bg-subtle/40 px-3 py-2" key={label}>
                <p className="m-0 text-lg font-bold text-ink">{valor}</p>
                <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  {label}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {orcamento ? (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50/60 p-3 dark:bg-amber-950/20">
            <p className="m-0 text-xs font-bold text-ink">
              {orcamento.fichas} fichas estao com o conjuge no lugar do titular
            </p>
            <p className="m-0 mt-1 text-xs text-ink-soft">
              Teto de R$ {orcamento.custoTeto.toFixed(2)} ({orcamento.documentos} documentos).
              O real fica bem abaixo: a leitura para no documento do proponente e o que ja foi
              lido nao e cobrado de novo.
            </p>
            <ul className="m-0 mt-2 max-h-40 overflow-y-auto pl-4 text-xs text-ink-soft">
              {orcamento.itens.map((i) => (
                <li key={i.entityId}>
                  <b className="text-ink">{i.proponente}</b> — hoje esta como {i.estaComo}
                </li>
              ))}
            </ul>
            <button
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-inverse px-3 py-1.5 text-xs font-bold text-brand-ink disabled:opacity-60"
              disabled={corrigindo}
              onClick={() => void corrigir()}
              type="button"
            >
              {corrigindo ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
              {corrigindo ? "Corrigindo…" : "Confirmo, pode ler e corrigir"}
            </button>
          </div>
        ) : null}

        {correcao ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              ["Fichas corrigidas", correcao.corrigidas],
              ["Pendentes de conferencia", correcao.pendentes],
              ["Gasto", `R$ ${correcao.custoBrl.toFixed(2)}`],
            ].map(([label, valor]) => (
              <div className="rounded-lg border border-line bg-subtle/40 px-3 py-2" key={label}>
                <p className="m-0 text-lg font-bold text-ink">{valor}</p>
                <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  {label}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {resultado ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {[
              ["CADs lidas", resultado.cads],
              ["Fichas completadas", resultado.atualizados],
              ["Datas preenchidas", resultado.datasPreenchidas],
              ["Sem vínculo", resultado.semVinculo],
            ].map(([label, valor]) => (
              <div className="rounded-lg border border-line bg-subtle/40 px-3 py-2" key={label}>
                <p className="m-0 text-lg font-bold text-ink">{valor}</p>
                <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  {label}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
