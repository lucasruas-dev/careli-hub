"use client";

import { Check, Loader2, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// VINCULAR LOTES A UMA CATEGORIA.
//
// Lucas (15/09/2026): *"eu criei umas categorias mas não tem como eu vincular a unidade aquela
// categoria"* e, sobre como isso acontece na prática: *"vai ocorrer das duas formas, normalmente
// vamos subir em massa essa configuração na importação de unidades, mas teremos cenários que
// precisamos cadastrar uma unidade nova e apontar essa estrutura, ou até mesmo atualizar"*.
//
// Esta tela é a forma MANUAL — a do "atualizar" e a do lote avulso. A importação em massa entra
// pela planilha, que é outro caminho.
//
// ⚠️ ESCOLHER POR QUADRA É O CAMINHO REAL, e não um atalho. A Lagoa Bonita tem 907 unidades: marcar
// lote a lote não é trabalho de tela, é de banco. Como as categorias da casa hoje separam
// condomínio de loteamento — recortes que seguem a geografia do empreendimento —, a quadra é a
// unidade natural de escolha.
//
// ⚠️ E UMA LINHA POR TERRENO, nunca duas. O mesmo lote existe no pai e na gleba; a rota devolve só
// a linha viva e carimba as duas de uma vez. Mostrar as duas faria o operador escolher o mesmo
// terreno duas vezes e a contagem mentir.

type UnidadeParaVincular = {
  categoriaId: null | string;
  codigo: string;
  enterpriseId: string;
  id: string;
  lote: string;
  quadra: string;
  situacao: string;
};

type Props = {
  categoriaId: string;
  categoriaNome: string;
  /** O código de uma das etapas, para o servidor resolver o produto consolidado. */
  codigo?: null | string;
  enterpriseId: string;
  onFechar: () => void;
  /** Chamado depois de gravar, para a aba recarregar as contagens. */
  onGravou: () => void;
};

export function VincularLotes({
  categoriaId,
  categoriaNome,
  codigo,
  enterpriseId,
  onFechar,
  onGravou,
}: Props) {
  const [unidades, setUnidades] = useState<null | UnidadeParaVincular[]>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [busca, setBusca] = useState("");
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<null | string>(null);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const url = `/api/temis/categorias/unidades?enterpriseId=${encodeURIComponent(
        enterpriseId,
      )}${codigo ? `&codigo=${encodeURIComponent(codigo)}` : ""}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const corpo = (await r.json().catch(() => ({}))) as {
        data?: { unidades?: UnidadeParaVincular[] };
        error?: string;
      };
      // ⚠️ FALHA FECHADA: cair para lista vazia faria a tela dizer "este empreendimento não tem
      // lote" a partir de um timeout — e alguém vincularia tudo de novo por cima.
      if (!r.ok || !corpo.data) {
        setErro(corpo.error ?? "Não foi possível carregar os lotes.");
        return;
      }
      setUnidades(corpo.data.unidades ?? []);
    } catch {
      setErro("Falha ao carregar os lotes deste empreendimento.");
    }
  }, [codigo, enterpriseId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const lista = unidades ?? [];
    if (!termo) return lista;
    return lista.filter((u) =>
      `${u.quadra} ${u.lote} ${u.codigo}`.toLowerCase().includes(termo),
    );
  }, [busca, unidades]);

  /** Os lotes agrupados por quadra — é por quadra que o operador pensa. */
  const porQuadra = useMemo(() => {
    const mapa = new Map<string, UnidadeParaVincular[]>();
    for (const u of visiveis) {
      const q = u.quadra || "—";
      const atual = mapa.get(q);
      if (atual) atual.push(u);
      else mapa.set(q, [u]);
    }
    return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  }, [visiveis]);

  const alternar = (id: string) => {
    setEscolhidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  };

  const alternarQuadra = (lotes: UnidadeParaVincular[]) => {
    const todosJaEstao = lotes.every((u) => escolhidos.has(u.id));
    setEscolhidos((atual) => {
      const novo = new Set(atual);
      for (const u of lotes) {
        if (todosJaEstao) novo.delete(u.id);
        else novo.add(u.id);
      }
      return novo;
    });
  };

  async function gravar(paraCategoria: null | string) {
    if (escolhidos.size === 0) return;
    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/temis/categorias/unidades", {
        body: JSON.stringify({
          categoriaId: paraCategoria,
          unidadeIds: [...escolhidos],
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const corpo = (await r.json().catch(() => ({}))) as {
        data?: { porParentesco: number; terrenos: number };
        error?: string;
      };
      if (!r.ok) {
        setErro(corpo.error ?? "Não foi possível vincular.");
        return;
      }

      const t = corpo.data?.terrenos ?? escolhidos.size;
      // ⚠️ A FRASE CONTA TERRENO, E EXPLICA O GÊMEO. Dizer "24 linhas gravadas" onde o operador
      // marcou 12 lotes parece defeito; dizer que o registro antigo foi junto explica o número sem
      // ensinar o detalhe interno a quem não precisa dele.
      const gemeos = corpo.data?.porParentesco ?? 0;
      setAviso(
        `${t === 1 ? "1 lote" : `${t} lotes`} ${
          paraCategoria ? `em ${categoriaNome}` : "sem categoria"
        }.${gemeos > 0 ? " O registro antigo do mesmo terreno foi junto." : ""}`,
      );
      setEscolhidos(new Set());
      await carregar();
      onGravou();
    } catch {
      setErro("Falha de rede. Recarregue para conferir o que foi gravado.");
    } finally {
      setSalvando(false);
    }
  }

  const jaNesta = (unidades ?? []).filter((u) => u.categoriaId === categoriaId).length;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-6">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-line bg-surface shadow-xl">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-ink">
              Vincular lotes · {categoriaNome}
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              {unidades === null
                ? "Carregando…"
                : `${unidades.length} lotes no empreendimento · ${jaNesta} nesta categoria`}
            </p>
          </div>
          <button
            aria-label="Fechar"
            className="inline-flex size-8 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-subtle"
            onClick={onFechar}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>

        <div className="border-b border-line px-5 py-3">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-subtle px-3 py-2">
            <Search aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
            <input
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Quadra, lote ou código"
              value={busca}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {erro ? (
            <p className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
              {erro}
            </p>
          ) : null}

          {unidades === null && !erro ? (
            <p className="py-6 text-center text-xs text-ink-muted">Carregando os lotes…</p>
          ) : null}

          {unidades !== null && visiveis.length === 0 ? (
            <p className="py-6 text-center text-xs text-ink-muted">
              {busca ? "Nenhum lote com esse termo." : "Nenhum lote cadastrado aqui."}
            </p>
          ) : null}

          {porQuadra.map(([quadra, lotes]) => {
            const todos = lotes.every((u) => escolhidos.has(u.id));
            return (
              <section className="mb-4" key={quadra}>
                <div className="mb-1.5 flex items-center gap-2">
                  <button
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[11px] font-semibold text-ink transition-colors hover:bg-subtle"
                    onClick={() => alternarQuadra(lotes)}
                    type="button"
                  >
                    {todos ? "Desmarcar" : "Marcar"} quadra {quadra}
                  </button>
                  <span className="text-[11px] text-ink-muted">
                    {lotes.length === 1 ? "1 lote" : `${lotes.length} lotes`}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {lotes.map((u) => {
                    const marcado = escolhidos.has(u.id);
                    const nesta = u.categoriaId === categoriaId;
                    const noutra = Boolean(u.categoriaId) && !nesta;
                    return (
                      <button
                        className={`inline-flex h-8 min-w-14 items-center justify-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-colors ${
                          marcado
                            ? "border-inverse bg-inverse text-surface"
                            : nesta
                              ? "border-emerald-400 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
                              : noutra
                                ? "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
                                : "border-line bg-surface text-ink hover:bg-subtle"
                        }`}
                        key={u.id}
                        onClick={() => alternar(u.id)}
                        // ⚠️ O TÍTULO DIZ O ESTADO, porque a cor sozinha não serve a quem não
                        // distingue verde de âmbar.
                        title={
                          nesta
                            ? `Já está em ${categoriaNome}`
                            : noutra
                              ? "Está em outra categoria"
                              : "Sem categoria"
                        }
                        type="button"
                      >
                        {marcado ? <Check aria-hidden="true" className="size-3" /> : null}
                        {u.lote || u.codigo}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          <span className="text-xs text-ink-muted">
            {escolhidos.size === 0
              ? "Nenhum lote marcado"
              : `${escolhidos.size === 1 ? "1 lote" : `${escolhidos.size} lotes`} marcados`}
          </span>
          {aviso ? (
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              {aviso}
            </span>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            {/* ⚠️ DESVINCULAR MORA AQUI, e não numa tela separada: o operador que marcou o lote
                errado desfaz no mesmo lugar onde errou. Manda `null`, que é o "volta a herdar". */}
            <button
              className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:bg-subtle disabled:opacity-40"
              disabled={escolhidos.size === 0 || salvando}
              onClick={() => void gravar(null)}
              type="button"
            >
              Tirar a categoria
            </button>
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-4 text-xs font-semibold text-surface transition-opacity hover:opacity-90 disabled:opacity-40"
              disabled={escolhidos.size === 0 || salvando}
              onClick={() => void gravar(categoriaId)}
              type="button"
            >
              {salvando ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null}
              Vincular a {categoriaNome}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
