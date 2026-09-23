"use client";

import { AlertTriangle, Download, Loader2, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { LinhaDaDefasagem, ResumoDaDefasagem } from "@/lib/apolo/reajuste/defasagem";

// PARCELAS A CORRIGIR — a carteira que ficou para trás.
//
// Nasceu de uma medição feita para outro pedido. O Lucas (23/09/2026) pediu um relatório de
// projeção de reajuste para o cliente; ao medir o terreno apareceu isto, que vem antes: **o valor
// contratual da parcela nunca é atualizado no C2X**. Só a parcela que RECEBE BOLETO é corrigida.
// Resultado medido em 23/09/2026: 527 de 870 contratos (60%) têm parcela futura no valor de anos
// atrás, mediana de 22,63%, somando R$ 50.762,05 por mês que a carteira deixa de cobrar.
//
// ⚠️ ESTA TELA NÃO CORRIGE NADA, e é de propósito. O legado é READ-ONLY daqui, e corrigir parcela
// é decisão de negócio (tem cliente do outro lado). Ela MOSTRA onde está o dinheiro parado; quem
// aplica é a operação, pela tela do C2X.
//
// ⚠️ NÃO COLOQUE POLLING NISTO. A leitura varre 118.033 parcelas do legado (868 ms medido). É tela
// que se abre para trabalhar, não painel que fica aberto atualizando — e o custo de polling em
// leitura já derrubou fatura nesta casa.

type Payload = {
  linhas: LinhaDaDefasagem[];
  parcial: boolean;
  resumo: ResumoDaDefasagem;
};

const PAGINA = 50;

function reais(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  });
}

function pct(valor: number): string {
  return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
}

export function PainelDefasagem() {
  const [dados, setDados] = useState<null | Payload>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);
  const [busca, setBusca] = useState("");
  const [empreendimento, setEmpreendimento] = useState("");
  const [visiveis, setVisiveis] = useState(PAGINA);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resposta = await fetch("/api/apolo/defasagem", { cache: "no-store" });
      const corpo = (await resposta.json().catch(() => null)) as
        | { data?: Payload; error?: string }
        | null;
      if (!resposta.ok || !corpo?.data) {
        setErro(corpo?.error ?? "Não consegui carregar a carteira.");
        return;
      }
      setDados(corpo.data);
    } catch {
      setErro("Não consegui carregar a carteira.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const empreendimentos = useMemo(
    () => [...new Set((dados?.linhas ?? []).map((l) => l.code))].filter(Boolean).sort(),
    [dados],
  );

  // Só os defasados entram na lista: quem está em dia não é trabalho.
  const linhas = useMemo(() => {
    const todas = (dados?.linhas ?? []).filter(
      (l) => l.defasagem.apurada && l.defasagem.percentual > 0,
    );
    const termo = busca.trim().toLowerCase();
    return todas.filter((l) => {
      if (empreendimento && l.code !== empreendimento) return false;
      if (!termo) return true;
      return [l.cliente, l.unidade, String(l.contratoId)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(termo);
    });
  }, [busca, dados, empreendimento]);

  // O total do RECORTE, e não o da carteira: é o que a pessoa está vendo.
  const doRecorte = useMemo(
    () => linhas.reduce((soma, l) => soma + l.defasagem.porParcela, 0),
    [linhas],
  );

  function baixarCsv() {
    const cabecalho = [
      "contrato", "empreendimento", "unidade", "cliente",
      "valor_contratual", "valor_cobrado", "defasagem_pct", "por_parcela", "parcelas_futuras",
    ].join(";");
    const corpo = linhas.map((l) =>
      [
        l.contratoId,
        l.code,
        l.unidade,
        (l.cliente ?? "").replace(/;/g, ","),
        l.defasagem.contratual.toFixed(2).replace(".", ","),
        l.defasagem.cobrado.toFixed(2).replace(".", ","),
        l.defasagem.percentual.toFixed(2).replace(".", ","),
        l.defasagem.porParcela.toFixed(2).replace(".", ","),
        l.defasagem.futurasDefasadas,
      ].join(";"),
    );
    // ⚠️ BOM na frente: é o que faz o Excel em português abrir o arquivo sem assistente.
    const arquivo = new Blob(["﻿" + [cabecalho, ...corpo].join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const endereco = URL.createObjectURL(arquivo);
    const link = document.createElement("a");
    link.download = `parcelas-a-corrigir-${new Date().toISOString().slice(0, 10)}.csv`;
    link.href = endereco;
    link.click();
    URL.revokeObjectURL(endereco);
  }

  if (carregando && !dados) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-soft">
        <Loader2 className="size-4 animate-spin" />
        Lendo a carteira inteira no C2X…
      </div>
    );
  }

  if (erro && !dados) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
        <p className="text-danger">{erro}</p>
        <button
          className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold dark:border-white/15"
          onClick={() => void carregar()}
          type="button"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  const resumo = dados?.resumo;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto bg-canvas p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Parcelas a corrigir</h1>
          <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink-soft">
            A correção só alcança a parcela quando o boleto dela é emitido. Estes contratos têm
            parcelas futuras ainda no valor antigo, abaixo do que a cobrança já pratica.
          </p>
        </div>
        <button
          className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
          disabled={carregando}
          onClick={() => void carregar()}
          type="button"
        >
          {carregando ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Atualizar
        </button>
      </header>

      {resumo ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Cartao
            destaque
            rotulo="Deixa de cobrar por mês"
            valor={reais(resumo.porMes)}
            nota={`${resumo.comDefasagem} contratos`}
          />
          <Cartao rotulo="Defasagem mediana" valor={pct(resumo.medianaPct)} nota="entre os defasados" />
          <Cartao rotulo="Em dia" valor={String(resumo.emDia)} nota={`de ${resumo.total} contratos`} />
          <Cartao
            rotulo="Sem apurar"
            valor={String(resumo.naoApurados)}
            nota="sem boleto ou sem parcela futura"
          />
        </section>
      ) : null}

      {dados?.parcial ? (
        <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12.5px] text-ink">
          <AlertTriangle className="size-4 shrink-0 text-amber-600" />
          A leitura bateu no teto e esta lista <strong>não é completa</strong>.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-52 flex-1 items-center gap-2 rounded-lg border border-black/10 px-3 dark:border-white/15">
          <Search className="size-3.5 shrink-0 text-ink-soft" />
          <input
            className="w-full bg-transparent py-2 text-[13px] text-ink outline-none"
            onChange={(e) => {
              setBusca(e.target.value);
              setVisiveis(PAGINA);
            }}
            placeholder="Cliente, unidade ou contrato"
            value={busca}
          />
        </label>

        <select
          className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-[13px] text-ink dark:border-white/15"
          onChange={(e) => {
            setEmpreendimento(e.target.value);
            setVisiveis(PAGINA);
          }}
          value={empreendimento}
        >
          <option value="">Todo empreendimento</option>
          {empreendimentos.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>

        <button
          className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2 text-xs font-semibold text-ink transition hover:bg-black/5 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/5"
          disabled={linhas.length === 0}
          onClick={baixarCsv}
          type="button"
        >
          <Download className="size-3.5" />
          CSV
        </button>
      </div>

      <p className="text-[12.5px] text-ink-soft">
        {linhas.length} contrato(s) neste recorte, somando{" "}
        <strong className="text-ink">{reais(doRecorte)}</strong> por mês.
      </p>

      <div className="overflow-x-auto rounded-xl border border-black/[0.07] dark:border-white/[0.08]">
        <table className="w-full min-w-[820px] border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-black/[0.03] text-left text-ink-soft dark:bg-white/[0.04]">
              <Th>Contrato</Th>
              <Th>Emp.</Th>
              <Th>Unidade</Th>
              <Th>Cliente</Th>
              <Th direita>Hoje no sistema</Th>
              <Th direita>Já cobrado</Th>
              <Th direita>Defasagem</Th>
              <Th direita>Por parcela</Th>
              <Th direita>Futuras</Th>
            </tr>
          </thead>
          <tbody>
            {linhas.slice(0, visiveis).map((l) => (
              <tr
                className="border-t border-black/[0.06] dark:border-white/[0.07]"
                key={String(l.contratoId)}
              >
                <Td>{l.contratoId}</Td>
                <Td>{l.code}</Td>
                <Td>{l.unidade || "-"}</Td>
                <Td className="max-w-56 truncate">{l.cliente ?? "-"}</Td>
                <Td direita>{reais(l.defasagem.contratual)}</Td>
                <Td direita className="font-semibold text-ink">
                  {reais(l.defasagem.cobrado)}
                </Td>
                <Td direita>{pct(l.defasagem.percentual)}</Td>
                <Td direita className="font-semibold text-ink">
                  {reais(l.defasagem.porParcela)}
                </Td>
                <Td direita>{l.defasagem.futurasDefasadas}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {linhas.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-ink-soft">
          Nenhum contrato defasado neste recorte.
        </p>
      ) : null}

      {linhas.length > visiveis ? (
        <button
          className="rounded-lg border border-black/10 py-2.5 text-[13px] text-ink-soft transition hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
          onClick={() => setVisiveis((atual) => atual + PAGINA)}
          type="button"
        >
          Ver mais {Math.min(PAGINA, linhas.length - visiveis)} de {linhas.length}
        </button>
      ) : null}
    </div>
  );
}

function Cartao({
  destaque,
  nota,
  rotulo,
  valor,
}: {
  destaque?: boolean;
  nota: string;
  rotulo: string;
  valor: string;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        destaque
          ? "border-amber-500/30 bg-amber-500/[0.07]"
          : "border-black/[0.07] dark:border-white/[0.08]"
      }`}
    >
      <p className="text-[11px] uppercase tracking-wide text-ink-soft">{rotulo}</p>
      <p className="mt-1 text-xl font-semibold text-ink">{valor}</p>
      <p className="mt-0.5 text-[11.5px] text-ink-soft">{nota}</p>
    </div>
  );
}

function Th({ children, direita }: { children: React.ReactNode; direita?: boolean }) {
  return (
    <th className={`px-3 py-2 font-medium ${direita ? "text-right" : "text-left"}`}>{children}</th>
  );
}

function Td({
  children,
  className = "",
  direita,
}: {
  children: React.ReactNode;
  className?: string;
  direita?: boolean;
}) {
  return (
    <td className={`px-3 py-2 ${direita ? "text-right tabular-nums" : ""} ${className}`}>
      {children}
    </td>
  );
}
