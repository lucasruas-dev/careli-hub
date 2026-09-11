"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  FilePlus2,
  FileSignature,
  FileText,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { AnaliseDoTrabalho, CampoDaAnalise } from "@/lib/temis/analise-do-trabalho";
import type { DescontoDaProposta } from "@/lib/temis/comercial-da-analise";
import type { PedidoDoTrabalho } from "@/lib/temis/pedido-do-trabalho";
import { contratoVigente } from "@/lib/temis/contrato-guardado";
import { MOTIVOS } from "@/lib/temis/indeferimento";
import { pedidoDoTrabalho } from "@/lib/temis/pedido-do-trabalho";
import {
  caminhoDoCard,
  type EstagioDoTrabalho,
  NOME_DO_TIPO,
  nomeDoEstagio,
  type TipoDeTrabalho,
} from "@/lib/temis/trabalhos";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";
import { PreviaDoContrato } from "@/modules/incorporador/hercules/PreviaDoContrato";
import { ColunaFixa } from "@/modules/temis/blocks/trabalho/coluna-fixa";

// A TELA DE TRABALHO — o que abre ao clicar num card do quadro.
//
// A solicitação inteira do Lucas está em `docs/operations/temis-redesenho-decisoes.md`.
// Em resumo: *"queria ela informativa, ao clicar no card abrisse uma tela de trabalho"*.
//
// ⚠️ O LAYOUT É DE DUAS COLUNAS, e isso não é enfeite: *"chat - documento - historico ficam em
// TODAS as etapas"*. A coluna da direita vive FORA do painel de etapa — trocar de etapa não
// recarrega a conversa nem apaga o que estava escrito no campo de mensagem.
//
// ⚠️ E O PAINEL DA ESQUERDA SEGUE A ETAPA DO CARD. A primeira versão desta tela mostrava sempre a
// conferência da etapa 1, mesmo num card em assinatura: mandaria conferir o que já foi conferido e
// esconderia o que importa naquele momento.
//
// ⚠️ AS AÇÕES VIVEM AQUI, E A PRIMEIRA VERSÃO AS MATOU SEM QUERER. Ao trocar o clique do card por
// "abrir tela de trabalho", o bloco do quadro que continha "Gerar contrato" e "Enviar para
// assinatura" ficou inalcançável (`setAberto` deixou de ser chamado), e esta tela só oferecia
// "Indeferir" — a Têmis ficaria sem conseguir emitir contrato pela interface. Elas estão de volta,
// cada uma na etapa em que acontece.

/**
 * ⚠️ O MESMO `ContratoNoCard` de `lib/temis/contrato-guardado-db.ts`, conferido campo a campo — e
 * ele NÃO tem `vigente`. Qual é a versão vigente não é coluna: é o resultado de `contratoVigente`,
 * que compara data e, no empate, o número no nome. Inventar a bandeira aqui daria uma segunda
 * regra para a mesma pergunta.
 */
type ContratoNoCard = {
  criadoEm: string;
  id: string;
  nome: string;
  observacao: null | string;
  versao: null | number;
};

type Card = {
  arrependimento_inicio: null | string;
  cliente_cpf: null | string;
  cliente_nome: null | string;
  contratos: ContratoNoCard[];
  enterprise_codigo: null | string;
  enterprise_nome: null | string;
  estagio: EstagioDoTrabalho;
  estagio_desde: string;
  id: string;
  indeferido_motivo: null | string;
  indeferido_observacao: null | string;
  indeferido_por_nome: null | string;
  /** O pedido que abriu o trabalho, como o Hércules o gravou. Ver `pedido-do-trabalho.ts`. */
  observacao: null | string;
  proposta_id: null | string;
  tipo: TipoDeTrabalho;
  unidade: null | string;
};

export function TelaDeTrabalho({
  aoEnviarParaAssinatura,
  aoFechar,
  aoMudar,
  trabalhoId,
}: {
  /**
   * Abre o modal de envio, que vive no quadro.
   *
   * ⚠️ O MODAL FICA LÁ, e não aqui, porque ele já existe e é o mesmo dos dois lugares. Duplicá-lo
   * criaria duas telas de envio para o mesmo ato — e foi justamente perder o acesso a ele que
   * quebrou a primeira versão desta tela.
   */
  aoEnviarParaAssinatura: (trabalhoId: string) => void;
  aoFechar: () => void;
  /** Chamado quando algo muda, para o quadro recarregar. */
  aoMudar: () => void;
  trabalhoId: string;
}) {
  const [dados, setDados] = useState<null | { analise: AnaliseDoTrabalho | null; card: Card }>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [ocupado, setOcupado] = useState(false);
  /** A proposta cuja prévia de contrato está aberta. `null` = nenhuma. */
  const [previa, setPrevia] = useState<null | string>(null);
  /**
   * O formulário de indeferimento está aberto.
   *
   * ⚠️ O ESTADO MORA AQUI, e não no painel da etapa, porque o BOTÃO subiu para o topo. Deixá-lo
   * embaixo faria o botão do cabeçalho não conseguir abrir o formulário que vive na coluna.
   */
  const [indeferindo, setIndeferindo] = useState(false);
  /** A falha da última ação disparada pelo topo. */
  const [erroDaAcao, setErroDaAcao] = useState<null | string>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(`/api/temis/trabalho?id=${encodeURIComponent(trabalhoId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const corpo = (await r.json().catch(() => ({}))) as {
        data?: { analise: AnaliseDoTrabalho | null; card: Card };
        error?: string;
      };
      if (!r.ok || !corpo.data) {
        setErro(corpo.error ?? "Não consegui abrir este trabalho.");
        return;
      }
      setDados(corpo.data);
    } catch {
      setErro("Não consegui abrir este trabalho.");
    }
  }, [trabalhoId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const propostaId = dados?.card.proposta_id ?? null;

  /** Gera o PDF pela minuta publicada. O card anda para Contrato pela régua de atividades. */
  const gerarContrato = useCallback(async (): Promise<null | string> => {
    if (!propostaId) return "Este card não tem venda ligada.";
    setOcupado(true);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/temis/contrato/gerar", {
        body: JSON.stringify({ propostaId }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const j = (await r.json().catch(() => ({}))) as { erro?: string; faltando?: string[] };
      if (!r.ok) {
        // ⚠️ A LISTA DE LACUNAS VEM JUNTO. A geração recusa quando falta variável obrigatória, e
        // dizer só "falhou" mandaria o operador procurar no escuro.
        return j.faltando?.length
          ? `Falta preencher: ${j.faltando.join(", ")}.`
          : (j.erro ?? `Não consegui gerar (${r.status}).`);
      }
      await carregar();
      aoMudar();
      return null;
    } finally {
      setOcupado(false);
    }
  }, [aoMudar, carregar, propostaId]);

  const abrirContrato = useCallback(async (documentoId: string) => {
    // A aba abre ANTES do await: o navegador bloqueia `window.open` fora do gesto do usuário.
    const aba = window.open("", "_blank", "noopener,noreferrer");
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(
        `/api/temis/contrato/gerar?documento=${encodeURIComponent(documentoId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const j = (await r.json().catch(() => ({}))) as { data?: { url: string } };
      if (j.data?.url) {
        if (aba) aba.location.href = j.data.url;
        else window.location.href = j.data.url;
      } else {
        aba?.close();
      }
    } catch {
      aba?.close();
    }
  }, []);

  const indeferir = useCallback(
    async (motivo: string, observacao: string): Promise<null | string> => {
      setOcupado(true);
      try {
        const token = await getApoloAccessToken();
        const r = await fetch("/api/temis/trabalho", {
          body: JSON.stringify({ id: trabalhoId, motivo, observacao }),
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          method: "POST",
        });
        const corpo = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) return corpo.error ?? "Não consegui indeferir.";
        await carregar();
        aoMudar();
        return null;
      } finally {
        setOcupado(false);
      }
    },
    [aoMudar, carregar, trabalhoId],
  );

  if (erro) {
    return (
      <Moldura aoFechar={aoFechar}>
        <p className="m-0 text-sm text-ink-soft">{erro}</p>
      </Moldura>
    );
  }

  if (!dados) {
    return (
      <Moldura aoFechar={aoFechar}>
        <p className="m-0 flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          Carregando…
        </p>
      </Moldura>
    );
  }

  const { analise, card } = dados;
  const caminho = caminhoDoCard(card.tipo, card.estagio);
  const ehContrato = card.tipo === "contrato" && Boolean(card.proposta_id);

  return (
    <Moldura aoFechar={aoFechar}>
      {/* ⚠️ É A PRÓPRIA PRÉVIA DO HÉRCULES, e não uma segunda tela de contrato. Ela já monta o
          documento preenchido pelo motor, lista o que ficou sem valor e mostra as versões já
          guardadas — `comAvisos` existe nela desde o começo com a nota "só a Têmis usa". Redesenhar
          isso aqui criaria dois lugares que respondem "como está o contrato desta venda", e no dia
          em que um mudasse o outro passaria a mentir.

          ⚠️ `podeGerar` SEGUE A REGRA DO CARD, e mesmo assim não é a trava: quem fecha a emissão é
          `autorizarEmissaoDeContrato`, no servidor. Esconder botão só resolve o que se vê. */}
      {previa ? (
        <PreviaDoContrato
          aoFechar={() => setPrevia(null)}
          comAvisos
          // ⚠️ EDITAR SEGUE A MESMA RÉGUA DE EMITIR, e não a de abrir: quem pode fechar o
          // contrato pode ajustar o texto que vai ser fechado. Abrir para conferir continua
          // sendo de todo mundo — e num cancelamento, onde o documento ainda é o contrato da
          // venda, a folha abre para leitura e nada mais.
          podeEditar={ehContrato}
          podeGerar={ehContrato}
          propostaId={previa}
        />
      ) : null}

      {/* ⚠️ O FLUXO FICA À DIREITA, NA MESMA LINHA DO NOME — Lucas (10/09/2026): *"o flow acho que
          deveria estar na direita"*. Abaixo do cabeçalho ele empurrava o trabalho para baixo e
          gastava uma faixa inteira da altura; ao lado, quem é e em que pé está se leem de uma vez,
          e a etapa fica onde o olho já vai procurar informação de estado. */}
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <header className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-base font-semibold text-ink">
              {card.cliente_nome ?? "Sem nome"}
            </h2>

            {/* ⚠️ O TIPO VEM ANTES DE TUDO, colado no nome — Lucas (10/09/2026): *"quando abro
                a tela eu não identifiquei que era um cancelamento"*. A etapa 1 é quase igual nos
                cinco tipos (a mesma proposta, o mesmo proponente, a mesma unidade), então quem
                abre um cancelamento vê uma tela de venda e lê como venda. A cor separa o que
                FAZ do que DESFAZ: um trabalho que derruba uma venda não pode parecer com um que
                a cria. */}
            <span
              className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                card.tipo === "contrato"
                  ? "bg-subtle text-ink-soft"
                  : card.tipo === "cessao"
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    : "bg-rose-500/15 text-rose-700 dark:text-rose-300"
              }`}
            >
              {NOME_DO_TIPO[card.tipo]}
            </span>
          </div>
          <p className="m-0 mt-0.5 text-xs text-ink-muted">
            {[card.enterprise_nome ?? card.enterprise_codigo, card.unidade, card.cliente_cpf]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </header>

      {/* ⚠️ A FAIXA É DE SETAS ENCAIXADAS, NÃO DE PÍLULAS SOLTAS — Lucas (10/09/2026): *"só
          trocaria esse estágio por workflow de setinhas"*. A ponta de uma entra no entalhe da
          seguinte, e a faixa passa a ler como um caminho com direção: dá para ver de onde o card
          veio e para onde vai. Pílulas lado a lado diziam só "estas são as etapas".

          ⚠️ O DOURADO FICA SÓ AQUI. Depois que os botões perderam a cor de fundo, a marca passou a
          significar uma coisa só na tela: em que etapa o card está. */}
      <nav aria-label="Etapas" className="flex shrink-0 flex-wrap gap-0.5">
        {card.estagio === "indeferido" ? (
          <span className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-300">
            Indeferido
          </span>
        ) : (
          caminho.map((e, i) => {
            const atual = e === card.estagio;
            const passou = caminho.indexOf(card.estagio) > caminho.indexOf(e);
            const primeiro = i === 0;
            const ultimo = i === caminho.length - 1;
            return (
              <span
                className={`whitespace-nowrap py-1.5 text-[11px] font-semibold ${
                  primeiro ? "rounded-l-lg pl-3.5" : "pl-6"
                } ${ultimo ? "rounded-r-lg pr-3.5" : "pr-3.5"} ${
                  atual
                    ? "bg-[#A07C3B] text-white"
                    : passou
                      ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                      : "bg-subtle text-ink-muted"
                }`}
                key={e}
                style={{
                  // A primeira não tem entalhe atrás; a última não tem ponta à frente — o caminho
                  // acaba nela, e uma seta apontando para fora prometeria uma etapa seguinte.
                  clipPath: primeiro
                    ? "polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%)"
                    : ultimo
                      ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 9px 50%)"
                      : "polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%, 9px 50%)",
                }}
              >
                {nomeDoEstagio(e, card.tipo)}
              </span>
            );
          })
        )}
        </nav>

        {/* ⚠️ AS AÇÕES SÃO SÓ ÍCONE, E FICAM NO TOPO — Lucas (10/09/2026): *"coloca esses
            botões no topo somente o ícone"*. Elas ocupavam um bloco inteiro no fim da coluna,
            com título e parágrafo, para três cliques; e ficavam abaixo de tudo que se lê, então
            era preciso rolar a análise inteira para agir sobre ela. Cada botão diz o que faz
            pelo `title` e pelo `aria-label` — ícone sem nome nenhum é adivinhação. */}
        {card.estagio === "analise" ? (
          <div className="flex items-center gap-1.5">
            {card.proposta_id ? (
              <BotaoDeAcao
                icone={FileText}
                onClick={() => setPrevia(card.proposta_id)}
                rotulo="Abrir o contrato preenchido"
              />
            ) : null}

            {ehContrato ? (
              <BotaoDeAcao
                carregando={ocupado}
                icone={FilePlus2}
                onClick={async () => {
                  setErroDaAcao(null);
                  const falha = await gerarContrato();
                  if (falha) setErroDaAcao(falha);
                }}
                principal
                rotulo="Gerar contrato"
              />
            ) : null}

            <BotaoDeAcao
              ativo={indeferindo}
              icone={Ban}
              onClick={() => setIndeferindo((v) => !v)}
              perigo
              rotulo="Indeferir"
            />
          </div>
        ) : null}
      </div>

      {/* ── DUAS COLUNAS: o trabalho da etapa · chat, documentos e histórico ── */}
      <div className="mt-3 grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-h-0 overflow-auto pr-1">
          {card.estagio === "indeferido" ? <BlocoIndeferido card={card} /> : null}

          {!card.proposta_id ? (
            <Aviso texto="Este card não tem venda ligada. Ele nasceu antes de a Têmis passar a receber a proposta do Hércules, então não há proponentes nem condições para conferir." />
          ) : null}

          {card.estagio === "analise" && analise ? (
            <EtapaDeAnalise
              analise={analise}
              aoFecharIndeferimento={() => setIndeferindo(false)}
              emAndamento={ocupado}
              erro={erroDaAcao}
              indeferindo={indeferindo}
              onIndeferir={indeferir}
              pedido={pedidoDoTrabalho({ observacao: card.observacao, tipo: card.tipo })}
              tipo={card.tipo}
            />
          ) : null}

          {card.estagio === "contrato" ? (
            <EtapaDoContrato
              contratos={card.contratos}
              emAndamento={ocupado}
              onAbrir={abrirContrato}
              onEnviar={() => aoEnviarParaAssinatura(card.id)}
              onGerarContrato={gerarContrato}
              podeEnviar={ehContrato}
            />
          ) : null}

          {card.estagio === "assinatura" ? (
            <EmConstrucao
              oQueVem="Os indicadores por signatário (assinou, visualizou, e-mail não entregue), a tela de monitoramento e o botão de cobrar pela Íris."
              titulo="Em assinatura"
            />
          ) : null}

          {card.estagio === "prazo_legal" ? (
            <EtapaDoPrazoLegal inicio={card.arrependimento_inicio} />
          ) : null}

          {card.estagio === "faturado" ? (
            <EmConstrucao
              oQueVem="O resumo do que ficou: contrato no cofre, assinaturas, prazo cumprido e entrada paga."
              titulo={nomeDoEstagio("faturado", card.tipo)}
            />
          ) : null}

          {card.proposta_id && card.estagio === "analise" && !analise ? (
            <Aviso texto="Não consegui montar os dados desta proposta. Isso costuma ser cadastro incompleto no Apolo; o log do servidor tem o motivo." />
          ) : null}
        </div>

        <ColunaFixa podeEscrever propostaId={card.proposta_id} />
      </div>
    </Moldura>
  );
}

// ── ETAPA 1 · ANÁLISE ──────────────────────────────────────────────────────

/**
 * A ETAPA 1 — a tela de ANÁLISE.
 *
 * Lucas (10/09/2026), reprovando a primeira versão: *"não gostei da tela, achei pobre, a primeira
 * tela tinha que trazer a proposta comercial não veio"* · *"eu gosto das coisas blocadas, bem
 * organizada na tela"* · *"se tiver desconto tem que vir falando, se tiver algo fora tem que vir
 * pontuando, o operador tem que ter todas as informações para ele analisar"*.
 *
 * A ordem dos blocos é o roteiro da análise, e não decoração: primeiro o que está FORA (é para
 * isso que a pessoa abriu o card), depois o que foi COMBINADO, depois COM QUEM, e por último as
 * ações. Enterrar as pendências embaixo da qualificação faria a tela pedir para ler tudo antes de
 * descobrir que faltava um documento.
 */
function EtapaDeAnalise({
  analise,
  aoFecharIndeferimento,
  emAndamento,
  erro,
  indeferindo,
  onIndeferir,
  pedido,
  tipo,
}: {
  analise: AnaliseDoTrabalho;
  aoFecharIndeferimento: () => void;
  emAndamento: boolean;
  /**
   * A falha da última ação disparada pelo TOPO.
   *
   * ⚠️ VEM DE FORA porque os botões saíram daqui. Um erro guardado neste componente nunca seria
   * escrito por "Gerar contrato", que agora vive no cabeçalho — a ação falharia calada.
   */
  erro: null | string;
  /** O formulário de indeferimento está aberto. Quem alterna é o botão do topo. */
  indeferindo: boolean;
  onIndeferir: (motivo: string, observacao: string) => Promise<null | string>;
  /** O pedido que abriu o trabalho. `null` na venda: ali o pedido é a própria proposta. */
  pedido: null | PedidoDoTrabalho;
  tipo: TipoDeTrabalho;
}) {
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");
  /** A falha do próprio formulário de indeferimento — separada do erro que vem do topo. */
  const [erroDoForm, setErroDoForm] = useState<null | string>(null);

  return (
    <div className="grid gap-3">
      {erro ?? erroDoForm ? (
        <p className="m-0 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-300">
          {erro ?? erroDoForm}
        </p>
      ) : null}

      <PontosDeAtencao avisos={analise.avisos} desconto={analise.comercial?.desconto ?? null} />

      {/* ── O QUE SE PEDIU ───────────────────────────────────────────────────
          ⚠️ VEM ANTES DA PROPOSTA, e não depois. Num cancelamento a proposta comercial é
          CONTEXTO — o que se está desfazendo —, e o assunto é o pedido: por que, se o contrato
          chegou a existir, se houve pagamento. Abaixo da proposta, este bloco faria a pessoa ler
          uma venda inteira antes de descobrir que ninguém está vendendo nada. */}
      {pedido ? (
        <Bloco titulo={pedido.titulo}>
          {pedido.semRegistro ? (
            <p className="m-0 text-sm text-amber-600 dark:text-amber-300">
              Ninguém registrou o motivo. Registrar é a primeira atividade desta etapa — sem isso o
              documento não tem o que fundamentar.
            </p>
          ) : pedido.livre ? (
            <p className="m-0 text-sm text-ink">{pedido.livre}</p>
          ) : (
            <Campos
              campos={pedido.itens.map((i) => ({
                faltando: false,
                rotulo: i.rotulo,
                valor: i.valor,
              }))}
            />
          )}
        </Bloco>
      ) : null}

      {/* ── A PROPOSTA COMERCIAL ─────────────────────────────────────────── */}
      {analise.comercial ? (
        <Bloco
          destaque
          // ⚠️ "DESEMBOLSO", E NÃO "TOTAL DO CONTRATO": `totais.geral` soma o que o comprador paga
          // nas três séries, com reajuste embutido — no card do Otavio dá R$ 183.871,20 para uma
          // unidade de R$ 135.000. Chamar isso de total do contrato faria o operador achar que a
          // venda saiu por 183 mil.
          direita={
            analise.comercial.total ? `Desembolso ${analise.comercial.total}` : undefined
          }
          titulo={
            // ⚠️ NUM CANCELAMENTO A PROPOSTA NÃO É "a proposta comercial": é a venda que se
            // quer derrubar. O mesmo bloco com o mesmo título em cima de trabalhos opostos
            // é metade do motivo de a tela ter sido lida como um contrato novo.
            tipo === "contrato"
              ? "A proposta comercial"
              : tipo === "cessao"
                ? "A venda que muda de titular"
                : "A venda que se quer desfazer"
          }
        >
          <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2.5">
            {analise.comercial.destaques.map((d) => (
              <div
                className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2"
                key={d.rotulo}
              >
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.05em] text-ink-muted">
                  {d.rotulo}
                </div>
                <div className="mt-0.5 break-words text-[17px] font-bold leading-tight tabular-nums text-ink">
                  {d.valor}
                </div>
                {d.detalhe ? (
                  <div className="mt-0.5 text-[10.5px] text-ink-muted">{d.detalhe}</div>
                ) : null}
              </div>
            ))}
          </div>


          <dl className="m-0 mt-2.5 grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-x-4 gap-y-1.5">
            {analise.comercial.condicoes.map((c) => (
              <div className="min-w-0" key={c.rotulo}>
                <dt className="truncate text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  {c.rotulo}
                </dt>
                <dd
                  className={`m-0 break-words text-sm ${
                    c.faltando ? "text-amber-600 dark:text-amber-300" : "text-ink"
                  }`}
                >
                  {c.valor}
                </dd>
              </div>
            ))}
          </dl>
        </Bloco>
      ) : (
        <Bloco titulo="A proposta">
          {/* As 4.857 propostas importadas do C2X nasceram sem cronograma: o que existe delas é o
              texto abaixo, e dizer isso é melhor do que desenhar uma tabela de zeros. */}
          <p className="m-0 text-[11px] text-ink-muted">
            Esta proposta não tem fluxo de pagamento gravado — é uma das importadas do C2X. Os
            valores abaixo são o que existe dela.
          </p>
          <Campos campos={analise.proposta} />
        </Bloco>
      )}

      {/* ── QUEM COMPRA ──────────────────────────────────────────────────── */}
      {analise.proponentes.map((p) => (
        <Bloco key={p.nome} titulo={p.conjuge ? "Proponente · titular" : "Proponente"}>
          <h4 className="m-0 mb-1 text-sm font-semibold text-ink">{p.nome}</h4>
          <Campos campos={p.campos} />
          {p.conjuge ? (
            <>
              <h4 className="m-0 mt-4 border-t border-line pt-3 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                Cônjuge · assina o contrato
              </h4>
              <Campos campos={p.conjuge} />
            </>
          ) : null}
        </Bloco>
      ))}

      {/* ── QUEM VENDEU E ONDE ───────────────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Bloco titulo="Quem vendeu">
          <Campos campos={analise.imobiliaria} />
        </Bloco>
        <Bloco titulo="A unidade">
          <Campos campos={analise.unidade} />
        </Bloco>
      </div>

      {indeferindo ? (
        <section className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
          <h3 className="m-0 text-sm font-semibold text-ink">Indeferir este trabalho</h3>
          <p className="m-0 mt-1 text-xs text-ink-muted">
            O motivo vai para o corretor e para a imobiliária. Diga o que precisa ser corrigido.
          </p>

          <label className="mt-3 block text-xs font-semibold text-ink-soft">
            Motivo
            <select
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
              onChange={(ev) => setMotivo(ev.target.value)}
              value={motivo}
            >
              <option value="">Escolha…</option>
              {MOTIVOS.map((m) => (
                <option key={m.codigo} value={m.codigo}>
                  {m.rotulo}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-3 block text-xs font-semibold text-ink-soft">
            Observação
            {motivo === "outro" ? (
              <span className="ml-1 font-normal text-rose-600 dark:text-rose-300">
                obrigatória para “Outro motivo”
              </span>
            ) : null}
            <textarea
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
              onChange={(ev) => setObservacao(ev.target.value)}
              rows={3}
              value={observacao}
            />
          </label>

          <button
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-surface px-3.5 py-2 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-300"
            disabled={emAndamento || !motivo}
            onClick={async () => {
              setErroDoForm(null);
              const falha = await onIndeferir(motivo, observacao);
              if (falha) setErroDoForm(falha);
              else aoFecharIndeferimento();
            }}
            type="button"
          >
            {emAndamento ? (
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            ) : (
              <Ban aria-hidden="true" className="size-3.5" />
            )}
            Confirmar indeferimento
          </button>
        </section>
      ) : null}
    </div>
  );
}

/**
 * O PARECER — o primeiro bloco da análise.
 *
 * Lucas (10/09/2026): *"se tiver desconto tem que vir falando, se tiver algo fora tem que vir
 * pontuando, o operador tem que ter todas as informações para ele analisar"*.
 *
 * ⚠️ HOJE ELE SÓ MOSTRA O QUE `dadosDaProposta` JÁ APURA — as lacunas de cadastro que impedem o
 * contrato de sair correto. As conferências de POLÍTICA (entrada abaixo do mínimo do
 * empreendimento, prazo acima do plano, desconto sobre a tabela) exigem a régua de cada
 * empreendimento e ainda não estão aqui: prometê-las com um bloco vazio faria o operador confiar
 * numa conferência que ninguém fez, que é pior do que não ter o bloco.
 *
 * ⚠️ E O BLOCO NÃO SOME QUANDO ESTÁ TUDO CERTO. "Nada pendente" é informação — é o que diz que a
 * conferência rodou. Um bloco ausente é indistinguível de um bloco que não carregou.
 */
function PontosDeAtencao({
  avisos,
  desconto,
}: {
  avisos: string[];
  desconto: DescontoDaProposta | null;
}) {
  const achados = avisos.length + (desconto ? 1 : 0);

  return (
    <section className="rounded-xl border border-line bg-surface px-3.5 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          Pontos de atenção
        </h3>
        {/* ⚠️ O BLOCO NÃO SOME QUANDO ESTÁ TUDO CERTO. "Nada pendente" é informação — é o que diz
            que a conferência rodou. Um bloco ausente é indistinguível de um que não carregou. */}
        <span
          className={`text-[10.5px] font-semibold ${
            achados === 0 ? "text-emerald-700 dark:text-emerald-300" : "text-ink-muted"
          }`}
        >
          {achados === 0
            ? "nada a apontar"
            : achados === 1
              ? "1 ponto"
              : `${achados} pontos`}
        </span>
      </div>

      {achados > 0 ? (
        <ul className="m-0 mt-1.5 grid list-none gap-1 p-0">
          {/* ⚠️ O DESCONTO VEM PRIMEIRO, e vem com a TABELA ao lado — Lucas (10/09/2026): *"se
              tiver desconto tem que vir falando"*. Apontar sem mostrar contra o quê obriga o
              operador a conferir na mão de novo, que é o trabalho que esta tela existe para
              poupar. As duas medidas saem juntas porque quem aprova desconto pensa em percentual
              e quem fecha a proposta pensa em reais. */}
          {desconto ? (
            <li className="grid grid-cols-[3px_auto_1fr] items-center gap-x-2.5 overflow-hidden rounded-lg bg-rose-500/10 py-1.5 pr-3">
              <span className="h-full self-stretch rounded-sm bg-rose-500" />
              <AlertTriangle
                aria-hidden="true"
                className="size-3.5 text-rose-600 dark:text-rose-300"
              />
              <span className="text-xs text-ink">
                <b className="font-semibold">
                  {desconto.acrescimo ? "Acréscimo" : "Desconto"} de {desconto.emReais} (
                  {desconto.emPercentual})
                </b>{" "}
                <span className="text-ink-soft">
                  sobre a tabela de <b className="tabular-nums">{desconto.tabela}</b> · dado em{" "}
                  {desconto.modo === "percentual" ? "percentual" : "reais"}
                </span>
              </span>
            </li>
          ) : null}

          {avisos.map((a) => (
            <li
              className="grid grid-cols-[3px_auto_1fr] items-center gap-x-2.5 overflow-hidden rounded-lg bg-amber-500/10 py-1.5 pr-3"
              key={a}
            >
              <span className="h-full self-stretch rounded-sm bg-amber-500" />
              <AlertTriangle
                aria-hidden="true"
                className="size-3.5 text-amber-600 dark:text-amber-300"
              />
              <span className="text-xs font-medium text-ink">{a}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * UMA AÇÃO DO CABEÇALHO — só o ícone.
 *
 * Lucas (10/09/2026): *"coloca esses botões no topo somente o ícone"*, e a regra da casa é a
 * mesma de sempre: ícone acima de texto.
 *
 * ⚠️ SÓ O ÍCONE NA TELA, NUNCA NO CÓDIGO DE ACESSIBILIDADE. `title` dá o tooltip do mouse e
 * `aria-label` dá o nome para o leitor de tela e para o teclado — sem os dois, o botão vira um
 * desenho que só quem já sabe consegue usar.
 */
function BotaoDeAcao({
  ativo,
  carregando,
  icone: Icone,
  onClick,
  perigo,
  principal,
  rotulo,
}: {
  /** Ligado enquanto o painel que ele abre está aberto. */
  ativo?: boolean;
  carregando?: boolean;
  icone: typeof FileText;
  onClick: () => void;
  /** Contorno vermelho: a única ação que não se desfaz. */
  perigo?: boolean;
  /** Borda forte: a ação que faz o card andar. Sem cor de fundo — ver a nota dos botões. */
  principal?: boolean;
  rotulo: string;
}) {
  return (
    <button
      aria-label={rotulo}
      className={`grid size-9 shrink-0 place-items-center rounded-lg bg-surface transition-colors disabled:opacity-50 ${
        perigo
          ? `border border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-300 ${
              ativo ? "bg-rose-500/10" : ""
            }`
          : `text-ink hover:bg-subtle ${
              principal ? "border-2 border-line-strong" : "border border-line"
            }`
      }`}
      disabled={carregando}
      onClick={onClick}
      title={rotulo}
      type="button"
    >
      {carregando ? (
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      ) : (
        <Icone aria-hidden="true" className="size-4" />
      )}
    </button>
  );
}

/**
 * Um bloco da análise: moldura, título em caixa alta e, opcionalmente, um número à direita.
 *
 * Lucas (10/09/2026): *"eu gosto das coisas blocadas, bem organizada na tela"*.
 */
function Bloco({
  children,
  destaque,
  direita,
  titulo,
}: {
  children: React.ReactNode;
  /** Fundo acinzentado, para o bloco que a tela existe para mostrar. */
  destaque?: boolean;
  direita?: string;
  titulo: string;
}) {
  return (
    <section
      className={`rounded-xl px-3.5 py-3 ${
        destaque ? "bg-subtle" : "border border-line bg-surface"
      }`}
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          {titulo}
        </h3>
        {direita ? (
          <span className="text-[10.5px] font-semibold tabular-nums text-ink-soft">{direita}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

// ── ETAPA 2 · CONTRATO ─────────────────────────────────────────────────────

/**
 * ⚠️ O PDF FICA À DIREITA E QUEM ASSINA À ESQUERDA — Lucas (09/09/2026): *"acho valido ter o
 * contrato gerado ao lado direito (PDF), aqui eu já vejo o PDF mesmo, e no lado esquerdo quem
 * assina"*.
 *
 * O PDF vai num `<iframe>` com a URL assinada de 10 minutos: o bucket é privado, e é a mesma URL
 * que o botão de abrir usa.
 */
function EtapaDoContrato({
  contratos,
  emAndamento,
  onAbrir,
  onEnviar,
  onGerarContrato,
  podeEnviar,
}: {
  contratos: ContratoNoCard[];
  emAndamento: boolean;
  onAbrir: (documentoId: string) => void;
  onEnviar: () => void;
  onGerarContrato: () => Promise<null | string>;
  podeEnviar: boolean;
}) {
  const [erro, setErro] = useState<null | string>(null);
  const vigente = contratoVigente(contratos);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      {/* ESQUERDA: o contrato e quem assina */}
      <div className="grid content-start gap-3">
        {erro ? (
          <p className="m-0 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-300">
            {erro}
          </p>
        ) : null}

        <section className="rounded-xl border border-line bg-surface p-4">
          <h3 className="m-0 text-sm font-semibold text-ink">O contrato</h3>
          {contratos.length === 0 ? (
            <p className="m-0 mt-2 text-xs text-ink-muted">Nenhuma versão gerada ainda.</p>
          ) : (
            <ul className="m-0 mt-2 list-none space-y-1 p-0">
              {contratos.map((c) => (
                <li key={c.id}>
                  <button
                    className={`w-full rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                      c.id === vigente?.id
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "bg-subtle text-ink-soft hover:text-ink"
                    }`}
                    onClick={() => onAbrir(c.id)}
                    type="button"
                  >
                    {c.versao === null ? c.nome : `versão ${c.versao}`}
                    {c.id === vigente?.id ? " · vigente" : ""}
                    <span className="block text-[10px] text-ink-muted">
                      {new Date(c.criadoEm).toLocaleString("pt-BR")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-line bg-surface p-4">
          <h3 className="m-0 text-sm font-semibold text-ink">Quem assina</h3>
          {/* ⚠️ DITO, E NÃO FINGIDO. A lista com ordem, e-mail, CPF e exclusão vive hoje dentro do
              modal de envio; trazê-la para esta coluna, com a edição e a exclusão que o Lucas
              pediu, é a próxima fatia. Uma lista falsa aqui seria pior do que a ausência. */}
          <p className="m-0 mt-2 text-xs text-ink-muted">
            A lista com a ordem, os e-mails e a exclusão abre no botão de enviar. Trazê-la para esta
            coluna é a próxima entrega.
          </p>
        </section>

        <div className="flex flex-wrap gap-2">
          {podeEnviar && vigente ? (
            <button
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#A07C3B] px-3.5 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              onClick={onEnviar}
              type="button"
            >
              <FileSignature aria-hidden="true" className="size-3.5" />
              Enviar para assinatura
            </button>
          ) : null}

          {podeEnviar ? (
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-xs font-semibold text-ink-soft transition-colors hover:text-ink disabled:opacity-50"
              disabled={emAndamento}
              onClick={async () => {
                setErro(null);
                const falha = await onGerarContrato();
                if (falha) setErro(falha);
              }}
              type="button"
            >
              {emAndamento ? (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              ) : (
                <FileText aria-hidden="true" className="size-3.5" />
              )}
              {contratos.length > 0 ? `Gerar versão ${contratos.length + 1}` : "Gerar contrato"}
            </button>
          ) : null}
        </div>
      </div>

      {/* DIREITA: o PDF, "aqui eu já vejo o PDF mesmo" */}
      <section className="min-h-[60vh] rounded-xl border border-line bg-subtle">
        {vigente ? (
          <VisorDoPdf documentoId={vigente.id} />
        ) : (
          <p className="m-0 p-4 text-xs text-ink-muted">
            O contrato aparece aqui depois de gerado.
          </p>
        )}
      </section>
    </div>
  );
}

/** O PDF embutido. A URL é assinada e dura 10 minutos; reabrir a tela pede outra. */
function VisorDoPdf({ documentoId }: { documentoId: string }) {
  const [url, setUrl] = useState<null | string>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const token = await getApoloAccessToken();
        const r = await fetch(
          `/api/temis/contrato/gerar?documento=${encodeURIComponent(documentoId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const j = (await r.json().catch(() => ({}))) as { data?: { url: string } };
        if (!vivo) return;
        if (j.data?.url) setUrl(j.data.url);
        else setErro(true);
      } catch {
        if (vivo) setErro(true);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [documentoId]);

  if (erro) {
    return <p className="m-0 p-4 text-xs text-ink-muted">Não consegui abrir o contrato.</p>;
  }
  if (!url) {
    return <p className="m-0 p-4 text-xs text-ink-muted">Carregando o contrato…</p>;
  }

  return <iframe className="h-full min-h-[60vh] w-full rounded-xl" src={url} title="Contrato" />;
}

// ── ETAPA 4 · PRAZO LEGAL ──────────────────────────────────────────────────

function EtapaDoPrazoLegal({ inicio }: { inicio: null | string }) {
  // ⚠️ SETE DIAS CORRIDOS, não úteis: é prazo do comprador e corre no calendário. O resto dos
  // prazos da Têmis conta dias ÚTEIS, porque mede trabalho nosso.
  const dias = inicio
    ? Math.floor((Date.now() - new Date(inicio).getTime()) / 86_400_000)
    : null;

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="m-0 text-sm font-semibold text-ink">Prazo de arrependimento</h3>
        {dias === null ? (
          <p className="m-0 mt-2 text-xs text-ink-muted">
            Sem a data da última assinatura do comprador. O card chegou aqui antes de o carimbo
            existir.
          </p>
        ) : (
          <>
            <p className="m-0 mt-2 text-2xl font-bold text-ink">{Math.min(dias, 7)} de 7 dias</p>
            <div className="mt-2 flex gap-1">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <span
                  className={`h-1.5 flex-1 rounded-full ${i < dias ? "bg-emerald-500" : "bg-line"}`}
                  key={i}
                />
              ))}
            </div>
            <p className="m-0 mt-2 text-xs text-ink-muted">
              Última assinatura em {new Date(inicio as string).toLocaleDateString("pt-BR")}
              {dias >= 7 ? " · prazo cumprido" : ""}
            </p>
          </>
        )}
      </section>

      <EmConstrucao
        oQueVem="A entrada lida do C2X (à vista ou primeira parcela, com a data de vencimento) e o botão de faturar, que só acende com as duas condições fechadas."
        titulo="A entrada"
      />
    </div>
  );
}

// ── Peças ──────────────────────────────────────────────────────────────────

function EmConstrucao({ oQueVem, titulo }: { oQueVem: string; titulo: string }) {
  return (
    <section className="rounded-xl border border-dashed border-line bg-surface p-4">
      <h3 className="m-0 text-sm font-semibold text-ink">{titulo}</h3>
      <p className="m-0 mt-1 text-xs text-ink-muted">{oQueVem}</p>
    </section>
  );
}

function Campos({ campos }: { campos: CampoDaAnalise[] }) {
  return (
    <dl className="m-0 mt-1.5 grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-x-4 gap-y-1.5">
      {campos.map((c) => (
        // ⚠️ `min-w-0` E `break-words` ANDAM JUNTOS, e sem os dois o e-mail escrevia POR CIMA
        // do telefone da coluna vizinha. Item de grid nasce com `min-width: auto`, que significa
        // "nunca fique menor que a maior palavra" — e um e-mail nao tem onde quebrar, entao a
        // caixa transbordava em vez de encolher. `min-w-0` deixa encolher; `break-words` da ao
        // texto o direito de quebrar no meio da palavra quando nao ha espaco nenhum.
        <div className="min-w-0" key={c.rotulo}>
          <dt className="truncate text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            {c.rotulo}
          </dt>
          <dd
            className={`m-0 break-words text-sm ${
              c.faltando ? "text-amber-600 dark:text-amber-300" : "text-ink"
            }`}
          >
            {c.valor}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function BlocoIndeferido({ card }: { card: Card }) {
  const rotulo = MOTIVOS.find((m) => m.codigo === card.indeferido_motivo)?.rotulo;
  return (
    <section className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3">
      <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
        Indeferido
      </h3>
      <p className="m-0 mt-1 text-sm text-ink">{rotulo ?? card.indeferido_motivo}</p>
      {card.indeferido_observacao ? (
        <p className="m-0 mt-1 text-xs text-ink-soft">{card.indeferido_observacao}</p>
      ) : null}
      {card.indeferido_por_nome ? (
        <p className="m-0 mt-1 text-[11px] text-ink-muted">por {card.indeferido_por_nome}</p>
      ) : null}
    </section>
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <p className="m-0 mb-4 rounded-xl border border-line bg-subtle px-4 py-3 text-xs text-ink-soft">
      {texto}
    </p>
  );
}

/** A moldura de tela cheia. O quadro fica por baixo; `Esc` e o botão voltam. */
function Moldura({
  aoFechar,
  children,
}: {
  aoFechar: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const naTecla = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") aoFechar();
    };
    document.addEventListener("keydown", naTecla);
    return () => document.removeEventListener("keydown", naTecla);
  }, [aoFechar]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-canvas p-3">
      <button
        className="mb-2 inline-flex w-fit shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-ink-soft transition-colors hover:text-ink"
        onClick={aoFechar}
        type="button"
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        Voltar ao quadro
      </button>
      {children}
    </div>
  );
}
