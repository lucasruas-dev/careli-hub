"use client";

import { AlertTriangle, FolderTree, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

// Só TIPOS do lib do Apolo: `empreendimentos.ts` é server-side (mysql2).
import type { ApoloEnterpriseUnit } from "@/lib/apolo/empreendimentos";

import {
  type Aplicacao,
  aplicar,
  conferir,
  type Previsao,
  type Universo,
} from "./vinculo-de-unidades";

// A CATEGORIA E A DIVISÃO NA FICHA DA UNIDADE — o caminho UNITÁRIO.
//
// Lucas (15/09/2026): *"teremos cenários que precisamos cadastrar uma unidade nova e apontar essa
// estrutura, ou até mesmo atualizar"*. E em 21/09/2026: *"eu preciso também vincular as unidades no
// filho, categoria (quando existir)"*.
//
// ⚠️ ISTO É UM BLOCO DA FICHA DO LOTE, E NÃO MAIS UMA JANELA. Nasceu como modal aberto por um botão
// na linha da tabela e virou bloco em 21/09/2026, quando o Lucas pediu a aba de cadastro da
// unidade: *"preciso ter a aba cadastro de unidade a qual vai ter o cadastro daquela unidade a qual
// eu posso fazer a vinculação das categorias, inserir os anexos se for o caso"*. Duas portas para o
// mesmo vínculo (o botão da linha e a aba) seriam duas réguas na cabeça de quem opera.
//
// ⚠️ O UNIVERSO VEM DE FORA (`CadastroDaUnidade`), e não de um fetch daqui. A mesma resposta diz a
// categoria de hoje, as divisões da família E de qual divisão a unidade é — e é essa divisão que a
// edição dos dados do lote precisa para falar com a porta do cadastro. Buscar duas vezes traria a
// lista inteira de unidades duas vezes (907 no Lagoa Bonita) para responder à mesma pergunta.
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
  /** Relê a tabela de unidades lá em cima depois de a gravação entrar inteira. */
  aoGravar: () => void;
  /** O código do produto na tela, para o servidor resolver a ficha consolidada. */
  codigo?: null | string;
  /** O id do produto como a ficha o conhece ("31", "pai:<uuid>" ou "group:Lagoa Bonita"). */
  enterpriseId: string;
  /** Relê o universo depois de gravar: é dele que sai o carimbo de quem vinculou. */
  recarregarUniverso: () => Promise<void>;
  unidade: ApoloEnterpriseUnit;
  /** Nulo enquanto carrega. */
  universo: null | Universo;
};

const CAMPO =
  "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-xs text-ink outline-none";

export function VinculoDaUnidade({
  aoGravar,
  codigo,
  enterpriseId,
  recarregarUniverso,
  unidade,
  universo,
}: Props) {
  const panteonId = unidade.panteonId ? String(unidade.panteonId) : "";
  const semCadastro = !panteonId || unidade.semCadastroNoPanteon === true;
  const [erro, setErro] = useState<null | string>(null);
  const [categoriaId, setCategoriaId] = useState<string>("");
  const [divisaoDestino, setDivisaoDestino] = useState("");
  const [confirmouDivisao, setConfirmouDivisao] = useState(false);
  const [previsao, setPrevisao] = useState<null | Previsao>(null);
  const [resultado, setResultado] = useState<null | Aplicacao>(null);
  const [ocupado, setOcupado] = useState(false);

  const linha = universo?.unidades.find((u) => u.id === panteonId) ?? null;
  const atualId = linha?.categoriaId ?? "";
  const divisaoAtual = linha?.enterpriseId ?? "";

  // O que está gravado manda no campo sempre que o universo chega ou volta a chegar (depois de
  // salvar): sem isto, o select continuaria mostrando a escolha antiga como se fosse o gravado.
  useEffect(() => {
    setCategoriaId(atualId);
    setDivisaoDestino("");
  }, [atualId, divisaoAtual]);

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
    // destino), o bloco fica na tela com o motivo: limpar e recarregar faria a tela parecer que deu
    // certo, e o operador só descobriria no contrato.
    if (r.data.recusas.length === 0 && r.data.naoMovidas === 0) {
      setPrevisao(null);
      setConfirmouDivisao(false);
      await recarregarUniverso();
      aoGravar();
    }
  }

  const nomeDaCategoria = (id: null | string) =>
    universo?.categorias.find((c) => c.id === id)?.nome ?? "sem categoria";
  const nomeDaDivisao = (id: string) =>
    universo?.divisoes.find((d) => d.enterpriseId === id)?.nome ?? id;

  // ⚠️ SEM LINHA NO PANTEON NÃO HÁ O QUE VINCULAR, e dizer isso é melhor que um formulário morto: a
  // unidade existe no C2X e o sync ainda não a trouxe.
  if (semCadastro) {
    return (
      <p className="m-0 rounded-xl border border-dashed border-line px-3 py-2.5 text-xs text-ink-muted">
        Esta unidade ainda não entrou no cadastro do Panteon, então não há linha para vincular.
        Depois da próxima sincronização ela aceita divisão e categoria.
      </p>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <header className="flex items-start gap-3 border-b border-line bg-subtle/40 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-inverse text-brand-ink">
          <FolderTree aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0">
          <h4 className="m-0 text-sm font-semibold text-ink">Filho e categoria</h4>
          <p className="m-0 mt-0.5 text-xs text-ink-muted">
            {linha
              ? `Hoje: ${nomeDaDivisao(divisaoAtual)} · ${atualId ? nomeDaCategoria(atualId) : "sem categoria"}`
              : "Carregando…"}
          </p>
        </div>
      </header>

      <div className="grid gap-4 p-4">
        {erro ? (
          <p className="m-0 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
            {erro}
          </p>
        ) : null}

        <div>
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
              ? "Este empreendimento não tem categorias. Sem categoria, o lote segue a minuta do produto, e a categoria nova se cadastra no Setup do empreendimento."
              : "Sem categoria, o lote segue a minuta do produto. O registro antigo do mesmo terreno é carimbado junto."}
          </p>
          {linha?.vinculo ? (
            <p className="m-0 mt-1 text-[11px] text-ink-muted">
              Vinculado por {linha.vinculo.por ?? "alguém"} em{" "}
              {new Date(linha.vinculo.em).toLocaleDateString("pt-BR")}
              {linha.vinculo.origem ? ` (${linha.vinculo.origem})` : ""}.
            </p>
          ) : null}
        </div>

        {(universo?.divisoes.length ?? 0) > 1 ? (
          <div className="rounded-xl border border-dashed border-line p-3">
            <label
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted"
              htmlFor="divisao-da-unidade"
            >
              Filho
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
              Mudar o filho muda quem enxerga o lote no portal, a minuta do contrato e a comissão. Só
              vale para lote livre.
            </p>
          </div>
        ) : null}

        {previsao ? (
          <div className="rounded-xl border border-line bg-subtle/50 p-3 text-xs text-ink">
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
          </div>
        ) : null}

        {(previsao?.resumo.movem ?? 0) > 0 ? (
          <label className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <input
              checked={confirmouDivisao}
              className="mt-0.5"
              onChange={(e) => setConfirmouDivisao(e.target.checked)}
              type="checkbox"
            />
            <span>Li os avisos e quero mover esta unidade de filho.</span>
          </label>
        ) : null}

        {resultado ? (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
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
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
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
        </div>
      </div>
    </section>
  );
}
