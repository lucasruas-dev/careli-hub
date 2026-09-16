"use client";

import { type ReactNode, useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarRange,
  RefreshCw,
  Tags,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type {
  BlocoDePoliticas,
  CategoriaDoPortal,
  FaixaDoPortal,
  PlanoDoPortal,
  PoliticasDoProduto as DadosDasPoliticas,
} from "@/lib/apolo/incorporador/politicas-do-produto";

// ⚠️ A MOLDURA VEM DE `../moldura`, E NÃO DE `../TelaContratos` (16/09/2026): o simulador da Mesa
// passou a importar a etiqueta da ressalva daqui, e a TelaContratos arrasta o quadro inteiro da
// Têmis. É o mesmo objeto (a TelaContratos o reexporta de lá).
import { MOLDURA_TAILWIND } from "../moldura";
import { useTemaDoPortal } from "../tema";

// AS POLÍTICAS COMERCIAIS DO PRODUTO — os planos de pagamento, as faixas de prazo e as categorias,
// dentro da ficha do produto no portal. SÓ LEITURA.
//
// Lucas (16/09/2026): o time da Cecílio Rocha vai operar o portal sozinho (*"eles meio que vao
// andar sozinhos sem o time administrativo da Careli"*), mas os planos continuam com a Careli,
// cadastrados no Apolo. Esta aba é onde o time deles VÊ o que pode oferecer, com a ressalva de
// disponibilidade do plano (*"essa escrita no plano investidor da disponibilidade do plano"*) na
// mesma etiqueta âmbar que o masterplan do Garden já usava (`.of-res`): condição de validade, não
// erro, e por isso nem vermelha nem escondida num tooltip.
//
// ⚠️ A TELA NÃO CALCULA NEM DECIDE NADA. Qual plano vale (categoria, produto, pai), Panteon antes do
// C2X, o texto de juros e de índice: tudo sai pronto da rota, montado por
// `lib/apolo/incorporador/politicas-do-produto.ts`, que tem teste e usa as mesmas réguas da Mesa de
// Venda. Uma segunda régua aqui é como o portal passaria a anunciar um plano que a proposta não
// deixa escolher.
//
// ⚠️ VAZIO NÃO É ERRO. Garden hoje não tem plano no Panteon: a aba diz "Nenhum plano cadastrado
// para este produto ainda", em tom neutro. Falha de leitura é outra frase (vermelha, com "Tentar de
// novo"), e o C2X fora do ar é uma terceira (âmbar): as três pedem reações diferentes de quem lê.
//
// ⚠️ TAILWIND DENTRO DO PORTAL — a moldura ÚNICA da TelaContratos (`MOLDURA_TAILWIND`) e o
// `data-uix-theme` com o tema efetivo, como o ResumoDoProduto: sem os dois a aba seria um bloco
// claro no tema escuro do portal.

/** O dourado da casa, o mesmo das abas da ficha. */
const DOURADO = "#A07C3B";

type Estado =
  | { dados: DadosDasPoliticas; tipo: "pronto" }
  | { mensagem: string; tipo: "erro" }
  | { tipo: "carregando" };

const ERRO_PADRAO = "Não foi possível carregar as políticas comerciais agora.";

export function PoliticasDoProduto({ emp }: { emp: string }) {
  const { efetivo } = useTemaDoPortal();
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  // O "Tentar de novo" só muda isto para o efeito rodar outra vez.
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    // ⚠️ `vivo` PORQUE O `emp` TROCA COM A FICHA ABERTA: a resposta atrasada do produto anterior não
    // pode pintar os planos dele na ficha deste.
    let vivo = true;
    setEstado({ tipo: "carregando" });

    (async () => {
      try {
        const resposta = await fetch(
          `/api/incorporador/produto/politicas?emp=${encodeURIComponent(emp)}`,
          { cache: "no-store" },
        );
        const corpo = (await resposta.json().catch(() => null)) as
          | { data?: DadosDasPoliticas; error?: string }
          | null;

        if (!vivo) return;
        if (!resposta.ok || !corpo?.data) {
          setEstado({ mensagem: corpo?.error ?? ERRO_PADRAO, tipo: "erro" });
          return;
        }
        setEstado({ dados: corpo.data, tipo: "pronto" });
      } catch {
        if (vivo) setEstado({ mensagem: ERRO_PADRAO, tipo: "erro" });
      }
    })();

    return () => {
      vivo = false;
    };
  }, [emp, tentativa]);

  const tentarDeNovo = () => setTentativa((n) => n + 1);

  return (
    <div
      className="grid gap-3"
      data-uix-theme={efetivo === "escuro" ? "dark" : "light"}
      style={MOLDURA_TAILWIND}
    >
      {estado.tipo === "carregando" ? <Esqueleto /> : null}

      {estado.tipo === "erro" ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          role="alert"
        >
          <span>{estado.mensagem}</span>
          <BotaoTentar onClick={tentarDeNovo} tom="erro" />
        </div>
      ) : null}

      {estado.tipo === "pronto" && estado.dados.vazio ? <Vazio /> : null}

      {estado.tipo === "pronto" && !estado.dados.vazio
        ? estado.dados.blocos.map((bloco) => (
            <Bloco
              bloco={bloco}
              key={bloco.produtos.map((p) => p.codigo).join("+")}
              mostrarProdutos={estado.dados.blocos.length > 1}
              onTentar={tentarDeNovo}
            />
          ))
        : null}
    </div>
  );
}

// ── Estados ──────────────────────────────────────────────────────────────────

function Esqueleto() {
  return (
    <div aria-busy="true" aria-live="polite" className="grid gap-3">
      <span className="sr-only">Carregando</span>
      <div className="h-12 animate-pulse rounded-xl border border-line bg-subtle" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, indice) => (
          <div
            className="h-44 animate-pulse rounded-xl border border-line bg-subtle"
            key={indice}
          />
        ))}
      </div>
    </div>
  );
}

function Vazio() {
  return (
    <section className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center">
      <span
        className="flex size-10 items-center justify-center rounded-full"
        style={{ background: `${DOURADO}1f`, color: DOURADO }}
      >
        <Wallet aria-hidden="true" className="size-5" />
      </span>
      <p className="m-0 text-sm font-semibold text-ink">
        Nenhum plano cadastrado para este produto ainda
      </p>
      <p className="m-0 max-w-md text-xs text-ink-muted">
        Os planos de pagamento são cadastrados pela Careli. Assim que estiverem
        prontos, aparecem aqui com entrada, parcelas, juros e correção.
      </p>
    </section>
  );
}

function BotaoTentar({ onClick, tom }: { onClick: () => void; tom: "alerta" | "erro" }) {
  const cores =
    tom === "erro"
      ? "border-red-300 text-red-700 dark:border-red-800 dark:text-red-300"
      : "border-amber-300 text-amber-800 dark:border-amber-500/40 dark:text-amber-200";
  return (
    <button
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-surface px-2.5 py-1 text-xs font-semibold hover:bg-subtle ${cores}`}
      onClick={onClick}
      type="button"
    >
      <RefreshCw aria-hidden="true" className="size-3.5" />
      Tentar de novo
    </button>
  );
}

// ── Um bloco (quase sempre o único) ──────────────────────────────────────────

function Bloco({
  bloco,
  mostrarProdutos,
  onTentar,
}: {
  bloco: BlocoDePoliticas;
  /** Só quando a ficha abrange mais de um empreendimento com políticas diferentes. */
  mostrarProdutos: boolean;
  onTentar: () => void;
}) {
  return (
    <div className="grid gap-3">
      {mostrarProdutos ? (
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Vale para {bloco.produtos.map((p) => p.nome).join(", ")}
        </p>
      ) : null}

      {/* ── Planos ─────────────────────────────────────────────────────────── */}
      <Secao
        contagem={bloco.planos.length}
        icone={Wallet}
        plural="planos"
        singular="plano"
        titulo="Planos de pagamento"
      >
        {bloco.planos.length > 0 ? (
          <GradeDePlanos planos={bloco.planos} />
        ) : bloco.consultaIncompleta ? (
          // ⚠️ NÃO É "NENHUM PLANO": o produto depende do sistema antigo e ele não respondeu.
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <span className="flex items-start gap-2">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              Não consegui consultar os planos deste produto agora.
            </span>
            <BotaoTentar onClick={onTentar} tom="alerta" />
          </div>
        ) : (
          <p className="m-0 text-sm text-ink-muted">
            Nenhum plano cadastrado para este produto ainda.
          </p>
        )}
      </Secao>

      {/* ── Faixas de prazo ────────────────────────────────────────────────── */}
      {bloco.faixas.length > 0 ? (
        <Secao
          contagem={bloco.faixas.length}
          descricao="O que vale conforme o número de parcelas da proposta."
          icone={CalendarRange}
          plural="faixas"
          singular="faixa"
          titulo="Faixas de prazo"
        >
          <FaixasDePrazo faixas={bloco.faixas} />
        </Secao>
      ) : null}

      {/* ── Categorias ─────────────────────────────────────────────────────── */}
      {bloco.categorias.length > 0 ? (
        <Secao
          contagem={bloco.categorias.length}
          descricao="Unidades de uma categoria com planos próprios usam os planos dela."
          icone={Tags}
          plural="categorias"
          singular="categoria"
          titulo="Categorias"
        >
          <ul className="m-0 grid list-none gap-2 p-0">
            {bloco.categorias.map((categoria) => (
              <LinhaDaCategoria categoria={categoria} key={categoria.id} />
            ))}
          </ul>
        </Secao>
      ) : null}
    </div>
  );
}

function Secao({
  children,
  contagem,
  descricao,
  icone: Icone,
  plural,
  singular,
  titulo,
}: {
  children: ReactNode;
  contagem: number;
  descricao?: string;
  icone: LucideIcon;
  plural: string;
  singular: string;
  titulo: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-subtle/40 px-4 py-3">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `${DOURADO}1f`, color: DOURADO }}
        >
          <Icone aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-sm font-semibold text-ink">{titulo}</h3>
          {descricao ? (
            <p className="m-0 mt-0.5 text-xs text-ink-muted">{descricao}</p>
          ) : null}
        </div>
        {contagem > 0 ? (
          <span className="text-xs font-medium text-ink-muted">
            {contagem} {contagem === 1 ? singular : plural}
          </span>
        ) : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

// ── Planos ───────────────────────────────────────────────────────────────────

function GradeDePlanos({ planos }: { planos: PlanoDoPortal[] }) {
  return (
    <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
      {planos.map((plano) => (
        <CartaoDoPlano key={plano.id} plano={plano} />
      ))}
    </ul>
  );
}

function CartaoDoPlano({ plano }: { plano: PlanoDoPortal }) {
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="min-w-0">
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-ink">
          <span className="min-w-0 break-words">{plano.nome}</span>
          {plano.ressalva ? <EtiquetaDaRessalva texto={plano.ressalva} /> : null}
        </p>
        {plano.nomeNaProposta ? (
          <p className="m-0 mt-1 text-[11px] text-ink-muted">
            Na proposta: {plano.nomeNaProposta}
          </p>
        ) : null}
      </div>

      <p className="m-0 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums leading-none text-ink">
          {plano.parcelas.toLocaleString("pt-BR")}
        </span>
        <span className="text-xs font-medium text-ink-muted">
          {plano.parcelas === 1 ? "parcela" : "parcelas"}
        </span>
      </p>

      <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2">
        <Fato rotulo="Entrada" valor={plano.entrada} />
        <Fato rotulo="Juros" valor={plano.juros} />
        <Fato rotulo="Correção" valor={plano.indice} />
        <Fato detalhe={plano.tabelaDetalhe} rotulo="Tabela" valor={plano.tabela} />
        {plano.anuais ? (
          <div className="col-span-2">
            <Fato rotulo="Anuais" valor={plano.anuais} />
          </div>
        ) : null}
      </dl>
    </li>
  );
}

/**
 * A ressalva de disponibilidade: âmbar, arredondada, ao lado do nome. É a mesma etiqueta da lista de
 * planos no Apolo, para a frase que a Careli escreve lá ser reconhecida aqui de relance.
 *
 * ⚠️ EXPORTADA (16/09/2026): o simulador da Mesa de Venda desenha a MESMA etiqueta no cartão do
 * plano, porque é lá que o time escolhe o plano. Uma segunda etiqueta "parecida" lá divergiria desta
 * no primeiro ajuste de cor.
 *
 * ⚠️ ELA CARREGA O TEMA DO PORTAL CONSIGO. As variantes `dark:` respondem a `[data-uix-theme="dark"]`
 * num ANCESTRAL, e a aba de políticas tem a moldura que o põe; o simulador da Mesa é estilo inline
 * sem moldura, e ali a etiqueta sairia clara no tema escuro. O `data-uix-theme` do invólucro é o
 * mesmo tema efetivo da moldura, então dentro dela nada muda.
 */
export function EtiquetaDaRessalva({ texto }: { texto: string }) {
  const { efetivo } = useTemaDoPortal();
  return (
    <span data-uix-theme={efetivo === "escuro" ? "dark" : "light"} style={{ display: "inline-flex" }}>
      <span className="inline-block rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold leading-4 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
        {texto}
      </span>
    </span>
  );
}

function Fato({
  detalhe,
  rotulo,
  valor,
}: {
  detalhe?: null | string;
  rotulo: string;
  valor: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="m-0 text-[11px] font-medium text-ink-muted">{rotulo}</dt>
      <dd className="m-0 mt-0.5 break-words text-sm font-semibold text-ink">
        {valor}
        {detalhe ? (
          <span className="block text-[11px] font-normal text-ink-muted">{detalhe}</span>
        ) : null}
      </dd>
    </div>
  );
}

// ── Faixas ───────────────────────────────────────────────────────────────────

/**
 * ⚠️ "SEGUE O PLANO" E NÃO TRAÇO: nulo na faixa quer dizer que ela não opina sobre o campo, e o
 * valor sai do plano escolhido. Um "sem juros" ali seria a afirmação oposta.
 */
const SEGUE_O_PLANO = "segue o plano";

function FaixasDePrazo({ faixas }: { faixas: FaixaDoPortal[] }) {
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {faixas.map((faixa) => (
        <li
          className="grid gap-2 rounded-lg border border-line bg-subtle/40 px-3 py-2.5 sm:grid-cols-[minmax(9rem,1fr)_repeat(3,minmax(0,1fr))] sm:items-center"
          key={faixa.prazo}
        >
          <span className="text-sm font-semibold text-ink">{faixa.prazo}</span>
          <ValorDaFaixa rotulo="Entrada" valor={faixa.entrada} />
          <ValorDaFaixa rotulo="Juros" valor={faixa.juros} />
          <ValorDaFaixa rotulo="Correção" valor={faixa.indice} />
        </li>
      ))}
    </ul>
  );
}

function ValorDaFaixa({ rotulo, valor }: { rotulo: string; valor: null | string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5 text-xs sm:flex-col sm:gap-0">
      <span className="text-ink-muted">{rotulo}</span>
      <span className={valor ? "font-semibold text-ink" : "italic text-ink-muted"}>
        {valor ?? SEGUE_O_PLANO}
      </span>
    </span>
  );
}

// ── Categorias ───────────────────────────────────────────────────────────────

function LinhaDaCategoria({ categoria }: { categoria: CategoriaDoPortal }) {
  return (
    <li className="grid gap-3 rounded-lg border border-line bg-subtle/40 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="m-0 min-w-0 text-sm font-semibold text-ink">
          {categoria.nome}
          {categoria.dentroDe ? (
            <span className="ml-1.5 text-xs font-normal text-ink-muted">
              em {categoria.dentroDe}
            </span>
          ) : null}
        </p>
        <span className="text-xs text-ink-muted">
          {categoria.unidades === 0
            ? "nenhuma unidade ainda"
            : `${categoria.unidades.toLocaleString("pt-BR")} ${categoria.unidades === 1 ? "unidade" : "unidades"}`}
        </span>
      </div>

      {categoria.planos.length > 0 ? (
        <GradeDePlanos planos={categoria.planos} />
      ) : (
        <p className="m-0 text-xs text-ink-muted">Segue os planos gerais do produto.</p>
      )}
    </li>
  );
}
