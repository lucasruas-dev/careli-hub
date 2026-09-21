"use client";

import { AlertTriangle, ArrowRightLeft, Check, FileSpreadsheet, ListChecks, Loader2, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { filtrarUnidades, lerFaixaDeLotes } from "@/lib/hercules/unidade-vinculo";

import {
  type Aplicacao,
  aplicar,
  conferir,
  lerUniverso,
  type Previsao,
  type Universo,
} from "./vinculo-de-unidades";

// VINCULAR LOTES A UMA CATEGORIA — o caminho EM MASSA.
//
// Lucas (15/09/2026): *"eu criei umas categorias mas não tem como eu vincular a unidade aquela
// categoria"*. E em 21/09/2026: *"eu preciso também vincular as unidades no filho, categoria (quando
// existir)"*.
//
// ⚠️ ESCOLHER POR QUADRA E POR FAIXA É O CAMINHO REAL, e não um atalho. A Lagoa Bonita tem 907
// unidades: marcar lote a lote não é trabalho de tela, é de banco. O operador pensa por quadra
// ("marcar a quadra C") e por faixa ("do 01 ao 40"), e é assim que a planilha dele já é montada.
//
// ⚠️ E UMA LINHA POR TERRENO, nunca duas. O mesmo lote existe no pai e na gleba; a rota devolve só a
// linha viva e carimba as duas de uma vez. Mostrar as duas faria o operador escolher o mesmo terreno
// duas vezes e a contagem mentir.
//
// ⚠️ A PRÉVIA VEM ANTES DE GRAVAR, SEMPRE. Um clique aqui pode carimbar 900 lotes; a prévia diz
// quantos entram, quantos já estavam, de qual categoria estão saindo e quantos têm venda andando.
// Quem confirma sabe o que vai acontecer — e o servidor recalcula tudo do zero ao aplicar, porque
// entre a conferência e o clique cabe uma venda.
//
// ⚠️ MOVER DE DIVISÃO MORA AQUI, MAS APAGADO. Trocar a categoria é reversível; trocar a divisão muda
// quem enxerga o lote no portal, qual minuta sai, qual comissão vale e deixa o código apontando para
// o masterplan da gleba antiga. Por isso é um painel separado, com os avisos por extenso e uma
// confirmação explícita.

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

type Aba = "lista" | "planilha";

const CAMPO =
  "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-xs text-ink outline-none placeholder:text-ink-muted";

const MODELO_DA_PLANILHA = "Quadra;Lote;Categoria;Divisão\nC;01;Condomínio;\nC;02;;LBR\n";

export function VincularLotes({
  categoriaId,
  categoriaNome,
  codigo,
  enterpriseId,
  onFechar,
  onGravou,
}: Props) {
  const [universo, setUniverso] = useState<null | Universo>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [aba, setAba] = useState<Aba>("lista");

  const [termo, setTermo] = useState("");
  const [faixa, setFaixa] = useState("");
  const [divisao, setDivisao] = useState("");
  const [situacao, setSituacao] = useState("");
  const [estadoDaCategoria, setEstadoDaCategoria] = useState<"nesta" | "noutra" | "qualquer" | "sem">(
    "qualquer",
  );

  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [destinoDaDivisao, setDestinoDaDivisao] = useState("");
  const [confirmouDivisao, setConfirmouDivisao] = useState(false);
  /**
   * Vincular ou tirar — e as duas passam pela prévia.
   *
   * ⚠️ TIRAR A CATEGORIA TAMBÉM É UM CLIQUE QUE ALCANÇA 900 LOTES. Ela era um botão direto, sem
   * conferência: a escolha aqui é entre duas ações da MESMA seleção, e só depois vem o "Conferir".
   */
  const [acao, setAcao] = useState<"tirar" | "vincular">("vincular");

  const [planilha, setPlanilha] = useState("");
  const [previsao, setPrevisao] = useState<null | Previsao>(null);
  const [resultado, setResultado] = useState<null | Aplicacao>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  const carregar = useCallback(async () => {
    setErro(null);
    const r = await lerUniverso({ codigo, enterpriseId });
    if ("erro" in r) {
      setErro(r.erro);
      return;
    }
    setUniverso(r.data);
  }, [codigo, enterpriseId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const erroDaFaixa = useMemo(() => lerFaixaDeLotes(faixa).erro, [faixa]);

  // ⚠️ O FILTRO É A MESMA RÉGUA DO SERVIDOR (`filtrarUnidades`), importada e não reescrita: a tela e
  // o motor não podem discordar sobre o que "do 01 ao 40" quer dizer.
  const visiveis = useMemo(() => {
    if (!universo) return [];
    return filtrarUnidades(
      universo.unidades.map((u) => ({
        apartamento: u.apartamento,
        categoria_id: u.categoriaId,
        codigo: u.codigo,
        enterprise_id: u.enterpriseId,
        id: u.id,
        lote: u.lote,
        quadra: u.quadra,
        situacao: u.situacao,
        torre: u.torre,
      })),
      {
        categoria: estadoDaCategoria,
        divisoes: divisao ? [divisao] : [],
        faixa,
        situacoes: situacao ? [situacao] : [],
        termo,
      },
      { categoriaAlvo: categoriaId },
    );
  }, [categoriaId, divisao, estadoDaCategoria, faixa, situacao, termo, universo]);

  const nomeDaDivisao = useMemo(() => {
    const mapa = new Map((universo?.divisoes ?? []).map((d) => [d.enterpriseId, d.codigo || d.nome]));
    return (id: string) => mapa.get(id) ?? id;
  }, [universo]);

  const situacoesExistentes = useMemo(
    () => [...new Set((universo?.unidades ?? []).map((u) => u.situacao).filter(Boolean))].sort(),
    [universo],
  );

  /** Os lotes agrupados por quadra — é por quadra que o operador pensa. */
  const porQuadra = useMemo(() => {
    const mapa = new Map<string, typeof visiveis>();
    for (const u of visiveis) {
      const q = String(u.quadra ?? "") || "—";
      const atual = mapa.get(q);
      if (atual) atual.push(u);
      else mapa.set(q, [u]);
    }
    return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  }, [visiveis]);

  /** Qualquer mexida na seleção invalida a prévia: confirmar a antiga seria confirmar outra coisa. */
  const mexeu = () => {
    setPrevisao(null);
    setResultado(null);
    setConfirmouDivisao(false);
    setErro(null);
  };

  const alternar = (id: string) => {
    mexeu();
    setEscolhidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  };

  const alternarLote = (lotes: { id: string }[]) => {
    mexeu();
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

  const pedido = (paraCategoria?: null | string) => ({
    ...(paraCategoria === undefined ? {} : { categoriaId: paraCategoria }),
    ...(destinoDaDivisao && aba === "lista" ? { divisaoDestino: destinoDaDivisao } : {}),
    ...(aba === "planilha" ? { csv: planilha } : { unidadeIds: [...escolhidos] }),
    codigo,
    confirmarDivisao: confirmouDivisao,
    enterpriseId,
    origem: (aba === "planilha" ? "planilha" : "massa") as "massa" | "planilha",
  });

  async function pedirPrevia(paraCategoria?: null | string) {
    setOcupado(true);
    setErro(null);
    setResultado(null);
    const r = await conferir(pedido(paraCategoria));
    setOcupado(false);
    if ("erro" in r) {
      setErro(r.erro);
      return;
    }
    setPrevisao(r.data);
  }

  async function gravar(paraCategoria?: null | string) {
    setOcupado(true);
    setErro(null);
    const r = await aplicar(pedido(paraCategoria));
    setOcupado(false);
    if ("erro" in r) {
      // ⚠️ O QUE JÁ ENTROU APARECE, E A LISTA RECARREGA. Um envio grande vai em blocos: quando o
      // segundo cai, o primeiro JÁ GRAVOU. Até 21/09/2026 a tela mostrava só a mensagem de erro em
      // cima do retrato anterior, com os lotes ainda pintados como estavam — e o operador clicava
      // de novo em cima de dado velho, regravando o que já tinha entrado.
      const feito = r.parcial;
      const antes =
        feito && feito.gravadas + feito.movidas > 0
          ? `${feito.gravadas + feito.movidas} ${feito.gravadas + feito.movidas === 1 ? "lote já foi gravado" : "lotes já foram gravados"} antes da falha, e a lista foi recarregada. `
          : "";
      setErro(`${antes}${r.erro}`);
      setPrevisao(null);
      setEscolhidos(new Set());
      await carregar();
      onGravou();
      return;
    }
    setResultado(r.data);
    setPrevisao(null);
    setEscolhidos(new Set());
    setConfirmouDivisao(false);
    await carregar();
    onGravou();
  }

  const jaNesta = (universo?.unidades ?? []).filter((u) => u.categoriaId === categoriaId).length;
  const temSelecao = aba === "planilha" ? planilha.trim() !== "" : escolhidos.size > 0;
  /**
   * O alvo da ação escolhida.
   *
   * ⚠️ `undefined` NA PLANILHA É DIFERENTE DE `null`. `null` manda "tire a categoria de todos";
   * ausente manda "não mexa na categoria pelo corpo", e aí quem decide é cada linha do arquivo.
   */
  const alvoDaAcao: null | string | undefined =
    aba === "planilha" ? undefined : acao === "tirar" ? null : categoriaId;
  const querMover = aba === "lista" && destinoDaDivisao !== "";
  const precisaConfirmarDivisao = (previsao?.resumo.movem ?? 0) > 0 && !confirmouDivisao;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-6">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-2xl border border-line bg-surface shadow-xl">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-ink">
              Vincular lotes · {categoriaNome}
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              {universo === null
                ? "Carregando…"
                : `${universo.unidades.length} lotes em ${universo.empreendimento.nome} · ${jaNesta} nesta categoria`}
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

        <div className="flex items-center gap-1 border-b border-line px-5 pt-3">
          {(
            [
              ["lista", "Escolher na lista", ListChecks],
              ["planilha", "Subir planilha", FileSpreadsheet],
            ] as const
          ).map(([chave, texto, Icone]) => (
            <button
              className={`inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
                aba === chave
                  ? "border-ink text-ink"
                  : "border-transparent text-ink-muted hover:text-ink"
              }`}
              key={chave}
              onClick={() => {
                setAba(chave);
                mexeu();
              }}
              type="button"
            >
              <Icone aria-hidden="true" className="size-3.5" />
              {texto}
            </button>
          ))}
        </div>

        {aba === "lista" ? (
          <div className="grid gap-2 border-b border-line px-5 py-3 sm:grid-cols-5">
            <div className="flex items-center gap-2 rounded-lg border border-line bg-subtle px-2.5 sm:col-span-2">
              <Search aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
              <input
                className="h-9 w-full bg-transparent text-xs text-ink outline-none placeholder:text-ink-muted"
                onChange={(e) => {
                  setTermo(e.target.value);
                  mexeu();
                }}
                placeholder="Quadra, lote ou código"
                value={termo}
              />
            </div>
            <div>
              <input
                className={`${CAMPO} ${erroDaFaixa ? "border-rose-400" : ""}`}
                onChange={(e) => {
                  setFaixa(e.target.value);
                  mexeu();
                }}
                placeholder="Faixa: 1-40, 45"
                value={faixa}
              />
            </div>
            <select
              className={CAMPO}
              onChange={(e) => {
                setDivisao(e.target.value);
                mexeu();
              }}
              value={divisao}
            >
              <option value="">Todas as divisões</option>
              {(universo?.divisoes ?? []).map((d) => (
                <option key={d.enterpriseId} value={d.enterpriseId}>
                  {d.pai ? `${d.nome} (registro do pai)` : d.nome}
                </option>
              ))}
            </select>
            <select
              className={CAMPO}
              onChange={(e) => {
                setSituacao(e.target.value);
                mexeu();
              }}
              value={situacao}
            >
              <option value="">Todas as situações</option>
              {situacoesExistentes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className={`${CAMPO} sm:col-span-2`}
              onChange={(e) => {
                setEstadoDaCategoria(e.target.value as typeof estadoDaCategoria);
                mexeu();
              }}
              value={estadoDaCategoria}
            >
              <option value="qualquer">Com ou sem categoria</option>
              <option value="sem">Só os sem categoria</option>
              <option value="nesta">Só os que já estão em {categoriaNome}</option>
              <option value="noutra">Só os que estão em outra categoria</option>
            </select>
            <div className="flex items-center gap-2 sm:col-span-3">
              <button
                className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-2.5 text-[11px] font-semibold text-ink transition-colors hover:bg-subtle disabled:opacity-40"
                disabled={visiveis.length === 0}
                onClick={() => alternarLote(visiveis)}
                type="button"
              >
                Marcar os {visiveis.length} visíveis
              </button>
              <button
                className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-2.5 text-[11px] font-semibold text-ink transition-colors hover:bg-subtle disabled:opacity-40"
                disabled={escolhidos.size === 0}
                onClick={() => {
                  mexeu();
                  setEscolhidos(new Set());
                }}
                type="button"
              >
                Limpar seleção
              </button>
              {erroDaFaixa ? (
                <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                  {erroDaFaixa}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {erro ? (
            <p className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
              {erro}
            </p>
          ) : null}

          {universo === null && !erro ? (
            <p className="py-6 text-center text-xs text-ink-muted">Carregando os lotes…</p>
          ) : null}

          {aba === "planilha" ? (
            <section className="grid gap-2">
              <p className="m-0 text-xs text-ink-muted">
                Cole a planilha (ou o CSV exportado do Excel). A primeira linha é o cabeçalho. A
                coluna <strong>Categoria</strong> aceita o nome cadastrado, ou a palavra{" "}
                <strong>sem</strong> para tirar a categoria; a coluna <strong>Divisão</strong> aceita
                o código ou o nome da gleba. Célula em branco não mexe em nada.
              </p>
              <textarea
                className="min-h-[180px] w-full rounded-lg border border-line bg-subtle/60 px-3 py-2 font-mono text-[11px] text-ink outline-none"
                onChange={(e) => {
                  setPlanilha(e.target.value);
                  mexeu();
                }}
                placeholder={MODELO_DA_PLANILHA}
                value={planilha}
              />
              <button
                className="justify-self-start text-[11px] font-semibold text-ink-muted underline"
                onClick={() => {
                  setPlanilha(MODELO_DA_PLANILHA);
                  mexeu();
                }}
                type="button"
              >
                Usar o modelo de exemplo
              </button>
              {(universo?.categorias.length ?? 0) > 0 ? (
                <p className="m-0 text-[11px] text-ink-muted">
                  Categorias aceitas: {universo?.categorias.map((c) => c.nome).join(" · ")}
                </p>
              ) : null}
            </section>
          ) : null}

          {aba === "lista" && universo !== null && visiveis.length === 0 ? (
            <p className="py-6 text-center text-xs text-ink-muted">
              Nenhum lote com esse recorte.
            </p>
          ) : null}

          {aba === "lista"
            ? porQuadra.map(([quadra, lotes]) => {
                const todos = lotes.every((u) => escolhidos.has(u.id));
                return (
                  <section className="mb-4" key={quadra}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <button
                        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[11px] font-semibold text-ink transition-colors hover:bg-subtle"
                        onClick={() => alternarLote(lotes)}
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
                        const nesta = u.categoria_id === categoriaId;
                        const noutra = Boolean(u.categoria_id) && !nesta;
                        return (
                          <button
                            className={`inline-flex h-8 min-w-16 items-center justify-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-colors ${
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
                            // ⚠️ O TÍTULO DIZ O ESTADO E A DIVISÃO, porque a cor sozinha não serve a
                            // quem não distingue verde de âmbar — e porque numa família de glebas
                            // saber de qual gleba é o lote muda a decisão.
                            title={`${
                              nesta
                                ? `Já está em ${categoriaNome}`
                                : noutra
                                  ? "Está em outra categoria"
                                  : "Sem categoria"
                            } · ${nomeDaDivisao(String(u.enterprise_id ?? ""))} · ${u.situacao ?? ""}`}
                            type="button"
                          >
                            {marcado ? <Check aria-hidden="true" className="size-3" /> : null}
                            {u.lote || u.codigo}
                            <span className="text-[9px] font-normal opacity-70">
                              {nomeDaDivisao(String(u.enterprise_id ?? ""))}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })
            : null}

          {aba === "lista" ? (
            <section className="mt-2 rounded-xl border border-dashed border-line p-3">
              <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <ArrowRightLeft aria-hidden="true" className="size-3.5" />
                Mover para outra divisão (opcional)
              </p>
              <p className="m-0 mt-1 text-[11px] text-ink-muted">
                Muda quem enxerga o lote no portal, a minuta do contrato e a comissão. Só vale para
                lote livre: o que tem reserva, proposta ou venda é recusado com o motivo.
              </p>
              <select
                className={`${CAMPO} mt-2 max-w-xs`}
                onChange={(e) => {
                  setDestinoDaDivisao(e.target.value);
                  mexeu();
                }}
                value={destinoDaDivisao}
              >
                <option value="">Não mover de divisão</option>
                {(universo?.divisoes ?? []).map((d) => (
                  <option key={d.enterpriseId} value={d.enterpriseId}>
                    Mover para {d.nome}
                  </option>
                ))}
              </select>
            </section>
          ) : null}

          {previsao ? <PainelDaPrevia previsao={previsao} /> : null}
          {resultado ? <PainelDoResultado resultado={resultado} /> : null}

          {(previsao?.resumo.movem ?? 0) > 0 ? (
            <label className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <input
                checked={confirmouDivisao}
                className="mt-0.5"
                onChange={(e) => setConfirmouDivisao(e.target.checked)}
                type="checkbox"
              />
              <span>
                Li os avisos acima e quero mover {previsao?.resumo.movem} unidade
                {previsao?.resumo.movem === 1 ? "" : "s"} de divisão.
              </span>
            </label>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          <span className="text-xs text-ink-muted">
            {aba === "planilha"
              ? planilha.trim()
                ? "Planilha colada"
                : "Cole a planilha para conferir"
              : escolhidos.size === 0
                ? "Nenhum lote marcado"
                : `${escolhidos.size === 1 ? "1 lote" : `${escolhidos.size} lotes`} marcados`}
          </span>
          {universo?.semCarimbo ? (
            <span className="text-[11px] text-ink-muted" title="Migration 0181 ainda não aplicada">
              (o vínculo grava; o registro de quem vinculou ainda não)
            </span>
          ) : null}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* ⚠️ DESVINCULAR MORA AQUI, e não numa tela separada: o operador que marcou o lote
                errado desfaz no mesmo lugar onde errou. Manda `null`, que é o "volta a herdar" —
                e passa pela mesma prévia, porque tirar também alcança o loteamento inteiro. */}
            {aba === "lista" ? (
              <select
                className={`${CAMPO} w-auto`}
                onChange={(e) => {
                  setAcao(e.target.value as typeof acao);
                  mexeu();
                }}
                value={acao}
              >
                <option value="vincular">Vincular a {categoriaNome}</option>
                <option value="tirar">Tirar a categoria</option>
              </select>
            ) : null}

            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:bg-subtle disabled:opacity-40"
              disabled={!temSelecao || ocupado || Boolean(erroDaFaixa)}
              onClick={() => void pedirPrevia(alvoDaAcao)}
              type="button"
            >
              {ocupado ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null}
              Conferir o que vai mudar
            </button>

            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-4 text-xs font-semibold text-surface transition-opacity hover:opacity-90 disabled:opacity-40"
              disabled={!previsao || ocupado || precisaConfirmarDivisao}
              onClick={() => void gravar(alvoDaAcao)}
              title={previsao ? undefined : "Confira o que vai mudar antes de aplicar"}
              type="button"
            >
              {ocupado ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null}
              {aba === "planilha"
                ? "Aplicar a planilha"
                : acao === "tirar"
                  ? "Tirar a categoria"
                  : querMover
                    ? `Aplicar em ${categoriaNome} e mover`
                    : `Vincular a ${categoriaNome}`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** O que vai acontecer, em números e em frases. Nada aqui é calculado na tela. */
function PainelDaPrevia({ previsao }: { previsao: Previsao }) {
  const nada =
    previsao.resumo.linhas === 0 && previsao.resumo.movem === 0 && !previsao.planilha;

  return (
    <section className="mt-3 rounded-xl border border-line bg-subtle/50 p-3">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        O que vai mudar
      </p>

      {nada ? (
        <p className="m-0 mt-1 text-xs text-ink">
          Nada muda: os lotes marcados já estão como você pediu.
        </p>
      ) : null}

      {previsao.categorias.map((grupo) => (
        <div className="mt-2 text-xs text-ink" key={grupo.categoriaId ?? "sem"}>
          <p className="m-0 font-semibold">
            {grupo.previa.terrenos - grupo.previa.jaEstao} lote
            {grupo.previa.terrenos - grupo.previa.jaEstao === 1 ? "" : "s"}{" "}
            {grupo.categoriaId ? `entram em ${grupo.nome}` : "ficam sem categoria"}
          </p>
          <ul className="m-0 mt-1 list-disc pl-4 text-ink-soft">
            {grupo.previa.jaEstao > 0 ? (
              <li>{grupo.previa.jaEstao} já estavam assim e não são regravados.</li>
            ) : null}
            {grupo.previa.semCategoria > 0 ? (
              <li>{grupo.previa.semCategoria} não tinham categoria nenhuma.</li>
            ) : null}
            {grupo.previa.trocamDeCategoria.map((t) => (
              <li key={t.de}>
                {t.terrenos} {t.terrenos === 1 ? "sai" : "saem"} de {t.de}.
              </li>
            ))}
            {grupo.previa.porParentesco > 0 ? (
              <li>
                {grupo.previa.porParentesco} registro
                {grupo.previa.porParentesco === 1 ? "" : "s"} antigo
                {grupo.previa.porParentesco === 1 ? "" : "s"} do mesmo terreno {" "}
                {grupo.previa.porParentesco === 1 ? "vai" : "vão"} junto.
              </li>
            ) : null}
            {grupo.previa.vendaAndando > 0 ? (
              <li>{grupo.previa.vendaAndando} com venda em andamento (a categoria muda mesmo assim).</li>
            ) : null}
          </ul>
        </div>
      ))}

      {previsao.planilha ? <RelatorioDaPlanilha relatorio={previsao.planilha} /> : null}

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
        <div className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-2 text-[11px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          <p className="m-0 font-semibold">
            {previsao.recusas.length} não {previsao.recusas.length === 1 ? "vai" : "vão"}:
          </p>
          <ul className="m-0 mt-1 list-disc pl-4">
            {previsao.recusas.slice(0, 12).map((r) => (
              <li key={r.unidadeId}>
                <strong>{r.rotulo}</strong>: {r.motivo}
              </li>
            ))}
          </ul>
          {previsao.recusas.length > 12 ? (
            <p className="m-0 mt-1">e mais {previsao.recusas.length - 12}.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** O relatório da planilha: o que casou e o que não casou, com a linha do Excel. */
function RelatorioDaPlanilha({
  relatorio,
}: {
  relatorio: NonNullable<Previsao["planilha"]>;
}) {
  return (
    <div className="mt-2 text-xs text-ink">
      <p className="m-0 font-semibold">
        {relatorio.resumo.total} linha{relatorio.resumo.total === 1 ? "" : "s"} na planilha ·{" "}
        {relatorio.casaram.length} casaram · {relatorio.resumo.naoCasaram} não casaram ·{" "}
        {relatorio.resumo.semMudanca} sem mudança
      </p>
      {relatorio.naoCasaram.length > 0 ? (
        <div className="mt-1 max-h-40 overflow-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-[11px]">
            <thead className="bg-subtle text-ink-muted">
              <tr>
                <th className="px-2 py-1 text-left">Linha</th>
                <th className="px-2 py-1 text-left">Quadra/Lote</th>
                <th className="px-2 py-1 text-left">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {relatorio.naoCasaram.map((n) => (
                <tr className="border-t border-line/70" key={`${n.linha}-${n.valor}`}>
                  <td className="px-2 py-1 tabular-nums">{n.linha}</td>
                  <td className="px-2 py-1">{n.valor || "—"}</td>
                  <td className="px-2 py-1">{n.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** O que de fato aconteceu depois de gravar. */
function PainelDoResultado({ resultado }: { resultado: Aplicacao }) {
  return (
    <section className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
      <p className="m-0 font-semibold">
        {resultado.terrenos === 1 ? "1 lote" : `${resultado.terrenos} lotes`} atualizados
        {resultado.movidas > 0
          ? ` · ${resultado.movidas} ${resultado.movidas === 1 ? "movida" : "movidas"} de divisão`
          : ""}
        .
      </p>
      {resultado.porParentesco > 0 ? (
        <p className="m-0 mt-1">O registro antigo do mesmo terreno foi junto.</p>
      ) : null}
      {/* ⚠️ O QUE ESCAPOU ENTRE A PRÉVIA E O CLIQUE APARECE, e não some: uma reserva que nasceu no
          meio faz a gravação condicional casar zero linhas. */}
      {resultado.naoMovidas > 0 ? (
        <p className="m-0 mt-1 font-semibold">
          {resultado.naoMovidas} não {resultado.naoMovidas === 1 ? "foi movida" : "foram movidas"}: a
          unidade mudou entre a conferência e o clique. Confira e tente de novo.
        </p>
      ) : null}
      {resultado.planilha ? <RelatorioDaPlanilha relatorio={resultado.planilha} /> : null}
      {resultado.recusas.length > 0 ? (
        <ul className="m-0 mt-1 list-disc pl-4">
          {resultado.recusas.slice(0, 12).map((r) => (
            <li key={r.unidadeId}>
              <strong>{r.rotulo}</strong>: {r.motivo}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
