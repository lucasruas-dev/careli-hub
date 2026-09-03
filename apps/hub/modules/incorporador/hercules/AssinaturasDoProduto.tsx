"use client";

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BadgeDollarSign,
  CheckCircle2,
  Clock,
  FileText,
  type LucideIcon,
  PenLine,
  Search,
  Timer,
  X,
} from "lucide-react";

import { diaNaTela } from "@/lib/apolo/incorporador/dia-na-tela";
import { fonte } from "@/modules/publico/ui/tokens";

import { T } from "../tema";

// ASSINATURA E RESUMO DOS CONTRATOS — as sub-abas da tela Contratos do Hércules.
//
// Pedido do Lucas (02/09/2026, olhando a ficha do Jardim das Gerais na aba Vendas): *"já que
// temos uma aba de contratos, podemos levar para essa tela a parte de contratos: podemos ter um
// board (para visualizar a Têmis), podemos ter Resumo, podemos ter Assinatura"*. E, apontando o
// kanban da Têmis dentro da ficha: *"isso aqui tem que estar na tela de contrato — no board"*.
// A TelaContratos ganhou as três sub-abas; o Board é o kanban de sempre, e as outras duas moram
// aqui.
//
// É A VISÃO "CONTRATOS" DA TelaVendas, COPIADA — não importada — para cá: tipos do payload, o
// fetch sob demanda, a faixa de taxas por perfil, os blocos do painel, a lista por unidade com as
// barrinhas, o popup do esquema de assinatura, a fila e o quadro por assinante, linha a linha.
// A TelaVendas continua com a dela (a frente C só a esconde dentro da ficha); quando as duas
// divergirem de propósito, é AQUI que a versão da tela Contratos evolui. Os comentários de
// desenho (a fusão de 18/08/2026, o redesenho do dono) vieram junto, porque explicam cada peça.
//
// DUAS PORTAS: sem `emp` é a tela Contratos do menu — o consolidado de tudo o que a sessão
// autoriza (a rota aceita a ausência de `emp`: `codigosDoPedido` com pedido nulo cai em
// `codesDoRecorte`, os códigos da sessão inteira); com `emp` ("pai:<uuid>" do cadastro ou id do
// C2X) é a aba Contratos da FICHA DO PRODUTO, recortada ao produto. O recorte é do servidor,
// nunca daqui.
//
// O CACHE É DE QUEM MONTA. `useDadosDaVisao` guarda o payload num Map por recorte (chave = emp,
// "" = todos), e o Map vem por props (`cache`): a TelaContratos segura UM `useRef` para as
// sub-abas Resumo e Assinatura, então trocar entre as duas — ou ir ao Board e voltar — NÃO refaz
// a chamada (2 consultas no C2X mais a conferência das assinaturas). Sem o prop, o componente
// cria o seu, vivo enquanto ele viver.
//
// TUDO EM ESTILO INLINE COM OS TOKENS `T` (nada de classe Tailwind de cor): o portal tem tema
// claro E escuro próprios, e assim esta tela não precisa da MOLDURA_TAILWIND da TelaContratos —
// e não a importa, de propósito, para não fechar um ciclo (a TelaContratos importa daqui).

// ── CONTRATOS (a visão com fetch PRÓPRIO) ───────────────────────────────────
// Payload de /api/incorporador/vendas/assinaturas — o shape é a allowlist da rota, campo a campo.
// Nome de comprador/imobiliária/assinante aparece (o incorporador é parte do contrato); telefone,
// e-mail e documento NÃO existem no payload.

/** A situação resumida da assinatura de um contrato (lib/apolo/incorporador/contratos.ts). */
type SituacaoAssinatura = "aguardando-emissao" | "assinado" | "em-assinatura";

// COPIADO de contratos.ts, não importado, pela mesma razão da TelaVendas: aquele módulo puxa o
// driver do MySQL, que não pode entrar no bundle de um componente "use client".
const SITUACAO_LABELS: Record<SituacaoAssinatura, string> = {
  "aguardando-emissao": "Aguardando emissão",
  assinado: "Assinado",
  "em-assinatura": "Em assinatura",
};

/**
 * O que o CONTRATO acrescenta à linha — o que a visão Contratos antiga mostrava em colunas. Nulo
 * quando o envio é de uma proposta que não é mais a viva da unidade (revenda, distrato): ali não
 * há contrato vigente de onde tirar valor, imobiliária ou PDF.
 */
type ContratoDaLinha = {
  /** ISO curto "YYYY-MM-DD" — formatar por STRING (rotuloDeYmd), nunca por new Date. */
  faturadoEm: null | string;
  /** ISO completo (created_at do histórico é datetime real): aqui rotuloDaData serve. */
  geradoEm: null | string;
  imobiliaria: null | string;
  /** Há contrato assinado no D4Sign: liga o botão de PDF (mesma UX da coluna da Carteira). */
  temContrato: boolean;
  /** A chave do botão de PDF; a rota que o recebe reconfere o escopo do lado de lá. */
  unitId: number;
  valorTabela: number;
};

type AssinanteDaTela = {
  /** Contratos em que a fila parou em alguém ANTES dele: pendência que ainda não é dele. */
  aguardandoAnteriores: number;
  assinou: number;
  /** Contratos em que a bola está COM ELE agora: o gargalo que o quadro existe para mostrar. */
  naVez: number;
  nome: string;
  papel: null | string;
};

/** Uma linha do esquema de assinatura de um contrato. Sem e-mail: decisão do dono, ver a rota. */
type AssinaturaDoEsquema = {
  /** ISO curto "2026-07-01" — formatar por STRING (rotuloDeYmd), nunca por new Date. */
  assinadoEm: null | string;
  /** Posição na fila. 0 = o empreendimento não usa ordem e todos assinam em paralelo. */
  degrau: number;
  nome: string;
  /** O rótulo de `perfilDeTela`, o MESMO que o painel interno mostra. */
  perfil: string;
  situacao: "aguardando" | "assinado" | "vez";
};

/** O progresso de um perfil DENTRO de um contrato: a barrinha por grupo da linha da unidade. */
type GrupoDaUnidade = { assinadas: number; naVez: boolean; perfil: string; total: number };

/** Uma linha da lista: um contrato, rotulado pela unidade dele. */
type UnidadeDeAssinatura = {
  assinadas: number;
  comprador: null | string;
  concluida: boolean;
  /** Os dados do contrato daquela venda: valor, geração, imobiliária, faturamento e o PDF. */
  contrato: ContratoDaLinha | null;
  empreendimento: string;
  /** ISO curto "2026-07-01" — formatar por STRING (rotuloDeYmd), nunca por new Date. VAZIA no
   * contrato que ainda não saiu para assinar. */
  enviadoEm: string;
  /** `contract_signatures.id`. 0 = contrato ainda sem envio (aguardando emissão). */
  envioId: number;
  esquema: AssinaturaDoEsquema[];
  /**
   * ⚠️ NÃO TEM `aviso` NEM `fonte` AQUI, e a ausência é deliberada. A linha do lado interno
   * (`UnidadeDeAssinatura` em lib/apolo/incorporador/assinaturas.ts) carrega os dois, e a rota
   * deste portal os REMOVE antes de responder: os textos nomeiam C2X e D4Sign, que é vocabulário
   * de quem opera, não de quem compra o produto. Decisão do Lucas em 18/08/2026 diante da faixa:
   * *"não queria esse tipo de comunicado para o incorporador"*. Quem quiser essa informação usa a
   * tela interna (/apolo/assinaturas), que recebe tudo. Ver o comentário da rota.
   */
  grupos: GrupoDaUnidade[];
  naVez: string[];
  perfisNaVez: string[];
  /** A régua da visão antiga: assinado, em assinatura ou aguardando emissão. */
  situacao: SituacaoAssinatura;
  total: number;
  unidade: string;
};

export type DadosAssinaturas = {
  assinantes: AssinanteDaTela[];
  /** O aviso do teto da lista, quando ela veio cortada. */
  aviso: null | string;
  /**
   * A confirmação das assinaturas não respondeu: o que está na tela pode mostrar como pendente
   * algo já assinado. Vem do SERVIDOR já em linguagem de cliente, sem nomear sistema nenhum (a
   * rota troca o texto técnico da lib) e é raro por construção — só aparece quando a confirmação
   * falha de verdade.
   *
   * ⚠️ O `avisoDosAssinantes` da lib NÃO chega aqui. Ele ficava aceso quase todo dia no Vale do
   * Ouro dizendo que a marcação vinha do sistema antigo, e o dono cortou: para o incorporador
   * aquilo não muda decisão nenhuma e só passa insegurança. A rota o zera.
   */
  avisoDaFonte: null | string;
  /** Vazia quando o recorte não usa ordem de assinatura (todo mundo no degrau 0). */
  fila: { assinadas: number; degrau: number; perfis: string[]; total: number }[];
  kpis: {
    aguardandoEmissao: number;
    compradorEmAtraso: number;
    compradorOk: number;
    compradorPendente: number;
    diasAteAssinar: null | number;
    diasDesdeEnvio: null | number;
    pctCompradoresAssinaram: null | number;
    tempoMedioDias: null | number;
    unidadesComEnvio: number;
    unidadesTotalmenteAssinadas: number;
  };
  taxas: { assinadas: number; esperadas: number; perfil: string }[];
  unidades: UnidadeDeAssinatura[];
};

// ── AS RÉGUAS DE FORMATO (as mesmas da TelaVendas) ───────────────────────────

const brl = (valor: number): string =>
  valor.toLocaleString("pt-BR", { currency: "BRL", maximumFractionDigits: 0, style: "currency" });

const inteiro = (valor: number): string => valor.toLocaleString("pt-BR");

const pct1 = (valor: number): string =>
  valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/**
 * 'YYYY-MM-DD' → 'dd/mm/aaaa', por STRING. `new Date("2026-08-01")` é meia-noite UTC, que o
 * fuso de São Paulo mostra como 31/07 — a data do contrato voltaria um dia.
 */
function rotuloDeYmd(ymd: null | string): string {
  const texto = String(ymd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return "";
  const [ano, mes, dia] = texto.split("-");
  return `${dia}/${mes}/${ano}`;
}


/**
 * dd/mm/aaaa para geração, faturamento e envio. Mesma régua da Carteira
 * (`lib/apolo/incorporador/dia-na-tela`), pelo mesmo motivo: estas datas são DIA, e formatá-las
 * no fuso da casa devolve o dia anterior — o defeito que o Lucas pegou na Carteira em 18/08/2026.
 */
function rotuloDaData(iso: null | string): string {
  return diaNaTela(iso, "");
}

const cartao = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 14,
  padding: 20,
} as const;

const titulo = { color: T.text, fontSize: 15, fontWeight: 700, margin: 0 } as const;

export function Pilula({
  ativo,
  onClick,
  rotulo,
}: {
  ativo: boolean;
  onClick: () => void;
  rotulo: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: ativo ? T.btnBg : "transparent",
        border: `1px solid ${ativo ? "transparent" : T.border}`,
        borderRadius: 999,
        color: ativo ? T.btnFg : T.sub,
        cursor: "pointer",
        fontFamily: fonte,
        fontSize: 12.5,
        fontWeight: ativo ? 600 : 500,
        padding: "7px 14px",
      }}
      type="button"
    >
      {rotulo}
    </button>
  );
}

/** Um fato do topo do modal, no padrão do MiniFato da carteira: rótulo pequeno + valor forte. */
function FatoDoModal({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          color: T.muted,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
      >
        {rotulo}
      </div>
      <div
        style={{
          color: T.text,
          fontSize: 14,
          fontWeight: 700,
          marginTop: 2,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {valor}
      </div>
    </div>
  );
}

// ── O FETCH SOB DEMANDA (o mesmo desenho da TelaVendas) ──────────────────────
//
// O QUE FICOU DE FORA, declarado (como lá): ordenação clicável nas tabelas (a ordem já vem
// decidida do servidor: contratos pelo gargalo, assinantes pelo gargalo); "dias desde o envio" e
// o prazo por linha do painel interno (o payload do portal não os traz); export/CSV. O recorte de
// empreendimento é o `emp` de quem monta — a ficha do produto — ou nenhum, na tela do menu.

type EstadoDeVisao<Tipo> =
  | { dados: Tipo; tipo: "pronto" }
  | { mensagem: string; tipo: "erro" }
  | { tipo: "carregando" };

/**
 * O fetch de uma visão sob demanda, como o ModalDaProposta da TelaVendas: cache primeiro (chave =
 * recorte), erro fora do cache, flag `ativo` contra setState depois do unmount. O efeito roda
 * quando a visão MONTA (a troca de visão desmonta a seção) e quando o recorte muda.
 */
/**
 * Quanto esperar antes de perguntar de novo quando a resposta veio marcada `conciliando`.
 *
 * ⚠️ ISTO NÃO É POLLING, e a diferença importa: só há repique quando o SERVIDOR pediu, e ele para
 * sozinho assim que a resposta chega conciliada (ou depois de `MAXIMO_DE_REPIQUES`). Em regime
 * normal — que é o caso comum, com o catálogo quente — não acontece nenhuma volta.
 *
 * 6 s porque é a ordem de grandeza do aquecimento medido (catálogo 4,4 s), com folga. Menos que
 * isso só produz uma volta a mais que ainda pega o dado velho.
 */
const MS_ATE_PERGUNTAR_DE_NOVO = 6000;
const MAXIMO_DE_REPIQUES = 3;

function useDadosDaVisao<Tipo>(
  caminho: string,
  emp: null | string,
  cache: Map<string, Tipo>,
  mensagemDeErro: string,
): EstadoDeVisao<Tipo> {
  const [estado, setEstado] = useState<EstadoDeVisao<Tipo>>({ tipo: "carregando" });

  useEffect(() => {
    let ativo = true;
    let relogio: null | ReturnType<typeof setTimeout> = null;

    const chave = emp ?? "";

    async function carregar(tentativa: number) {
      try {
        const endereco = emp ? `${caminho}?emp=${encodeURIComponent(emp)}` : caminho;
        const resposta = await fetch(endereco, { cache: "no-store" });
        const corpo = (await resposta.json().catch(() => null)) as
          | { data?: Tipo; error?: string }
          | null;

        if (!resposta.ok || corpo?.data === undefined) {
          throw new Error(corpo?.error ?? mensagemDeErro);
        }

        cache.set(chave, corpo.data);
        if (!ativo) return;
        // ⚠️ TROCA SEM VOLTAR PARA "CARREGANDO". No repique a tela JÁ tem números na frente do
        // usuário; devolvê-la ao esqueleto para trocar por números quase iguais seria piscada
        // gratuita. Os dados são substituídos por baixo e pronto.
        setEstado({ dados: corpo.data, tipo: "pronto" });

        // O servidor respondeu com o que tinha e foi buscar o resto: voltamos daqui a pouco.
        const aindaConciliando =
          (corpo.data as { conciliando?: boolean } | null)?.conciliando === true;
        if (aindaConciliando && tentativa < MAXIMO_DE_REPIQUES) {
          relogio = setTimeout(() => {
            void carregar(tentativa + 1);
          }, MS_ATE_PERGUNTAR_DE_NOVO);
        }
      } catch (falha) {
        // ⚠️ FALHA NO REPIQUE NÃO APAGA A TELA. Na primeira carga não há nada a perder e o erro
        // aparece; da segunda em diante o usuário já está lendo números que vieram do C2X, e
        // trocá-los por uma mensagem de erro porque a CONFERÊNCIA falhou seria piorar o que já
        // estava bom.
        if (ativo && tentativa === 0) {
          setEstado({
            mensagem: falha instanceof Error ? falha.message : mensagemDeErro,
            tipo: "erro",
          });
        }
      }
    }

    const guardado = cache.get(chave);
    if (guardado !== undefined) {
      setEstado({ dados: guardado, tipo: "pronto" });
      // Cache local não impede o repique: se o que está guardado veio pela metade, a volta é
      // justamente o que o completa.
      if ((guardado as { conciliando?: boolean } | null)?.conciliando === true) {
        relogio = setTimeout(() => {
          void carregar(1);
        }, MS_ATE_PERGUNTAR_DE_NOVO);
      }
      return () => {
        ativo = false;
        if (relogio) clearTimeout(relogio);
      };
    }

    setEstado({ tipo: "carregando" });
    void carregar(0);
    return () => {
      ativo = false;
      if (relogio) clearTimeout(relogio);
    };
  }, [cache, caminho, emp, mensagemDeErro]);

  return estado;
}

/**
 * O chip da coluna Assinatura: assinado no verde T.ok, em assinatura neutro, aguardando emissão
 * esmaecido. É a única cor de estado da tabela — e verde de "concluído" é permitido (o que não é
 * estado é o dourado).
 */
function ChipDeAssinatura({ situacao }: { situacao: SituacaoAssinatura }) {
  const tom: CSSProperties =
    situacao === "assinado"
      ? { background: T.okBg, color: T.ok }
      : situacao === "em-assinatura"
        ? { background: T.soft, color: T.sub }
        : { background: "transparent", color: T.muted, opacity: 0.75 };

  return (
    <span
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 700,
        padding: "2px 9px",
        whiteSpace: "nowrap",
        ...tom,
      }}
    >
      {SITUACAO_LABELS[situacao]}
    </span>
  );
}

/**
 * O BOTÃO DO FIM DA LINHA — *"no final dessa linha vai ter o contrato para ser baixado"* (Lucas,
 * 18/08/2026). A MESMA UX do BotaoDeContrato da TelaCarteira: ícone de documento que abre
 * /api/incorporador/contrato?unitId=… em aba nova. O link leva o unitId, NUNCA o uuid: a rota
 * reconfere `unidadeNoEscopo` e resolve o documento no C2X a cada clique.
 *
 * ⚠️ SEM CONTRATO DISPONÍVEL, A CÉLULA É "-", NUNCA UM BOTÃO QUE ERRA: sem `temContrato` não há
 * documento assinado na D4Sign, e sem `contrato` (envio de proposta que não é mais a viva) não há
 * nem unitId para onde apontar.
 */
function BotaoDePdfDoContrato({
  contrato,
  largo,
}: {
  contrato: ContratoDaLinha | null;
  /** Versão do popup: o mesmo destino, com rótulo, porque ali sobra largura. */
  largo?: boolean;
}) {
  if (!contrato?.temContrato) {
    return <span style={{ color: T.muted, fontSize: 12 }}>-</span>;
  }

  return (
    <a
      href={`/api/incorporador/contrato?unitId=${encodeURIComponent(contrato.unitId)}`}
      rel="noopener noreferrer"
      style={{
        alignItems: "center",
        background: T.soft,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        color: T.sub,
        display: "inline-flex",
        fontFamily: fonte,
        fontSize: 12,
        fontWeight: 600,
        gap: largo ? 7 : 0,
        height: 28,
        justifyContent: "center",
        padding: largo ? "0 11px" : 0,
        textDecoration: "none",
        width: largo ? "auto" : 28,
      }}
      target="_blank"
      title="Abrir contrato assinado"
    >
      <FileText aria-hidden="true" size={14} />
      {largo ? "Abrir contrato" : null}
    </a>
  );
}

// ── CONTRATOS: a taxa por perfil, os blocos do painel, a lista por unidade e o quadro ─
//
// ⚠️ FUSÃO DE 18/08/2026 (o quarto desenho): *"acho que a tela de assinatura devia chamar
// contratos e tirar a tela de contratos que tem hoje. O nome da tela de assinatura vai chamar
// contrato, e aí no final dessa linha vai ter o contrato para ser baixado"*. Esta visão absorveu a
// lista de contratos gerados. ONDE CADA COISA DELA FOI PARAR:
//   • unidade e comprador → já eram a identificação da linha;
//   • VALOR e GERADO EM → linha de apoio da mesma identificação (uma linha só, discreta);
//   • IMOBILIÁRIA e FATURADO EM → cabeçalho "Dados do contrato" do popup da unidade;
//   • SITUAÇÃO DA ASSINATURA → o mesmo `ChipDeAssinatura`, na terceira coluna da linha (só quando
//     o contrato ainda não saiu para assinar; nos demais a fração "x de y" e o "parado com quem"
//     dizem mais do que o chip) e no cabeçalho do popup;
//   • PDF → o botão do FIM DA LINHA, e de novo no popup;
//   • FILTRO POR SITUAÇÃO → virou a pílula "Aguardando emissão", ao lado de Pendentes/Concluídas;
//   • BUSCA por imobiliária → continua, junto de unidade e comprador.
// O contrato gerado que ainda NÃO saiu para assinar deixou de ser só o KPI "aguardando emissão" e
// virou LINHA: era linha na visão antiga, e some-lo num contador perderia valor e faturamento.
//
// REDESENHO 18/08/2026 (o terceiro, e o que o dono desenhou por inteiro). O que ele pediu, na
// ordem em que pediu, e onde cada coisa foi parar:
//
//   1. *"essa tela tem que ser a que temos hoje no painel"* — o painel interno de assinatura
//      (modules/apolo/blocks/assinaturas/painel-assinatura.tsx, que ele usa e aprovou) entra aqui
//      em DESENHO, não em classe: os blocos de KPI, a fila por ordem e o quadro por assinante com
//      os números clicáveis. As classes Tailwind do hub viraram estilo inline com os tokens T,
//      porque o portal é tela pública e tem tema claro E escuro;
//   2. *"eu não sei o status de assinatura das unidades... um visual em barra que vai enchendo"* —
//      a LISTA POR UNIDADE virou o palco da tela. A pergunta principal aqui é por unidade, não por
//      assinante;
//   3. *"traz a unidade e os grupos, e com a barrinha também"* — cada linha mostra uma barrinha
//      POR PERFIL presente naquele contrato, e é ela que responde "falta o Incorporador";
//   4. *"ao clicar nessa unidade abre um popup... quem assinou, quem falta"* — o clique abre a
//      TABELA de assinatura daquele contrato (o termo é dele, e tabela lê melhor que linha do
//      tempo quando metade dos contratos não tem ordem nenhuma);
//   5. *"colocar filtro para saber as unidades, tipo pendente e tal"* — pílulas com contagem,
//      mais a busca por unidade, comprador e imobiliária;
//   6. *"esses cards poderiam trazer a taxa de assinatura das imobiliárias, Careli, coordenação,
//      incorporador"* — a faixa de cima virou a TAXA POR PERFIL, com o pior elo primeiro.
//
// ⚠️ OS NOMES DE PERFIL SÃO OS DO PAINEL INTERNO, e nenhum é inventado aqui: vêm de `perfilDeTela`
// (lib/apolo/painel-assinatura.ts), no servidor. Regra do Lucas: *"em vez de Careli, coloca
// Backoffice... do jeito que estamos fazendo hoje"*. Medido no C2X em 18/08/2026, os perfis que
// existem nos recortes de hoje são Comprador, Imobiliária, Backoffice, Incorporador, Coordenadora
// de venda e Corretor. Se aparecer um perfil novo no C2X, ele chega sozinho na tela.
//
// ⚠️ O QUE SAIU: os cards "Com a bola agora". Eles respondiam "de quem eu cobro", e a mesma
// resposta está agora em dois lugares melhores — a pílula "parado com <perfil>" e a coluna "Na
// vez" do quadro, que filtra a lista no clique. Manter os três seria a terceira leitura do mesmo
// dado, que é justamente o que deixou a tela longa da primeira vez.
//
// ⚠️ E-MAIL DO ASSINANTE NÃO APARECE. O painel interno mostra o e-mail sob o nome; aqui não, nem
// no quadro nem no popup. Decisão registrada: esta tela é de cliente externo, os assinantes são o
// comprador do contrato, a imobiliária e gente da Careli, e a tela responde tudo o que precisa com
// NOME e PERFIL. O e-mail nem sai do servidor.
const CSS_ASSINATURAS = `
  /* Um card por perfil que assina. São 5 ou 6 no pior caso, então auto-fit resolve sem sobrar
     órfão: eles têm o mesmo peso visual e a quebra não cria hierarquia falsa. */
  .asn-taxas { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(184px, 1fr)); }
  .asn-blocos { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(252px, 1fr)); }
  .asn-apoio { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); }
  /* A LINHA DA UNIDADE: identificação | barrinhas por grupo | situação. As barrinhas ficam com a
     maior fração de propósito, porque são elas que o dono lê de relance. */
  .asn-linha {
    align-items: center; display: grid; gap: 14px;
    grid-template-columns: minmax(140px, 1.05fr) minmax(0, 2.3fr) minmax(116px, 0.85fr);
  }
  /* ⚠️ O PDF FICA FORA DO BOTÃO DA LINHA, não dentro: <a> dentro de <button> é HTML inválido e o
     clique do link seria engolido pelo popup. A moldura é uma grade de duas células — a linha
     clicável e a célula do documento —, e é ela que põe o contrato no FIM da linha. */
  .asn-moldura { align-items: center; display: grid; grid-template-columns: minmax(0, 1fr) auto; }
  .asn-pdf { display: flex; justify-content: flex-end; padding: 0 10px 0 6px; }
  /* Abaixo de 960px as três colunas não cabem sem espremer as barrinhas a ponto de a fração não
     caber embaixo: empilha, e a linha vira um cartãozinho. */
  @media (max-width: 960px) { .asn-linha { gap: 10px; grid-template-columns: minmax(0, 1fr); } }
  .asn-grupos { display: flex; flex-wrap: wrap; gap: 10px; }
  .asn-grupo { flex: 1 1 88px; min-width: 78px; }
  /* A tabela recolhida rola DENTRO dela mesma (cabeçalho fixo): aberta, ela não pode empurrar a
     página de volta ao comprimento que o dono reprovou. */
  .asn-rolagem { max-height: 400px; overflow: auto; }
  .asn-tabela { border-collapse: separate; border-spacing: 0; min-width: 520px; width: 100%; }
  .asn-tabela thead th {
    background: var(--inc-card); box-shadow: inset 0 -1px 0 var(--inc-border);
    color: var(--inc-muted); font-size: 11px; font-weight: 600; letter-spacing: .04em;
    padding: 9px 10px 9px 0; position: sticky; text-transform: uppercase; top: 0;
    white-space: nowrap; z-index: 1;
  }
  .asn-tabela td { padding: 9px 10px 9px 0; }
  .asn-tabela thead th:first-child, .asn-tabela tbody td:first-child { padding-left: 10px; }
  /* Zebra em cinza TRANSLÚCIDO, não em token: o mesmo valor serve nos dois temas (sobre branco
     vira quase-cinza, sobre preto vira quase-grafite) sem precisar de segunda regra no dark. */
  .asn-tabela tbody tr:nth-child(2n) td { background: rgb(127 127 127 / .06); }
  /* A linha inteira é um botão (o popup é o destino do clique), então ela precisa do afago de
     hover e do anel de foco por teclado — senão vira alvo invisível para quem navega por Tab. */
  .asn-clicavel { background: transparent; border: none; cursor: pointer; display: block;
    font: inherit; text-align: left; width: 100%; }
  .asn-clicavel:hover { background: rgb(127 127 127 / .07); }
  .asn-clicavel:focus-visible { outline: 2px solid var(--inc-text); outline-offset: -2px; }
`;

/** Quantos dias inteiros desde 'YYYY-MM-DD', pela data LOCAL (new Date do ymd é UTC: erra um dia). */
function diasDesdeYmd(ymd: null | string): null | number {
  const texto = String(ymd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  const [ano, mes, dia] = texto.split("-").map(Number);
  const entao = new Date(ano ?? 0, (mes ?? 1) - 1, dia ?? 1).getTime();
  if (Number.isNaN(entao)) return null;

  return Math.max(0, Math.floor((Date.now() - entao) / 86_400_000));
}

/** "há 12 dias" / "há 1 dia" / "hoje" — a espera, do jeito que se fala. */
function rotuloDeEspera(ymd: null | string): string {
  const dias = diasDesdeYmd(ymd);
  if (dias === null) return "";
  if (dias === 0) return "hoje";

  return dias === 1 ? "há 1 dia" : `há ${inteiro(dias)} dias`;
}

/** O recorte da lista: um estado, ou "parado com o perfil X". */
type RecorteDeAssinatura =
  | "concluidas"
  | "emissao"
  | "pendentes"
  | "todas"
  | `perfil:${string}`;

/** O que o clique num número do quadro por assinante manda a lista mostrar. */
type FiltroDeAssinante = { alvo: "aguardando" | "assinado" | "vez"; nome: string };

const ANCORA_DA_LISTA = "analitico-contratos";

/** O Map por recorte que guarda o payload (chave = emp; "" = todos os empreendimentos da sessão). */
export type CacheDeAssinaturas = Map<string, DadosAssinaturas>;

const ROTA_DE_ASSINATURAS = "/api/incorporador/vendas/assinaturas";

/**
 * O cache de quem monta, ou um próprio. `useRef(new Map())` cria um Map por render e descarta
 * todos menos o primeiro — é o mesmo desenho da TelaVendas, e o custo é nenhum.
 */
function useCacheDeAssinaturas(externo?: CacheDeAssinaturas): CacheDeAssinaturas {
  const proprio = useRef<CacheDeAssinaturas>(new Map());
  return externo ?? proprio.current;
}

// ── ASSINATURA: a visão inteira, por unidade ─────────────────────────────────
// Era a `SecaoContratos` da TelaVendas. O que muda é só a porta: `emp` opcional (a tela do menu
// não tem recorte) e o cache por props.

export function AssinaturasDoProduto({
  cache,
  emp,
}: {
  /** O Map de quem monta (a TelaContratos divide o dela entre Resumo e Assinatura). */
  cache?: CacheDeAssinaturas;
  /** "pai:<uuid>" do cadastro ou id do C2X; ausente = tudo o que a sessão autoriza. */
  emp?: string;
}) {
  const mapa = useCacheDeAssinaturas(cache);
  const estado = useDadosDaVisao(
    ROTA_DE_ASSINATURAS,
    emp ?? null,
    mapa,
    "Não foi possível carregar os contratos.",
  );

  const [busca, setBusca] = useState("");
  const [recorte, setRecorte] = useState<RecorteDeAssinatura>("todas");
  const [porAssinante, setPorAssinante] = useState<FiltroDeAssinante | null>(null);
  const [aberta, setAberta] = useState<null | UnidadeDeAssinatura>(null);

  /** O clique num número do quadro joga a lista naquele recorte e desce até ela. */
  const filtrarPorAssinante = useCallback((filtro: FiltroDeAssinante) => {
    setPorAssinante(filtro);
    setRecorte("todas");
    document.getElementById(ANCORA_DA_LISTA)?.scrollIntoView({ behavior: "smooth" });
  }, []);

  if (estado.tipo === "carregando") return <EsqueletoDaTela blocos={5} cards={4} />;
  if (estado.tipo === "erro") return <Aviso texto={estado.mensagem} tom="erro" />;

  const { assinantes, aviso, avisoDaFonte, fila, kpis, taxas, unidades } = estado.dados;

  if (unidades.length === 0 && kpis.aguardandoEmissao === 0) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <style>{CSS_ASSINATURAS}</style>
        <Aviso texto="Nenhuma venda deste recorte chegou à etapa de contrato ainda." />
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Layout responsivo em classe pela mesma razão do CSS_RESUMO: media query não alcança
          estilo inline, e as barrinhas precisam empilhar no celular. */}
      <style>{CSS_ASSINATURAS}</style>

      <FaixaDaFonte fonte={avisoDaFonte} />
      <FaixaDeTaxas kpis={kpis} taxas={taxas} />
      <BlocosDoPainel kpis={kpis} />

      <ListaDeUnidades
        aviso={aviso}
        busca={busca}
        onAbrir={setAberta}
        onBuscar={setBusca}
        onLimparAssinante={() => setPorAssinante(null)}
        onRecorte={setRecorte}
        porAssinante={porAssinante}
        recorte={recorte}
        unidades={unidades}
      />

      <div className="asn-apoio">
        {fila.length > 0 ? <SecaoDaFila fila={fila} /> : null}
        <QuadroDeAssinantes
          assinantes={assinantes}
          onFiltrar={filtrarPorAssinante}
          selecionado={porAssinante}
        />
      </div>

      {aberta ? <ModalDoEsquema onFechar={() => setAberta(null)} unidade={aberta} /> : null}
    </div>
  );
}

// ── QUANDO A CONFIRMAÇÃO NÃO RESPONDE ───────────────────────────────────────
//
// ⚠️ UMA FAIXA SÓ, E EM LINGUAGEM DE CLIENTE. A lib produz DOIS avisos e a tela interna mostra os
// dois; aqui chega só este, e já reescrito pelo servidor. O outro (`avisoDosAssinantes`, que dizia
// "a marcação de quem já assinou vem do sistema antigo (C2X)") foi cortado pelo dono em 18/08/2026
// ao ver a faixa no portal: *"não queria esse tipo de comunicado para o incorporador"*. E ele está
// certo — no Vale do Ouro aquilo ficava aceso todo dia, o loteador não decide nada com aquilo, e
// nomear as tripas do sistema numa vitrine só passa insegurança sobre o produto.
//
// O que sobrou aparece raro (só quando a confirmação falha de verdade) e diz o EFEITO — pode faltar
// atualizar — sem nomear sistema nenhum. Calar também isso seria pior: a tela mostraria como
// pendente uma assinatura já colhida, sem nenhuma pista.
//
// Vem ANTES dos cards porque as taxas e os KPIs saem das MESMAS linhas da lista.

function FaixaDaFonte({ fonte }: { fonte: null | string }) {
  if (!fonte) return null;

  return (
    <p
      style={{
        background: T.soft,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        color: T.muted,
        fontSize: 12.5,
        lineHeight: 1.5,
        margin: 0,
        padding: "10px 14px",
      }}
    >
      {fonte}
    </p>
  );
}

// ── A FAIXA DE CIMA: a taxa de cada elo da cadeia ───────────────────────────
//
// *"esses cards poderiam trazer a taxa de assinatura das imobiliárias, Careli, coordenação,
// incorporador"* (Lucas, 18/08/2026). O card responde uma pergunta só: em qual elo a assinatura
// emperra. O pior vem primeiro (a ordem sai do servidor) e ganha o vermelho de alerta do tema —
// o único destaque de cor da faixa, porque dourado não é estado.
//
// Os dois indicadores que não são taxa e que ele já tinha validado (tempo médio e aguardando
// emissão) não sumiram: desceram para o bloco "Emissão", logo abaixo.

function FaixaDeTaxas({
  kpis,
  taxas,
}: {
  kpis: DadosAssinaturas["kpis"];
  taxas: DadosAssinaturas["taxas"];
}) {
  if (taxas.length === 0) return null;

  // O pior elo é o primeiro da lista (o servidor já ordena por taxa). Só vira alerta se de fato
  // estiver atrás: com tudo assinado, destacar o "menos assinado" inventaria um problema.
  const pior = taxas[0];
  const destacar = pior !== undefined && pior.assinadas < pior.esperadas ? pior.perfil : null;

  return (
    <section style={{ ...cartao, padding: 16 }}>
      <div
        style={{
          alignItems: "baseline",
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 10px",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h2 style={titulo}>Taxa de assinatura por perfil</h2>
        <span style={{ color: T.muted, fontSize: 12.5 }}>
          {kpis.unidadesTotalmenteAssinadas === kpis.unidadesComEnvio
            ? "Todos os contratos enviados estão assinados."
            : "Quem está mais atrasado aparece primeiro."}
        </span>
      </div>
      <div className="asn-taxas">
        {taxas.map((taxa) => (
          <CardDeTaxa
            alerta={taxa.perfil === destacar}
            assinadas={taxa.assinadas}
            esperadas={taxa.esperadas}
            key={taxa.perfil}
            perfil={taxa.perfil}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Um card de taxa: percentual grande, a fração embaixo ("21 de 23") e a barra fina do tile que o
 * dono já validou. A barra é monocromática (tinta do texto), e só o card mais atrasado troca para
 * o vermelho de alerta — cor por estado aqui viraria arco-íris com cinco perfis lado a lado.
 */
function CardDeTaxa({
  alerta,
  assinadas,
  esperadas,
  perfil,
}: {
  alerta: boolean;
  assinadas: number;
  esperadas: number;
  perfil: string;
}) {
  const percentual = esperadas > 0 ? (assinadas / esperadas) * 100 : 0;
  const completo = assinadas >= esperadas;
  const tinta = alerta ? T.danger : T.text;

  return (
    <div
      style={{
        background: alerta ? T.dangerBg : T.soft,
        border: `1px solid ${alerta ? T.danger : T.border}`,
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 0,
        padding: "13px 14px 14px",
      }}
    >
      <div
        style={{
          color: alerta ? T.danger : T.muted,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.05em",
          lineHeight: 1.35,
          overflowWrap: "anywhere",
          textTransform: "uppercase",
        }}
      >
        {perfil}
      </div>

      <div style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: 5 }}>
        <span style={{ color: tinta, fontSize: 27, fontWeight: 700, lineHeight: 1.05 }}>
          {pct1(percentual)}
        </span>
        <span style={{ color: alerta ? T.danger : T.muted, fontSize: 13, fontWeight: 600 }}>%</span>
      </div>

      <div style={{ color: T.muted, fontSize: 11, lineHeight: 1.4, marginTop: "auto" }}>
        {inteiro(assinadas)} de {inteiro(esperadas)} assinaturas
      </div>

      <div
        aria-hidden="true"
        style={{ background: T.border, borderRadius: 999, height: 4, overflow: "hidden" }}
      >
        <div
          style={{
            background: completo ? T.ok : tinta,
            height: "100%",
            width: `${Math.min(100, Math.max(0, percentual))}%`,
          }}
        />
      </div>
    </div>
  );
}

// ── OS BLOCOS DO PAINEL INTERNO, portados ───────────────────────────────────
// Comprador, Geral e Prazo do comprador · 7 dias são os três blocos do painel que o Lucas aprovou
// (`Bloco` + `Kpi` em modules/apolo/blocks/assinaturas/painel-assinatura.tsx), com os mesmos
// números e a mesma ordem. O quarto, "Emissão", guarda os dois indicadores que já estavam nesta
// aba e que ele validou: o tempo médio de geração até a última assinatura e o aguardando emissão.
//
// O cabeçalho dourado do bloco é o único uso de ouro aqui, e é o mesmo do painel: ele rotula,
// não sinaliza estado.

function BlocosDoPainel({ kpis }: { kpis: DadosAssinaturas["kpis"] }) {
  const unidades = kpis.unidadesComEnvio;

  return (
    <div className="asn-blocos">
      <BlocoDeKpi titulo="Comprador">
        <NumeroDoBloco cor={T.ok} rotulo="Unidades assinadas" valor={inteiro(kpis.compradorOk)} />
        <NumeroDoBloco rotulo="Unidades pendentes" valor={inteiro(kpis.compradorPendente)} />
        <NumeroDoBloco cor={T.gold} rotulo="Do total" valor={porcentagem(kpis.compradorOk, unidades)} />
      </BlocoDeKpi>

      <BlocoDeKpi titulo="Geral">
        <NumeroDoBloco rotulo="Total de unidades" valor={inteiro(unidades)} />
        <NumeroDoBloco
          cor={T.ok}
          rotulo="Unidades finalizadas"
          valor={inteiro(kpis.unidadesTotalmenteAssinadas)}
        />
        <NumeroDoBloco
          cor={T.gold}
          rotulo="Do total"
          valor={porcentagem(kpis.unidadesTotalmenteAssinadas, unidades)}
        />
      </BlocoDeKpi>

      <BlocoDeKpi titulo="Prazo do comprador · 7 dias">
        <NumeroDoBloco
          cor={kpis.compradorEmAtraso > 0 ? T.danger : undefined}
          rotulo="Em atraso"
          valor={inteiro(kpis.compradorEmAtraso)}
        />
        <NumeroDoBloco rotulo="Dias até assinar" valor={numeroOuTraco(kpis.diasAteAssinar)} />
        <NumeroDoBloco rotulo="Dias desde o envio" valor={numeroOuTraco(kpis.diasDesdeEnvio)} />
      </BlocoDeKpi>

      <BlocoDeKpi titulo="Emissão">
        <NumeroDoBloco rotulo="Tempo médio em dias" valor={numeroOuTraco(kpis.tempoMedioDias)} />
        <NumeroDoBloco
          rotulo="Aguardando emissão"
          valor={inteiro(kpis.aguardandoEmissao)}
        />
      </BlocoDeKpi>
    </div>
  );
}

const porcentagem = (parte: number, todo: number): string =>
  todo > 0 ? `${Math.round((100 * parte) / todo)}%` : "—";

const numeroOuTraco = (valor: null | number): string =>
  valor === null ? "—" : pct1(valor);

function BlocoDeKpi({ children, titulo }: { children: ReactNode; titulo: string }) {
  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <h2
        style={{
          background: T.soft,
          borderBottom: `1px solid ${T.border}`,
          color: T.gold,
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.12em",
          margin: 0,
          padding: "8px 16px",
          textTransform: "uppercase",
        }}
      >
        {titulo}
      </h2>
      <div style={{ display: "flex", gap: 8, padding: 16 }}>{children}</div>
    </div>
  );
}

function NumeroDoBloco({
  cor,
  rotulo,
  valor,
}: {
  cor?: string;
  rotulo: string;
  valor: string;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
      <span
        style={{
          color: cor ?? T.text,
          display: "block",
          fontSize: 26,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 700,
          lineHeight: 1.05,
        }}
      >
        {valor}
      </span>
      <span
        style={{
          color: T.muted,
          display: "block",
          fontSize: 11.5,
          lineHeight: 1.3,
          marginTop: 6,
        }}
      >
        {rotulo}
      </span>
    </div>
  );
}

// ── O PALCO: A LISTA DE CONTRATOS, POR UNIDADE ──────────────────────────────
//
// Uma linha por CONTRATO, rotulada pela unidade (a granularidade está declarada em
// lib/apolo/incorporador/assinaturas.ts: unidade revendida tem dois contratos, com esquemas
// diferentes, e fundir os dois inventaria um esquema que não existe). Desde a fusão, o contrato
// que ainda não saiu para assinar também é linha — sem barrinha, com o chip "Aguardando emissão".
//
// A ordem vem do servidor e é a do gargalo: pendente primeiro, a que espera há mais tempo no topo,
// e as concluídas no fim — visíveis, mas sem disputar o palco.

function ListaDeUnidades({
  aviso,
  busca,
  onAbrir,
  onBuscar,
  onLimparAssinante,
  onRecorte,
  porAssinante,
  recorte,
  unidades,
}: {
  aviso: null | string;
  busca: string;
  onAbrir: (unidade: UnidadeDeAssinatura) => void;
  onBuscar: (texto: string) => void;
  onLimparAssinante: () => void;
  onRecorte: (recorte: RecorteDeAssinatura) => void;
  porAssinante: FiltroDeAssinante | null;
  recorte: RecorteDeAssinatura;
  unidades: UnidadeDeAssinatura[];
}) {
  const alvo = busca.trim().toLowerCase();

  // A BUSCA VEM ANTES DAS PÍLULAS de propósito: a contagem da pílula tem que ser o que o clique
  // vai mostrar. Contar sobre tudo faria a pílula prometer 12 e entregar 2 com a busca ativa.
  const buscadas = useMemo(
    () =>
      unidades.filter((unidade) => {
        if (porAssinante) {
          const { alvo: situacao, nome } = porAssinante;
          const casa =
            situacao === "vez"
              ? unidade.naVez.includes(nome)
              : unidade.esquema.some((item) => item.nome === nome && item.situacao === situacao);
          if (!casa) return false;
        }
        if (!alvo) return true;

        // A IMOBILIÁRIA entrou na busca com a fusão: era campo pesquisável na visão antiga.
        return (
          unidade.unidade.toLowerCase().includes(alvo) ||
          (unidade.comprador ?? "").toLowerCase().includes(alvo) ||
          (unidade.contrato?.imobiliaria ?? "").toLowerCase().includes(alvo) ||
          unidade.empreendimento.toLowerCase().includes(alvo)
        );
      }),
    [alvo, porAssinante, unidades],
  );

  const pendentes = buscadas.filter((unidade) => !unidade.concluida);
  const concluidas = buscadas.length - pendentes.length;
  // O contrato que nem saiu para assinar: era o chip "Aguardando emissão" da visão antiga, e é o
  // único estado que a fração "x de y" não conta (não há nenhuma assinatura para contar).
  const aguardandoEmissao = buscadas.filter(
    (unidade) => unidade.situacao === "aguardando-emissao",
  ).length;

  // Os perfis que estão SEGURANDO alguma unidade, do que mais segura para o que menos segura.
  // ⚠️ Uma unidade parada em dois perfis (degrau dividido) conta nos dois: a soma das pílulas pode
  // passar do total de pendentes, e é assim que tem que ser — ela espera as duas assinaturas.
  const porPerfil = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const unidade of pendentes) {
      for (const perfil of unidade.perfisNaVez) {
        contagem.set(perfil, (contagem.get(perfil) ?? 0) + 1);
      }
    }
    return [...contagem.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"),
    );
  }, [pendentes]);

  const lista = buscadas.filter((unidade) => {
    if (recorte === "pendentes") return !unidade.concluida;
    if (recorte === "concluidas") return unidade.concluida;
    if (recorte === "emissao") return unidade.situacao === "aguardando-emissao";
    if (recorte.startsWith("perfil:")) {
      return !unidade.concluida && unidade.perfisNaVez.includes(recorte.slice(7));
    }
    return true;
  });

  const variosEmpreendimentos =
    new Set(unidades.map((unidade) => unidade.empreendimento).filter(Boolean)).size > 1;

  return (
    <section id={ANCORA_DA_LISTA} style={cartao}>
      <div
        style={{
          alignItems: "baseline",
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 10px",
          justifyContent: "space-between",
        }}
      >
        <h2 style={titulo}>Contratos por unidade</h2>
        <span style={{ color: T.muted, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
          {inteiro(lista.length)} de {inteiro(unidades.length)}{" "}
          {unidades.length === 1 ? "contrato" : "contratos"}
        </span>
      </div>
      <p style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.5, margin: "6px 0 0" }}>
        Cada barra é um perfil que assina aquele contrato. Clique na unidade para ver os dados do
        contrato e a tabela de assinatura, com quem já assinou e quem falta. O contrato assinado
        abre no ícone do fim da linha.
      </p>

      {porAssinante ? (
        <div
          style={{
            alignItems: "center",
            background: T.soft,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            marginTop: 12,
            padding: "8px 12px",
          }}
        >
          <span style={{ color: T.text, fontSize: 12.5 }}>
            {porAssinante.alvo === "vez"
              ? "Contratos parados com "
              : porAssinante.alvo === "assinado"
                ? "Contratos já assinados por "
                : "Contratos em que ainda não é a vez de "}
            <b>{porAssinante.nome}</b>
          </span>
          <button
            onClick={onLimparAssinante}
            style={{
              background: "transparent",
              border: `1px solid ${T.border}`,
              borderRadius: 999,
              color: T.sub,
              cursor: "pointer",
              fontFamily: fonte,
              fontSize: 11.5,
              marginLeft: "auto",
              padding: "4px 10px",
            }}
            type="button"
          >
            limpar
          </button>
        </div>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "14px 0 0" }}>
        <Pilula
          ativo={recorte === "todas"}
          onClick={() => onRecorte("todas")}
          rotulo={`Todas (${inteiro(buscadas.length)})`}
        />
        {pendentes.length > 0 ? (
          <Pilula
            ativo={recorte === "pendentes"}
            onClick={() => onRecorte(recorte === "pendentes" ? "todas" : "pendentes")}
            rotulo={`Pendentes (${inteiro(pendentes.length)})`}
          />
        ) : null}
        {concluidas > 0 ? (
          <Pilula
            ativo={recorte === "concluidas"}
            onClick={() => onRecorte(recorte === "concluidas" ? "todas" : "concluidas")}
            rotulo={`Concluídas (${inteiro(concluidas)})`}
          />
        ) : null}
        {/* O filtro por situação da visão antiga, no que ele tinha de único: as outras duas
            situações já são Pendentes e Concluídas. */}
        {aguardandoEmissao > 0 ? (
          <Pilula
            ativo={recorte === "emissao"}
            onClick={() => onRecorte(recorte === "emissao" ? "todas" : "emissao")}
            rotulo={`${SITUACAO_LABELS["aguardando-emissao"]} (${inteiro(aguardandoEmissao)})`}
          />
        ) : null}
      </div>

      {porPerfil.length > 0 ? (
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 10,
          }}
        >
          <span
            style={{
              color: T.muted,
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Parado com
          </span>
          {porPerfil.map(([perfil, quantas]) => (
            <Pilula
              ativo={recorte === `perfil:${perfil}`}
              key={perfil}
              onClick={() =>
                onRecorte(recorte === `perfil:${perfil}` ? "todas" : `perfil:${perfil}`)
              }
              rotulo={`${perfil} (${inteiro(quantas)})`}
            />
          ))}
        </div>
      ) : null}

      <label
        style={{
          alignItems: "center",
          background: T.soft,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          display: "flex",
          gap: 8,
          marginTop: 12,
          maxWidth: 340,
          padding: "0 12px",
        }}
      >
        <Search aria-hidden="true" size={15} style={{ color: T.muted, flexShrink: 0 }} />
        <input
          onChange={(evento) => onBuscar(evento.target.value)}
          placeholder="Buscar por unidade, comprador ou imobiliária"
          style={{
            background: "transparent",
            border: "none",
            color: T.text,
            flex: 1,
            fontFamily: fonte,
            fontSize: 14,
            minWidth: 0,
            outline: "none",
            padding: "9px 0",
          }}
          value={busca}
        />
      </label>

      {lista.length === 0 ? (
        <p style={{ color: T.muted, fontSize: 13, margin: "22px 0 6px", textAlign: "center" }}>
          Nenhum contrato neste recorte.
        </p>
      ) : (
        <div style={{ marginTop: 12 }}>
          {lista.map((unidade, indice) => (
            <div
              // O contrato sem envio tem envioId 0: a chave só fecha com empreendimento +
              // unidade, que é a chave de unidade do servidor.
              key={`${unidade.envioId}-${unidade.empreendimento}-${unidade.unidade}`}
              style={{ borderTop: indice === 0 ? "none" : `1px solid ${T.border}` }}
            >
              <LinhaDaUnidade
                mostrarEmpreendimento={variosEmpreendimentos}
                onAbrir={() => onAbrir(unidade)}
                unidade={unidade}
              />
            </div>
          ))}
        </div>
      )}

      {aviso ? (
        <p style={{ color: T.muted, fontSize: 12, lineHeight: 1.5, margin: "14px 0 0" }}>{aviso}</p>
      ) : null}
    </section>
  );
}

/**
 * A linha do contrato: identificação, uma barrinha por perfil daquele contrato, a situação e, no
 * FIM, o documento assinado.
 *
 * ⚠️ SÓ OS PERFIS DAQUELE CONTRATO desenham barra. Perfil que não assina ali não vira barra vazia,
 * porque barra vazia diz "falta alguém" de quem nunca foi chamado.
 *
 * ⚠️ O VALOR E A GERAÇÃO ficam numa linha de apoio, esmaecidos: eles vieram da visão antiga e são
 * consulta, não a pergunta da tela. Quem manda no destaque continua sendo a barrinha.
 */
function LinhaDaUnidade({
  mostrarEmpreendimento,
  onAbrir,
  unidade,
}: {
  mostrarEmpreendimento: boolean;
  onAbrir: () => void;
  unidade: UnidadeDeAssinatura;
}) {
  const percentual = unidade.total > 0 ? (unidade.assinadas / unidade.total) * 100 : 0;
  const apoio = [
    unidade.contrato ? brl(unidade.contrato.valorTabela) : null,
    unidade.contrato?.geradoEm ? `gerado em ${rotuloDaData(unidade.contrato.geradoEm)}` : null,
  ].filter(Boolean);

  return (
    <div className="asn-moldura">
      <button
        className="asn-clicavel"
        onClick={onAbrir}
        style={{ borderRadius: 10, padding: "12px 10px" }}
        title={`Ver o contrato de ${unidade.unidade || "esta unidade"}`}
        type="button"
      >
        <div className="asn-linha">
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                color: T.text,
                fontSize: 13.5,
                fontWeight: 700,
                overflowWrap: "anywhere",
              }}
            >
              {unidade.unidade || "unidade sem nome"}
              {mostrarEmpreendimento && unidade.empreendimento ? (
                <span style={{ color: T.muted, fontWeight: 500 }}> · {unidade.empreendimento}</span>
              ) : null}
            </div>
            <div
              style={{
                color: T.muted,
                fontSize: 11.5,
                lineHeight: 1.4,
                marginTop: 2,
                overflowWrap: "anywhere",
              }}
            >
              {unidade.comprador ?? "comprador não registrado no envio"}
            </div>
            {/* O VALOR E A GERAÇÃO da visão antiga. Sem contrato vivo por trás do envio, a linha
                simplesmente não tem esses dados e some com ela — nada de "R$ 0". */}
            {apoio.length > 0 ? (
              <div
                style={{
                  color: T.muted,
                  fontSize: 11,
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1.4,
                  marginTop: 3,
                  opacity: 0.85,
                }}
              >
                {apoio.join(" · ")}
              </div>
            ) : null}
          </div>

          {unidade.situacao === "aguardando-emissao" ? (
            // Contrato gerado que não saiu para assinar: não há esquema, e barrinha vazia mentiria.
            <div style={{ color: T.muted, fontSize: 12, lineHeight: 1.5 }}>
              O contrato foi gerado e ainda não saiu para assinatura.
            </div>
          ) : unidade.grupos.length === 0 ? (
            <div style={{ color: T.muted, fontSize: 12 }}>
              Nenhum assinante ficou registrado neste envio. Não há de quem cobrar sem refazer o
              envio.
            </div>
          ) : (
            <div className="asn-grupos">
              {unidade.grupos.map((grupo) => (
                <BarraDoGrupo grupo={grupo} key={grupo.perfil} />
              ))}
            </div>
          )}

          <div style={{ minWidth: 0 }}>
            {unidade.situacao === "aguardando-emissao" ? (
              // A situação da visão antiga, no chip da visão antiga: aqui não há fração para contar.
              <ChipDeAssinatura situacao={unidade.situacao} />
            ) : (
              <div
                style={{
                  color: T.text,
                  fontSize: 13,
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 700,
                }}
              >
                {inteiro(unidade.assinadas)} de {inteiro(unidade.total)}
                <span style={{ color: T.muted, fontWeight: 500 }}>
                  {" "}
                  · {Math.round(percentual)}%
                </span>
              </div>
            )}
            <div style={{ marginTop: 4 }}>
              {unidade.situacao === "aguardando-emissao" ? (
                <span style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.4 }}>
                  {unidade.contrato?.geradoEm
                    ? rotuloDeEspera(unidade.contrato.geradoEm.slice(0, 10))
                    : "sem data de geração registrada"}
                </span>
              ) : unidade.concluida ? (
                <span
                  style={{
                    alignItems: "center",
                    color: T.ok,
                    display: "inline-flex",
                    fontSize: 11.5,
                    fontWeight: 600,
                    gap: 5,
                  }}
                >
                  <CheckCircle2 aria-hidden="true" size={13} />
                  contrato completo
                </span>
              ) : (
                <span style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.4 }}>
                  {unidade.perfisNaVez.length > 0 ? (
                    <>
                      com <b style={{ color: T.text, fontWeight: 600 }}>
                        {unidade.perfisNaVez.join(" e ")}
                      </b>
                      {" · "}
                    </>
                  ) : null}
                  {rotuloDeEspera(unidade.enviadoEm)}
                </span>
              )}
            </div>
          </div>
        </div>
      </button>

      {/* *"no final dessa linha vai ter o contrato para ser baixado"*. Fora do <button> de
          propósito (link dentro de botão é HTML inválido) e "-" quando não há documento. */}
      <div className="asn-pdf">
        <BotaoDePdfDoContrato contrato={unidade.contrato} />
      </div>
    </div>
  );
}

/**
 * A barrinha de um perfil dentro do contrato: rótulo, trilha e fração.
 *
 * OS TRÊS ESTADOS, e por que só dois tons: completo enche em verde (o verde de concluído que o
 * portal já usa em "em dia" e "contrato completo"); o grupo DA VEZ enche na tinta do texto e traz
 * o rótulo em negrito, porque é ele que a linha existe para denunciar; quem ainda espera a vez
 * fica esmaecido. Cor por perfil viraria arco-íris com cinco barras lado a lado, e o dono pediu
 * explicitamente que não virasse.
 */
function BarraDoGrupo({ grupo }: { grupo: GrupoDaUnidade }) {
  const completo = grupo.assinadas >= grupo.total;
  const percentual = grupo.total > 0 ? (grupo.assinadas / grupo.total) * 100 : 0;
  const tinta = completo ? T.ok : grupo.naVez ? T.text : T.muted;

  return (
    <div className="asn-grupo" style={{ opacity: completo || grupo.naVez ? 1 : 0.6 }}>
      <div
        style={{
          color: grupo.naVez && !completo ? T.text : T.muted,
          fontSize: 10.5,
          fontWeight: grupo.naVez && !completo ? 700 : 500,
          letterSpacing: "0.02em",
          lineHeight: 1.3,
          marginBottom: 4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={grupo.perfil}
      >
        {grupo.perfil}
      </div>
      <div
        aria-hidden="true"
        style={{
          background: T.border,
          borderRadius: 999,
          height: 6,
          // O anel só no grupo da vez: é o destaque que faz a linha ler "falta o Incorporador".
          boxShadow: grupo.naVez && !completo ? `0 0 0 1.5px ${T.text}` : "none",
          overflow: "hidden",
        }}
      >
        <div style={{ background: tinta, height: "100%", width: `${percentual}%` }} />
      </div>
      <div
        style={{
          color: T.muted,
          fontSize: 10.5,
          fontVariantNumeric: "tabular-nums",
          marginTop: 3,
        }}
      >
        {inteiro(grupo.assinadas)} de {inteiro(grupo.total)}
      </div>
    </div>
  );
}

// ── O POPUP: OS DADOS DO CONTRATO E A TABELA DE ASSINATURA DELE ─────────────
// *"ao clicar nessa unidade abre um popup que mostra o esquema de assinatura, quem assinou, quem
// falta"*. Mesmo esqueleto do ModalDaProposta: clique fora fecha, Esc fecha, corpo rolável.
//
// ⚠️ O CABEÇALHO "DADOS DO CONTRATO" É DA FUSÃO de 18/08/2026: gerado em, valor, imobiliária e
// faturado em vieram da visão Contratos antiga, mais o botão do documento. Eles ficam ACIMA da
// tabela de assinatura, que continua sendo o corpo do popup.
//
// TABELA e não linha do tempo: o dono usou a palavra "tabela" duas vezes, e o dado a favorece —
// metade dos empreendimentos assina com a ordem DESLIGADA (todo mundo no degrau 0), e uma linha do
// tempo vertical desenharia uma sequência que ali não existe. A coluna Ordem só aparece quando o
// contrato tem ordem de verdade.
//
// SEM FETCH: o esquema já veio com a lista, na mesma resposta escopada da sessão. Popup que abre
// instantâneo em cima de dado que já está na mão é melhor do que uma chamada nova ao C2X por
// clique.

function ModalDoEsquema({
  onFechar,
  unidade,
}: {
  onFechar: () => void;
  unidade: UnidadeDeAssinatura;
}) {
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") onFechar();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  const percentual = unidade.total > 0 ? (unidade.assinadas / unidade.total) * 100 : 0;
  // Ordem de verdade = mais de um degrau no contrato. Com todos em 0 a coluna só repetiria zero.
  const temOrdem = new Set(unidade.esquema.map((item) => item.degrau)).size > 1;
  const sublinha = [unidade.comprador, unidade.empreendimento].filter(Boolean).join(" · ");
  const dados = unidade.contrato;

  return (
    <div
      style={{
        alignItems: "center",
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        inset: 0,
        justifyContent: "center",
        padding: 16,
        position: "fixed",
        zIndex: 60,
      }}
    >
      <button
        aria-label="Fechar"
        onClick={onFechar}
        style={{
          background: "transparent",
          border: "none",
          cursor: "default",
          inset: 0,
          position: "absolute",
        }}
        type="button"
      />
      <div
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 16,
          boxShadow: T.sombra,
          display: "flex",
          flexDirection: "column",
          maxHeight: "85vh",
          maxWidth: 620,
          overflow: "hidden",
          position: "relative",
          width: "100%",
          zIndex: 1,
        }}
      >
        <header
          style={{
            alignItems: "flex-start",
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            gap: 12,
            justifyContent: "space-between",
            padding: "14px 20px",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                alignItems: "center",
                color: T.text,
                display: "flex",
                fontSize: 14,
                fontWeight: 700,
                gap: 8,
                margin: 0,
              }}
            >
              <FileText aria-hidden="true" size={16} style={{ color: T.sub }} />
              Contrato · {unidade.unidade || "unidade sem nome"}
            </p>
            {sublinha ? (
              <p
                style={{
                  color: T.sub,
                  fontSize: 12,
                  margin: "2px 0 0",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {sublinha}
              </p>
            ) : null}
          </div>
          <button
            aria-label="Fechar"
            onClick={onFechar}
            style={{
              alignItems: "center",
              background: "transparent",
              border: "none",
              borderRadius: 8,
              color: T.muted,
              cursor: "pointer",
              display: "flex",
              flexShrink: 0,
              height: 32,
              justifyContent: "center",
              width: 32,
            }}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {/* ── OS DADOS DO CONTRATO (a visão Contratos antiga, inteira) ──────── */}
          <div style={{ borderBottom: `1px solid ${T.border}`, padding: "14px 20px" }}>
            <div
              style={{
                alignItems: "center",
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  color: T.muted,
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                Dados do contrato
              </span>
              <ChipDeAssinatura situacao={unidade.situacao} />
            </div>

            <div
              style={{
                display: "grid",
                gap: "12px 16px",
                gridTemplateColumns: "repeat(auto-fit, minmax(126px, 1fr))",
              }}
            >
              <FatoDoModal rotulo="Gerado em" valor={rotuloDaData(dados?.geradoEm ?? null) || "-"} />
              <FatoDoModal rotulo="Valor" valor={dados ? brl(dados.valorTabela) : "-"} />
              <FatoDoModal rotulo="Imobiliária" valor={dados?.imobiliaria ?? "-"} />
              {/* Por STRING: billing_date é DATE, e new Date mostraria a véspera. */}
              <FatoDoModal rotulo="Faturado em" valor={rotuloDeYmd(dados?.faturadoEm ?? null) || "-"} />
            </div>

            <div style={{ marginTop: 12 }}>
              <BotaoDePdfDoContrato contrato={unidade.contrato} largo />
            </div>
          </div>

          {/* ── O ANDAMENTO DA ASSINATURA ─────────────────────────────────────── */}
          {unidade.situacao === "aguardando-emissao" ? null : (
            <div style={{ borderBottom: `1px solid ${T.border}`, padding: "14px 20px" }}>
              <div
                style={{
                  alignItems: "baseline",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "2px 10px",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ color: T.text, fontSize: 13, fontWeight: 700 }}>
                  {inteiro(unidade.assinadas)} de {inteiro(unidade.total)} assinaturas
                </span>
                <span style={{ color: T.muted, fontSize: 12 }}>
                  enviado em {rotuloDeYmd(unidade.enviadoEm)} · {rotuloDeEspera(unidade.enviadoEm)}
                </span>
              </div>
              <div
                aria-hidden="true"
                style={{
                  background: T.border,
                  borderRadius: 999,
                  height: 6,
                  marginTop: 8,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    background: unidade.concluida ? T.ok : T.text,
                    height: "100%",
                    width: `${percentual}%`,
                  }}
                />
              </div>
            </div>
          )}

          {unidade.situacao === "aguardando-emissao" ? (
            <p style={{ color: T.muted, fontSize: 13, margin: 0, padding: 24, textAlign: "center" }}>
              O contrato foi gerado e ainda não saiu para assinatura. Quando ele for enviado, a
              tabela de assinatura aparece aqui.
            </p>
          ) : unidade.esquema.length === 0 ? (
            <p style={{ color: T.muted, fontSize: 13, margin: 0, padding: 24, textAlign: "center" }}>
              O contrato saiu para assinatura, mas nenhum assinante ficou registrado no envio. Não
              há de quem cobrar sem refazer o envio.
            </p>
          ) : (
            <div style={{ padding: "4px 10px 14px" }}>
              <table className="asn-tabela" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    {temOrdem ? <th style={{ textAlign: "left" }}>Ordem</th> : null}
                    <th style={{ textAlign: "left" }}>Assinante</th>
                    <th style={{ textAlign: "left" }}>Perfil</th>
                    <th style={{ textAlign: "left" }}>Situação</th>
                    <th style={{ textAlign: "right" }}>Assinou em</th>
                  </tr>
                </thead>
                <tbody>
                  {unidade.esquema.map((item, indice) => (
                    <tr key={`${item.nome}-${item.perfil}-${indice}`}>
                      {temOrdem ? (
                        <td
                          style={{
                            color: T.muted,
                            fontSize: 12.5,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {item.degrau || "—"}
                        </td>
                      ) : null}
                      <td style={{ color: T.text, fontSize: 13, fontWeight: 600 }}>{item.nome}</td>
                      <td style={{ color: T.sub, fontSize: 12.5 }}>{item.perfil}</td>
                      <td>
                        <SeloDaSituacao situacao={item.situacao} />
                      </td>
                      <td
                        style={{
                          color: T.sub,
                          fontSize: 12.5,
                          fontVariantNumeric: "tabular-nums",
                          textAlign: "right",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {rotuloDeYmd(item.assinadoEm) || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* A legenda some no contrato completo: ali não há vez nem espera para explicar. */}
              {unidade.concluida ? null : (
                <p style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.5, margin: "12px 10px 0" }}>
                  Quem está em <b>é a vez</b> pode assinar agora. Quem está em <b>aguardando</b> só
                  é chamado depois que os anteriores assinarem.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** O selo de situação do popup: verde para assinado, tinta forte para a vez, esmaecido para o resto. */
function SeloDaSituacao({ situacao }: { situacao: AssinaturaDoEsquema["situacao"] }) {
  const tom: CSSProperties =
    situacao === "assinado"
      ? { background: T.okBg, color: T.ok }
      : situacao === "vez"
        ? { background: T.soft, color: T.text }
        : { background: "transparent", color: T.muted };

  return (
    <span
      style={{
        ...tom,
        borderRadius: 999,
        display: "inline-block",
        fontSize: 11.5,
        fontWeight: situacao === "aguardando" ? 500 : 600,
        padding: "3px 9px",
        whiteSpace: "nowrap",
      }}
    >
      {situacao === "assinado" ? "Assinou" : situacao === "vez" ? "É a vez" : "Aguardando"}
    </span>
  );
}

// ── A FILA, DEGRAU A DEGRAU (porte do painel interno) ───────────────────────
//
// ⚠️ ELA SÓ APARECE QUANDO O RECORTE TEM ORDEM DE VERDADE. O servidor devolve a fila vazia quando
// todo mundo está no degrau 0 — medido no C2X em 18/08/2026, é o caso do Vista Alegre e de duas
// glebas da Lagoa Bonita, onde a ordem está desligada e todos assinam em paralelo.
//
// ⚠️ O NOME DO DEGRAU É DERIVADO DOS PERFIS que assinam nele, e não da tabela fixa do painel
// interno (1 Corretor/imobiliária, 2 Comprador e cônjuge, 3 Testemunhas…). Aquela tabela descreve
// o Vale do Ouro: no LBR a ordem 3 é da Imobiliária e a 4 do Comprador, então copiá-la escreveria
// "Testemunhas" onde está a imobiliária do cliente. Rótulo derivado do dado não mente.

function SecaoDaFila({ fila }: { fila: DadosAssinaturas["fila"] }) {
  return (
    <section style={cartao}>
      <h2 style={titulo}>A fila, degrau a degrau</h2>
      <p style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.5, margin: "6px 0 14px" }}>
        Quem está num degrau só é chamado depois que todos os anteriores assinarem.
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        {fila.map((degrau) => {
          const percentual = degrau.total > 0 ? (100 * degrau.assinadas) / degrau.total : 0;

          return (
            <div
              key={degrau.degrau}
              style={{
                alignItems: "center",
                display: "grid",
                gap: 10,
                gridTemplateColumns: "minmax(96px, 132px) 1fr 42px",
              }}
            >
              <span style={{ color: T.text, fontSize: 12, minWidth: 0 }}>
                {degrau.degrau}. {degrau.perfis.join(", ") || "sem perfil"}
                <span style={{ color: T.muted, display: "block", fontSize: 11 }}>
                  {inteiro(degrau.assinadas)} de {inteiro(degrau.total)}
                </span>
              </span>
              <span
                style={{
                  background: T.border,
                  borderRadius: 999,
                  display: "block",
                  height: 14,
                  overflow: "hidden",
                }}
              >
                <i
                  style={{
                    background: percentual >= 100 ? T.ok : T.text,
                    display: "block",
                    height: "100%",
                    width: `${percentual}%`,
                  }}
                />
              </span>
              <span
                style={{
                  color: T.sub,
                  fontSize: 12,
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "right",
                }}
              >
                {Math.round(percentual)}%
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── O QUADRO POR ASSINANTE (o quadro do painel interno, com os números clicáveis) ─
//
// Vira APOIO, e não palco: a pergunta principal da tela agora é por unidade. O que ele mantém do
// painel do Lucas é o que faz dele útil — as três colunas (assinado, assinar, aguardando) e o
// CLIQUE no número, que joga a lista de unidades naquele recorte.
//
// ⚠️ "ASSINAR" SÓ CONTA O QUE ESTÁ COM A PESSOA. A fila é ordenada, e somar tudo que ela não
// assinou dava um número que ela não tem como resolver: no painel interno o Northon aparecia com
// 181 pendências quando só 2 estavam de fato na vez dele. A regra vem do servidor (`marcarSituacao`).

function QuadroDeAssinantes({
  assinantes,
  onFiltrar,
  selecionado,
}: {
  assinantes: AssinanteDaTela[];
  onFiltrar: (filtro: FiltroDeAssinante) => void;
  selecionado: FiltroDeAssinante | null;
}) {
  const [busca, setBusca] = useState("");

  if (assinantes.length === 0) {
    return (
      <section style={cartao}>
        <h2 style={titulo}>Quadro por assinante</h2>
        <p style={{ color: T.muted, fontSize: 13, margin: "16px 0 4px", textAlign: "center" }}>
          Nenhum assinante registrado nos contratos deste recorte.
        </p>
      </section>
    );
  }

  const alvo = busca.trim().toLowerCase();
  const lista = [...assinantes]
    .filter((assinante) => (alvo ? assinante.nome.toLowerCase().includes(alvo) : true))
    .sort(
      (a, b) => b.naVez - a.naVez || b.assinou - a.assinou || a.nome.localeCompare(b.nome, "pt-BR"),
    );

  return (
    <section style={cartao}>
      <div
        style={{
          alignItems: "baseline",
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 10px",
          justifyContent: "space-between",
        }}
      >
        <h2 style={titulo}>Quadro por assinante</h2>
        <span style={{ color: T.muted, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
          {inteiro(assinantes.length)} {assinantes.length === 1 ? "pessoa" : "pessoas"}
        </span>
      </div>
      <p style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.5, margin: "6px 0 12px" }}>
        Clique num número para ver quais unidades ele representa. Assinar é o que está com a pessoa
        agora; aguardando é o que ainda depende de quem assina antes dela.
      </p>

      <label
        style={{
          alignItems: "center",
          background: T.soft,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          display: "flex",
          gap: 8,
          marginBottom: 12,
          maxWidth: 280,
          padding: "0 12px",
        }}
      >
        <Search aria-hidden="true" size={15} style={{ color: T.muted, flexShrink: 0 }} />
        <input
          onChange={(evento) => setBusca(evento.target.value)}
          placeholder="Buscar assinante pelo nome"
          style={{
            background: "transparent",
            border: "none",
            color: T.text,
            flex: 1,
            fontFamily: fonte,
            fontSize: 13.5,
            minWidth: 0,
            outline: "none",
            padding: "8px 0",
          }}
          value={busca}
        />
      </label>

      {lista.length === 0 ? (
        <p style={{ color: T.muted, fontSize: 13, margin: "18px 0 6px", textAlign: "center" }}>
          Nenhum assinante com esse nome neste recorte.
        </p>
      ) : (
        <div className="asn-rolagem">
          <table className="asn-tabela">
            <thead>
              <tr>
                {["Assinante", "Assinado", "Assinar", "Aguardando"].map((coluna) => (
                  <th key={coluna} style={{ textAlign: coluna === "Assinante" ? "left" : "right" }}>
                    {coluna}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.map((assinante) => (
                <tr key={`${assinante.nome}-${assinante.papel ?? ""}`}>
                  <td style={{ color: T.text, fontSize: 13, fontWeight: 600 }}>
                    {assinante.nome}
                    {assinante.papel ? (
                      <span style={{ color: T.muted, fontWeight: 500 }}> · {assinante.papel}</span>
                    ) : null}
                  </td>
                  <NumeroClicavel
                    aoClicar={() => onFiltrar({ alvo: "assinado", nome: assinante.nome })}
                    ativo={selecionado?.alvo === "assinado" && selecionado.nome === assinante.nome}
                    titulo={`Contratos que ${assinante.nome} já assinou`}
                    valor={assinante.assinou}
                  />
                  <NumeroClicavel
                    aoClicar={() => onFiltrar({ alvo: "vez", nome: assinante.nome })}
                    ativo={selecionado?.alvo === "vez" && selecionado.nome === assinante.nome}
                    destaque
                    titulo={`Contratos esperando a assinatura de ${assinante.nome} agora`}
                    valor={assinante.naVez}
                  />
                  <NumeroClicavel
                    aoClicar={() => onFiltrar({ alvo: "aguardando", nome: assinante.nome })}
                    ativo={
                      selecionado?.alvo === "aguardando" && selecionado.nome === assinante.nome
                    }
                    titulo={`Contratos em que ${assinante.nome} ainda depende de outra assinatura`}
                    valor={assinante.aguardandoAnteriores}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Um número do quadro que joga a lista de unidades naquele recorte.
 *
 * ⚠️ ZERO NÃO VIRA BOTÃO (a regra é a do painel interno): clicar num zero levaria a uma lista
 * vazia, e lista vazia depois de um clique parece tela quebrada. O zero fica esmaecido.
 */
function NumeroClicavel({
  aoClicar,
  ativo,
  destaque,
  titulo: dica,
  valor,
}: {
  aoClicar: () => void;
  ativo: boolean;
  destaque?: boolean;
  titulo: string;
  valor: number;
}) {
  if (valor === 0) {
    return <NumeroDaColuna valor={0} />;
  }

  return (
    <td style={{ textAlign: "right" }}>
      <button
        onClick={aoClicar}
        style={{
          background: ativo ? T.btnBg : "transparent",
          border: "none",
          borderRadius: 7,
          color: ativo ? T.btnFg : T.text,
          cursor: "pointer",
          fontFamily: fonte,
          fontSize: 13,
          fontVariantNumeric: "tabular-nums",
          fontWeight: destaque ? 700 : 500,
          padding: "3px 8px",
          textDecoration: ativo ? "none" : "underline dotted",
          textUnderlineOffset: 3,
        }}
        title={dica}
        type="button"
      >
        {inteiro(valor)}
      </button>
    </td>
  );
}

/**
 * Uma célula de número do quadro: tabular-nums para as casas alinharem e ZERO esmaecido, para o
 * olho pular direto no que tem número.
 */
function NumeroDaColuna({ valor }: { valor: number }) {
  const zero = valor === 0;

  return (
    <td
      style={{
        color: zero ? T.muted : T.text,
        fontSize: 13,
        fontVariantNumeric: "tabular-nums",
        opacity: zero ? 0.55 : 1,
        textAlign: "right",
        whiteSpace: "nowrap",
      }}
    >
      {inteiro(valor)}
    </td>
  );
}

/**
 * O ESQUELETO DA ESPERA — o carregamento que o resto do Panteon já usa (`animate-pulse` sobre
 * blocos do tamanho do que vem), trazido para cá a pedido do dono em 18/08/2026.
 *
 * ⚠️ POR QUE NÃO A FRASE "Carregando…". Uma linha de texto centralizada não diz quanto falta nem
 * o que vem, e numa tela que demorava perto de 12 s parecia sistema travado. O bloco no formato do
 * conteúdo mostra a página se montando e dá a leitura certa do que está por vir.
 *
 * As cores saem dos tokens do PORTAL (`T.card`, `T.border`), não das classes utilitárias de cor do
 * hub: o portal tem tema próprio e claro/escuro, e cor emprestada de outro tema acerta num e erra
 * no outro. Do Tailwind vem só a animação, que é neutra.
 */
function EsqueletoDaTela({ blocos = 4, cards = 4 }: { blocos?: number; cards?: number }) {
  const pele: CSSProperties = {
    animationDuration: "1.6s",
    background: T.card,
    border: `1px solid ${T.border}`,
    borderRadius: 14,
  };

  return (
    <div aria-busy="true" aria-live="polite" style={{ display: "grid", gap: 12 }}>
      <span style={{ height: 0, overflow: "hidden", position: "absolute", width: 0 }}>
        Carregando
      </span>
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: `repeat(auto-fit, minmax(190px, 1fr))`,
        }}
      >
        {Array.from({ length: cards }).map((_, indice) => (
          <div className="animate-pulse" key={indice} style={{ ...pele, height: 92 }} />
        ))}
      </div>
      {Array.from({ length: blocos }).map((_, indice) => (
        <div
          className="animate-pulse"
          key={indice}
          style={{ ...pele, height: indice === 0 ? 220 : 56 }}
        />
      ))}
    </div>
  );
}

function Aviso({ texto, tom }: { texto: string; tom?: "erro" }) {
  return (
    <div
      style={{
        background: tom === "erro" ? T.dangerBg : T.card,
        border: `1px ${tom === "erro" ? "solid" : "dashed"} ${tom === "erro" ? T.danger : T.border}`,
        borderRadius: 14,
        color: tom === "erro" ? T.danger : T.muted,
        fontSize: 14,
        padding: 40,
        textAlign: "center",
      }}
    >
      {texto}
    </div>
  );
}

// ── RESUMO: os totais dos contratos, em cards ────────────────────────────────
//
// A sub-aba Resumo da tela Contratos. Lê o MESMO payload da Assinatura (o Map do cache é o mesmo,
// vindo da TelaContratos): nenhuma chamada a mais para mostrar o que a lista já sabe.
//
// OS CARDS SÃO OS DA FICHA DO PRODUTO (a faixa do processo em hercules/ResumoDoProduto): rótulo
// em caixa alta com o ícone à direita, o número grande, uma linha de apoio embaixo e a borda
// esquerda mais grossa — só que em estilo inline com os tokens `T`, porque aqui não há a moldura
// Tailwind (ver o cabeçalho do arquivo). Verde só no que está CONCLUÍDO (assinado, faturado); o
// resto é monocromático — dourado não é estado.
//
// ⚠️ OS TOTAIS SAEM DAS LINHAS, não dos `kpis`: os kpis do painel contam UNIDADES com envio
// (comprador ok/pendente, finalizadas), e o que o Lucas pediu aqui é a contagem de CONTRATOS por
// situação — que é a `situacao` de cada linha da lista, a mesma régua do chip da Assinatura.
// Quando a lista vem cortada no teto, o `aviso` diz, e os números são do que veio.
//
// ⚠️ O "EMPREENDIMENTO" DA LINHA É O CÓDIGO (VAL, LBR…), não o nome: é o que o payload traz, e é
// o que a Assinatura já mostra ao lado da unidade quando o recorte tem mais de um. A tabela "Por
// empreendimento" só aparece nesse caso (na ficha do produto seria uma linha só, repetindo os
// cards).

const CSS_RESUMO_DE_CONTRATOS = `
  .ctr-cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(164px, 1fr)); }
`;

type TotaisDeContratos = {
  aguardandoEmissao: number;
  assinados: number;
  contratos: number;
  emAssinatura: number;
  faturados: number;
};

/** Conta os contratos por situação (a régua do chip) e os faturados (billing_date preenchido). */
function totaisDe(unidades: UnidadeDeAssinatura[]): TotaisDeContratos {
  const totais: TotaisDeContratos = {
    aguardandoEmissao: 0,
    assinados: 0,
    contratos: unidades.length,
    emAssinatura: 0,
    faturados: 0,
  };

  for (const unidade of unidades) {
    if (unidade.situacao === "assinado") totais.assinados += 1;
    else if (unidade.situacao === "em-assinatura") totais.emAssinatura += 1;
    else totais.aguardandoEmissao += 1;

    if (unidade.contrato?.faturadoEm) totais.faturados += 1;
  }

  return totais;
}

/** Os mesmos totais, um empreendimento por linha, do que tem mais contratos para o que tem menos. */
function totaisPorEmpreendimento(
  unidades: UnidadeDeAssinatura[],
): { empreendimento: string; totais: TotaisDeContratos }[] {
  const grupos = new Map<string, UnidadeDeAssinatura[]>();

  for (const unidade of unidades) {
    const chave = unidade.empreendimento || "—";
    const lista = grupos.get(chave);
    if (lista) lista.push(unidade);
    else grupos.set(chave, [unidade]);
  }

  return [...grupos.entries()]
    .map(([empreendimento, lista]) => ({ empreendimento, totais: totaisDe(lista) }))
    .sort(
      (a, b) =>
        b.totais.contratos - a.totais.contratos ||
        a.empreendimento.localeCompare(b.empreendimento, "pt-BR"),
    );
}

const COLUNAS_POR_EMPREENDIMENTO = [
  "Empreendimento",
  "Contratos",
  "Assinados",
  "Em assinatura",
  "Aguardando emissão",
  "Faturados",
];

export function ResumoDeContratos({
  cache,
  emp,
}: {
  /** O Map de quem monta (a TelaContratos divide o dela entre Resumo e Assinatura). */
  cache?: CacheDeAssinaturas;
  /** "pai:<uuid>" do cadastro ou id do C2X; ausente = tudo o que a sessão autoriza. */
  emp?: string;
}) {
  const mapa = useCacheDeAssinaturas(cache);
  const estado = useDadosDaVisao(
    ROTA_DE_ASSINATURAS,
    emp ?? null,
    mapa,
    "Não foi possível carregar o resumo dos contratos.",
  );

  if (estado.tipo === "carregando") return <EsqueletoDaTela blocos={1} cards={6} />;
  if (estado.tipo === "erro") return <Aviso texto={estado.mensagem} tom="erro" />;

  const { aviso, avisoDaFonte, kpis, unidades } = estado.dados;

  if (unidades.length === 0 && kpis.aguardandoEmissao === 0) {
    return <Aviso texto="Nenhuma venda deste recorte chegou à etapa de contrato ainda." />;
  }

  const totais = totaisDe(unidades);
  const porEmpreendimento = totaisPorEmpreendimento(unidades);
  const parteDosContratos = (parte: number): string =>
    `${porcentagem(parte, totais.contratos)} dos contratos`;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* A grade dos cards precisa de media query (auto-fit), e estilo inline não responde a
          ela — mesma razão do CSS_ASSINATURAS, que a tabela abaixo reaproveita. */}
      <style>{CSS_ASSINATURAS}</style>
      <style>{CSS_RESUMO_DE_CONTRATOS}</style>

      <FaixaDaFonte fonte={avisoDaFonte} />

      {/* ── OS TOTAIS ───────────────────────────────────────────────────────── */}
      <div className="ctr-cards">
        <CardDoResumo
          icone={FileText}
          rotulo="Contratos"
          subtexto={
            porEmpreendimento.length > 1
              ? `em ${inteiro(porEmpreendimento.length)} empreendimentos`
              : "gerados neste produto"
          }
          valor={inteiro(totais.contratos)}
        />
        <CardDoResumo
          cor={T.ok}
          icone={CheckCircle2}
          rotulo="Assinados"
          subtexto={parteDosContratos(totais.assinados)}
          valor={inteiro(totais.assinados)}
        />
        <CardDoResumo
          icone={PenLine}
          rotulo="Em assinatura"
          subtexto={
            totais.emAssinatura === 0
              ? "nenhum esperando assinatura"
              : kpis.compradorEmAtraso > 0
                ? `${inteiro(kpis.compradorEmAtraso)} com o comprador em atraso`
                : `${inteiro(kpis.compradorPendente)} aguardam o comprador`
          }
          valor={inteiro(totais.emAssinatura)}
        />
        <CardDoResumo
          cor={T.muted}
          icone={Clock}
          rotulo="Aguardando emissão"
          subtexto="gerados, ainda sem envio"
          valor={inteiro(totais.aguardandoEmissao)}
        />
        <CardDoResumo
          cor={T.ok}
          icone={BadgeDollarSign}
          rotulo="Faturados"
          subtexto={parteDosContratos(totais.faturados)}
          valor={inteiro(totais.faturados)}
        />
        <CardDoResumo
          icone={Timer}
          rotulo="Tempo médio"
          subtexto="dias da geração à última assinatura"
          valor={numeroOuTraco(kpis.tempoMedioDias)}
        />
      </div>

      {/* ── POR EMPREENDIMENTO (só na tela do menu, com mais de um) ─────────── */}
      {porEmpreendimento.length > 1 ? (
        <section style={cartao}>
          <div
            style={{
              alignItems: "baseline",
              display: "flex",
              flexWrap: "wrap",
              gap: "4px 10px",
              justifyContent: "space-between",
            }}
          >
            <h2 style={titulo}>Por empreendimento</h2>
            <span style={{ color: T.muted, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
              {inteiro(porEmpreendimento.length)} empreendimentos
            </span>
          </div>
          <p style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.5, margin: "6px 0 12px" }}>
            Os mesmos totais, um empreendimento por linha. A situação e a lista de cada contrato
            estão na sub-aba Assinatura.
          </p>
          <div className="asn-rolagem">
            <table className="asn-tabela">
              <thead>
                <tr>
                  {COLUNAS_POR_EMPREENDIMENTO.map((coluna, indice) => (
                    <th key={coluna} style={{ textAlign: indice === 0 ? "left" : "right" }}>
                      {coluna}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {porEmpreendimento.map(({ empreendimento, totais: linha }) => (
                  <tr key={empreendimento}>
                    <td style={{ color: T.text, fontSize: 13, fontWeight: 600 }}>
                      {empreendimento}
                    </td>
                    <NumeroDaColuna valor={linha.contratos} />
                    <NumeroDaColuna valor={linha.assinados} />
                    <NumeroDaColuna valor={linha.emAssinatura} />
                    <NumeroDaColuna valor={linha.aguardandoEmissao} />
                    <NumeroDaColuna valor={linha.faturados} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {aviso ? (
        <p style={{ color: T.muted, fontSize: 12, lineHeight: 1.5, margin: 0 }}>{aviso}</p>
      ) : null}
    </div>
  );
}

/**
 * Um card do resumo, no desenho dos blocos da faixa do processo da ficha (ResumoDoProduto):
 * rótulo em caixa alta + ícone, número grande, apoio embaixo e a borda esquerda de 4px. A `cor`
 * é só da borda — o número fica na tinta do texto, como lá.
 */
function CardDoResumo({
  cor,
  icone: Icone,
  rotulo,
  subtexto,
  valor,
}: {
  cor?: string;
  icone: LucideIcon;
  rotulo: string;
  subtexto: string;
  valor: string;
}) {
  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderLeft: `4px solid ${cor ?? T.text}`,
        borderRadius: 12,
        minWidth: 0,
        padding: "12px 14px",
      }}
    >
      <div style={{ alignItems: "center", display: "flex", gap: 8, justifyContent: "space-between" }}>
        <span
          style={{
            color: T.muted,
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: "0.05em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {rotulo}
        </span>
        <Icone aria-hidden="true" size={14} style={{ color: T.muted, flexShrink: 0 }} />
      </div>
      <p
        style={{
          color: T.text,
          fontSize: 24,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
          lineHeight: 1,
          margin: "8px 0 0",
        }}
      >
        {valor}
      </p>
      <p
        style={{
          color: T.sub,
          fontSize: 11,
          lineHeight: 1.4,
          margin: "6px 0 0",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={subtexto}
      >
        {subtexto}
      </p>
    </div>
  );
}
