"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

// COMPARATIVO Asana x Board do Apolo, com a importação na mesma tela.
//
// A pergunta que essa tela responde é "o que ainda não subiu?" — e, respondida, deixa agir ali
// mesmo, seção por seção, com os NOMES à vista para conferência.
//
// ⚠️ O formulário do Asana NÃO tem campo de CPF: esse dado só existe dentro dos documentos
// anexados. Por isso a importação daqui é sempre pela LEITURA (MOST), que é PAGA — a tela mostra
// o custo antes e só lê depois de confirmar. Duplicadas e CAD incorreta ficam fora da conta.

type Faltante = { gid: string; nome: string };

type Secao = {
  faltantes: Faltante[];
  importadas: number;
  naAsana: number;
  // Já está no Board (mesma pessoa na esteira), só sem o vínculo da task. Não é pendência.
  noBoardSemVinculo: number;
  secao: string;
};

type Comparativo = {
  empreendimento: string;
  porEtapa: Record<string, number>;
  porSecao: Secao[];
  resumo: {
    faltamImportar: number;
    importadas: number;
    naAsanaTotal: number;
    naAsanaValidas: number;
    noApoloSemTask: number;
    noApoloTotal: number;
    noBoardSemVinculo: number;
    refugo: number;
  };
  secoesEncontradas: string[];
};

type ItemLeitura = { gid: string; nome: string };
type Orcamento = {
  custoEstimado: number;
  custoPorImagem: number;
  gratisPorTexto: number;
  imagensAPagar: number;
  jaLidos: number;
  jaNaEsteira: number;
  naoLegiveis: number;
  totalCads: number;
};
type Previa = { itens: ItemLeitura[]; orcamento: Orcamento };

type Andamento = {
  conflitos: number;
  criados: number;
  gasto: number;
  lotesFeitos: number;
  pendentes: number;
  totalLotes: number;
};

const TAMANHO_LOTE = 5;
const reais = (v: number) => v.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });

export function ComparativoAsanaApolo() {
  const [empreendimento, setEmpreendimento] = useState("Vale do Ouro");
  const [dados, setDados] = useState<Comparativo | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [aberta, setAberta] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [andamentos, setAndamentos] = useState<Record<string, Andamento>>({});
  // Quem foi marcado para importar, por seção. Vazio = a seção inteira.
  const [marcados, setMarcados] = useState<Record<string, Set<string>>>({});

  const alternar = useCallback((secao: string, gid: string) => {
    setMarcados((atual) => {
      const set = new Set(atual[secao] ?? []);
      if (set.has(gid)) set.delete(gid);
      else set.add(gid);
      return { ...atual, [secao]: set };
    });
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(
        `/api/apolo/asana/comparativo?empreendimento=${encodeURIComponent(empreendimento)}`,
        { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
      );
      const corpo = (await r.json()) as { data?: Comparativo; error?: string };
      if (!r.ok) setErro(corpo.error ?? `Falha (${r.status}).`);
      else setDados(corpo.data ?? null);
    } catch (e) {
      setErro((e as Error).message);
    }
    setCarregando(false);
  }, [empreendimento]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // IMPORTAR = um passo só. Por dentro ainda há duas chamadas — a primeira monta a lista de CADs
  // da seção (e já tira quem está no Board), a segunda lê os documentos em lotes pequenos —, mas
  // isso é detalhe de implementação: quem opera clica uma vez e acompanha o progresso.
  const importar = useCallback(
    async (secao: string) => {
      setOcupada(secao);
      setErro(null);

      const token = await getApoloAccessToken();

      let previa: Previa | null = null;
      try {
        const url = `/api/apolo/asana/leitura?empreendimento=${encodeURIComponent(empreendimento)}&secoes=${encodeURIComponent(secao)}`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const corpo = (await r.json()) as { data?: Previa; error?: string };
        if (!r.ok) {
          setErro(corpo.error ?? `Falha (${r.status}).`);
          setOcupada(null);
          return;
        }
        previa = corpo.data ?? null;
      } catch (e) {
        setErro((e as Error).message);
        setOcupada(null);
        return;
      }

      if (!previa || previa.itens.length === 0) {
        setErro("Nada para importar nesta seção: todas já estão no Board.");
        setOcupada(null);
        return;
      }

      // Marcou alguém? Lê só esses. Nada marcado = a seção inteira.
      const escolhidos = marcados[secao];
      const alvo =
        escolhidos && escolhidos.size > 0
          ? previa.itens.filter((i) => escolhidos.has(i.gid))
          : previa.itens;

      if (alvo.length === 0) {
        setErro("As CADs marcadas não estão mais pendentes nesta seção.");
        setOcupada(null);
        return;
      }

      const lotes: ItemLeitura[][] = [];
      for (let i = 0; i < alvo.length; i += TAMANHO_LOTE) {
        lotes.push(alvo.slice(i, i + TAMANHO_LOTE));
      }

      setAndamentos((a) => ({
        ...a,
        [secao]: {
          conflitos: 0,
          criados: 0,
          gasto: 0,
          lotesFeitos: 0,
          pendentes: 0,
          totalLotes: lotes.length,
        },
      }));

      for (const [indice, lote] of lotes.entries()) {
        try {
          const r = await fetch("/api/apolo/asana/leitura", {
            body: JSON.stringify({
              confirmado: true,
              empreendimento,
              itens: lote,
              secao,
            }),
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            method: "POST",
          });
          const corpo = (await r.json()) as {
            data?: {
              conflitos?: unknown[];
              criacao: { criados: number };
              leitura: { gastoBrl: number };
              pendentes: unknown[];
            };
            error?: string;
          };
          if (!r.ok) {
            setErro(corpo.error ?? `Falha (${r.status}).`);
            break;
          }
          const d = corpo.data;
          if (!d) break;

          setAndamentos((a) => {
            const atual = a[secao];
            if (!atual) return a;
            return {
              ...a,
              [secao]: {
                conflitos: atual.conflitos + (d.conflitos?.length ?? 0),
                criados: atual.criados + d.criacao.criados,
                gasto: atual.gasto + d.leitura.gastoBrl,
                lotesFeitos: indice + 1,
                pendentes: atual.pendentes + d.pendentes.length,
                totalLotes: atual.totalLotes,
              },
            };
          });
        } catch (e) {
          setErro((e as Error).message);
          break;
        }
      }

      setOcupada(null);
      setMarcados((a) => ({ ...a, [secao]: new Set() }));
      void carregar();
    },
    [carregar, empreendimento, marcados],
  );

  const r = dados?.resumo;

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
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-[#101820] px-4 py-2 text-sm font-semibold text-[#cba25a] hover:bg-[#1c2733] disabled:opacity-40"
            disabled={carregando}
            onClick={() => void carregar()}
            type="button"
          >
            {carregando ? (
              <Loader2 className="animate-spin" size={15} />
            ) : (
              <RefreshCw size={15} />
            )}
            Comparar
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Comparar é gratuito: lê o Asana e o Board, sem criar nada e sem ler documento.
        </p>
      </section>

      {erro ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {erro}
        </p>
      ) : null}

      {r ? (
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-black/[0.07] bg-surface p-4 dark:border-white/[0.08]">
            <p className="m-0 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              <FileText size={13} /> No Asana
            </p>
            <p className="m-0 mt-1 text-3xl font-bold tabular-nums text-ink">
              {r.naAsanaValidas}
            </p>
            <p className="m-0 text-xs text-ink-soft">
              CADs de trabalho ({r.naAsanaTotal} no total, menos {r.refugo} duplicadas/incorretas)
            </p>
          </div>

          <div className="rounded-xl border border-black/[0.07] bg-surface p-4 dark:border-white/[0.08]">
            <p className="m-0 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              <Database size={13} /> No Board do Apolo
            </p>
            <p className="m-0 mt-1 text-3xl font-bold tabular-nums text-ink">{r.importadas}</p>
            <p className="m-0 text-xs text-ink-soft">
              vindas do Asana
              {r.noApoloSemTask > 0
                ? ` · mais ${r.noApoloSemTask} criada(s) fora do Asana`
                : ""}
            </p>
          </div>

          <div
            className={`rounded-xl border p-4 sm:col-span-2 ${
              r.faltamImportar > 0
                ? "border-amber-400/50 bg-amber-50/50 dark:bg-amber-950/20"
                : "border-emerald-400/40 bg-emerald-50/40 dark:bg-emerald-950/20"
            }`}
          >
            <p className="m-0 flex items-center gap-2 text-sm font-bold text-ink">
              {r.faltamImportar > 0 ? (
                <>
                  <AlertTriangle className="text-amber-600" size={16} />
                  {r.faltamImportar} CAD(s) no Asana ainda não estão no Board
                </>
              ) : (
                <>
                  <Check className="text-emerald-600" size={16} />
                  Tudo que está no Asana já está no Board
                </>
              )}
            </p>
            {dados && Object.keys(dados.porEtapa).length > 0 ? (
              <p className="m-0 mt-1 text-xs text-ink-soft">
                Distribuição no Board:{" "}
                {Object.entries(dados.porEtapa)
                  .map(([e, n]) => `${e} ${n}`)
                  .join(" · ")}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {dados?.porSecao.map((s) => {
        // Quem já está no Board pela PESSOA (sem o vínculo da task) não é pendência: descontar,
        // senão o número do Asana nunca fecha com o do Board.
        const faltam = s.naAsana - s.importadas - s.noBoardSemVinculo;
        const andamento = andamentos[s.secao];
        const estaAberta = aberta === s.secao;
        const selecionados = marcados[s.secao]?.size ?? 0;

        return (
          <section
            className="rounded-xl border border-black/[0.07] bg-surface dark:border-white/[0.08]"
            key={s.secao}
          >
            <div className="flex flex-wrap items-center gap-3 p-4">
              <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => setAberta(estaAberta ? null : s.secao)}
                type="button"
              >
                {estaAberta ? (
                  <ChevronDown className="shrink-0 text-ink-muted" size={16} />
                ) : (
                  <ChevronRight className="shrink-0 text-ink-muted" size={16} />
                )}
                <span className="truncate text-sm font-bold text-ink">{s.secao}</span>
              </button>

              <div className="flex items-center gap-4 text-xs">
                <span className="text-ink-soft">
                  Asana <b className="text-ink">{s.naAsana}</b>
                </span>
                <span className="text-emerald-700 dark:text-emerald-300">
                  no Board <b>{s.importadas + s.noBoardSemVinculo}</b>
                  {s.noBoardSemVinculo > 0 ? (
                    <span
                      className="text-ink-muted"
                      title="Já está na esteira, mas a CAD do Asana não foi vinculada (cadastro manual ou portal)."
                    >
                      {" "}
                      ({s.noBoardSemVinculo} sem vínculo)
                    </span>
                  ) : null}
                </span>
                <span
                  className={
                    faltam > 0 ? "font-bold text-amber-700 dark:text-amber-300" : "text-ink-muted"
                  }
                >
                  faltam {faltam}
                </span>
              </div>

              {faltam > 0 ? (
                <button
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#101820] px-3 py-1.5 text-xs font-semibold text-[#cba25a] hover:bg-[#1c2733] disabled:opacity-40"
                  disabled={ocupada === s.secao}
                  onClick={() => void importar(s.secao)}
                  type="button"
                >
                  {ocupada === s.secao ? (
                    <Loader2 className="animate-spin" size={12} />
                  ) : (
                    <Upload size={12} />
                  )}
                  {ocupada === s.secao
                    ? "Importando..."
                    : selecionados > 0
                      ? `Importar ${selecionados} marcado(s)`
                      : `Importar ${faltam}`}
                </button>
              ) : (
                <span className="text-xs text-ink-muted">nada a fazer</span>
              )}
            </div>

            {andamento ? (
              <div className="border-t border-black/[0.06] px-4 py-3 dark:border-white/[0.07]">
                <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.1]">
                  <div
                    className="h-full rounded-full bg-[#A07C3B] transition-all"
                    style={{
                      width: `${(andamento.lotesFeitos / Math.max(1, andamento.totalLotes)) * 100}%`,
                    }}
                  />
                </div>
                <p className="m-0 text-xs text-ink-soft">
                  <b className="text-ink">{andamento.criados}</b> cadastro(s) criado(s) ·{" "}
                  <b className="text-ink">{reais(andamento.gasto)}</b> gastos ·{" "}
                  {andamento.pendentes} sem CPF legível · {andamento.conflitos} em conflito
                  {ocupada === s.secao ? " · lendo..." : ""}
                </p>
              </div>
            ) : null}

            {/* NOMES — conferência e escolha de quem entra. */}
            {estaAberta ? (
              <div className="border-t border-black/[0.06] px-4 py-3 dark:border-white/[0.07]">
                {s.faltantes.length ? (
                  <>
                    <div className="mb-2 flex flex-wrap items-center gap-3">
                      <p className="m-0 text-[0.68rem] font-semibold uppercase tracking-wide text-ink-muted">
                        {faltam} que ainda não estão no Board
                        {s.faltantes.length < faltam
                          ? ` (mostrando ${s.faltantes.length})`
                          : ""}
                      </p>
                      <button
                        className="text-[0.68rem] font-semibold text-[#A07C3B] hover:underline"
                        onClick={() =>
                          setMarcados((a) => ({
                            ...a,
                            [s.secao]:
                              (a[s.secao]?.size ?? 0) === s.faltantes.length
                                ? new Set()
                                : new Set(s.faltantes.map((f) => f.gid)),
                          }))
                        }
                        type="button"
                      >
                        {(marcados[s.secao]?.size ?? 0) === s.faltantes.length
                          ? "limpar seleção"
                          : "marcar todos"}
                      </button>
                      {selecionados > 0 ? (
                        <span className="text-[0.68rem] text-ink-soft">
                          {selecionados} marcado(s)
                        </span>
                      ) : (
                        <span className="text-[0.68rem] text-ink-muted">
                          nada marcado = importa a seção inteira
                        </span>
                      )}
                    </div>

                    <ul className="m-0 grid list-none gap-x-6 gap-y-0.5 p-0 sm:grid-cols-2 lg:grid-cols-3">
                      {s.faltantes.map((f) => (
                        <li key={f.gid}>
                          <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-ink-soft hover:bg-black/[0.03] dark:hover:bg-white/[0.05]">
                            <input
                              checked={marcados[s.secao]?.has(f.gid) ?? false}
                              className="shrink-0"
                              disabled={ocupada === s.secao}
                              onChange={() => alternar(s.secao, f.gid)}
                              type="checkbox"
                            />
                            <span className="truncate">{f.nome}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="m-0 text-xs text-ink-muted">
                    Todas as CADs desta seção já estão no Board.
                  </p>
                )}
              </div>
            ) : null}
          </section>
        );
      })}

      {dados && dados.resumo.faltamImportar > 0 ? (
        <p className="rounded-lg border border-black/[0.07] px-3 py-2 text-xs text-ink-soft dark:border-white/[0.08]">
          <b className="text-ink">Por que a importação é paga:</b> o formulário do Asana não tem
          campo de CPF, e sem CPF o Apolo não cria cadastro. O documento anexado é lido pela MOST
          para extrair CPF, RG, nascimento e filiação — por isso a tela mostra o custo antes e só lê
          depois que você confirma. As fichas entram em <b className="text-ink">Validação</b>, com
          os documentos anexados, e quem já tem ficha em outro empreendimento ou por outra
          imobiliária fica de fora como <b className="text-ink">conflito</b>, para alguém decidir.
        </p>
      ) : null}
    </div>
  );
}
