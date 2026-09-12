"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CircleCheck,
  Eye,
  FilePlus2,
  FileText,
  Loader2,
  Mail,
  MailCheck,
  MailX,
  Pencil,
  RefreshCw,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AnaliseDoTrabalho, CampoDaAnalise } from "@/lib/temis/analise-do-trabalho";
import type { DescontoDaProposta } from "@/lib/temis/comercial-da-analise";
import type { PedidoDoTrabalho } from "@/lib/temis/pedido-do-trabalho";
import { PAPEIS, type PapelNoContrato, rotuloDoPapel } from "@/lib/assinatura/tipos";
import { contratoVigente } from "@/lib/temis/contrato-guardado";
import { MOTIVOS } from "@/lib/temis/indeferimento";
import { pedidoDoTrabalho } from "@/lib/temis/pedido-do-trabalho";
import {
  caminhoDoCard,
  type EstagioDoTrabalho,
  EXIGE_ASSINATURA,
  NOME_DO_TIPO,
  nomeDoEstagio,
  type TipoDeTrabalho,
} from "@/lib/temis/trabalhos";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";
import { PreviaDoContrato } from "@/modules/incorporador/hercules/PreviaDoContrato";
import { OrganizacaoDaAssinatura } from "@/modules/temis/blocks/assinatura/organizacao-da-assinatura";
import { VisorDeDocumento } from "@/modules/temis/blocks/trabalho/visor-de-documento";
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
//
// ⚠️ E O ENVIO PARA ASSINATURA NÃO SOBE MAIS PELO QUADRO. A tela tinha uma prop
// `aoEnviarParaAssinatura(trabalhoId)` que abria o modal lá em cima — e o nome dela MENTIA: o
// destino espera o id da PROPOSTA, e o callsite mandava `card.id`. Em produção (11/09/2026) o card
// `88a53e18` tem `proposta_id` `332315b6`; havia dois contratos gravados para a proposta e NENHUM
// para o id do card, então a rota respondia "Esta proposta ainda não tem contrato gerado" com o
// PDF aberto na tela ao lado. Trocar o argumento não bastava: os dois são uuid v4, nenhum rename
// trava a troca, e o próximo callsite erraria de novo calado. Por isso a prop morreu inteira e
// quem organiza o envio é a `OrganizacaoDaAssinatura`, que recebe a proposta e mais nada.

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

/**
 * O ENVELOPE VIVO DESTA VENDA — o MESMO fato que o servidor confere antes de cancelar.
 *
 * ⚠️ ELE SUBSTITUI O PALPITE PELA ETAPA, e essa troca é o conserto inteiro. A confirmação da volta
 * escolhia a frase por `estagio !== "contrato"`, supondo que em "Contrato" nunca há envelope; o
 * servidor cancela sem olhar estágio nenhum. E um card DIZ "Contrato" com envelope vivo sempre que o
 * envio falha no passo `notificar`: a linha fica com `envelope_id` e estado `aguardando` e o card
 * NÃO é movido. Ali a frase neutra mandava confirmar, e o envelope de PRODUÇÃO morria depois do
 * clique — com o aviso chegando no recado verde, tarde demais para quem ia decidir.
 *
 * ⚠️ O CAMPO VEM DA ROTA, e não é derivado aqui: quem responde "existe envelope vivo?" é
 * `envelopeQueSegura`, no servidor, a mesma régua do reenvio e da volta. Ver
 * `app/api/temis/trabalho/route.ts`.
 *
 * ⚠️ E ELE É SEMPRE `null` FORA DO CARD DE TIPO `contrato`, pelo mesmo portão que a volta usa: a
 * tabela casa por `proposta_id` e não tem `trabalho_id`, então o card de cancelamento leria o
 * envelope DA VENDA. Nesses cards a volta não toca em envelope nenhum, e a frase neutra é a certa.
 */
type EnvelopeVivo = {
  /**
   * O servidor CONSEGUIU conferir a tabela?
   *
   * ⚠️ `false` É "NÃO DEU PARA PERGUNTAR", E NÃO "NÃO TEM". A leitura de `temis_envelopes` pode
   * falhar, e o campo chegar `null` por causa disso faria esta tela escrever a frase NEUTRA sobre
   * uma venda com envelope vivo — o operador confirmaria sem nunca ler que um envelope da conta de
   * produção morre no clique. Com `conferido: false` a tela avisa pelo pior caso.
   */
  conferido: boolean;
  /** O estado cru de `temis_envelopes`. É por ele que a frase é escolhida. */
  estado: string;
  /** O id na Clicksign. `null` = envio que começou e o Panteon não soube como terminou. */
  id: null | string;
  /** O mesmo estado em palavra da casa, pronto para escrever — `rotuloDoEstado`, no servidor. */
  rotulo: string;
};

/**
 * O QUE A CLICKSIGN JÁ CONTOU SOBRE ESTE ENVELOPE — signatário a signatário, e em linha do tempo.
 *
 * ⚠️ ISTO EXISTE PORQUE UMA ASSINATURA MORREU CALADA. Medido em produção (12/09/2026, envelope
 * `3e9a331d-ec2f-4eb5-9ae1-aafbeae8b395`): o contrato da Beatriz saiu para dois signatários, o
 * segundo e-mail não existe, e quatro segundos depois do envio a Clicksign registrou
 * `tracking_notification_error` com `last_status: "bounce"` e `550 5.1.1 ... NoSuchUser`. A tela
 * dizia "Parcialmente assinado" e mais nada — Lucas: *"nesse caso tinha que voltar com o erro de
 * e-mail"*. O dado sempre esteve no nosso banco: ele vem DENTRO do payload dos webhooks seguintes,
 * no array `document.events[]`, que a Clicksign reenvia inteiro a cada evento.
 *
 * ⚠️ QUEM LÊ O PAYLOAD É O SERVIDOR, E SÓ ELE. Esta tela não sabe o que é `tracking_notification_
 * error` nem `last_bounce_type`: ela recebe fatos em português e os desenha. Interpretar o evento
 * cru aqui criaria uma segunda régua para a mesma pergunta — a mesma armadilha que a camada de
 * tradução dos estados (`lib/assinatura/traduzir.ts`) existe para impedir.
 *
 * ⚠️ E É `null` QUANDO NÃO HÁ O QUE CONTAR, não um objeto zerado: card sem envelope (o caso do
 * Henrique, que subiu de etapa por marcação humana) e card de tipo que não assina caem nesse
 * caso, e um "0 de 0 assinaram" diria que ninguém assinou um contrato que nunca foi enviado.
 */
/**
 * ⚠️ ESTA FORMA É A DE `DiarioDaProposta` (`lib/assinatura/diario-do-envelope-db.ts`), CAMPO POR
 * CAMPO. O objeto atravessa a rota como JSON, e ali o TypeScript não confere nada: este bloco
 * chegou a declarar uma lista `quemAssinou` na raiz enquanto o servidor mandava as pessoas dentro
 * de `envelope.signatarios` — typecheck limpo dos dois lados, painel vazio na tela. Mexeu em um,
 * confira o outro.
 */
type AssinaturaDoCard = {
  assinaram: number;
  diario: LinhaDoDiario[];
  envelope: {
    /** O id na Clicksign — é ele que se procura na conta de lá, e não o uuid da nossa linha. */
    envelopeId: null | string;
    estado: string;
    signatarios: SignatarioNaTela[];
  };
  total: number;
};

/** Uma linha do painel de log: o fato já escrito em português pelo servidor. */
type LinhaDoDiario = {
  detalhe: null | string;
  fato: string;
  /**
   * ⚠️ `erro` É O QUE PEDE MÃO HUMANA, e é por isso que ele tem cor própria. Convite devolvido não
   * vira assinatura com o tempo: alguém precisa voltar o card para a análise e corrigir o e-mail.
   */
  gravidade: "erro" | "marco" | "normal";
  quem: null | string;
  quando: string;
};

/**
 * Um signatário do envelope, com o que se sabe dele.
 *
 * ⚠️ `convite` TEM TRÊS VALORES, E O TERCEIRO NÃO É "ENTREGUE". A Clicksign avisa quando a
 * notificação FALHA; silêncio não é confirmação de entrega. Escrever "convite entregue" sobre
 * `sem_noticia` seria a tela afirmando o que ninguém disse — e, no dia em que o e-mail estivesse
 * errado de novo, o operador leria "entregue" e iria cobrar o cliente pelo atraso dele.
 */
type SignatarioNaTela = {
  assinouEm: null | string;
  /**
   * A identidade da pessoa no envelope: a `signer.key` da Clicksign, ou o e-mail quando ela ainda
   * não existe lá. Serve de `key` da lista, e NADA MAIS — em especial, não carrega o papel.
   */
  chave: string;
  comecouEm: null | string;
  convite: "entregue" | "nao_entregue" | "sem_noticia";
  conviteDetalhe: null | string;
  conviteQuando: null | string;
  email: null | string;
  nome: string;
  /**
   * `comprador`, `conjuge`, `vendedora`… como o envio congelou em `temis_envelopes.signatarios`.
   *
   * ⚠️ ELE VEM EM CAMPO PRÓPRIO, E NÃO SE LÊ DA `chave`. Esta tela chegou a tirar o papel de um
   * prefixo `papel|nome` que a `chave` não tem — o que a Clicksign devolve é um uuid —, então o
   * papel saía `null` para todo mundo enquanto o servidor o mandava pronto ao lado. `null` de
   * verdade quer dizer: apareceu nos eventos e não está na lista congelada do envio.
   */
  papel: null | string;
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
  aoConcluir,
  aoFechar,
  aoMudar,
  trabalhoId,
}: {
  /**
   * Uma etapa foi encerrada aqui dentro: o quadro que recebe isto mostra o recado e volta a ser a
   * tela. Hoje são dois casos: a geração do contrato e o envio para assinatura.
   */
  aoConcluir?: (recado: string) => void;
  aoFechar: () => void;
  /** Chamado quando algo muda, para o quadro recarregar. */
  aoMudar: () => void;
  trabalhoId: string;
}) {
  const [dados, setDados] = useState<null | {
    analise: AnaliseDoTrabalho | null;
    assinatura: AssinaturaDoCard | null;
    card: Card;
    envelopeVivo: EnvelopeVivo | null;
    podeEmitir: boolean;
  }>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [ocupado, setOcupado] = useState(false);
  /** A proposta cuja prévia de contrato está aberta. `null` = nenhuma. */
  const [previa, setPrevia] = useState<null | string>(null);
  /** A versao do contrato aberta por cima da tela. `url` vazia = buscando a URL assinada. */
  const [contratoNaTela, setContratoNaTela] = useState<null | { nome: string; url: string }>(null);
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
        data?: {
          analise: AnaliseDoTrabalho | null;
          // ⚠️ OPCIONAL PELO MESMO MOTIVO DO `envelopeVivo` ABAIXO: enquanto a versão de produção
          // da rota não mandar o campo, a tela precisa continuar abrindo. O `?? null` faz dele o
          // que ele é nesse caso — "não sei" —, e a etapa volta a dizer o que ainda não mostra.
          assinatura?: AssinaturaDoCard | null;
          card: Card;
          // ⚠️ OPCIONAL DE PROPÓSITO. Enquanto a versão de produção da rota não mandar o campo, a
          // tela precisa continuar abrindo — e o `?? null` abaixo faz dela o que ela é nesse caso:
          // "não sei", que a confirmação trata como o texto neutro e o servidor resolve de novo.
          envelopeVivo?: EnvelopeVivo | null;
          podeEmitir: boolean;
        };
        error?: string;
      };
      if (!r.ok || !corpo.data) {
        setErro(corpo.error ?? "Não consegui abrir este trabalho.");
        return;
      }
      setDados({
        ...corpo.data,
        assinatura: corpo.data.assinatura ?? null,
        envelopeVivo: corpo.data.envelopeVivo ?? null,
      });
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

  /**
   * Abre uma versão do contrato SEM SAIR DA TELA.
   *
   * ⚠️ ANTES ISSO ABRIA ABA, E ABRIA ERRADO: `window.open("", "_blank", "noopener,noreferrer")`
   * devolve `null` por especificação — a flag `noopener` leva junto a referência. O código caía no
   * `else` e mandava a ABA DE TRABALHO para o PDF, deixando uma aba nova em branco. Lucas
   * (11/09/2026): *"ao clicar nos documentos está abrindo uma pagina no navegador em branco e abre
   * no hub o documento"*.
   */
  const abrirContrato = useCallback(async (documentoId: string) => {
    setContratoNaTela({ nome: "Contrato", url: "" });
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(
        `/api/temis/contrato/gerar?documento=${encodeURIComponent(documentoId)}&modo=ver`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const j = (await r.json().catch(() => ({}))) as {
        data?: { nome?: string; url: string };
      };
      if (j.data?.url) {
        setContratoNaTela({ nome: j.data.nome ?? "Contrato", url: j.data.url });
      } else {
        setContratoNaTela(null);
      }
    } catch {
      setContratoNaTela(null);
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

  /**
   * DEVOLVE O CARD PARA A ANÁLISE — o caminho de correção que substituiu o "Gerar versão N".
   *
   * Lucas (11/09/2026): *"caso queira fazer algum ajuste no contrato, podemos ter um botão para
   * voltar o contrato a etapa anterior, corrigir e mandar para assinatura"* e, sobre a etapa
   * seguinte: *"aproveita e coloca uma forma de voltar para analise quando precisarmos alterar
   * alguma coisa no contrato mesmo estando na sessao de assinatura, pois e nesse momento que todos
   * vao receber o contrato para assinatura, ae com certeza pode ter algo para ser alterado"*.
   *
   * ⚠️ A CHAMADA VIVE AQUI, e não no painel da etapa, pelo mesmo motivo do indeferimento: quem
   * recarrega o card é esta tela, e o quadro precisa saber que ele mudou de coluna. O painel só
   * devolve o texto da falha para escrever na própria coluna.
   *
   * ⚠️ QUEM DECIDE É O ENVELOPE, E NÃO A ETAPA — Lucas (11/09/2026): *"prefaturamento pode
   * desde que nao esteja todo assinado"*. Não existe lista de estágios que voltam "por natureza":
   * o que decide é um FATO — o contrato está assinado por todos? E a etapa não prova o fato. O
   * Pré-faturamento é alcançado normalmente com o envelope fechado, mas `marcarAtividade` avança o
   * card por marcação humana sem consultar envelope nenhum, e foi assim que o card do Henrique
   * chegou ao fim sem contrato e sem envelope (medido em 09/09/2026). Por isso a tela OFERECE a
   * volta nas três etapas do caminho, e quem responde "pode?" é o servidor, que lê o envelope.
   *
   * ⚠️ A FALHA SOBE COMO VEIO DO SERVIDOR, LETRA POR LETRA, e isso é regra e não conveniência:
   * quando o contrato já está assinado por todos, a resposta traz o FATO e o CAMINHO — abrir o
   * pedido de cancelamento, no Hércules, na tela da venda — Lucas (11/09/2026): *"se o contrato
   * estiver assinado por todos somente cancelamento do contrato"*. Trocá-la por um "não consegui
   * voltar" jogaria fora a única instrução útil que a tela tem naquele instante.
   *
   * ⚠️ E A TELA NÃO REESCREVE A FRASE NEM COMPLETA O QUE ELA NÃO DIZ. Quem classifica entre
   * cancelamento e distrato é `classificarCancelamento` (`lib/temis/cancelamento.ts`), por duas
   * perguntas — assinou? pagou? — que leem OUTRA fonte (os fatos do contrato). Uma frase daqui que
   * afirmasse o resultado dessa régua passaria a mentir no dia em que o pagamento entrasse na conta,
   * e ninguém a corrigiria: ela não é dela. Repassar é o desenho inteiro.
   */
  const voltarParaAnalise = useCallback(async (): Promise<null | string> => {
    setOcupado(true);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/temis/trabalho", {
        body: JSON.stringify({ acao: "voltar_para_analise", id: trabalhoId }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      // ⚠️ O AVISO DO ENVELOPE É OPCIONAL, E É LIDO NOS DOIS FORMATOS DA CASA: esta rota responde na
      // raiz (`ok`) e o GET responde dentro de `data`. Quando o campo não vem — porque não havia
      // envelope para cancelar, ou porque a resposta é de uma versão anterior da rota — o recado
      // fala só da volta, que é verdade em qualquer um dos casos.
      //
      // ⚠️ E ELE É O ID DO ENVELOPE, NÃO UM `boolean`. `retornarParaAnalise` devolve
      // `envelopeCancelado: null | string` (`lib/temis/retorno-para-correcao.ts`), e o id é o que
      // permite conferir na Clicksign qual envelope morreu. Tipado como `boolean`, o valor real
      // continuaria funcionando no `if` por ser uma string não vazia — e quebraria calado no dia em
      // que alguém escrevesse `=== true`, ou quisesse mostrar o número na mensagem.
      const corpo = (await r.json().catch(() => ({}))) as {
        data?: { envelopeCancelado?: null | string };
        envelopeCancelado?: null | string;
        error?: string;
      };
      if (!r.ok) return corpo.error ?? "Não consegui voltar o card para a análise.";
      const envelopeCancelado = corpo.envelopeCancelado ?? corpo.data?.envelopeCancelado ?? null;
      await carregar();
      // ⚠️ `aoConcluir` JÁ RECARREGA O QUADRO E FECHA A TELA — chamar `aoMudar` junto faria a mesma
      // busca duas vezes. O `aoMudar` fica para quem montou a tela sem passar o `aoConcluir`: ali
      // ninguém fecha nada, e o quadro por baixo precisaria saber que o card mudou de coluna.
      if (aoConcluir) {
        aoConcluir(
          envelopeCancelado
            ? "Envelope cancelado na Clicksign e card de volta na Análise. Quem já tinha recebido o convite perdeu o acesso."
            : "O card voltou para Análise.",
        );
      } else {
        aoMudar();
      }
      return null;
    } finally {
      setOcupado(false);
    }
  }, [aoConcluir, aoMudar, carregar, trabalhoId]);

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

  const { analise, assinatura, card, envelopeVivo, podeEmitir } = dados;
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
          // ⚠️ GERAR ENCERRA A ETAPA — Lucas (11/09/2026): *"cliquei no gerar contrato não
          // aconteceu nada, acho que tem que dar uma mensagem contrato gerado e voltar para o
          // board"*. O modal fechava e a tela ficava igual: sem recado, sem o card ter andado, sem
          // nada que dissesse que o PDF existe.
          aoGerar={(contrato) => {
            setPrevia(null);
            aoConcluir?.(`Contrato gerado — versão ${contrato.versao}. O card foi para Contrato.`);
          }}
          podeEditar={ehContrato}
          podeGerar={ehContrato}
          propostaId={previa}
        />
      ) : null}

      {/* O contrato aberto por cima da tela, e nao numa aba: quem confere precisa do fundo. */}
      {contratoNaTela ? (
        <VisorDeDocumento
          aoFechar={() => setContratoNaTela(null)}
          documento={contratoNaTela}
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

      {/* ── DUAS COLUNAS: o trabalho da etapa · chat, documentos e histórico ──
          ⚠️ A ALTURA SÓ É TRAVADA A PARTIR DE `lg`, e não em toda largura. Em janela estreita as
          duas colunas empilham: travar a altura ali faria a análise inteira — que é a etapa mais
          alta da tela — caber numa faixa com rolagem própria, com a conversa escondida embaixo. */}
      <div className="mt-3 grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-h-0 flex-col pr-1 lg:overflow-auto">
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
              // ⚠️ O ENVIO ENCERRA A ETAPA, E A TELA PRECISA FECHAR JUNTO. O POST move o card para
              // "assinatura"; se a tela continuasse aberta desenhando esta etapa, o botão de
              // enviar ficaria vivo em cima de um envelope já criado e o segundo clique criaria o
              // SEGUNDO envelope — que também é cobrado. É o mesmo desenho da geração de contrato:
              // recado primeiro, volta ao quadro depois.
              aoEnviado={() =>
                aoConcluir?.("Contrato enviado para assinatura. O card foi para Em assinatura.")
              }
              aoVoltarParaAnalise={voltarParaAnalise}
              contratos={card.contratos}
              // ⚠️ ELE ATRAVESSA A ETAPA INTEIRA ATÉ A CONFIRMAÇÃO DA VOLTA. É o que faz a frase
              // desta etapa parar de mentir quando sobrou envelope de um envio que falhou.
              envelopeVivo={envelopeVivo}
              onAbrir={abrirContrato}
              podeEmitir={podeEmitir}
              // ⚠️ `propostaId`, E NÃO `card.proposta_id`: o const acima já foi estreitado pelo TS,
              // e nem `!` nem `?? ""` entram aqui — a string vazia bate no 400 "Sem proposta." e a
              // tela voltaria a mentir por outro caminho. Quando é `null`, o painel de envio nem
              // aparece: o aviso "Este card não tem venda ligada" logo acima já explica.
              propostaId={propostaId}
              // ⚠️ O TIPO É TRAVA, e sem ele a etapa oferece assinatura para quem não assina. Ver a
              // nota de `EtapaDoContrato` — o caso dos dois cards do Henrique.
              tipo={card.tipo}
            />
          ) : null}

          {/* ── ETAPA 3 · EM ASSINATURA ──────────────────────────────────────
              ⚠️ A ETAPA DEIXOU DE SER UM BLOCO "EM CONSTRUÇÃO" — Lucas (12/09/2026): *"na tela de
              assinatura, alem de trazer as coisas que solicitei seria legal ter um painel de log,
              tipo, contrato enviado, contrato nao enviado - e-mail invalido"*. O que o bloco
              PROMETIA ("os indicadores por signatário: assinou, visualizou, e-mail não entregue")
              é exatamente o que a `PainelDaAssinatura` entrega agora. A ordem é a do pedido: o
              contador, depois quem assina, depois o log.

              ⚠️ E O "EM CONSTRUÇÃO" SOBREVIVE SÓ ONDE NÃO HÁ O QUE MOSTRAR — card sem envelope, ou
              rota antiga que não manda o campo. Sem ele, a etapa ficaria MUDA nesses casos, e tela
              muda se lê como "não há nada acontecendo".

              ⚠️ E É AQUI QUE A VOLTA MAIS IMPORTA — Lucas (11/09/2026): *"e nesse momento que todos
              vao receber o contrato para assinatura, ae com certeza pode ter algo para ser
              alterado"*. Voltar daqui costuma CANCELAR o envelope, e o preço está escrito na
              confirmação, antes do clique — mas quem decide a frase é o ENVELOPE, e não esta etapa:
              card em "Em assinatura" sem envelope vivo existe (`marcarAtividade` sobe card por
              marcação humana), e prometer ali um cancelamento que não vai acontecer ensinaria a ler
              o aviso âmbar como enfeite. */}
          {card.estagio === "assinatura" ? (
            /* ⚠️ LARGURA DE LEITURA, e não a largura do painel. Esta etapa não tem PDF ao lado,
               então o conteúdo esticava nos ~1.150px inteiros — e-mail e frase atravessando a tela,
               que é o jeito mais rápido de uma tela parecer desorganizada mesmo com tudo no lugar.
               O teto deixa a lista com a proporção de uma lista, e não de uma planilha. */
            <div className="grid max-w-3xl gap-3">
              {/* ⚠️ UMA LINHA, E SÓ O QUE SE SABE. Ela é o CABEÇALHO da etapa: diz em que pé está o
                  envelope como um todo (a palavra da casa, vinda pronta do servidor) e desde quando
                  o card está aqui. O detalhe por pessoa vem logo abaixo, no painel.

                  ⚠️ E ELA NÃO É REDUNDANTE COM O PAINEL. `envelopeVivo` responde "há envelope
                  SEGURANDO esta venda?" — é a mesma régua da volta e do reenvio; o painel responde
                  "o que aconteceu com quem assina?". Um envelope já cancelado some daqui e continua
                  contando a história lá embaixo.

                  ⚠️ E ELA SÓ APARECE NO CARD QUE TEM ENVELOPE PARA TER: nos outros tipos o servidor
                  NÃO LÊ a tabela (o portão de `conferirEMatarOEnvelope`, porque `temis_envelopes`
                  casa por proposta e o cancelamento divide a proposta com a venda), então
                  `envelopeVivo` chega `null` por não ter sido perguntado. Escrever ali "não vejo
                  envelope vivo" seria transformar "não perguntei" em "não existe". */}
              {/* ⚠️ A BARRA DE ESTADO SUMIU DAQUI, e virou o cabeçalho do painel. Ela dizia
                  "Parcialmente assinado" numa caixa, e o painel logo abaixo dizia "1 de 2
                  assinaram" noutra: o mesmo fato, duas caixas, dois pesos visuais iguais. Lucas
                  (12/09/2026): *"está bem ruim essa tela"*, *"é muito informação, temos que
                  conduzir o usuário"*. Conduzir começa por não dizer a mesma coisa duas vezes.

                  ⚠️ A LINHA SOBREVIVE PARA O CARD SEM PAINEL — quando o envelope existe mas nenhum
                  evento voltou, ou quando a leitura falhou, ela é a única coisa que sabe dizer o
                  que há. */}
              {ehContrato && !assinatura ? (
                <LinhaDoEnvelope desde={card.estagio_desde} envelopeVivo={envelopeVivo} />
              ) : null}
              {assinatura ? (
                // ⚠️ `carregar`, E NÃO `aoMudar`: os dois botões da linha do signatário mexem no
                // envelope e NÃO mexem na etapa do card. Quem precisa reler é ESTA tela — é ela que
                // desenha o e-mail novo e o convite recém-mandado. Subir pelo quadro recarregaria a
                // lista de cards e deixaria o painel aberto mostrando o e-mail antigo.
                <PainelDaAssinatura
                  aoRecarregar={carregar}
                  assinatura={assinatura}
                  desde={card.estagio_desde}
                  envelopeVivo={envelopeVivo}
                />
              ) : (
                <EmConstrucao
                  oQueVem="Não há signatários para mostrar nesta venda: ou o card chegou aqui sem envelope, ou o envelope ainda não devolveu nenhum evento. Continuam por vir a tela de monitoramento e o botão de cobrar pela Íris."
                  titulo="Em assinatura"
                />
              )}
              {/* ⚠️ O CAMINHO DE CONSERTO DO E-MAIL ERRADO É ESTE BOTÃO, e ele continua onde estava.
                  Quando o painel acima acusa convite devolvido, não há o que clicar na Clicksign: a
                  volta para a análise é que permite corrigir o cadastro e mandar de novo. */}
              <VoltarParaAnalise aoVoltar={voltarParaAnalise} envelopeVivo={envelopeVivo} />
            </div>
          ) : null}

          {/* ── ETAPA 4 · PRÉ-FATURAMENTO ──────────────────────────────────
              ⚠️ DAQUI TAMBÉM SE VOLTA, e é a correção que muda o desenho anterior — Lucas
              (11/09/2026): *"prefaturamento pode desde que nao esteja todo assinado"*. A etapa
              costuma ser alcançada com o envelope fechado, mas COSTUMA não é PROVA:
              `marcarAtividade` avança o card por marcação humana sem consultar envelope nenhum, e
              foi assim que o card do Henrique chegou ao fim sem contrato e sem envelope (medido em
              09/09/2026). Quem confere o envelope é o servidor; a tela oferece e aceita o não.

              ⚠️ E O BOTÃO ENTRA ABAIXO DO PRAZO, sem substituir nada: quem abre o card continua
              vendo em que dia dos sete ele está, que é o motivo de a etapa existir. */}
          {card.estagio === "prazo_legal" ? (
            <div className="grid gap-3">
              <EtapaDoPrazoLegal inicio={card.arrependimento_inicio} />
              <VoltarParaAnalise aoVoltar={voltarParaAnalise} envelopeVivo={envelopeVivo} />
            </div>
          ) : null}

          {card.estagio === "faturado" ? (
            <>
              <EmConstrucao
                oQueVem="O resumo do que ficou: contrato no cofre, assinaturas, prazo cumprido e entrada paga."
                titulo={nomeDoEstagio("faturado", card.tipo)}
              />
              <DaquiNaoSeVolta estagio="faturado" />
            </>
          ) : null}

          {card.estagio === "indeferido" ? <DaquiNaoSeVolta estagio="indeferido" /> : null}

          {card.proposta_id && card.estagio === "analise" && !analise ? (
            <Aviso texto="Não consegui montar os dados desta proposta. Isso costuma ser cadastro incompleto no Apolo; o log do servidor tem o motivo." />
          ) : null}
        </div>

        <ColunaFixa podeEscrever propostaId={card.proposta_id} trabalhoId={card.id} />
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
 * A ETAPA 2 — o contrato gerado e QUEM ASSINA.
 *
 * ⚠️ O PDF FICA À DIREITA E QUEM ASSINA À ESQUERDA — Lucas (09/09/2026): *"acho valido ter o
 * contrato gerado ao lado direito (PDF), aqui eu já vejo o PDF mesmo, e no lado esquerdo quem
 * assina"*.
 *
 * ⚠️ AQUI NÃO SE GERA CONTRATO. O botão "Gerar versão N" morava nesta coluna e saiu — Lucas
 * (11/09/2026): *"não precisa, nessa etapa é para somente organizar as assinatura, caso queira
 * fazer algum ajuste no contrato, podemos ter um botão para voltar o contrato a etapa anterior,
 * corrigir e mandar para assinatura"*. A descrição oficial da etapa em `lib/temis/trabalhos.ts` já
 * dizia isso: *"Gerado. Conferir quem assina antes de mandar."*. Regerar continua existindo na
 * ANÁLISE, que é onde a prévia abre editável — e o caminho de correção virou explícito: voltar,
 * corrigir, gerar, e o card volta para cá sozinho. Ter as duas portas na mesma coluna de 320px
 * fazia a conferência dos signatários competir com a edição do texto do contrato.
 *
 * O PDF vai num `<iframe>` com a URL assinada de 10 minutos: o bucket é privado, e é a mesma URL
 * que o botão de abrir usa.
 *
 * ⚠️ QUEM ABRE O PAINEL DE ASSINATURA É O TIPO DO CARD, E NÃO A PERMISSÃO DE QUEM OLHA. `podeEmitir`
 * responde "esta PESSOA pode mandar?"; a pergunta que faltava é "este TRABALHO se assina?". E o
 * caso é real e medido: em 10/09/2026 a proposta do Henrique (Q01 L05) tinha DOIS cards — a venda e
 * o pedido de cancelamento dela. Gerar o contrato no card da venda chama `moverCardDaTemis`, e o
 * caminho do cancelamento TAMBÉM passa pelo estágio "contrato" (`estagiosDoTipo`), então os dois
 * caem nesta coluna. Abrindo o card de CANCELAMENTO, esta etapa desenhava o painel com os
 * signatários da VENDA e o dourado vivo: um clique criaria envelope pago convidando o comprador a
 * assinar o contrato de uma venda que está sendo desfeita. E o card nem andava depois — como
 * `estagiosDoTipo("cancelamento")` não inclui "assinatura", ele ficaria parado aqui com o botão
 * vivo, criando um envelope a cada reabertura.
 *
 * ⚠️ A TRAVA É `EXIGE_ASSINATURA`, NUNCA `tipo === "contrato"`. Cessão, distrato e cancelamento por
 * correção também assinam (`lib/temis/trabalhos.ts` é a fonte única disso), e travar por "contrato"
 * fecharia a porta para os três. Só o cancelamento por desistência não assina.
 */
function EtapaDoContrato({
  aoEnviado,
  aoVoltarParaAnalise,
  contratos,
  envelopeVivo,
  onAbrir,
  podeEmitir,
  propostaId,
  tipo,
}: {
  /** O envelope já existe na Clicksign: quem recebe fecha a tela e avisa o quadro. */
  aoEnviado: () => void;
  /** Devolve o texto da falha, ou `null` quando o card voltou para a análise. */
  aoVoltarParaAnalise: () => Promise<null | string>;
  contratos: ContratoNoCard[];
  /**
   * O envelope vivo desta venda, que esta etapa só repassa para a confirmação da volta.
   *
   * ⚠️ E EM "CONTRATO" ELE NÃO É SEMPRE `null`, que era justamente a suposição errada: falha no
   * passo `notificar` deixa `envelope_id` gravado, estado `aguardando` e o card PARADO aqui.
   */
  envelopeVivo: EnvelopeVivo | null;
  onAbrir: (documentoId: string) => void;
  /** Quem organiza a assinatura. Vem do servidor junto com o card — esconder botão é só o que se vê. */
  podeEmitir: boolean;
  /** ⚠️ A PROPOSTA, NUNCA O CARD. `null` = card sem venda ligada, e aí não há o que enviar. */
  propostaId: null | string;
  /** O que este card produz. É ele que decide se existe assinatura — ver a nota acima. */
  tipo: TipoDeTrabalho;
}) {
  /**
   * O envio para a Clicksign está no ar, e quem avisa é o próprio painel.
   *
   * ⚠️ ENQUANTO ELE CORRE, A VOLTA FICA TRANCADA. O POST leva de 40 a 90 segundos (16 chamadas
   * HTTP, com o PDF inteiro em base64) e parece travado; quem clicava em "Voltar para análise"
   * nesse intervalo PASSAVA pelo comparar-e-trocar do servidor, porque o card só sai de "contrato"
   * na última linha do envio. O card voltava para Análise, este painel desmontava com o envelope a
   * caminho, e gerar a v2 ali deixaria o comprador assinando a v1 com o Panteon apontando a v2.
   */
  const [enviando, setEnviando] = useState(false);
  const vigente = contratoVigente(contratos);

  return (
    <div className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      {/* ESQUERDA: o contrato e quem assina */}
      <div className="grid content-start gap-3 xl:min-h-0 xl:overflow-auto xl:pr-1">
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

        {/* ── QUEM ASSINA ──────────────────────────────────────────────────
            ⚠️ O PAINEL É AUTOSSUFICIENTE e vem SEM moldura nossa: ele busca o preparo, guarda a
            ordem, os e-mails e o CPF editados, mostra impedimento e avisos e tem o próprio botão de
            enviar. Embrulhá-lo numa `<section>` daqui desenharia duas bordas em volta da mesma
            lista. O que esta coluna decide é só se ele aparece.

            ⚠️ SEM `propostaId` NÃO HÁ PAINEL. Quem não tem venda ligada já leu o aviso no topo da
            coluna; oferecer o envio aqui só levaria ao 400 "Sem proposta.".

            ⚠️ E SEM ASSINATURA NO CAMINHO DO TIPO TAMBÉM NÃO HÁ PAINEL — é a trava que faltava, e o
            caso do card de cancelamento do Henrique está contado na nota do componente. */}
        {!EXIGE_ASSINATURA[tipo] ? (
          <section className="rounded-xl border border-line bg-surface p-4">
            <h3 className="m-0 text-sm font-semibold text-ink">Sem assinatura</h3>
            <p className="m-0 mt-2 text-xs text-ink-muted">
              {NOME_DO_TIPO[tipo]} não passa por assinatura: o documento se emite e se arquiva. O
              card fica nesta etapa só enquanto o documento é preparado.
            </p>
          </section>
        ) : !podeEmitir ? (
          <section className="rounded-xl border border-line bg-surface p-4">
            <h3 className="m-0 text-sm font-semibold text-ink">Quem assina</h3>
            <p className="m-0 mt-2 text-xs text-ink-muted">
              Quem monta a ordem de assinatura e manda o contrato para a Clicksign é a coordenação
              da Têmis. Aqui dá para conferir o documento e acompanhar.
            </p>
          </section>
        ) : propostaId ? (
          <OrganizacaoDaAssinatura
            aoEnviar={() => aoEnviado()}
            aoMudarEnvio={setEnviando}
            compacto
            propostaId={propostaId}
          />
        ) : null}

        {/* ── O CAMINHO DE VOLTA ───────────────────────────────────────────
            ⚠️ A PEÇA É A MESMA DAS ETAPAS EM ASSINATURA E PRÉ-FATURAMENTO, e é uma só de
            propósito: a regra do Lucas (11/09/2026) também é uma só — o card volta para Análise
            enquanto o contrato não estiver assinado por todos. Três cópias do botão dariam três
            chances de as frases se desencontrarem, e a frase é a parte que protege quem clica.

            ⚠️ E ELA FICA TRANCADA DURANTE O ENVIO. Ver a nota de `enviando`: o servidor aceitaria a
            volta no meio do POST, porque o card só muda de estágio na última linha dele. */}
        <VoltarParaAnalise
          aoVoltar={aoVoltarParaAnalise}
          envelopeVivo={envelopeVivo}
          travado={enviando}
          travadoPorque="O contrato está sendo enviado para a Clicksign. Voltar agora deixaria o envelope a caminho de um card que saiu da etapa."
        />
      </div>

      {/* DIREITA: o PDF, "aqui eu já vejo o PDF mesmo"
          ⚠️ O `xl:min-h-0` NÃO É ENFEITE. Em `xl` esta seção é quem preenche a altura do painel; um
          `min-height` maior do que a altura disponível empurraria o painel para rolar por fora, e a
          barra de rolagem dupla seria outro defeito no lugar do "a tela está cortando". Abaixo de
          `xl`, onde a coluna empilha, o `min-h-[60dvh]` volta a valer e o PDF nasce com tamanho de
          leitura. `dvh` e não `vh`: no mobile a barra do navegador come a diferença. */}
      <section className="flex min-h-[60dvh] flex-col rounded-xl border border-line bg-subtle xl:min-h-0">
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
        // ⚠️ `modo=ver` OU O IFRAME BAIXA O ARQUIVO. Sem ele a URL vem assinada com `download`, o
        // Storage responde `Content-Disposition: attachment`, e attachment dentro de um iframe não
        // desenha nada — dispara um download. O painel ficava vazio e o navegador salvava o PDF.
        const r = await fetch(
          `/api/temis/contrato/gerar?documento=${encodeURIComponent(documentoId)}&modo=ver`,
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

  // ⚠️ QUEM SEGURA A ALTURA AGORA É O PAI, e o `h-full` daqui era o elo quebrado: altura em
  // porcentagem sem altura definida no pai não dá erro nenhum — vira `auto`, e o navegador desenha
  // o iframe no tamanho padrão dele, uns 150px. O `min-h-[60vh]` escondia isso enquanto o painel
  // rolava por fora; com a coluna preenchendo a altura, ele passaria a estourar o painel.
  return <iframe className="min-h-0 w-full flex-1 rounded-xl" src={url} title="Contrato" />;
}

// ── O CAMINHO DE VOLTA ─────────────────────────────────────────────────────

/**
 * VOLTAR PARA A ANÁLISE — a mesma peça nas etapas Contrato, Em assinatura e Pré-faturamento.
 *
 * A regra do Lucas (11/09/2026) cabe numa linha: o card volta para Análise enquanto o contrato NÃO
 * estiver assinado por todos. Assinado por todos, o caminho é o pedido de cancelamento, que o
 * sistema classifica como DISTRATO — *"se o contrato estiver assinado por todos somente
 * cancelamento do contrato"* e *"ae entra naquelas regras, se ele estiver todo assinado tem que
 * fazer distrato"*.
 *
 * ⚠️ O PORTÃO É O ENVELOPE, E NÃO A ETAPA, e é por isso que esta peça aparece nas TRÊS etapas do
 * caminho — inclusive no Pré-faturamento, liberado no mesmo dia: *"prefaturamento pode desde que
 * nao esteja todo assinado"*. Nenhuma etapa prova que o contrato está assinado; quem prova é o
 * envelope, e quem o lê é o servidor. A tela oferece a volta e escreve o não quando ele vem.
 *
 * ⚠️ A FRASE MUDA COM O ENVELOPE, E NÃO MAIS COM O NOME DA ETAPA — esta é a correção de 12/09/2026,
 * e ela não é de estilo. Até aqui a régua era `estagio !== "contrato"`, pela suposição de que em
 * "Contrato" o envelope ainda não existe; o servidor, porém, confere e MATA o envelope sem
 * condicional de estágio nenhuma (`lib/temis/retorno-para-correcao.ts`). E o caso em que as duas
 * coisas se separam está escrito no próprio módulo: quando o envio falha no passo `notificar`, a
 * linha fica com `envelope_id` e estado `aguardando` e o card NUNCA é movido — ele fica em
 * "Contrato" com envelope ATIVO na conta de PRODUÇÃO. Nesse card a pessoa lia "o card volta para
 * Análise e o prazo daquela etapa recomeça", confirmava, e o envelope morria: a surpresa depois do
 * clique que a frase âmbar existe para impedir. Agora a tela pergunta o MESMO que o servidor —
 * existe envelope vivo deste contrato? —, e a resposta vem pronta do GET.
 *
 * ⚠️ CANCELAMENTO DE ENVELOPE NÃO SE DESFAZ, e é por isso que o aviso é anterior ao clique — Lucas
 * (11/09/2026): *"pode cancelar o envelope"*. Quem já recebeu o convite perde o acesso, quem já
 * assinou assina de novo, e o cancelado fica na lista da conta de PRODUÇÃO para sempre.
 *
 * ⚠️ SEM ENVELOPE VIVO A FRASE NÃO PROMETE CANCELAMENTO NENHUM. Prometer a morte de um envelope que
 * não existe ensinaria a ler a frase âmbar como enfeite — e no dia em que ele existisse de verdade,
 * o clique viria sem leitura.
 *
 * ⚠️ E O ENVELOPE JÁ ASSINADO TEM FRASE PRÓPRIA, porque ali a volta nem acontece: o servidor RECUSA
 * (o card volta a lugar nenhum, o envelope continua vivo) e manda abrir o pedido de cancelamento.
 * Mostrar "isto CANCELA o envelope" nesse card seria avisar do que não vai ocorrer e calar sobre o
 * que vai.
 *
 * ⚠️ A TELA NÃO É A RÉGUA, mesmo agora. O envelope que ela mostra foi lido quando o card abriu: a
 * última assinatura pode entrar entre a carga e o clique, e o webhook pode chegar no meio. Por isso
 * o botão continua aparecendo em todos os casos e quem responde "pode?" continua sendo o servidor.
 *
 * ⚠️ A CONFIRMAÇÃO ACONTECE NO LUGAR DO BOTÃO, sem diálogo novo e sem `window.confirm`. Um modal em
 * cima de uma tela que já é um overlay empilharia duas camadas para uma pergunta de uma linha, e o
 * `Esc` passaria a significar duas coisas diferentes na mesma tela.
 *
 * ⚠️ E A RECUSA DO SERVIDOR É ESCRITA COMO VEIO. Ela chega em QUALQUER estágio — inclusive com o
 * card ainda em Em assinatura, porque o webhook pode não ter chegado ou a última assinatura pode
 * ter entrado entre a tela carregar e o clique, que é o caso que a trava existe para pegar. A
 * resposta traz o FATO (este contrato está assinado por todos) e o CAMINHO (abrir o pedido de
 * cancelamento, no Hércules, na tela da venda). Substituí-la por um "não consegui" jogaria fora a
 * única coisa que, naquele instante, diz para onde ir.
 */
function VoltarParaAnalise({
  aoVoltar,
  envelopeVivo,
  travado,
  travadoPorque,
}: {
  /** Devolve o texto da falha, ou `null` quando o card voltou. Quem chama a rota é a tela. */
  aoVoltar: () => Promise<null | string>;
  /**
   * O envelope vivo desta venda — é ELE que escolhe a frase da confirmação, em qualquer etapa.
   *
   * ⚠️ `null` NÃO QUER DIZER "ETAPA SEM ENVELOPE": quer dizer que a volta deste card não vai
   * cancelar envelope nenhum. Ou porque o Panteon não vê envelope vivo desta venda, ou porque o card
   * não é de tipo `contrato` — e aí o servidor nem lê a tabela (o portão de
   * `conferirEMatarOEnvelope`). Nos dois casos a frase certa é a mesma: a volta é só a volta.
   */
  envelopeVivo: EnvelopeVivo | null;
  /** Trancado por outra coisa em andamento. Hoje só o envio para a Clicksign, na etapa Contrato. */
  travado?: boolean;
  /** O porquê da tranca, para o `title` dizer em vez de deixar o botão apagado sem explicação. */
  travadoPorque?: string;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<null | string>(null);
  /**
   * A volta está no ar.
   *
   * ⚠️ O ESTADO É DAQUI, e não emprestado do `ocupado` da tela: o rótulo "Voltando…" precisa falar
   * desta ação e de mais nenhuma. E ele é o que impede o SEGUNDO CLIQUE — a volta a partir de Em
   * assinatura chama a Clicksign e demora, e um clique repetido tentaria cancelar o mesmo envelope
   * duas vezes.
   */
  const [voltando, setVoltando] = useState(false);
  /**
   * O QUE A VOLTA VAI FAZER COM O ENVELOPE — a pergunta que escolhe a frase.
   *
   * ⚠️ A RÉGUA É O FATO, NÃO O NOME DA ETAPA. `envelopeVivo` é a resposta de `envelopeQueSegura` no
   * servidor, a MESMA que a volta usa para decidir entre cancelar e recusar. Ver a nota do
   * componente para o card que ficava em "Contrato" com envelope ativo.
   *
   * ⚠️ O ENVELOPE VIVO SEM `id` ENTRA NO "CANCELA", E ISSO É O PIOR CASO DE PROPÓSITO: ele é o envio
   * que começou e o Panteon nunca soube como terminou, e pode haver envelope pago do lado de lá. O
   * servidor vai RECUSAR a volta com a instrução de conferir na Clicksign — avisar pelo mais caro
   * antes disso é o que nunca deixa a surpresa para depois do clique.
   */
  const oQueAVoltaFaz: "cancela" | "recusa_assinado" | "so_volta" = !envelopeVivo
    ? "so_volta"
    : // ⚠️ LEITURA QUE FALHOU AVISA PELO PIOR CASO, e não pela frase neutra: `conferido: false` é
      // "o servidor não conseguiu perguntar", e pode haver envelope vivo. Ver o tipo `EnvelopeVivo`.
      !envelopeVivo.conferido
      ? "cancela"
      : envelopeVivo.estado === "assinado"
        ? "recusa_assinado"
        : "cancela";
  const impedido = Boolean(travado) || voltando;
  const titulo = travado && travadoPorque ? travadoPorque : "Voltar o card para a análise";

  return (
    <div className="border-t border-line pt-3">
      {erro ? (
        <p className="m-0 mb-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-300">
          {erro}
        </p>
      ) : null}

      {confirmando ? (
        // ⚠️ ÂMBAR SÓ QUANDO HÁ ENVELOPE VIVO — em QUALQUER etapa. A moldura neutra é da volta que
        // não custa nada além de gerar o PDF de novo; a âmbar precisa parecer com o que é antes de
        // ser lida. E quem separa as duas é o envelope, nunca o nome da etapa.
        <div
          className={`rounded-xl border p-3 ${
            oQueAVoltaFaz === "so_volta"
              ? "border-line bg-surface"
              : "border-amber-500/40 bg-amber-500/5"
          }`}
        >
          {/* ⚠️ AS FRASES SÃO AS DO LUCAS, PALAVRA POR PALAVRA, e um teste as compara byte a byte
              com `AVISO_DA_VOLTA_COM_ENVELOPE` e `AVISO_DA_VOLTA_SIMPLES`
              (`lib/temis/retorno-para-correcao.test.ts`) — elas vivem nos dois arquivos porque esta
              tela é `"use client"` e importar do módulo arrastaria a Clicksign e o Supabase para o
              pacote do navegador. A do envelope é o coração desta peça: ela diz que o envelope é
              CANCELADO, que quem já assinou assina de novo e que o cancelado fica na lista da conta
              de PRODUÇÃO para sempre. Resumir qualquer uma delas devolveria a surpresa para depois
              do clique.

              ⚠️ A TERCEIRA NÃO PROMETE CLASSIFICAÇÃO NENHUMA. Ela diz o FATO (o contrato consta
              assinado por todos) e o CAMINHO (abrir o pedido de cancelamento no Hércules, na tela da
              venda). Quem decide entre cancelamento e distrato é `classificarCancelamento`
              (`lib/temis/cancelamento.ts`), pelas duas perguntas — assinou? pagou? —, e uma frase de
              tela que afirmasse o resultado de outra régua passaria a mentir no dia em que o
              pagamento entrasse na conta.

              ⚠️ E ELA DIZ "CONSTA", NÃO "ESTÁ": o que a tela tem é o envelope lido quando o card
              abriu. Quem afirma é o servidor, no clique. */}
          <p className="m-0 text-xs text-ink-soft">
            {oQueAVoltaFaz === "cancela"
              ? "Isto CANCELA o envelope na Clicksign. Quem já recebeu o convite perde o acesso, e quem já assinou terá de assinar de novo na versão nova. O envelope cancelado continua na lista da conta, para sempre. O card volta para Análise."
              : oQueAVoltaFaz === "recusa_assinado"
                ? "Este contrato consta assinado por todos, e assinatura não se desfaz: a volta vai ser recusada. Para mudar alguma coisa agora, o caminho é abrir o pedido de cancelamento no Hércules, na tela da venda — o sistema classifica sozinho entre cancelamento e distrato."
                : "O card volta para Análise e o prazo daquela etapa recomeça. O contrato já gerado continua na lista: a próxima geração vira a versão seguinte e aposenta esta."}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:bg-subtle disabled:opacity-50"
              disabled={impedido}
              onClick={async () => {
                setErro(null);
                setVoltando(true);
                try {
                  const falha = await aoVoltar();
                  if (falha) {
                    setErro(falha);
                    setConfirmando(false);
                  }
                } finally {
                  // A volta que deu certo fecha a tela, e este `set` cai no vazio; a que falhou
                  // devolve o botão para quem vai ler o motivo e decidir de novo.
                  setVoltando(false);
                }
              }}
              title={titulo}
              type="button"
            >
              {voltando ? (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              ) : (
                <Undo2 aria-hidden="true" className="size-3.5" />
              )}
              {voltando ? "Voltando…" : "Confirmo: voltar"}
            </button>
            <button
              className="inline-flex items-center rounded-lg px-3 py-2 text-xs font-semibold text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
              disabled={voltando}
              onClick={() => setConfirmando(false)}
              type="button"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        // ⚠️ BORDA, E NÃO DOURADO: voltar é conserto, não avanço. O dourado da marca diz "o card
        // anda"; pintar a volta com ele faria o olho ler as duas ações como a mesma coisa numa
        // coluna onde a de cima manda o contrato para o cliente assinar.
        <button
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-xs font-semibold text-ink-soft transition-colors hover:text-ink disabled:opacity-50"
          disabled={impedido}
          onClick={() => {
            setErro(null);
            setConfirmando(true);
          }}
          title={titulo}
          type="button"
        >
          <Undo2 aria-hidden="true" className="size-3.5" />
          Voltar para análise
        </button>
      )}
    </div>
  );
}

/**
 * A LINHA QUE DIZ PARA ONDE IR nas duas etapas sem volta — Faturado e Indeferido.
 *
 * ⚠️ ELA EXISTE PARA NÃO DEIXAR NINGUÉM PROCURANDO UM BOTÃO QUE NÃO EXISTE. Nas três etapas do
 * caminho o "Voltar para análise" está logo ali; nestas duas ele some, e some por razões que não
 * aparecem na tela. Sem esta linha, a ausência do botão pareceria defeito.
 *
 * ⚠️ E SÃO DUAS FRASES, NÃO UMA — esta é a correção de 12/09/2026, e ela não é de estilo. A frase
 * única mandava abrir o pedido de cancelamento nas DUAS etapas, e no Indeferido isso é conselho
 * ERRADO: ali não houve contrato assinado nem venda em pé para cancelar, e o card saiu pela
 * lateral. Quem corrige um indeferido é quem vendeu, pelo Hércules, de onde o trabalho veio.
 * No Faturado sim, o cancelamento é o caminho que sobra — Lucas (12/09/2026): *"somente no ultimo
 * estagio que nao tem como voltar para corrigir"*.
 *
 * ⚠️ AS DUAS SÃO AS GÊMEAS DE `RECUSA_POR_ESTAGIO` (`lib/temis/retorno-para-correcao.ts`), que é o
 * que o servidor responde a quem chegar na rota por outro caminho. A tela e o 409 dizendo coisas
 * diferentes sobre o MESMO card é o tipo de divergência que só aparece no dia do problema.
 *
 * ⚠️ E NENHUMA DELAS AFIRMA O QUE NÃO SABE. Nem uma nem outra diz "já está assinado por todos", e
 * nenhuma promete o nome do pedido: quem decide entre cancelamento e distrato é
 * `classificarCancelamento` (`lib/temis/cancelamento.ts`), pelas duas perguntas — assinou? pagou?
 * —, e não esta frase.
 */
function DaquiNaoSeVolta({ estagio }: { estagio: "faturado" | "indeferido" }) {
  return (
    <p className="m-0 mt-3 border-t border-line pt-3 text-[11px] text-ink-muted">
      {estagio === "faturado"
        ? "Daqui não há volta para a análise: é o único estágio sem retorno. Para mudar alguma coisa agora, o caminho é abrir o pedido de cancelamento do contrato — o sistema classifica o que ele é pelas assinaturas e pelos pagamentos."
        : "Este card saiu do caminho do contrato, e não há etapa para onde devolvê-lo. A correção volta pelo Hércules, com quem vendeu."}
    </p>
  );
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

/**
 * O ENVELOPE DESTA VENDA, EM UMA LINHA — o que a etapa "Em assinatura" já pode dizer hoje.
 *
 * ⚠️ NÃO É A TELA DE MONITORAMENTO, e não deve virar uma. Quem conta a história pessoa a pessoa é a
 * `PainelDaAssinatura`, logo abaixo dela na etapa; esta linha responde OUTRA pergunta, a da volta:
 * "há envelope vivo segurando esta venda agora?". As duas fontes são diferentes de propósito —
 * `envelopeQueSegura` lê `temis_envelopes` com a régua do cancelamento, o painel lê o que a
 * Clicksign contou —, e juntá-las numa só faria a confirmação da volta depender de um histórico.
 *
 * ⚠️ A PALAVRA É A DA CASA, E VEM PRONTA DO SERVIDOR (`rotuloDoEstado`, em
 * `lib/assinatura/traduzir.ts`): "Aguardando assinatura", "Parcialmente assinado". Traduzir aqui
 * criaria um segundo vocabulário para os mesmos oito estados — e escrever o valor cru
 * (`aguardando`, `parcial`) devolveria o jargão do provedor para dentro da tela, que é exatamente o
 * que a camada de tradução existe para impedir.
 *
 * ⚠️ O "DESDE" É DA ETAPA, E NÃO DO ENVELOPE, e a frase diz isso com todas as letras. `estagio_desde`
 * é quando o CARD entrou aqui; a hora do último evento do envelope mora em `temis_envelopes` e não é
 * lida por esta tela. Escrever "aguardando desde" em cima do carimbo da etapa seria datar o envelope
 * com a hora de outra coisa.
 *
 * ⚠️ E O SILÊNCIO TAMBÉM É NOTÍCIA. Card em "Em assinatura" sem envelope vivo é o caso do Henrique
 * (09/09/2026): `marcarAtividade` avança o card por marcação humana, sem envelope nenhum. A linha
 * fala do que o PANTEON vê — nunca "não existe envelope", que ela não tem como saber.
 */
function LinhaDoEnvelope({
  desde,
  envelopeVivo,
}: {
  /** `estagio_desde` do card: quando ele entrou nesta etapa. */
  desde: string;
  envelopeVivo: EnvelopeVivo | null;
}) {
  const entrada = new Date(desde);
  const desdeEscrito = Number.isNaN(entrada.getTime()) ? desde : entrada.toLocaleString("pt-BR");

  return (
    <p className="m-0 rounded-xl border border-line bg-subtle px-4 py-3 text-xs text-ink-soft">
      {envelopeVivo && !envelopeVivo.conferido ? (
        // ⚠️ A LEITURA FALHOU, E A LINHA DIZ ISSO. Escrever aqui "o Panteon não vê envelope vivo"
        // seria trocar "não consegui perguntar" por "não existe" — o mesmo engano que a frase da
        // confirmação evita logo abaixo.
        `Não deu para conferir o envelope desta venda agora. Nesta etapa desde ${desdeEscrito}.`
      ) : envelopeVivo ? (
        <>
          <span className="font-semibold text-ink">{envelopeVivo.rotulo}</span>
          {envelopeVivo.id ? ` · envelope ${envelopeVivo.id}` : " · sem id do envelope no Panteon"}
          {` · nesta etapa desde ${desdeEscrito}`}
        </>
      ) : (
        `O Panteon não vê envelope vivo desta venda. Nesta etapa desde ${desdeEscrito}.`
      )}
    </p>
  );
}

/**
 * O PAINEL DA ASSINATURA — o contador, quem assina e o log do envelope.
 *
 * As três coisas que o Lucas pediu em 12/09/2026, nesta ordem: *"gostaria de ter essa visao de
 * quantas assinaturas ja foram feitas, tipo 1/5"* · *"nesse caso tinha que voltar com o erro de
 * e-mail"* · *"seria legal ter um painel de log, tipo, contrato enviado, contrato nao enviado -
 * e-mail invalido"*.
 *
 * ⚠️ NADA AQUI CONSULTA A CLICKSIGN. O painel desenha o que já veio na carga da tela, e a tela
 * recarrega ao abrir — a casa já pagou caro por polling (o Hermes), e um envelope que anda em
 * dias não justifica um relógio. Quem quiser o estado de agora fecha e abre o card.
 */
function PainelDaAssinatura({
  aoRecarregar,
  assinatura,
  desde,
  envelopeVivo,
}: {
  /** Relê o card depois de um conserto, para a lista refletir o e-mail novo. */
  aoRecarregar: () => Promise<void>;
  assinatura: AssinaturaDoCard;
  /** `estagio_desde` do card: quando ele entrou nesta etapa. */
  desde: string;
  envelopeVivo: EnvelopeVivo | null;
}) {
  const entrada = new Date(desde);
  const desdeEscrito = Number.isNaN(entrada.getTime()) ? desde : entrada.toLocaleString("pt-BR");

  /**
   * ⚠️ QUEM PRECISA DE GESTO VEM PRIMEIRO, e a ordem do envelope não serve para isso. A
   * Clicksign devolve os signatários na ordem em que foram cadastrados, que é inútil para quem
   * abriu o card perguntando "o que travou?". Num contrato de cinco pessoas, a única que pede
   * conserto pode estar em quinto lugar, embaixo de quatro linhas verdes.
   *
   * ⚠️ E A ORDENAÇÃO É ESTÁVEL: `sort` numa CÓPIA, e o critério é só "precisa de conserto",
   * então quem empata fica como veio. Sem isso a lista dançaria a cada recarga.
   */
  const signatarios = [...assinatura.envelope.signatarios].sort((a, b) => {
    const pesoA = a.convite === "nao_entregue" && !a.assinouEm ? 0 : 1;
    const pesoB = b.convite === "nao_entregue" && !b.assinouEm ? 0 : 1;
    return pesoA - pesoB;
  });

  /**
   * ⚠️ DO MAIS RECENTE PARA O MAIS ANTIGO, E A ORDEM É FEITA AQUI. O `document.events[]` da
   * Clicksign vem em ordem de acontecimento (o upload primeiro), que é a ordem errada para quem
   * abre o card perguntando "o que houve por último?". Ordenar uma CÓPIA porque `sort` é no lugar:
   * bagunçar o array que veio do estado faria a lista dançar entre renders.
   *
   * ⚠️ E DATA ILEGÍVEL NÃO REORDENA NADA. Se um carimbo vier torto, o `0` mantém os dois vizinhos
   * como estavam em vez de jogar a linha para uma ponta qualquer.
   */
  const diario = [...assinatura.diario].sort((a, b) => {
    const quandoA = Date.parse(a.quando);
    const quandoB = Date.parse(b.quando);
    if (Number.isNaN(quandoA) || Number.isNaN(quandoB)) return 0;
    return quandoB - quandoA;
  });

  return (
    <div className="grid gap-3">
      {/* ⚠️ UMA CAIXA SÓ, com cabeçalho e lista dentro. Eram três caixas cinzas empilhadas com o
          mesmo peso — estado do envelope, assinaturas, log — e nenhuma delas dizia "olhe aqui
          primeiro". O cabeçalho responde onde o contrato está; a lista, de quem depende.

          ⚠️ O ID DO ENVELOPE SAIU DA TELA e foi para o `title`. Ele aparecia DUAS vezes (na barra
          e no log) e não significa nada para quem trabalha o contrato — só serve para procurar na
          Clicksign, que é gesto raro e de quem já sabe o que quer. */}
      <section className="rounded-xl border border-line bg-surface">
        <header
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-3"
          title={
            assinatura.envelope.envelopeId
              ? `Envelope ${assinatura.envelope.envelopeId} na Clicksign`
              : undefined
          }
        >
          <div className="min-w-0">
            <p className="m-0 text-sm font-semibold text-ink">
              <span className="tabular-nums">
                {assinatura.assinaram} de {assinatura.total}
              </span>{" "}
              assinaram
            </p>
            <p className="m-0 text-[11px] text-ink-muted">
              {envelopeVivo && !envelopeVivo.conferido
                ? `Não deu para conferir o envelope agora · nesta etapa desde ${desdeEscrito}`
                : `Nesta etapa desde ${desdeEscrito}`}
            </p>
          </div>

          {envelopeVivo?.conferido ? (
            <span className="shrink-0 text-[11px] font-semibold text-ink-soft">
              {envelopeVivo.rotulo}
            </span>
          ) : null}
        </header>

        <ul className="m-0 grid list-none gap-0.5 p-2">
          {signatarios.map((s) => (
            <LinhaDoSignatario
              aoRecarregar={aoRecarregar}
              // ⚠️ O ENVELOPE VEM DE CIMA, E É O DA CLICKSIGN. É o id que as duas rotas de conserto
              // pedem; o uuid da nossa linha de `temis_envelopes` não serve para nada do lado de lá.
              // Quando ele é `null`, a linha não oferece botão nenhum.
              envelopeId={assinatura.envelope.envelopeId}
              key={s.chave}
              signatario={s}
            />
          ))}
        </ul>
      </section>

      {/* ⚠️ O LOG NASCE RECOLHIDO, e isso é o oposto de escondê-lo. Ele é AUDITORIA — responde
          "o que houve com este envelope", que é pergunta de quem foi investigar, não de quem abriu
          o card para trabalhar. Aberto por padrão, ele empurrava a lista de signatários para cima e
          competia com ela: duas listas na mesma tela, e a que pede ação perdia.

          ⚠️ E O TETO DE ALTURA CONTINUA: a Clicksign reenvia o histórico INTEIRO a cada webhook,
          então um envelope movimentado tem dezenas de linhas — sem o teto, o log aberto empurraria
          o botão de voltar para fora da tela. */}
      <details className="rounded-xl border border-line bg-surface px-3.5 py-3">
        <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-muted transition-colors hover:text-ink">
          Log do envelope
          <span className="ml-2 font-normal normal-case tracking-normal">
            {diario.length === 0 ? "sem eventos" : `${diario.length} eventos`}
          </span>
        </summary>

        {diario.length === 0 ? (
          <p className="m-0 mt-2 text-xs text-ink-muted">
            Nenhum evento registrado para este envelope ainda.
          </p>
        ) : (
          <ol className="m-0 mt-2 grid max-h-64 list-none gap-1 overflow-auto p-0">
            {diario.map((linha, i) => (
              <li
                className={`grid grid-cols-[3px_1fr] items-stretch gap-x-2.5 overflow-hidden rounded-lg py-1.5 pr-3 ${
                  linha.gravidade === "erro" ? "bg-rose-500/10" : ""
                }`}
                key={`${linha.quando}-${linha.fato}-${i}`}
              >
                <span
                  className={`h-full self-stretch rounded-sm ${
                    linha.gravidade === "erro"
                      ? "bg-rose-500"
                      : linha.gravidade === "marco"
                        ? "bg-emerald-500"
                        : "bg-line"
                  }`}
                />
                <div className="min-w-0">
                  <p
                    className={`m-0 text-xs font-medium ${
                      linha.gravidade === "erro"
                        ? "text-rose-700 dark:text-rose-300"
                        : "text-ink"
                    }`}
                  >
                    {linha.fato}
                    {linha.quem ? (
                      <span className="font-normal text-ink-muted"> · {linha.quem}</span>
                    ) : null}
                  </p>
                  {linha.detalhe ? (
                    <p className="m-0 break-words text-[10.5px] text-ink-soft">{linha.detalhe}</p>
                  ) : null}
                  <p className="m-0 text-[10px] tabular-nums text-ink-muted">
                    {momento(linha.quando)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </details>
    </div>
  );
}

/**
 * Uma pessoa do envelope: nome, papel, e-mail, em que pé ela está — e os dois consertos.
 *
 * ⚠️ OS BOTÕES MORAM AQUI, NA LINHA DA PESSOA, e não numa barra da etapa. O que se conserta é o
 * convite DE ALGUÉM: o e-mail errado é o de um signatário, e o reenvio é para um endereço só. Uma
 * ação da etapa precisaria perguntar "de quem?" depois do clique — e num envelope de produção a
 * pergunta seria respondida por um seletor, em vez de pelo dedo em cima da linha que está pintada
 * de vermelho.
 *
 * ⚠️ "CORRIGIR O E-MAIL" SÓ APARECE PARA QUEM NÃO ASSINOU, e isso não é enfeite: a Clicksign
 * RECUSA remover um signatário que já assinou (403, "Já assinou um documento. Não pode ser
 * excluído"). Um botão que sempre falha é pior do que botão nenhum — ele convida ao clique e
 * devolve um erro que parece defeito nosso.
 *
 * ⚠️ "REENVIAR CONVITE" CONTINUA PARA TODOS, de propósito. Ele não é destrutivo (é o mesmo convite
 * outra vez) e o caso do Lucas é justamente o do e-mail CERTO — *"ocorre muito do e-mail esta
 * correto mais o cliente nao recebeu"* (12/09/2026). Esconder o reenvio de quem já assinou custaria
 * mais do que deixá-lo: quem já assinou não pede reenvio, e a régua extra erraria no dia em que a
 * lista viesse sem o carimbo.
 *
 * ⚠️ E SEM `envelopeId`, OU COM UMA `chave` QUE É E-MAIL, NÃO HÁ BOTÃO. As duas rotas de conserto
 * falam com a Clicksign por id: sem o id do envelope não há para onde mandar, e a `chave` cai no
 * e-mail quando o `signer.key` não veio nos eventos (ver o tipo `SignatarioNaTela`) — mandar um
 * e-mail no lugar do `signer_id` é um 404 garantido, com o operador achando que o sistema quebrou.
 */
function LinhaDoSignatario({
  aoRecarregar,
  envelopeId,
  signatario,
}: {
  aoRecarregar: () => Promise<void>;
  envelopeId: null | string;
  signatario: SignatarioNaTela;
}) {
  const papel = papelNaLinha(signatario.papel);
  const estado = estadoDoSignatario(signatario);
  const Icone = estado.icone;

  /**
   * Qual chamada está no ar. `null` = nenhuma.
   *
   * ⚠️ ELE TRAVA OS DOIS BOTÕES, E NÃO SÓ O CLICADO. A troca são até quatro chamadas HTTP em
   * sequência contra um envelope pago — remover, recriar, os dois requisitos — e um segundo clique
   * faria a REMOÇÃO acontecer duas vezes: a segunda passada apagaria o signatário que a primeira
   * acabou de criar.
   */
  const [acaoNoAr, setAcaoNoAr] = useState<null | "reenviar" | "trocar">(null);
  /**
   * A MESMA TRAVA, AGORA SEM DEPENDER DO RENDER.
   *
   * ⚠️ O `disabled` DO BOTÃO SÓ VALE DEPOIS QUE O REACT REDESENHA, e a trava que importa aqui é
   * contra o clique que chega ANTES disso. Um segundo `trocar_email` que passe faz a REMOÇÃO
   * acontecer duas vezes num envelope de produção: a segunda passada apaga o signatário que a
   * primeira acabou de criar, e aí a pessoa fica fora do contrato sem ninguém ver erro nenhum. Um
   * `ref` muda no ato do clique, e é isso que o estado não garante.
   */
  const noArRef = useRef(false);
  const [corrigindo, setCorrigindo] = useState(false);
  /** Começa VAZIO e é preenchido ao abrir o campo, com o e-mail que está no envelope AGORA. */
  const [emailNovo, setEmailNovo] = useState("");
  const [erro, setErro] = useState<null | string>(null);
  /** O que deu certo, ou o pedido de esperar um minuto. Some no próximo clique. */
  const [recado, setRecado] = useState<null | string>(null);

  const signerId = signatario.chave;
  const emailAtual = (signatario.email ?? "").trim();
  const podeMexer = envelopeId !== null && !signerId.includes("@");
  /**
   * Esta linha PEDE alguma coisa de quem está olhando?
   *
   * ⚠️ É ELA QUE DECIDE O PESO DA LINHA INTEIRA — o fundo, a ação escrita e o detalhe. Sem essa
   * pergunta, as três pessoas de um envelope aparecem iguais, e quem abre o card tem de LER as três
   * para descobrir qual delas travou o contrato. Conduzir é isso: a linha que precisa de gesto se
   * distingue sozinha, e as outras ficam quietas.
   */
  const precisaDeConserto = signatario.convite === "nao_entregue" && !signatario.assinouEm;
  const emailLimpo = emailNovo.trim();

  const executar = async (
    corpo: { acao: "reenviar" } | { acao: "trocar_email"; email: string },
  ): Promise<void> => {
    if (envelopeId === null) return;
    if (noArRef.current) return;
    noArRef.current = true;
    setErro(null);
    setRecado(null);
    setAcaoNoAr(corpo.acao === "reenviar" ? "reenviar" : "trocar");
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/temis/assinatura/signatario", {
        body: JSON.stringify({ ...corpo, envelopeId, signerId }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const j = (await r.json().catch(() => ({}))) as {
        data?: { aviso?: null | string };
        erro?: string;
        removido?: boolean;
      };
      if (!r.ok) {
        // ⚠️ O TETO DE UM POR MINUTO NÃO É ERRO, E NÃO SE PINTA DE VERMELHO. A Clicksign limita as
        // notificações a cerca de uma por minuto por endpoint; quem clicou duas vezes não fez nada
        // errado, e o conserto é esperar. Escrever "erro" ali mandaria o operador procurar defeito
        // — ou, pior, voltar o card para a análise e cancelar um envelope que está inteiro.
        if (r.status === 429) {
          setRecado(
            "A Clicksign aceita cerca de um convite por minuto para cada pessoa. Espere um minuto e clique de novo.",
          );
          return;
        }
        // ⚠️ A FRASE DO SERVIDOR SOBE INTEIRA. É ela que distingue "esta pessoa já assinou e a
        // Clicksign recusa removê-la" de uma falha de rede — e a primeira não adianta tentar de
        // novo.
        setErro(j.erro ?? `Não consegui concluir (${r.status}).`);
        // ⚠️ MESMO NA FALHA, SE A REMOÇÃO JÁ PASSOU A LISTA PRECISA SER RELIDA. O signatário antigo
        // não está mais no envelope: deixar a linha velha na tela faria o operador tentar de novo
        // sobre uma pessoa que não existe mais do lado de lá.
        if (j.removido === true) await aoRecarregar();
        return;
      }
      if (corpo.acao === "reenviar") {
        setRecado("Convite reenviado.");
      } else {
        // ⚠️ O `aviso` VEM NO 200, E É ELE QUE CONTA A METADE QUE FALTOU. A troca deu certo (a pessoa
        // está no envelope, com os dois requisitos), mas o convite pode não ter saído — e sem esta
        // frase o operador leria "convite mandado" sobre um e-mail que não foi. Ele não é erro: o
        // caminho é o botão de reenviar, não o de trocar de novo.
        const aviso = j.data?.aviso ?? null;
        setRecado(
          aviso
            ? `E-mail corrigido no envelope. ${aviso}`
            : "E-mail corrigido e convite mandado para o endereço novo.",
        );
        setCorrigindo(false);
      }
      // ⚠️ RECARREGA O CARD DEPOIS DO SUCESSO. Na troca, o signatário antigo deixou de existir no
      // envelope e o novo tem outra `signer.key`: sem reler, a linha continuaria mostrando o
      // endereço errado que acabou de ser removido.
      await aoRecarregar();
    } catch {
      // ⚠️ "NÃO FALEI COM O SERVIDOR" NÃO É "NADA ACONTECEU" — NÃO NA TROCA. A rota tem teto de 60s
      // e a remoção é o PRIMEIRO passo dela: uma conexão que cai (ou um timeout da Vercel, que chega
      // aqui como erro de JSON — [[reference_vercel_timeout_vira_erro_de_json]]) pode ter deixado o
      // signatário antigo já fora do envelope. Mandar "tente de novo" seco faria o operador clicar
      // mais uma vez sem saber o que já foi feito. O reenviar é o outro caso: ele não mexe em nada,
      // e repetir é seguro.
      setErro(
        corpo.acao === "reenviar"
          ? "Não consegui falar com o servidor. O envelope continua como estava — tente de novo."
          : "Não consegui falar com o servidor, e a troca pode ter começado do lado da Clicksign. NÃO clique de novo: atualize a tela e confira a lista de signatários antes de tentar outra vez.",
      );
      if (corpo.acao === "trocar_email") await aoRecarregar();
    } finally {
      noArRef.current = false;
      setAcaoNoAr(null);
    }
  };

  return (
    <li
      /* ⚠️ O VERMELHO É UMA BARRA, E NÃO UM BLOCO MACIÇO. O fundo rosa cobrindo a linha inteira
         gritava mais alto que o próprio texto — e num contrato de cinco pessoas com dois convites
         devolvidos, metade da caixa fica rosa e o destaque deixa de destacar. A barra na borda diz
         a mesma coisa e devolve o fundo ao texto. É a mesma régua do log logo abaixo, que já marca
         gravidade com barra. */
      className={`rounded-lg border-l-2 px-2.5 py-2 ${
        precisaDeConserto
          ? "border-rose-500 bg-rose-500/[0.06]"
          : "border-transparent hover:bg-subtle"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* ⚠️ `min-w-0` E `break-words` DE NOVO, pelo mesmo motivo do bloco `Campos`: e-mail não
            tem onde quebrar, e sem os dois ele escreve por cima do estado à direita — logo aqui,
            onde o e-mail é justamente o que costuma estar errado. */}
        <div className="min-w-0">
          <p className="m-0 truncate text-[13px] font-semibold text-ink">
            {signatario.nome}
            {papel ? <span className="font-normal text-ink-muted"> · {papel}</span> : null}
          </p>
          {/* ⚠️ O E-MAIL APARECE SEMPRE, e é o ponto do painel inteiro: foi um e-mail inexistente
              que derrubou o envelope da Beatriz. Escondê-lo obrigaria a abrir a Clicksign para
              descobrir o que a tela já tem na mão. */}
          <p className="m-0 break-words text-[11px] text-ink-muted">
            {/* ⚠️ `||`, E NÃO `??`: a lib manda string VAZIA quando o envelope não tem e-mail da
                pessoa, e o `??` só troca nulo — a linha ficaria em branco no lugar da frase. É a
                armadilha que o repo já registrou em `nullish-nao-troca-string-vazia`. */}
            {signatario.email || "sem e-mail no envelope"}
            {/* ⚠️ A HORA ENTRA AQUI, COLADA NO E-MAIL, em vez de virar um parágrafo próprio. Ela
                é o único detalhe que interessa de quem já assinou, e uma terceira linha por pessoa
                triplicava a altura da lista para dizer o que cabe depois de um ponto. */}
            {signatario.assinouEm ? (
              <span className="text-ink-soft"> · {momento(signatario.assinouEm)}</span>
            ) : null}
          </p>
        </div>

        <span
          className={`flex shrink-0 items-center gap-1 text-[11px] font-semibold ${estado.cor}`}
        >
          <Icone aria-hidden="true" className="size-3.5 shrink-0" />
          {estado.texto}
        </span>
      </div>

      {/* ⚠️ O DETALHE SÓ APARECE ONDE ELE MUDA O QUE A PESSOA VAI FAZER: no convite que voltou,
          porque o motivo decide entre corrigir o endereço e reenviar. "Assinou em tal hora" e
          "abriu em tal hora" já estão ditos pelo estado à direita e repetidos no log; escritos aqui,
          eram três linhas de texto em cada pessoa numa coluna que se lê de relance. */}
      {precisaDeConserto && estado.detalhe ? (
        <p className="m-0 mt-0.5 break-words text-[10.5px] text-rose-700 dark:text-rose-300">
          {estado.detalhe}
        </p>
      ) : null}

      {podeMexer ? (
        <div className="mt-1.5 grid gap-1.5">
          {corrigindo ? (
            <div className="grid gap-1.5 rounded-lg border border-line bg-subtle px-2 py-2">
              {/* ⚠️ A FRASE VEM ANTES DO CAMPO, e é ela que faz o campo ser uma confirmação e não
                  um formulário de cadastro. O que acontece no clique não se adivinha pelo rótulo:
                  a pessoa é REMOVIDA do envelope de produção e recriada. Quem lê "editar e-mail"
                  imagina um UPDATE; o que existe do lado de lá é um DELETE seguido de um POST. */}
              <p className="m-0 text-[10.5px] text-ink-soft">
                O signatário atual sai do envelope e entra de novo com o e-mail corrigido, e só ele
                recebe o convite. Quem já assinou não é tocado.
              </p>
              <input
                autoComplete="off"
                className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px] text-ink outline-none focus:border-line-strong"
                disabled={acaoNoAr !== null}
                inputMode="email"
                onChange={(e) => setEmailNovo(e.target.value)}
                placeholder="email@dominio.com.br"
                type="email"
                value={emailNovo}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[11px] font-semibold text-ink transition-colors hover:bg-subtle disabled:opacity-50"
                  // ⚠️ O MESMO E-MAIL NÃO PASSA DAQUI, e a recusa manda para o botão certo: trocar
                  // um endereço por ele mesmo removeria a pessoa do envelope para recriá-la igual.
                  // Quando o endereço está certo e o cliente não recebeu, o caminho é "Reenviar
                  // convite" — Lucas, 12/09/2026.
                  disabled={acaoNoAr !== null || emailLimpo === "" || emailLimpo === emailAtual}
                  onClick={() => void executar({ acao: "trocar_email", email: emailLimpo })}
                  title={
                    emailLimpo === emailAtual && emailLimpo !== ""
                      ? "Este é o mesmo e-mail que já está no envelope. Para mandar de novo para ele, use Reenviar convite."
                      : undefined
                  }
                  type="button"
                >
                  {acaoNoAr === "trocar" ? (
                    <Loader2 aria-hidden="true" className="size-3 animate-spin" />
                  ) : (
                    <Pencil aria-hidden="true" className="size-3" />
                  )}
                  {acaoNoAr === "trocar" ? "Trocando…" : "Confirmo: trocar e enviar"}
                </button>
                <button
                  className="inline-flex items-center rounded-lg px-2 py-1.5 text-[11px] font-semibold text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
                  disabled={acaoNoAr !== null}
                  onClick={() => {
                    setCorrigindo(false);
                    setErro(null);
                  }}
                  type="button"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {/* ⚠️ A AÇÃO PRINCIPAL É A DO PROBLEMA DAQUELA LINHA, e só ela ganha nome. Lucas
                  (12/09/2026), vendo a tela: *"achei muito grande esses botões (escrita), ta feio
                  essa tela ... é muito informação, temos que conduzir o usuário na tela, ele tem
                  que saber o que fazer"*. Antes as duas ações tinham o mesmo peso e o mesmo tamanho
                  em TODAS as linhas — e a coluna virava uma parede de botões iguais, onde o que
                  precisa de conserto some no meio do que está certo.

                  Convite que voltou → "Corrigir o e-mail" escrito, porque é o que resolve.
                  Esperando → só o ícone de reenviar, que é o único gesto possível.
                  Já assinou → nada. */}
              {precisaDeConserto ? (
                <button
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#A07C3B] px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  disabled={acaoNoAr !== null}
                  onClick={() => {
                    setErro(null);
                    setRecado(null);
                    // O campo nasce com o que está no envelope AGORA: o normal é corrigir uma
                    // letra, e digitar o endereço inteiro de novo é como se erra de novo.
                    setEmailNovo(emailAtual);
                    setCorrigindo(true);
                  }}
                  type="button"
                >
                  <Pencil aria-hidden="true" className="size-3" />
                  Corrigir o e-mail
                </button>
              ) : null}

              {/* ⚠️ REENVIAR VIRA ÍCONE, e some para quem já assinou. O nome vive no `title` e no
                  `aria-label` — a mesma régua dos botões do topo desta tela, pedida pelo Lucas em
                  10/09/2026 (*"coloca esses botões no topo somente o ícone"*). E reenviar convite
                  para quem JÁ ASSINOU é gesto sem sentido: a tela oferecia, e oferecer o que não
                  serve é o que faz o operador duvidar do que serve. */}
              {signatario.assinouEm ? null : (
                <button
                  aria-label="Reenviar o convite para este e-mail"
                  className="grid size-7 shrink-0 place-items-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-subtle hover:text-ink disabled:opacity-50"
                  disabled={acaoNoAr !== null}
                  onClick={() => void executar({ acao: "reenviar" })}
                  title="Reenviar o convite para este e-mail"
                  type="button"
                >
                  {acaoNoAr === "reenviar" ? (
                    <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw aria-hidden="true" className="size-3.5" />
                  )}
                </button>
              )}
            </div>
          )}

          {recado ? (
            <p className="m-0 break-words text-[10.5px] font-medium text-ink-soft">{recado}</p>
          ) : null}
          {erro ? (
            <p className="m-0 break-words text-[10.5px] font-medium text-rose-700 dark:text-rose-300">
              {erro}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * EM QUE PÉ ESTÁ ESTE SIGNATÁRIO — uma frase, uma cor e um ícone.
 *
 * ⚠️ A ORDEM DAS PERGUNTAS É A REGRA INTEIRA, e ela vai do FATO consumado para o silêncio:
 * assinou vence tudo (nem que o convite tenha voltado antes e alguém tenha reenviado por fora);
 * depois o convite devolvido, que é o único caso que pede alguém; depois abriu; depois entregue;
 * e o silêncio por último.
 *
 * ⚠️ "SEM NOTÍCIA" NÃO SE ESCREVE COMO "ENTREGUE". A Clicksign só avisa quando a notificação
 * FALHA — foi assim que soubemos do `bounce` da Beatriz —, então a ausência de aviso não prova
 * entrega nenhuma. A frase diz o que a tela realmente sabe, e o detalhe explica por quê: sem isso,
 * o operador leria o silêncio como "o cliente recebeu e está enrolando".
 */
function estadoDoSignatario(signatario: SignatarioNaTela): {
  cor: string;
  detalhe: null | string;
  icone: typeof Mail;
  texto: string;
} {
  if (signatario.assinouEm) {
    return {
      cor: "text-emerald-700 dark:text-emerald-300",
      detalhe: `Assinou em ${momento(signatario.assinouEm)}.`,
      icone: CircleCheck,
      texto: "Assinou",
    };
  }

  if (signatario.convite === "nao_entregue") {
    return {
      cor: "text-rose-700 dark:text-rose-300",
      detalhe: [
        signatario.conviteQuando
          ? `O convite voltou em ${momento(signatario.conviteQuando)}.`
          : "O convite voltou.",
        signatario.conviteDetalhe,
        // ⚠️ O CONSELHO SAIU DA FRASE PORQUE ELE VIROU BOTÃO. Ela mandava voltar o card para a
        // análise — o que CANCELA o envelope de produção e obriga quem já assinou a assinar de novo.
        // Depois virou "corrija o e-mail aqui embaixo", que é escrever o rótulo do botão que está
        // logo ali. A linha diz o FATO; o que fazer é o botão dourado ao lado. Lucas (12/09/2026):
        // *"é muito informação, temos que conduzir o usuário na tela"* — conduzir é ter um gesto
        // óbvio, não um parágrafo explicando o gesto.
        "Esta assinatura não chega sozinha.",
      ]
        .filter(Boolean)
        .join(" "),
      icone: MailX,
      texto: "Convite NÃO entregue",
    };
  }

  if (signatario.comecouEm) {
    return {
      cor: "text-ink",
      detalhe: `Abriu o documento em ${momento(signatario.comecouEm)} e ainda não assinou.`,
      icone: Eye,
      texto: "Abriu para assinar",
    };
  }

  if (signatario.convite === "entregue") {
    return {
      cor: "text-ink-soft",
      detalhe: signatario.conviteQuando
        ? `Convite entregue em ${momento(signatario.conviteQuando)}.`
        : null,
      icone: MailCheck,
      texto: "Convite entregue",
    };
  }

  return {
    cor: "text-ink-muted",
    detalhe:
      "A Clicksign só avisa quando a notificação falha, e nada foi dito sobre esta: não dá para afirmar que o convite chegou.",
    icone: Mail,
    texto: "Sem notícia",
  };
}

/**
 * O PAPEL ESCRITO NA LINHA — "Comprador", "Cônjuge", "Vendedora".
 *
 * ⚠️ ELE VEM EM CAMPO PRÓPRIO, CONGELADO NO ENVIO (`temis_envelopes.signatarios`), e a leitura
 * continua DEFENSIVA: só vira rótulo o que é um papel que a casa conhece. Um valor gravado por
 * fora, ou de uma versão futura do envio, deixa a linha só com o nome — inventar rótulo a partir de
 * palavra desconhecida escreveria "Comprador" ao lado de quem é testemunha, e ninguém desconfiaria.
 */
function papelNaLinha(cru: null | string): null | string {
  const papel: PapelNoContrato | undefined = PAPEIS.find((p) => p === cru);
  return papel ? rotuloDoPapel(papel) : null;
}

/**
 * "2026-09-12T02:24:00.891Z" → "12/09/2026 02:24".
 *
 * ⚠️ SEM OS SEGUNDOS, E COM A DATA INTEIRA. O carimbo do `bounce` chega quatro segundos depois do
 * envio; o segundo não muda nenhuma decisão, e a data por extenso é o que responde "isso é de hoje
 * ou da semana passada?". Data ilegível volta como veio: escrever "Invalid Date" na tela seria
 * pior do que mostrar o cru.
 */
function momento(iso: string): string {
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return iso;
  return quando.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

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
    // ⚠️ O `overflow-hidden` SÓ VALE DE `lg` PARA CIMA, e é ele que faz a etapa contrato preencher
    // em vez de cortar. Abaixo disso as colunas empilham e a moldura precisa rolar por dentro, ou
    // a análise — a etapa mais alta da tela — ficaria inalcançável do meio para baixo.
    // ⚠️ O `data-temis-trabalho` NÃO É ENFEITE DE TESTE: é por ele que a `TemisPage` sabe, só com
    // CSS, que a tela de trabalho está aberta (`has-[[data-temis-trabalho]]:h-full`) e fixa a altura
    // do quadro. Sem altura DEFINIDA no pai, o `max-h-full` do kanban resolve como `none` e este
    // `inset-0` volta a copiar a altura da coluna de cards mais alta. Ver a nota do `temis-kanban`.
    <div
      className="absolute inset-0 z-30 flex flex-col overflow-auto bg-canvas p-3 lg:overflow-hidden"
      data-temis-trabalho=""
    >
      {/* ⚠️ SÓ O ÍCONE — Lucas (11/09/2026): *"essa escrita voltar ao quadro, deixa somente o
          ícone"*. É a mesma regra dos botões do topo (10/09/2026: *"coloca esses botões no topo
          somente o ícone"*), com o nome vivo no `title` e no `aria-label`: ícone mudo é adivinhação
          para quem usa teclado ou leitor de tela. Ele não reusa o `BotaoDeAcao` porque voltar é
          NAVEGAÇÃO, e não uma ação do trabalho — fica menor (size-8) e mais apagado, para não
          disputar o olho com gerar, indeferir e enviar. O `Esc` continua fazendo o mesmo. */}
      <button
        aria-label="Voltar ao quadro"
        className="mb-2 grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface text-ink-muted transition-colors hover:text-ink"
        onClick={aoFechar}
        title="Voltar ao quadro"
        type="button"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
      </button>
      {children}
    </div>
  );
}
