"use client";

import { Calculator, Check, FileWarning, Loader2, Wallet } from "lucide-react";
import { useCallback, useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

// Lote PAGO: lê os documentos das CADs pela MOST para criar o cadastro no Apolo.
//
// A tela existe para o gasto ser uma decisão consciente: primeiro mostra o ORÇAMENTO (grátis),
// com o valor em reais em destaque, e só depois de confirmar é que alguma consulta acontece.
// Depois de rodar, mostra o gasto REAL, que costuma ser menor que o orçado — arquivo já lido
// antes não é cobrado de novo.

type AnexoCandidato = {
  downloadUrl: string | null;
  gid: string;
  legivel: boolean;
  nome: string;
  tamanho: number | null;
};
type ItemLeitura = {
  anexos: AnexoCandidato[];
  cpfNoTexto: string | null;
  gid: string;
  imobiliaria: string | null;
  nome: string;
};
type Orcamento = {
  custoEstimado: number;
  custoPorImagem: number;
  gratisPorTexto: number;
  imagensAPagar: number;
  jaLidos: number;
  naoLegiveis: number;
  totalCads: number;
};
type Previa = {
  empreendimento: string;
  itens: ItemLeitura[];
  orcamento: Orcamento;
  secoes: string[];
};
type Acumulado = {
  criados: number;
  documentos: number;
  gasto: number;
  imagens: number;
  lotesFeitos: number;
  pendentes: { gid: string; nome: string }[];
  reaproveitados: number;
  totalLotes: number;
};

const TAMANHO_LOTE = 5;
const reais = (valor: number) =>
  valor.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });

export function LerCads(props: {
  // Vem preenchido quando o operador chega pela lista "sem cadastro" da aba Importar.
  empreendimentoInicial?: string;
  secoesIniciais?: string;
}) {
  const [empreendimento, setEmpreendimento] = useState(
    props.empreendimentoInicial || "Vale do Ouro",
  );
  const [secoes, setSecoes] = useState(props.secoesIniciais || "Em Cadastro");
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [orcando, setOrcando] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [acumulado, setAcumulado] = useState<Acumulado | null>(null);
  // Trava consciente: o botão de gastar só habilita depois de marcar isto.
  const [cienteDoCusto, setCienteDoCusto] = useState(false);

  const orcar = useCallback(async () => {
    setOrcando(true);
    setErro(null);
    setAcumulado(null);
    setCienteDoCusto(false);
    try {
      const token = await getApoloAccessToken();
      const url = `/api/apolo/asana/leitura?empreendimento=${encodeURIComponent(empreendimento)}&secoes=${encodeURIComponent(secoes)}`;
      const resposta = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const corpo = (await resposta.json()) as { data?: Previa; error?: string };
      if (!resposta.ok) {
        setErro(corpo.error ?? `Falha (${resposta.status}).`);
        setPrevia(null);
      } else {
        setPrevia(corpo.data ?? null);
      }
    } catch (e) {
      setErro((e as Error).message);
    }
    setOrcando(false);
  }, [empreendimento, secoes]);

  const ler = useCallback(async () => {
    if (!previa) return;

    const lotes: ItemLeitura[][] = [];
    for (let i = 0; i < previa.itens.length; i += TAMANHO_LOTE) {
      lotes.push(previa.itens.slice(i, i + TAMANHO_LOTE));
    }

    setLendo(true);
    setErro(null);
    setAcumulado({
      criados: 0,
      documentos: 0,
      gasto: 0,
      imagens: 0,
      lotesFeitos: 0,
      pendentes: [],
      reaproveitados: 0,
      totalLotes: lotes.length,
    });

    const token = await getApoloAccessToken();

    for (const [indice, lote] of lotes.entries()) {
      try {
        const resposta = await fetch("/api/apolo/asana/leitura", {
          body: JSON.stringify({
            confirmado: true,
            empreendimento: previa.empreendimento,
            itens: lote,
            secao: previa.secoes[0] ?? "Em Cadastro",
          }),
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        });
        const corpo = (await resposta.json()) as {
          data?: {
            criacao: { criados: number; reaproveitados: number };
            documentos: { baixados: number };
            leitura: { gastoBrl: number; imagensPagas: number; reaproveitados: number };
            pendentes: { gid: string; nome: string }[];
          };
          error?: string;
        };

        if (!resposta.ok) {
          setErro(corpo.error ?? `Falha (${resposta.status}).`);
        } else if (corpo.data) {
          const d = corpo.data;
          setAcumulado((atual) =>
            atual
              ? {
                  ...atual,
                  criados: atual.criados + d.criacao.criados,
                  documentos: atual.documentos + d.documentos.baixados,
                  gasto: atual.gasto + d.leitura.gastoBrl,
                  imagens: atual.imagens + d.leitura.imagensPagas,
                  lotesFeitos: indice + 1,
                  pendentes: [...atual.pendentes, ...d.pendentes],
                  reaproveitados:
                    atual.reaproveitados +
                    d.leitura.reaproveitados +
                    d.criacao.reaproveitados,
                }
              : atual,
          );
        }
      } catch (e) {
        setErro((e as Error).message);
      }
    }

    setLendo(false);
  }, [previa]);

  const orc = previa?.orcamento;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-black/[0.07] bg-surface p-4 dark:border-white/[0.08]">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[0.68rem] font-semibold uppercase tracking-wide text-ink-muted">
              Empreendimento
            </span>
            <input
              className="rounded-lg border border-black/10 bg-canvas px-3 py-2 text-sm text-ink dark:border-white/10"
              onChange={(e) => setEmpreendimento(e.target.value)}
              value={empreendimento}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[0.68rem] font-semibold uppercase tracking-wide text-ink-muted">
              Seções
            </span>
            <input
              className="w-56 rounded-lg border border-black/10 bg-canvas px-3 py-2 text-sm text-ink dark:border-white/10"
              onChange={(e) => setSecoes(e.target.value)}
              value={secoes}
            />
          </label>
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-black/10 px-4 py-2 text-sm font-semibold text-ink hover:bg-black/[0.04] disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/[0.06]"
            disabled={orcando || lendo}
            onClick={() => void orcar()}
            type="button"
          >
            {orcando ? (
              <Loader2 className="animate-spin" size={15} />
            ) : (
              <Calculator size={15} />
            )}
            Calcular custo
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Calcular é gratuito: conta os arquivos e mostra o preço. Nenhuma consulta é feita
          nesta etapa.
        </p>
      </section>

      {erro ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {erro}
        </p>
      ) : null}

      {orc ? (
        <section className="rounded-xl border border-amber-400/50 bg-amber-50/50 p-4 dark:bg-amber-950/20">
          <div className="flex items-start gap-3">
            <Wallet className="mt-0.5 shrink-0 text-amber-600" size={20} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">
                Ler os documentos destas {orc.totalCads} CADs custa{" "}
                <span className="text-base">{reais(orc.custoEstimado)}</span>
              </p>
              <p className="mt-0.5 text-xs text-ink-soft">
                {orc.imagensAPagar} imagens × {reais(orc.custoPorImagem)} por imagem. É uma
                estimativa de teto: documento já lido antes não é cobrado de novo.
              </p>

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <Economia
                  detalhe="CPF já está escrito na CAD"
                  rotulo="CADs sem custo"
                  valor={orc.gratisPorTexto}
                />
                <Economia
                  detalhe="planilha, zip, docx"
                  rotulo="Arquivos ignorados"
                  valor={orc.naoLegiveis}
                />
                <Economia
                  detalhe="não serão cobrados de novo"
                  rotulo="Já lidos antes"
                  valor={orc.jaLidos}
                />
              </div>
            </div>
          </div>

          {!lendo && !acumulado ? (
            <div className="mt-4 border-t border-amber-500/20 pt-3">
              <label className="flex items-start gap-2.5">
                <input
                  checked={cienteDoCusto}
                  className="mt-0.5"
                  onChange={(e) => setCienteDoCusto(e.target.checked)}
                  type="checkbox"
                />
                <span className="text-sm text-ink-soft">
                  Entendo que isto <b className="text-ink">consulta a MOST e será cobrado</b>,
                  mesmo para documento que voltar ilegível.
                </span>
              </label>

              <button
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#101820] px-4 py-2 text-sm font-semibold text-[#cba25a] hover:bg-[#1c2733] disabled:opacity-40"
                disabled={!cienteDoCusto || orc.totalCads === 0}
                onClick={() => void ler()}
                type="button"
              >
                <Check size={15} /> Ler documentos e criar os cadastros
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {acumulado ? (
        <section className="rounded-xl border border-black/[0.07] bg-surface p-4 dark:border-white/[0.08]">
          <div className="mb-3 flex items-center gap-2">
            {lendo ? (
              <Loader2 className="animate-spin text-ink-muted" size={16} />
            ) : (
              <Check className="text-emerald-600" size={16} />
            )}
            <h3 className="text-sm font-bold text-ink">
              {lendo ? "Lendo documentos..." : "Leitura concluída"}
            </h3>
          </div>

          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.1]">
            <div
              className="h-full rounded-full bg-[#A07C3B] transition-all"
              style={{
                width: `${(acumulado.lotesFeitos / Math.max(1, acumulado.totalLotes)) * 100}%`,
              }}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Resultado
              destaque
              rotulo="Gasto real"
              valor={reais(acumulado.gasto)}
            />
            <Resultado rotulo="Cadastros criados" valor={String(acumulado.criados)} />
            <Resultado rotulo="Documentos no Apolo" valor={String(acumulado.documentos)} />
            <Resultado
              rotulo="Reaproveitados"
              valor={String(acumulado.reaproveitados)}
            />
          </div>

          {acumulado.pendentes.length > 0 ? (
            <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-50/40 p-3 dark:bg-amber-950/20">
              <div className="flex items-center gap-2">
                <FileWarning className="text-amber-600" size={15} />
                <p className="text-sm font-semibold text-ink">
                  {acumulado.pendentes.length} CADs sem CPF legível
                </p>
              </div>
              <p className="mt-1 text-xs text-ink-soft">
                O documento não permitiu extrair um CPF válido, então estas não entraram no
                Board: o Apolo não cria cadastro sem documento. Precisam de cadastro manual.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {acumulado.pendentes.map((item) => (
                  <span
                    key={item.gid}
                    className="rounded bg-black/[0.05] px-2 py-1 text-xs text-ink-soft dark:bg-white/[0.07]"
                  >
                    {item.nome}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {!lendo ? (
            <p className="mt-3 text-xs text-ink-muted">
              Os cadastros criados entraram em <b>Validação</b> no Board, com o que o OCR
              conseguiu ler e os documentos ao lado. O operador confere e completa o que faltou.
            </p>
          ) : null}
        </section>
      ) : null}

      {previa && previa.itens.length === 0 ? (
        <p className="rounded-xl border border-black/[0.07] py-10 text-center text-sm text-ink-muted dark:border-white/[0.08]">
          Nenhuma CAD encontrada nessas seções para esse empreendimento.
        </p>
      ) : null}
    </div>
  );
}

function Economia(props: { detalhe: string; rotulo: string; valor: number }) {
  return (
    <div className="rounded-lg bg-white/60 px-3 py-2 dark:bg-black/20">
      <div className="text-sm font-bold tabular-nums text-ink">{props.valor}</div>
      <div className="text-[0.68rem] font-semibold text-ink-soft">{props.rotulo}</div>
      <div className="text-[0.62rem] text-ink-muted">{props.detalhe}</div>
    </div>
  );
}

function Resultado(props: { destaque?: boolean; rotulo: string; valor: string }) {
  return (
    <div
      className={`rounded-lg px-3 py-2 ${
        props.destaque
          ? "bg-[#101820] text-[#cba25a]"
          : "bg-black/[0.04] dark:bg-white/[0.06]"
      }`}
    >
      <div
        className={`text-base font-bold tabular-nums ${props.destaque ? "" : "text-ink"}`}
      >
        {props.valor}
      </div>
      <div
        className={`text-[0.66rem] ${props.destaque ? "opacity-80" : "text-ink-muted"}`}
      >
        {props.rotulo}
      </div>
    </div>
  );
}
