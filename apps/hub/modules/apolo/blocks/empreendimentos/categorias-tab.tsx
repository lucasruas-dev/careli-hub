"use client";

import { ChevronRight, FolderTree, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// AS CATEGORIAS DO EMPREENDIMENTO — o recorte que tem contrato próprio.
//
// Lucas (07/09/2026), definindo o que a categoria é: *"pode ser fase, condomínio e loteamento,
// lotes caucionados, TUDO QUE EU PRECISAR TER UMA MINUTA ESPECÍFICA EU TENHO QUE TER COMO
// CATEGORIA"*. E: *"eu posso criar uma subcategoria da categoria"*, *"isso tem que estar refletido
// no cadastro das unidades"*.
//
// ⚠️ O CRITÉRIO NÃO É GEOGRÁFICO NEM COMERCIAL — É DOCUMENTAL. Perguntado se a motivação era uma ou
// outra, ele respondeu *"pode ser os dois"*. O que define uma categoria não é onde o lote está nem
// para quem ele é vendido: é o fato de aquele conjunto assinar um instrumento diferente.
//
// ⚠️ E É ELA QUE FECHA A CADEIA DO CONTRATO:
//
//     unidade → categoria → planos da categoria → plano da venda → minuta
//
// Sem ela, a regra do Lucas (*"o que define qual minuta usar é o plano de pagamento"*) começava no
// meio da corrente: o plano decidia a minuta, mas nada dizia quais planos valiam para aquele lote.
//
// ⚠️ SEM CATEGORIA É O ESTADO NORMAL, e não cadastro faltando (*"quando eu tiver categorias sim, as
// unidades vão apontar para essa categoria; se eu não tiver, não aponta"*). São 5.540 unidades
// vivas em 36 empreendimentos, e a maioria esmagadora assina a minuta única do produto.

type Categoria = {
  categoriaPaiId: null | string;
  id: string;
  nome: string;
  /** Quantos lotes já apontam para ela. É o que diz se dá para desmontar sem dor. */
  unidades?: number;
};

type Props = { enterpriseId: string; name: string };

export function CategoriasTab({ enterpriseId, name }: Props) {
  const [categorias, setCategorias] = useState<Categoria[] | null>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [aviso, setAviso] = useState<null | string>(null);
  const [recarregar, setRecarregar] = useState(0);

  /** Onde a nova categoria vai nascer: `null` = primeiro nível; um id = subcategoria dele. */
  const [criandoSob, setCriandoSob] = useState<null | string | undefined>(undefined);
  const [nomeNovo, setNomeNovo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [apagando, setApagando] = useState<null | string>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(
        `/api/temis/categorias?enterpriseId=${encodeURIComponent(enterpriseId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const corpo = (await r.json().catch(() => ({}))) as {
        data?: { categorias: Categoria[] };
        error?: string;
      };
      if (!r.ok || !corpo.data) {
        setErro(corpo.error ?? "Não consegui carregar as categorias.");
        setCategorias([]);
        return;
      }
      setCategorias(corpo.data.categorias);
    } catch {
      setErro("Falha de rede ao carregar as categorias.");
      setCategorias([]);
    }
  }, [enterpriseId]);

  useEffect(() => {
    void carregar();
  }, [carregar, recarregar]);

  const criar = async () => {
    const nome = nomeNovo.trim();
    if (!nome || criandoSob === undefined) return;

    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(
        `/api/temis/categorias?enterpriseId=${encodeURIComponent(enterpriseId)}`,
        {
          body: JSON.stringify({ categoriaPaiId: criandoSob, nome }),
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const corpo = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErro(corpo.error ?? "Não consegui criar a categoria.");
        return;
      }
      setNomeNovo("");
      setCriandoSob(undefined);
      setAviso(`Categoria "${nome}" criada.`);
      setRecarregar((n) => n + 1);
    } catch {
      setErro("Falha de rede ao criar a categoria.");
    } finally {
      setSalvando(false);
    }
  };

  const apagar = async (categoria: Categoria) => {
    const lotes = categoria.unidades ?? 0;
    const pergunta =
      lotes > 0
        ? `"${categoria.nome}" tem ${lotes === 1 ? "1 lote" : `${lotes} lotes`}. Eles voltam a seguir a regra geral do empreendimento. Excluir?`
        : `Excluir a categoria "${categoria.nome}"?`;
    if (!window.confirm(pergunta)) return;

    setApagando(categoria.id);
    setErro(null);
    setAviso(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(`/api/temis/categorias?id=${encodeURIComponent(categoria.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "DELETE",
      });
      const corpo = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErro(corpo.error ?? "Não consegui excluir a categoria.");
        return;
      }
      setAviso(`"${categoria.nome}" foi excluída.`);
      setRecarregar((n) => n + 1);
    } catch {
      setErro("Falha de rede ao excluir a categoria.");
    } finally {
      setApagando(null);
    }
  };

  const filhasDe = (paiId: null | string) =>
    (categorias ?? []).filter((c) => c.categoriaPaiId === paiId);

  const campoNovo = (sob: null | string) => (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <input
        autoFocus
        className="h-9 min-w-56 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-line-strong"
        onChange={(e) => setNomeNovo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void criar();
          if (e.key === "Escape") setCriandoSob(undefined);
        }}
        placeholder={sob ? "Nome da subcategoria (ex.: Fase 1)" : "Nome da categoria (ex.: Lotes caucionados)"}
        value={nomeNovo}
      />
      <button
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:opacity-40"
        disabled={salvando || !nomeNovo.trim()}
        onClick={() => void criar()}
        type="button"
      >
        {salvando ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
        Criar
      </button>
      <button
        className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3 text-sm text-ink-muted transition-colors hover:bg-subtle"
        onClick={() => setCriandoSob(undefined)}
        type="button"
      >
        Cancelar
      </button>
    </div>
  );

  /**
   * ⚠️ A ÁRVORE SE DESENHA SOZINHA, e a profundidade é do negócio: condomínio dentro de loteamento,
   * fase dentro de condomínio, caucionados dentro da fase. Limitar em dois níveis obrigaria o Lucas
   * a inventar nome composto no dia em que precisasse do terceiro.
   */
  const ramo = (categoria: Categoria, nivel: number) => (
    <div key={categoria.id}>
      <div
        className="flex flex-wrap items-center gap-2 border-b border-line/70 py-2 last:border-b-0"
        style={{ paddingLeft: nivel * 20 }}
      >
        {nivel > 0 ? (
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />
        ) : null}
        <span className="text-sm font-semibold text-ink">{categoria.nome}</span>
        {categoria.unidades ? (
          <span className="rounded-md bg-subtle px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft">
            {categoria.unidades === 1 ? "1 lote" : `${categoria.unidades} lotes`}
          </span>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:bg-subtle"
            onClick={() => {
              setNomeNovo("");
              setCriandoSob(categoria.id);
            }}
            type="button"
          >
            <Plus aria-hidden="true" className="size-3.5" />
            Subcategoria
          </button>
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-40 dark:text-rose-300 dark:hover:bg-rose-500/10"
            disabled={apagando === categoria.id}
            onClick={() => void apagar(categoria)}
            type="button"
          >
            {apagando === categoria.id ? (
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" className="size-3.5" />
            )}
            Excluir
          </button>
        </div>
      </div>

      {criandoSob === categoria.id ? (
        <div style={{ paddingLeft: (nivel + 1) * 20 }}>{campoNovo(categoria.id)}</div>
      ) : null}

      {filhasDe(categoria.id).map((filha) => ramo(filha, nivel + 1))}
    </div>
  );

  return (
    <div className="grid gap-4 p-5">
      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-subtle/40 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-inverse text-brand-ink">
              <FolderTree aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0">
              <h4 className="m-0 text-sm font-semibold text-ink">Categorias de {name}</h4>
              <p className="m-0 mt-0.5 text-xs text-ink-muted">
                Todo recorte do empreendimento que assina um contrato diferente — fase, condomínio,
                loteamento, lotes caucionados. É a categoria que decide quais planos valem para o
                lote, e o plano decide a minuta.
              </p>
            </div>
          </div>
          <button
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90"
            onClick={() => {
              setNomeNovo("");
              setCriandoSob(null);
            }}
            type="button"
          >
            <Plus aria-hidden="true" className="size-4" />
            Nova categoria
          </button>
        </div>

        <div className="px-4 py-3">
          {criandoSob === null ? campoNovo(null) : null}

          {!categorias ? (
            <p className="m-0 flex items-center gap-2 py-4 text-sm text-ink-muted">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              Carregando…
            </p>
          ) : categorias.length === 0 ? (
            <p className="m-0 py-4 text-sm text-ink-muted">
              Nenhuma categoria em {name}. Sem categoria, todos os lotes seguem a mesma minuta do
              produto — que é o caso da maioria dos empreendimentos.
            </p>
          ) : (
            <div className="grid">{filhasDe(null).map((c) => ramo(c, 0))}</div>
          )}
        </div>
      </section>

      {aviso ? (
        <p className="m-0 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
          {aviso}
        </p>
      ) : null}
      {erro ? (
        <p className="m-0 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
