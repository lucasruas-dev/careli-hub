"use client";

import { AlertTriangle, FolderTree, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// Só TIPOS do lib do Apolo: `empreendimentos.ts` é server-side (mysql2).
import type { ApoloEnterpriseUnit } from "@/lib/apolo/empreendimentos";

import {
  type Aplicacao,
  aplicar,
  conferir,
  lerUniverso,
  type Previsao,
  type Universo,
} from "./vinculo-de-unidades";

// A CATEGORIA E A DIVISÃO NA FICHA DA UNIDADE — o caminho UNITÁRIO.
//
// Lucas (15/09/2026): *"teremos cenários que precisamos cadastrar uma unidade nova e apontar essa
// estrutura, ou até mesmo atualizar"*. E em 21/09/2026: *"eu preciso também vincular as unidades no
// filho, categoria (quando existir)"*.
//
// ⚠️ UMA UNIDADE É O CAMINHO EM MASSA COM UM ITEM SÓ, e é por isso que esta tela chama a MESMA rota
// (/api/apolo/empreendimentos/unidades/vinculo). De graça ela ganha o alcance por terreno (o gêmeo
// do pai vai junto), a conferência de que a categoria é da família, a trava da divisão com venda
// viva e o carimbo de quem mudou. Uma rota própria para "só esta unidade" seria a segunda régua.
//
// ⚠️ E NÃO PASSA PELO CADASTRO (`acao: "atualizar"`). Lá `EDITAVEIS` é preço, área e matrícula — as
// propriedades da unidade. Categoria e divisão são VÍNCULO: abrir espaço para elas naquele caminho
// duplicaria a régua do gêmeo e da venda viva dentro de `montarAtualizacao`. É o mesmo movimento que
// o bloqueio já fez, com rota própria.

type Props = {
  /** O código do produto na tela, para o servidor resolver a ficha consolidada. */
  codigo?: null | string;
  /** O id do produto como a ficha o conhece ("31", "pai:<uuid>" ou "group:Lagoa Bonita"). */
  enterpriseId: string;
  recarregar: () => void;
  unidade: ApoloEnterpriseUnit;
};

const CAMPO =
  "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-xs text-ink outline-none";

export function AcaoDeCategoria({ codigo, enterpriseId, recarregar, unidade }: Props) {
  const [aberto, setAberto] = useState(false);

  // Sem linha no Panteon não há o que vincular: a unidade nem existe no cadastro.
  if (!unidade.panteonId || unidade.semCadastroNoPanteon) return null;

  return (
    <>
      <button
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-ink transition-colors hover:border-ink/40 hover:bg-subtle"
        onClick={() => setAberto(true)}
        title="Categoria e divisão desta unidade"
        type="button"
      >
        <FolderTree aria-hidden="true" className="size-3.5" />
        Categoria
      </button>

      {aberto ? (
        <ModalDaCategoria
          aoFechar={() => setAberto(false)}
          aoGravar={() => {
            setAberto(false);
            recarregar();
          }}
          codigo={codigo}
          enterpriseId={enterpriseId}
          unidade={unidade}
        />
      ) : null}
    </>
  );
}

function ModalDaCategoria({
  aoFechar,
  aoGravar,
  codigo,
  enterpriseId,
  unidade,
}: {
  aoFechar: () => void;
  aoGravar: () => void;
  codigo?: null | string;
  enterpriseId: string;
  unidade: ApoloEnterpriseUnit;
}) {
  const panteonId = String(unidade.panteonId);
  const [universo, setUniverso] = useState<null | Universo>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [categoriaId, setCategoriaId] = useState<string>("");
  const [divisaoDestino, setDivisaoDestino] = useState("");
  const [confirmouDivisao, setConfirmouDivisao] = useState(false);
  const [previsao, setPrevisao] = useState<null | Previsao>(null);
  const [resultado, setResultado] = useState<null | Aplicacao>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const carregar = useCallback(async () => {
    setErro(null);
    const r = await lerUniverso({ codigo, enterpriseId });
    if ("erro" in r) {
      setErro(r.erro);
      return;
    }
    setUniverso(r.data);
    const atual = r.data.unidades.find((u) => u.id === panteonId);
    setCategoriaId(atual?.categoriaId ?? "");
  }, [codigo, enterpriseId, panteonId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const linha = universo?.unidades.find((u) => u.id === panteonId) ?? null;
  const atualId = linha?.categoriaId ?? "";
  const divisaoAtual = linha?.enterpriseId ?? "";
  const mudouCategoria = categoriaId !== atualId;
  const mudouDivisao = divisaoDestino !== "" && divisaoDestino !== divisaoAtual;
  const podeConferir = mudouCategoria || mudouDivisao;
  const precisaConfirmar = (previsao?.resumo.movem ?? 0) > 0 && !confirmouDivisao;

  const pedido = () => ({
    ...(mudouCategoria ? { categoriaId: categoriaId || null } : {}),
    ...(mudouDivisao ? { divisaoDestino } : {}),
    codigo,
    confirmarDivisao: confirmouDivisao,
    enterpriseId,
    origem: "ficha" as const,
    unidadeIds: [panteonId],
  });

  async function conferirAgora() {
    setOcupado(true);
    setErro(null);
    setResultado(null);
    const r = await conferir(pedido());
    setOcupado(false);
    if ("erro" in r) {
      setErro(r.erro);
      return;
    }
    setPrevisao(r.data);
  }

  async function gravar() {
    setOcupado(true);
    setErro(null);
    const r = await aplicar(pedido());
    setOcupado(false);
    if ("erro" in r) {
      setErro(r.erro);
      return;
    }
    setResultado(r.data);
    // ⚠️ RECUSA NÃO É SUCESSO. Se o servidor recusou a mudança de divisão (venda viva, gêmea no
    // destino), a janela fica aberta com o motivo: fechar e recarregar faria a tela parecer que deu
    // certo, e o operador só descobriria no contrato.
    if (r.data.recusas.length === 0 && r.data.naoMovidas === 0) aoGravar();
  }

  const nomeDaCategoria = (id: null | string) =>
    universo?.categorias.find((c) => c.id === id)?.nome ?? "sem categoria";
  const nomeDaDivisao = (id: string) =>
    universo?.divisoes.find((d) => d.enterpriseId === id)?.nome ?? id;

  return (
    <div className="fixed inset-0 z-[var(--uix-z-modal)] grid place-items-center bg-black/40 p-4 text-left">
      <button
        aria-label="Fechar"
        className="absolute inset-0 cursor-default"
        onClick={aoFechar}
        type="button"
      />
      <div
        aria-modal="true"
        className="relative z-10 flex max-h-[86vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        role="dialog"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-2 text-sm font-semibold text-ink">
              <FolderTree aria-hidden="true" className="size-4 text-ink-muted" />
              {unidade.code}
            </p>
            <p className="m-0 mt-0.5 text-xs text-ink-muted">
              {linha
                ? `${nomeDaDivisao(divisaoAtual)} · ${atualId ? nomeDaCategoria(atualId) : "sem categoria"}`
                : "Carregando…"}
            </p>
          </div>
          <button
            aria-label="Voltar"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
            onClick={aoFechar}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>

        <div className="grid min-h-0 gap-4 overflow-auto p-5">
          {erro ? (
            <p className="m-0 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
              {erro}
            </p>
          ) : null}

          <section>
            <label
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted"
              htmlFor="categoria-da-unidade"
            >
              Categoria
            </label>
            <select
              className={CAMPO}
              disabled={!universo || ocupado}
              id="categoria-da-unidade"
              onChange={(e) => {
                setCategoriaId(e.target.value);
                setPrevisao(null);
                setResultado(null);
              }}
              value={categoriaId}
            >
              <option value="">Sem categoria</option>
              {(universo?.categorias ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
            {/* ⚠️ SEM CATEGORIA É O ESTADO NORMAL, e a frase existe para ninguém cadastrar uma "por
                segurança": são 5.540 unidades vivas e a maioria esmagadora assina a minuta do
                produto. */}
            <p className="m-0 mt-1 text-[11px] text-ink-muted">
              {(universo?.categorias.length ?? 0) === 0
                ? "Este empreendimento não tem categorias. Sem categoria, o lote segue a minuta do produto."
                : "Sem categoria, o lote segue a minuta do produto. O registro antigo do mesmo terreno é carimbado junto."}
            </p>
            {linha?.vinculo ? (
              <p className="m-0 mt-1 text-[11px] text-ink-muted">
                Vinculado por {linha.vinculo.por ?? "alguém"} em{" "}
                {new Date(linha.vinculo.em).toLocaleDateString("pt-BR")}
                {linha.vinculo.origem ? ` (${linha.vinculo.origem})` : ""}.
              </p>
            ) : null}
          </section>

          {(universo?.divisoes.length ?? 0) > 1 ? (
            <section className="rounded-xl border border-dashed border-line p-3">
              <label
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted"
                htmlFor="divisao-da-unidade"
              >
                Divisão
              </label>
              <select
                className={CAMPO}
                disabled={!universo || ocupado}
                id="divisao-da-unidade"
                onChange={(e) => {
                  setDivisaoDestino(e.target.value);
                  setPrevisao(null);
                  setResultado(null);
                  setConfirmouDivisao(false);
                }}
                value={divisaoDestino || divisaoAtual}
              >
                {(universo?.divisoes ?? []).map((d) => (
                  <option key={d.enterpriseId} value={d.enterpriseId}>
                    {d.pai ? `${d.nome} (o conjunto)` : d.nome}
                  </option>
                ))}
              </select>
              <p className="m-0 mt-1 text-[11px] text-ink-muted">
                Mudar a divisão muda quem enxerga o lote no portal, a minuta do contrato e a
                comissão. Só vale para lote livre.
              </p>
            </section>
          ) : null}

          {previsao ? (
            <section className="rounded-xl border border-line bg-subtle/50 p-3 text-xs text-ink">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                O que vai mudar
              </p>
              {previsao.resumo.linhas === 0 && previsao.resumo.movem === 0 ? (
                <p className="m-0 mt-1">Nada muda: a unidade já está assim.</p>
              ) : null}
              {previsao.categorias.map((g) => (
                <p className="m-0 mt-1" key={g.categoriaId ?? "sem"}>
                  {g.previa.terrenos - g.previa.jaEstao > 0
                    ? `O terreno passa para ${g.categoriaId ? g.nome : "sem categoria"}`
                    : "A categoria não muda"}
                  {g.previa.porParentesco > 0
                    ? `, e o registro antigo do mesmo terreno vai junto`
                    : ""}
                  .
                </p>
              ))}
              {previsao.avisos.length > 0 ? (
                <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  <p className="m-0 flex items-center gap-1 font-semibold">
                    <AlertTriangle aria-hidden="true" className="size-3.5" />
                    Leia antes de confirmar
                  </p>
                  <ul className="m-0 mt-1 list-disc pl-4">
                    {previsao.avisos.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {previsao.recusas.length > 0 ? (
                <ul className="m-0 mt-2 list-disc pl-4 text-rose-700 dark:text-rose-300">
                  {previsao.recusas.map((r) => (
                    <li key={r.unidadeId}>{r.motivo}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {(previsao?.resumo.movem ?? 0) > 0 ? (
            <label className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <input
                checked={confirmouDivisao}
                className="mt-0.5"
                onChange={(e) => setConfirmouDivisao(e.target.checked)}
                type="checkbox"
              />
              <span>Li os avisos e quero mover esta unidade de divisão.</span>
            </label>
          ) : null}

          {resultado ? (
            <section className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
              <p className="m-0 font-semibold">
                {resultado.recusas.length > 0 || resultado.naoMovidas > 0
                  ? "Parte não entrou."
                  : "Pronto."}
              </p>
              {resultado.recusas.map((r) => (
                <p className="m-0 mt-1" key={r.unidadeId}>
                  {r.motivo}
                </p>
              ))}
              {resultado.naoMovidas > 0 ? (
                <p className="m-0 mt-1">
                  A unidade mudou entre a conferência e o clique. Recarregue e tente de novo.
                </p>
              ) : null}
            </section>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button
            className="h-9 rounded-lg border border-line bg-surface px-3.5 text-sm font-semibold text-ink-soft transition-colors hover:bg-subtle hover:text-ink"
            onClick={aoFechar}
            type="button"
          >
            Voltar
          </button>
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 text-sm font-semibold text-ink disabled:opacity-50"
            disabled={!podeConferir || ocupado}
            onClick={() => void conferirAgora()}
            type="button"
          >
            {ocupado ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            Conferir
          </button>
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-bold text-brand-ink disabled:opacity-60"
            disabled={!previsao || ocupado || precisaConfirmar}
            onClick={() => void gravar()}
            type="button"
          >
            {ocupado ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            Salvar
          </button>
        </footer>
      </div>
    </div>
  );
}
