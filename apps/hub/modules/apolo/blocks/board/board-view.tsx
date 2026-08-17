"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Check,
  CloudOff,
  CreditCard,
  ExternalLink,
  FileCheck2,
  LayoutGrid,
  List,
  AlertTriangle,
  Info,
  ListOrdered,
  Loader2,
  MessageSquare,
  QrCode,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  destinoEhProducao,
  foraDoC2x,
  HOST_C2X_PRODUCAO,
  rotuloBotaoC2x,
  type ResultadoSubidaC2x,
} from "@/lib/apolo/c2x-envio-card";
import {
  C2X_ESCOLARIDADE,
  C2X_ESTADO_CIVIL,
  C2X_FAIXA_RENDA,
  C2X_REGIME_BENS,
  C2X_SEXO,
  calcIdade,
  formatDateBR,
  titleCase,
} from "@/lib/apolo/c2x-fields";
import { C2X_PROFISSOES } from "@/lib/apolo/c2x-professions";
import { toTitleCase } from "@/lib/format/name-case";

import { expandirCamposComCaminho } from "@/lib/apolo/campos-aninhados";
import { formatarTelefoneBR } from "@/lib/format/phone-br";

import { buscarEnderecoPorCep } from "../../lib/cep";

import { CreditoSerasa } from "./credito-serasa";
import { StatusPixPrevenda } from "./status-pix";

import { getApoloAccessToken } from "../../data/apolo-operations";

import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

// Tela de trabalho do operador: a ESTEIRA de credenciamento (Lucas 18/jul).
// A imobiliária e a CAD percorrem caminhos diferentes:
//   imobiliária -> valida cadastro -> valida corretores -> apta a enviar CADs
//   CAD         -> valida cadastro -> crédito (Serasa) -> PIX da pré-venda -> fila do Prometeu
//
// ⚠️ PRIMEIRA VERSÃO = ESQUELETO NAVEGÁVEL (decisão do Lucas): a fila é real (entidades em
// review), mas as AÇÕES não gravam — servem pra validar o layout antes de ligar a lógica.
// Ver [[project_esteira_credenciamento_venda]].

type ItemFila = {
  // Analista responsável salvo no banco (metadata.esteira.analistaId).
  analistaId?: string | null;
  // Motivo da recusa do C2X (coluna `erro` de apolo_c2x_sync), para o tooltip do alerta.
  c2xErro?: string | null;
  // A CAD NÃO está confirmada no C2X. Quem decide é o servidor (lib/apolo/c2x-alerta-board.ts):
  //   'erro'            -> a API recusou (motivo em `c2xErro`).
  //   'sem_confirmacao' -> respondeu sucesso mas o cadastro não apareceu no banco do C2X.
  //   'nunca_enviado'   -> credenciado no Apolo e nunca chegou a ser enviado (não gerou nem linha
  //                        na fila apolo_c2x_sync; era o caso que ficava em silêncio total).
  // Null = está no C2X ou ainda não é hora de cobrar, e o card não mostra nada.
  c2xFalha?: string | null;
  // Corretor e imobiliária vindos da CAD importada (o cadastro do wizard usa outros campos).
  corretor?: string | null;
  corretores: number;
  criadoEm: string;
  documento: string;
  imobiliaria?: string | null;
  // Nomes dos empreendimentos a que o item se refere (eixo de filtro/ordenação do Board).
  empreendimentos: string[];
  // De QUAL CAD é este card. A esteira é `(entity_id, enterprise_id)` desde a migration 0080:
  // a mesma pessoa pode ter uma CAD por empreendimento. O card continua sendo por PESSOA (o `id`
  // é o entityId), mas as AÇÕES precisam dizer em qual CAD estão mexendo — senão a etapa iria
  // parar na CAD que a pessoa tem em outro loteamento.
  enterpriseId?: string | null;
  // Etapa PERSISTIDA (metadata.esteira.etapa). É o ponto de partida do item na tela: quem foi
  // importado do Asana como credenciado precisa nascer na coluna certa, não em Validação.
  etapa?: string | null;
  // Algum envio da pré-venda falhou. Só quem falhou é marcado: se todo card ganhasse um ícone de
  // status, o problema deixaria de saltar aos olhos.
  erroEnvio?: boolean;
  id: string;
  nome: string;
  // PIX da pré-venda confirmado (hora do nosso carimbo). Null = enviamos a cobrança mas ainda
  // não caiu. É o que separa, dentro de "Credenciado", quem pagou de quem só recebeu o PIX.
  pagoEm?: string | null;
  papel: string;
  // Status do papel `imobiliaria` (blocked | active | review). É a ETAPA dela: imobiliária não
  // tem linha na esteira, então a coluna do Board sai daqui e não de `etapa`.
  papelStatus?: null | string;
  // Status da ENTIDADE. `attention` = imobiliária em correção — o CHECK do papel não tem esse
  // valor, então essa metade do estado mora aqui.
  entidadeStatus?: null | string;
  // A etapa Pré-venda EXISTE para esta CAD? Vem do empreendimento (`prevenda_habilitada` +
  // `valor_pix`), decidido no servidor. Regra do Lucas (10/08): "pré-venda só existe se estiver
  // habilitado" — onde ela está desligada, a etapa não aparece na trilha nem no kanban, em vez de
  // aparecer e só ser barrada na hora de gravar.
  prevendaHabilitada?: boolean;
  // Não há linha em `apolo_esteira` para esta ficha: ela não tem etapa nem empreendimento. É por
  // isso que ela reaparece em Validação a cada recarga, mesmo com a análise de crédito já feita.
  semCad?: boolean;
  socios: number;
};

// A etapa salva é texto; o Board trabalha com índice em ETAPAS_CAD. Esta é a ponte.
// Os DESVIOS do crédito (revisão, indeferido) abrem NA Análise de crédito: quem está em revisão
// precisa ver a análise que reprovou, não voltar pra Validação. Correção é devolução da validação.
// `credenciado` = 4 (e não 3) DE PROPÓSITO: é o último estágio da esteira, então a ficha entra
// como CONCLUÍDA — todas as bolinhas ficam verdes, aparece o selo "Credenciado" e some o botão de
// avançar (não há pra onde ir depois). Com 3 ela ficava como "etapa atual", cinza e pedindo ação.
// A etapa salva é texto; a trilha do item é uma LISTA (`etapasDoItem`) cujo tamanho MUDA por
// empreendimento — onde a pré-venda está desligada ela tem um passo a menos. Por isso a ponte é
// uma função que olha a lista do item, e não a tabela fixa de números que existia aqui: assim que a
// lista encolheu, o número 2 ("Pré-venda") passaria a apontar para Credenciado.
const PASSO_DA_ETAPA: Record<string, string> = {
  cadastro: "cadastro",
  correcao: "cadastro",
  credenciado: "credenciado",
  credito: "credito",
  // Os DESVIOS do crédito (revisão, indeferido) abrem NA Análise de crédito: quem está em revisão
  // precisa ver a análise que reprovou, não voltar para a Validação.
  indeferido: "credito",
  prevenda: "prevenda",
  revisao: "credito",
  validacao: "cadastro",
};

// Posição do item na trilha DELE. `undefined` = etapa desconhecida, e aí nada se move.
//
// `credenciado` vale `etapas.length` (e não a posição dele na lista) DE PROPÓSITO: é o último
// estágio, então a ficha entra como CONCLUÍDA — bolinhas todas verdes, selo "Credenciado", sem
// botão de avançar. Com a posição, ela ficaria como "etapa atual", cinza e pedindo ação.
function indiceDaEtapa(item: ItemFila, etapa: null | string | undefined): number | undefined {
  if (!etapa) return undefined;
  const passo = PASSO_DA_ETAPA[etapa];
  if (!passo) return undefined;

  const etapas = etapasDoItem(item);
  if (passo === "credenciado") return etapas.length;

  const posicao = etapas.findIndex((e) => e.id === passo);
  if (posicao >= 0) return posicao;

  // Chegou aqui = resíduo em "prevenda" num empreendimento que não tem pré-venda. O servidor
  // manda essa ficha para credenciado (esteira.ts); a tela mostra o mesmo, em vez de inventar
  // uma posição para uma etapa que não existe mais.
  return etapas.length;
}

// Data e hora de chegada: é o carimbo que ordena a fila de trabalho.
function chegadaEm(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// "há 3 dias" — o que importa na triagem é há quanto tempo o item espera.
function esperaDesde(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const dias = Math.floor(ms / 86_400_000);
  if (dias >= 1) return `${dias} dia${dias > 1 ? "s" : ""}`;
  const horas = Math.floor(ms / 3_600_000);
  if (horas >= 1) return `${horas}h`;
  return "agora";
}

type Etapa = {
  descricao: string;
  icon: LucideIcon;
  id: string;
  label: string;
};

// ⚠️ São DOIS processos diferentes (Lucas): a imobiliária é credenciada pra ENVIAR CADs (não
// passa por crédito nem paga pré-venda); a CAD é o cliente comprando.
const ETAPAS_CAD: Etapa[] = [
  {
    descricao: "Confira os dados e os documentos originais lado a lado.",
    icon: FileCheck2,
    id: "cadastro",
    label: "Validação",
  },
  {
    descricao: "Consulta ao Serasa: score, negativações e protestos.",
    icon: CreditCard,
    id: "credito",
    label: "Análise de crédito",
  },
  {
    descricao: "Cobrança de R$ 1.000 (PIX ou boleto) para garantir a pré-venda.",
    icon: QrCode,
    id: "prevenda",
    label: "Pré-venda",
  },
  {
    descricao: "Credenciado: entra na fila do lançamento pela ordem de pagamento.",
    icon: ListOrdered,
    id: "credenciado",
    label: "Credenciado",
  },
];

const ETAPAS_IMOBILIARIA: Etapa[] = [
  {
    descricao:
      "Confira empresa, contrato social, sócios e os corretores vinculados, com os documentos ao lado.",
    icon: FileCheck2,
    id: "cadastro",
    label: "Validação",
  },
  {
    descricao: "Imobiliária habilitada a enviar CADs nos empreendimentos liberados.",
    icon: ShieldCheck,
    id: "habilitada",
    label: "Habilitada",
  },
];

// ⚠️ A TRILHA DA CAD NÃO É FIXA: a Pré-venda é uma etapa DO EMPREENDIMENTO, não do processo.
// Onde a cobrança de R$ 1.000 está desligada, ela não existe — e mostrar a bolinha assim mesmo é o
// que faz o cliente "cair em pré-venda" na tela de um lançamento que não cobra nada (Lucas, 10/08).
// O servidor decide (`prevendaHabilitada` do card, fail-closed); aqui só se obedece.
const etapasDoItem = (item: ItemFila): Etapa[] => {
  if (item.papel === "imobiliaria") return ETAPAS_IMOBILIARIA;
  return item.prevendaHabilitada ? ETAPAS_CAD : ETAPAS_CAD.filter((e) => e.id !== "prevenda");
};

type Analista = { id: string; nome: string };

// Registro do que aconteceu com o item, desde a chegada (regra do Lucas: histórico de tudo).
type EventoHistorico = {
  autor: string;
  em: string;
  id: string;
  texto: string;
  tipo: "aprovacao" | "chegada" | "etapa" | "nota" | "sistema";
};

type Mensagem = { autor: string; em: string; id: string; texto: string };

export function BoardView({
  onOpenEntity,
}: {
  // Abre a ficha do cliente no CRM do Apolo (mesma navegação dos relacionamentos). Vem do
  // ApoloPage (openEntityInCrm): busca por nome e seleciona pela id certa.
  onOpenEntity?: (name: string, entityId: string) => void;
} = {}) {
  const [itens, setItens] = useState<ItemFila[]>([]);
  const [analistas, setAnalistas] = useState<Analista[]>([]);
  // Lista canônica de empreendimentos, vinda do servidor. Ver `empreendimentosDisponiveis`.
  const [catalogoEmpreendimentos, setCatalogoEmpreendimentos] = useState<string[]>([]);
  const [usuarioAtual, setUsuarioAtual] = useState<Analista | null>(null);
  // Quem está analisando cada item. Local por enquanto (a atribuição real entra com a gravação).
  const [analistaPorItem, setAnalistaPorItem] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<"todos" | "imobiliaria" | "prospect">("todos");
  const [selecionado, setSelecionado] = useState<ItemFila | null>(null);
  // Abre no KANBAN: é a leitura que mostra de cara onde a fila está parada (quantos em cada
  // etapa). A tabela continua a um clique, no alternador do cabeçalho.
  const [visao, setVisao] = useState<"kanban" | "tabela">("kanban");
  const [busca, setBusca] = useState("");
  const [empreendimento, setEmpreendimento] = useState("todos");
  const [ordem, setOrdem] = useState<"antigos" | "nome" | "recentes">("antigos");
  // Filtro por etapa: com centenas de itens na fila, ver só uma coluna por vez é o que torna
  // a lista utilizável.
  const [etapaFiltro, setEtapaFiltro] = useState("todas");
  // Dentro de "Credenciado" convivem quem já pagou o PIX e quem só recebeu a cobrança. Este
  // filtro é o que separa os dois na hora de cobrar quem falta.
  const [pagoFiltro, setPagoFiltro] = useState<"pagos" | "pendentes" | "todos">("todos");
  // Isolar as fichas cujo envio falhou — o chip só existe quando há alguma.
  const [soErros, setSoErros] = useState(false);
  // Ordenação clicando no cabeçalho. `null` = usa a ordem escolhida no seletor.
  const [colunaOrdem, setColunaOrdem] = useState<{
    campo: "chegada" | "documento" | "empreendimento" | "etapa" | "nome";
    desc: boolean;
  } | null>(null);
  // Só no esqueleto: guarda em que etapa o operador "avançou" cada item (não persiste).
  const [progresso, setProgresso] = useState<Record<string, number>>({});
  // Popup do chat/histórico: nasce fechado, abre pelo botão.
  const [painelAberto, setPainelAberto] = useState(false);
  // Análises INDEFERIDAS (recusadas). Diferente de "em correção", que volta pra ajuste.
  const [indeferidos, setIndeferidos] = useState<Record<string, boolean>>({});
  // Escalados pro coordenador: ele pode aprovar um crédito que o analista barraria.
  const [emRevisao, setEmRevisao] = useState<Record<string, boolean>>({});
  // Devolvidos pro corretor ajustar. Sempre com o motivo registrado.
  const [emCorrecao, setEmCorrecao] = useState<Record<string, boolean>>({});
  // Popup de motivo: recusar e mandar pra correção exigem justificativa.
  const [modalMotivo, setModalMotivo] = useState<"correcao" | "indeferir" | null>(null);
  // PROBLEMA 3 (Lucas, 04/08): modal do override da coordenação (aprovar com restrição + evidência).
  const [modalRestricao, setModalRestricao] = useState(false);
  // Histórico e conversa interna por item (locais nesta versão).
  const [eventos, setEventos] = useState<Record<string, EventoHistorico[]>>({});
  const [mensagens, setMensagens] = useState<Record<string, Mensagem[]>>({});

  const agora = () => new Date().toISOString();
  const eu = usuarioAtual?.nome ?? "Você";

  const registrarEvento = (
    itemId: string,
    tipo: EventoHistorico["tipo"],
    texto: string,
  ) =>
    setEventos((prev) => ({
      ...prev,
      [itemId]: [
        ...(prev[itemId] ?? []),
        { autor: eu, em: agora(), id: `${Date.now()}`, texto, tipo },
      ],
    }));

  const enviarMensagem = (itemId: string, texto: string) =>
    setMensagens((prev) => ({
      ...prev,
      [itemId]: [
        ...(prev[itemId] ?? []),
        { autor: eu, em: agora(), id: `${Date.now()}`, texto },
      ],
    }));

  // Persiste a etapa no servidor (apolo_esteira) quando o operador decide no Board.
  //
  // ⚠️ DEIXOU DE SER BEST-EFFORT (Lucas, 10/08: "cliente não volta no fluxo"). Antes a tela movia o
  // card primeiro e mandava o PATCH sem ler a resposta: se o servidor recusasse — ficha sem CAD,
  // saída de revisão barrada, rede caída — o operador via o avanço acontecer, e no dia seguinte
  // encontrava a mesma pessoa na etapa anterior. Agora a resposta é lida e devolvida; quem chama só
  // mexe na tela depois do "ok", e mostra o motivo quando não é ok.
  const gravarEtapa = async (
    entityId: string,
    etapa: string,
    motivo?: string,
  ): Promise<{ error?: string; etapa?: string; ok: boolean }> => {
    try {
      const token = await getApoloAccessToken();
      // `enterpriseId` do card: diz ao servidor QUAL CAD desta pessoa está sendo movida.
      const enterpriseId = itens.find((item) => item.id === entityId)?.enterpriseId ?? null;
      const resposta = await fetch(`/api/apolo/board/${encodeURIComponent(entityId)}/etapa`, {
        body: JSON.stringify({ enterpriseId, etapa, motivo }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "PATCH",
      });
      const corpo = (await resposta.json().catch(() => null)) as {
        data?: { etapa?: string };
        error?: string;
      } | null;

      if (!resposta.ok) {
        return { error: corpo?.error ?? `Não foi possível gravar a etapa (${resposta.status}).`, ok: false };
      }
      // O destino REAL vem do servidor: ele pode redirecionar (pré-venda desligada -> credenciado).
      return { etapa: corpo?.data?.etapa ?? etapa, ok: true };
    } catch {
      return { error: "Falha de rede ao gravar a etapa. A ficha NÃO mudou de etapa.", ok: false };
    }
  };

  // O que o servidor recusou. Fica em cima do card, com o motivo que veio de lá — é o oposto do
  // que acontecia antes, quando a recusa era engolida e a tela seguia mostrando o avanço.
  const [erroEtapa, setErroEtapa] = useState<null | string>(null);
  // ORIENTAÇÃO não é ERRO. "Use o painel de empreendimentos" saindo na tarja vermelha de "A etapa
  // não foi gravada" faz o operador procurar um defeito onde só há um caminho diferente.
  const [avisoAcao, setAvisoAcao] = useState<null | string>(null);
  // O aviso de erro é da FICHA que estava aberta, não da tela. Sem limpar ao navegar, a tarja
  // vermelha de uma tentativa anterior seguia no topo da ficha seguinte, e o operador lia um erro
  // que não era dele — foi o que fez o Lucas achar que a habilitação tinha falhado quando ela
  // havia funcionado (17/08).
  useEffect(() => {
    setErroEtapa(null);
    setAvisoAcao(null);
  }, [selecionado?.id]);

  // IMOBILIÁRIA NÃO PASSA PELA ESTEIRA, então não usa `gravarEtapa`.
  //
  // A trilha dela é `cadastro -> habilitada`, e nenhuma das duas existe em `ETAPAS_ESTEIRA`: o
  // clique em "Habilitada" voltava **400 "Etapa invalida."**, e o indeferir voltava **409**
  // pedindo para "informar o empreendimento no cadastro" de uma empresa que não tem CAD. As duas
  // ações agora vão para `/habilitar`, que mexe onde o portal do corretor de fato lê (papel
  // `active` + vínculos `verified`). Ver [[project_apolo_habilitacao_imobiliaria_quebrada]].
  const decidirCredenciamento = async (
    entityId: string,
    corpoDaDecisao: Record<string, unknown>,
  ): Promise<{ error?: string; ok: boolean; resumo?: string }> => {
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch(
        `/api/apolo/board/${encodeURIComponent(entityId)}/habilitar`,
        {
          body: JSON.stringify(corpoDaDecisao),
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const corpo = (await resposta.json().catch(() => null)) as {
        data?: { resumo?: string };
        error?: string;
      } | null;

      if (!resposta.ok) {
        return {
          error: corpo?.error ?? `Não foi possível concluir (${resposta.status}).`,
          ok: false,
        };
      }
      return { ok: true, resumo: corpo?.data?.resumo };
    } catch {
      return { error: "Falha de rede. O credenciamento NÃO mudou.", ok: false };
    }
  };

  // TODA MUDANÇA DE ETAPA PASSA POR AQUI: grava primeiro, mexe na tela depois. `aplicar` só roda
  // com o "ok" do servidor, e recebe a etapa REAL gravada (que pode não ser a pedida — pré-venda
  // desligada vira credenciado).
  const moverEtapa = async (
    itemId: string,
    etapa: string,
    opts: { aplicar: (etapaGravada: string) => void; evento?: [EventoHistorico["tipo"], string]; motivo?: string },
  ) => {
    setErroEtapa(null);
    const r = await gravarEtapa(itemId, etapa, opts.motivo);
    if (!r.ok) {
      setErroEtapa(r.error ?? "Não foi possível gravar a etapa.");
      return;
    }
    opts.aplicar(r.etapa ?? etapa);
    if (opts.evento) registrarEvento(itemId, opts.evento[0], opts.evento[1]);
    void carregarFila();
  };

  // Recusa e correção SEMPRE com motivo (regra do Lucas): fica no histórico e é o que o
  // corretor/cliente recebe de volta.
  const indeferir = (itemId: string, motivo: string) => {
    // Imobiliária vai por outro caminho: `moverEtapa` grava na esteira, onde ela não tem linha,
    // e o operador levava 409 pedindo para "informar o empreendimento no cadastro".
    if (itens.find((item) => item.id === itemId)?.papel === "imobiliaria") {
      void (async () => {
        setErroEtapa(null);
        const r = await decidirCredenciamento(itemId, {
          acao: "indeferir",
          motivos: [motivo],
        });
        if (!r.ok) {
          setErroEtapa(r.error ?? "Não foi possível indeferir.");
          return;
        }
        setIndeferidos((prev) => ({ ...prev, [itemId]: true }));
        registrarEvento(itemId, "sistema", `Credenciamento indeferido — motivo: ${motivo}`);
        void carregarFila();
      })();
      return;
    }

    void moverEtapa(itemId, "indeferido", {
      aplicar: () => {
        setIndeferidos((prev) => ({ ...prev, [itemId]: true }));
        setEmRevisao((prev) => ({ ...prev, [itemId]: false }));
        setEmCorrecao((prev) => ({ ...prev, [itemId]: false }));
      },
      evento: ["sistema", `Reprovado — motivo: ${motivo}`],
      motivo,
    });
  };

  // HABILITAR a imobiliária: a ação que faltava. `empreendimentos` são os enterpriseId que o
  // operador marcou; sem nenhum o servidor recusa, porque papel ativo com zero empreendimento
  // deixaria o CNPJ valendo no portal do corretor sem nada para ele escolher.
  const habilitarImobiliaria = async (itemId: string, empreendimentos: string[]) => {
    setErroEtapa(null);
    const r = await decidirCredenciamento(itemId, { acao: "habilitar", empreendimentos });
    if (!r.ok) {
      setErroEtapa(r.error ?? "Não foi possível habilitar.");
      return false;
    }
    registrarEvento(itemId, "sistema", `Credenciamento habilitado — ${r.resumo ?? "ok"}`);
    void carregarFila();
    return true;
  };

  const enviarParaCorrecao = (itemId: string, motivo: string) => {
    // ⚠️ IMOBILIÁRIA VAI PELA ROTA PRÓPRIA. Esta é a TERCEIRA decisão da validação (habilitar,
    // corrigir, indeferir) e faltava para o caso mais comum: documento errado ou incompleto. Sem
    // ela, o operador só tinha "indeferir", que fecha a porta e esconde o caso na coluna de
    // recusadas — a Beatriz Teodora levou três indeferimentos por ter mandado o Cartão de CNPJ no
    // lugar do contrato social. `moverEtapa` aqui daria o 409 da esteira, que ela não tem.
    if (ehImobiliaria(itemId)) {
      void (async () => {
        setErroEtapa(null);
        const r = await decidirCredenciamento(itemId, {
          acao: "correcao",
          motivos: [motivo],
        });
        if (!r.ok) {
          setErroEtapa(r.error ?? "Não foi possível enviar para correção.");
          return;
        }
        setEmCorrecao((prev) => ({ ...prev, [itemId]: true }));
        registrarEvento(itemId, "sistema", `Enviado para correção — pendências: ${motivo}`);
        void carregarFila();
      })();
      return;
    }

    void moverEtapa(itemId, "correcao", {
      aplicar: () => {
        setEmCorrecao((prev) => ({ ...prev, [itemId]: true }));
        setEmRevisao((prev) => ({ ...prev, [itemId]: false }));
      },
      evento: ["nota", `Enviado para correção — pendências: ${motivo}`],
      motivo,
    });
  };

  const ehImobiliaria = (itemId: string): boolean =>
    itens.find((item) => item.id === itemId)?.papel === "imobiliaria";

  const reabrir = (itemId: string) => {
    // ⚠️ IMOBILIÁRIA NÃO TEM ESTEIRA, e "crédito" não é etapa dela. Reabrir chamava
    // `moverEtapa(itemId, "credito")` e o operador levava o 409 "esta ficha ainda não tem CAD na
    // esteira, informe o empreendimento no cadastro" — mensagem sem sentido para quem valida uma
    // EMPRESA: imobiliária não tem CAD, ela é quem cadastra os compradores. É o caminho de quem
    // foi recusada, regularizou a documentação e volta para a fila (Lucas, 17/08).
    if (ehImobiliaria(itemId)) {
      void (async () => {
        setErroEtapa(null);
        const r = await decidirCredenciamento(itemId, { acao: "reabrir" });
        if (!r.ok) {
          setErroEtapa(r.error ?? "Não foi possível reabrir o credenciamento.");
          return;
        }
        setIndeferidos((prev) => ({ ...prev, [itemId]: false }));
        setEmCorrecao((prev) => ({ ...prev, [itemId]: false }));
        registrarEvento(itemId, "sistema", "Credenciamento reaberto para validação");
        void carregarFila();
      })();
      return;
    }

    void moverEtapa(itemId, "credito", {
      aplicar: () => {
        setIndeferidos((prev) => ({ ...prev, [itemId]: false }));
        setEmCorrecao((prev) => ({ ...prev, [itemId]: false }));
      },
      evento: ["etapa", "Análise reaberta"],
    });
  };

  // Analista escala pro coordenador decidir o crédito.
  const enviarParaRevisao = (itemId: string) => {
    // Imobiliária não passa por CRÉDITO, e `revisao` é o desvio do crédito reprovado da CAD.
    // Além do 409 da esteira, o destino não existe no mundo dela: quem valida empresa decide
    // entre habilitar, corrigir e indeferir.
    if (ehImobiliaria(itemId)) {
      setErroEtapa(null);
      setAvisoAcao(
        "Validação de imobiliária não passa por análise de crédito. As ações são habilitar, enviar para correção ou indeferir.",
      );
      return;
    }

    void moverEtapa(itemId, "revisao", {
      aplicar: () => setEmRevisao((prev) => ({ ...prev, [itemId]: true })),
      evento: ["aprovacao", "Enviado ao coordenador para revisão do crédito"],
    });
  };

  // AVANÇAR ficou sendo uma gravação de verdade. Era `progresso++` puro: o card andava na tela, o
  // banco não sabia de nada, e o próximo F5 devolvia a ficha para a etapa anterior — a queixa do
  // Lucas em 10/08. O botão só existe onde a etapa NÃO tem ação própria no painel (a Análise de
  // crédito é o Serasa; a Pré-venda é o PIX), então o único avanço genérico é sair da Validação.
  const avancarEtapa = (item: ItemFila, etapaAtualId: string) => {
    // A imobiliária não passa por crédito: validou o cadastro, está habilitada a enviar CADs — e
    // "habilitada" não é etapa da esteira, o terminal dela também é `credenciado`.
    // A imobiliária não avança pela esteira: ela é habilitada marcando os empreendimentos no
    // painel, que chama `/habilitar`. Mandar "credenciado" para cá dava o 409 da esteira.
    if (item.papel === "imobiliaria") {
      setErroEtapa(null);
      setAvisoAcao(
        "Para habilitar a imobiliária, marque abaixo os empreendimentos que ela pode trabalhar e use o botão Habilitar imobiliária.",
      );
      return;
    }

    const destino = etapaAtualId === "cadastro" ? "credito" : "credenciado";
    void moverEtapa(item.id, destino, {
      aplicar: (etapaGravada) => {
        const indice = indiceDaEtapa(item, etapaGravada);
        if (indice !== undefined) setProgresso((prev) => ({ ...prev, [item.id]: indice }));
      },
      evento: ["etapa", etapaAtualId === "cadastro" ? "Validação aprovada" : "Credenciado"],
    });
  };

  // APROVAR COM RESTRIÇÃO (COORDENAÇÃO) — PROBLEMA 3 (Lucas, 04/08). Substitui o antigo
  // `aprovarRevisao`, que fazia `gravarEtapa(itemId, "prevenda")` CRU: reprovado ia para a cobrança
  // sem evidência, sem registro e ignorando o toggle da pré-venda. Agora vai pela rota de override,
  // que exige a evidência anexada, registra quem/quando e destrava respeitando `prevenda_habilitada`
  // (prevenda se ligada, senão credenciado). O destino real vem do servidor.
  const aprovarComRestricao = async (
    itemId: string,
    payload: { fileBase64: string; fileName: string; mimeType: string; motivo: string },
  ): Promise<{ error?: string; ok?: boolean }> => {
    try {
      const token = await getApoloAccessToken();
      const enterpriseId = itens.find((item) => item.id === itemId)?.enterpriseId ?? null;
      const resposta = await fetch("/api/apolo/serasa/aprovar-restricao", {
        body: JSON.stringify({
          enterpriseId,
          entityId: itemId,
          fileBase64: payload.fileBase64,
          fileName: payload.fileName,
          mimeType: payload.mimeType,
          motivo: payload.motivo,
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const corpo = (await resposta.json()) as { data?: { etapa?: string }; error?: string };
      if (!resposta.ok) return { error: corpo.error ?? `Falha (${resposta.status}).` };

      // Servidor destravou e disse para onde. Reflete na tela na hora, sem esperar o reload.
      const etapaNova = corpo.data?.etapa;
      setEmRevisao((prev) => ({ ...prev, [itemId]: false }));
      setIndeferidos((prev) => ({ ...prev, [itemId]: false }));
      const item = itens.find((linha) => linha.id === itemId);
      const indice = item ? indiceDaEtapa(item, etapaNova) : undefined;
      if (indice !== undefined) setProgresso((prev) => ({ ...prev, [itemId]: indice }));
      registrarEvento(itemId, "aprovacao", "Crédito aprovado com restrição pela coordenação");
      void carregarFila();
      return { ok: true };
    } catch (e) {
      return { error: (e as Error).message };
    }
  };

  // Carrega a fila do Board/Esteira. Extraída num callback estável para ser reusada tanto na
  // montagem quanto no refetch ao focar a aba (useRefetchOnFocus) — a MESMA função, sem
  // duplicar o fetch. As semeaduras seguem com "sessão vence servidor" (o operador não perde o
  // que mexeu na tela); os cards em si (`itens`) são substituídos pelo servidor, então PIX pago,
  // CPF corrigido e afins passam a refletir sem F5.
  const carregarFila = useCallback(async () => {
    try {
      const accessToken = await getApoloAccessToken();
      const response = await fetch("/api/apolo/board", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await response.json()) as {
        data?: {
          analistas?: Analista[];
          empreendimentos?: string[];
          itens?: ItemFila[];
          usuarioAtual?: Analista | null;
        };
      };
      const itensCarregados = payload.data?.itens ?? [];
      setItens(itensCarregados);
      setAnalistas(payload.data?.analistas ?? []);
      setCatalogoEmpreendimentos(payload.data?.empreendimentos ?? []);
      setUsuarioAtual(payload.data?.usuarioAtual ?? null);

      // O item ABERTO é um estado à parte de `itens` (não é derivado por id), e o título da
      // tela de detalhe lê dele. Sem esta linha, corrigir o nome arrumava o card e a tabela e
      // deixava o cabeçalho da própria tela onde a correção foi feita com o nome antigo.
      setSelecionado((atual) =>
        atual ? (itensCarregados.find((item) => item.id === atual.id) ?? atual) : atual,
      );

      // Semeia etapa e analista com o que veio do banco, preservando o que o operador já
      // mexeu nesta sessão (o que ele fez na tela ganha do que estava salvo).
      setProgresso((atual) => {
        const semeado: Record<string, number> = {};
        for (const item of itensCarregados) {
          // ⚠️ IMOBILIÁRIA NÃO TEM `etapa` (não tem esteira), então `indiceDaEtapa` devolvia
          // undefined e o progresso dela ficava em 0 PARA SEMPRE: a ficha da imobiliária já
          // habilitada abria dizendo "Validação", sem o selo de apta, e o botão Voltar (que é
          // `disabled={etapaAtual === 0}`) nunca ficava clicável. A trilha dela é
          // cadastro -> habilitada, então `active` é o passo 1.
          if (item.papel === "imobiliaria") {
            if (item.papelStatus === "active") semeado[item.id] = 1;
            else if (item.papelStatus) semeado[item.id] = 0;
            continue;
          }

          const indice = indiceDaEtapa(item, item.etapa);
          if (indice !== undefined) semeado[item.id] = indice;
        }
        // ⚠️ O BANCO VENCE A SESSÃO — era ao contrário (`{...semeado, ...atual}`), e essa
        // precedência é metade do "cliente voltando no fluxo": o operador clicava em avançar, a
        // tela guardava a posição só na memória, e o refetch nunca a corrigia — nem quando o
        // servidor tinha recusado a gravação. Agora o que está gravado manda, e a única posição
        // que sobrevive é a de quem NÃO tem etapa no banco (ficha sem CAD).
        const semEtapaNoBanco: Record<string, number> = {};
        for (const [id, posicao] of Object.entries(atual)) {
          if (semeado[id] === undefined) semEtapaNoBanco[id] = posicao;
        }
        return { ...semEtapaNoBanco, ...semeado };
      });

      // Semeia os DESVIOS (revisão/correção/indeferido) a partir da etapa persistida. Sem
      // isso eles se perdiam no reload: o item voltava para o caminho normal e a coluna
      // "Crédito em revisão" esvaziava sozinha. O que o operador mexeu na sessão prevalece.
      // ⚠️ AQUI TAMBÉM O BANCO VENCE (mesma razão do `progresso` acima): quem tem etapa gravada é
      // marcado ou desmarcado pelo que está gravado, não pelo que a sessão lembra. A ficha sem
      // etapa no banco mantém o que a sessão tinha, porque para ela não há verdade melhor.
      const marcarPorEtapa = (alvo: string): Record<string, boolean> => {
        const marcas: Record<string, boolean> = {};
        for (const item of itensCarregados) if (item.etapa) marcas[item.id] = item.etapa === alvo;

        // ⚠️ IMOBILIÁRIA NÃO TEM ETAPA NA ESTEIRA: para ela a decisão está no STATUS DO PAPEL.
        // Sem isto o card indeferido voltava para "Validação" a cada recarregamento — a recusa
        // existia no banco e sumia da tela, e o operador reindeferia achando que não tinha
        // gravado (a Beatriz Teodora foi indeferida três vezes por causa disso).
        if (alvo === "indeferido") {
          for (const item of itensCarregados) {
            if (item.papel === "imobiliaria" && item.papelStatus) {
              marcas[item.id] = item.papelStatus === "blocked";
            }
          }
        }

        // Correção da imobiliária mora na ENTIDADE (`attention`), não no papel nem na esteira.
        if (alvo === "correcao") {
          for (const item of itensCarregados) {
            if (item.papel === "imobiliaria" && item.entidadeStatus) {
              marcas[item.id] = item.entidadeStatus === "attention";
            }
          }
        }

        return marcas;
      };
      setEmRevisao((atual) => ({ ...atual, ...marcarPorEtapa("revisao") }));
      setEmCorrecao((atual) => ({ ...atual, ...marcarPorEtapa("correcao") }));
      setIndeferidos((atual) => ({ ...atual, ...marcarPorEtapa("indeferido") }));

      setAnalistaPorItem((atual) => {
        const semeado: Record<string, string> = {};
        for (const item of itensCarregados) {
          if (item.analistaId) semeado[item.id] = item.analistaId;
        }
        return { ...semeado, ...atual };
      });
    } catch {
      // fila vazia
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregarFila();
  }, [carregarFila]);

  // Volta pra aba/janela → recarrega a fila (correção de CPF, PIX por webhook, troca de etapa).
  // Não é polling: só ao focar, com debounce de ~10s dentro do hook.
  useRefetchOnFocus(() => {
    void carregarFila();
  });

  // SUBIR UMA CAD PARA O C2X, do próprio card (Lucas, 08/08: "coloca esse botão").
  //
  // O buraco que isso fecha: quando o C2X recusava por campo em branco, o time corrigia a ficha e
  // o dado ficava PARADO — não existia como reenviar. Das 43 recusadas, 23 já estavam corrigidas e
  // continuavam fora do C2X.
  //
  // Quem decide tudo é o servidor (imobiliária, campos obrigatórios, travas de identidade, host de
  // destino e a trava de ensaio). Aqui só se chama e se devolve a resposta INTEIRA para o card
  // mostrar — inclusive o motivo real da recusa, que é o que o operador precisa ler.
  const subirParaC2x = useCallback(
    async (entityId: string): Promise<ResultadoSubidaC2x> => {
      // Falha ANTES de o servidor responder: não dá para carimbar "ensaio" (isso afirmaria que
      // nada foi enviado, e numa queda de rede ninguém sabe). Fica só o erro, sem selo nenhum.
      const semDestino = { ensaio: false, entityId, faltantes: [], hostDestino: "desconhecido" };
      try {
        const token = await getApoloAccessToken();
        const resposta = await fetch("/api/apolo/c2x-sync/enviar", {
          body: JSON.stringify({ entityId }),
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          method: "POST",
        });
        const corpo = (await resposta.json().catch(() => null)) as {
          data?: ResultadoSubidaC2x;
          error?: string;
        } | null;
        if (!resposta.ok || !corpo?.data) {
          return {
            ...semDestino,
            erro: corpo?.error ?? `Falha (${resposta.status}).`,
            status: "erro",
          };
        }
        // Envio DE VERDADE mexeu no banco (fila de sync + carimbo na ficha): recarrega para o selo
        // do card refletir o novo estado. Ensaio não muda nada, então não gasta uma recarga.
        if (!corpo.data.ensaio) void carregarFila();
        return corpo.data;
      } catch (erro) {
        return { ...semDestino, erro: (erro as Error).message, status: "erro" };
      }
    },
    [carregarFila],
  );

  // Lista de empreendimentos pro seletor.
  //
  // ⚠️ SAI DO CATÁLOGO, não dos cards. Montar a partir de `itens` fazia o filtro oferecer só o que
  // já estava na tela: empreendimento sem nenhuma CAD simplesmente não existia como opção, e não
  // havia como perguntar "e o Lagoa Bonita?" — a resposta era a ausência da pergunta. Foi o que o
  // Lucas viu em 17/08, com a DANY CASTRO habilitada nas três divisões do Lagoa Bonita.
  //
  // A união com o que está nos cards continua: se um card trouxer um nome que o catálogo não tem
  // (grafia antiga da esteira, empreendimento desativado depois da venda), o filtro dele não pode
  // sumir junto.
  const empreendimentosDisponiveis = Array.from(
    new Set([...catalogoEmpreendimentos, ...itens.flatMap((item) => item.empreendimentos)]),
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const alvoBusca = busca.trim().toLowerCase();
  const visiveis = itens
    .filter((item) =>
      filtro === "todos"
        ? true
        : filtro === "imobiliaria"
          ? item.papel === "imobiliaria"
          : item.papel !== "imobiliaria",
    )
    .filter((item) =>
      empreendimento === "todos" ? true : item.empreendimentos.includes(empreendimento),
    )
    .filter((item) =>
      alvoBusca
        ? `${item.nome} ${item.documento}`.toLowerCase().includes(alvoBusca)
        : true,
    )
    .filter((item) =>
      etapaFiltro === "todas"
        ? true
        : colunaDoItem(
            item,
            progresso[item.id] ?? 0,
            Boolean(indeferidos[item.id]),
            Boolean(emRevisao[item.id]),
            Boolean(emCorrecao[item.id]),
          ) === etapaFiltro,
    )
    .filter((item) => {
      if (pagoFiltro === "todos") return true;
      return pagoFiltro === "pagos" ? Boolean(item.pagoEm) : !item.pagoEm;
    })
    .filter((item) => (soErros ? Boolean(item.erroEnvio) : true))
    .sort((a, b) => {
      // Clique no cabeçalho manda; o seletor é o padrão quando não há coluna escolhida.
      if (colunaOrdem) {
        const sinal = colunaOrdem.desc ? -1 : 1;
        const texto = (valor: string) => valor.toLocaleLowerCase("pt-BR");

        if (colunaOrdem.campo === "nome") {
          return sinal * a.nome.localeCompare(b.nome, "pt-BR");
        }
        if (colunaOrdem.campo === "documento") {
          return sinal * texto(a.documento).localeCompare(texto(b.documento), "pt-BR");
        }
        if (colunaOrdem.campo === "empreendimento") {
          return (
            sinal *
            texto(a.empreendimentos.join(", ")).localeCompare(
              texto(b.empreendimentos.join(", ")),
              "pt-BR",
            )
          );
        }
        if (colunaOrdem.campo === "etapa") {
          const posicao = (item: ItemFila) =>
            colunasDoTipo(item.papel === "imobiliaria", itens).findIndex(
              (coluna) =>
                coluna.id ===
                colunaDoItem(
                  item,
                  progresso[item.id] ?? 0,
                  Boolean(indeferidos[item.id]),
                  Boolean(emRevisao[item.id]),
                  Boolean(emCorrecao[item.id]),
                ),
            );
          return sinal * (posicao(a) - posicao(b));
        }
        return (
          sinal * (new Date(a.criadoEm).getTime() - new Date(b.criadoEm).getTime())
        );
      }

      if (ordem === "nome") return a.nome.localeCompare(b.nome, "pt-BR");
      const ta = new Date(a.criadoEm).getTime();
      const tb = new Date(b.criadoEm).getTime();
      return ordem === "recentes" ? tb - ta : ta - tb;
    });

  // Quem ABRE o processo assume a análise (regra do Lucas). Só atribui se ainda não tem dono —
  // abrir um item de outro analista não rouba a responsabilidade dele.
  const abrirItem = (item: ItemFila) => {
    setSelecionado(item);
    if (usuarioAtual && !analistaPorItem[item.id]) {
      setAnalistaPorItem((prev) => ({ ...prev, [item.id]: usuarioAtual.id }));
    }
  };

  const analistaAberto = selecionado
    ? (analistas.find((p) => p.id === analistaPorItem[selecionado.id])?.nome ?? "")
    : "";

  // Índice do item aberto DENTRO da lista filtrada: é o que permite emendar um no outro.
  const indiceAberto = selecionado
    ? visiveis.findIndex((item) => item.id === selecionado.id)
    : -1;
  const irPara = (delta: number) => {
    const alvo = visiveis[indiceAberto + delta];
    if (alvo) abrirItem(alvo);
  };

  // --- validação em TELA CHEIA (decisão do Lucas: fila e validação disputavam a mesma largura) ---
  if (selecionado) {
    return (
      <section className="flex h-full min-h-0 flex-col gap-3">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-subtle"
            onClick={() => setSelecionado(null)}
            type="button"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Voltar para a fila
          </button>

          <div className="flex items-center gap-2">
            {/* Atalho pro cadastro do cliente no CRM, sem sair pra pesquisar. */}
            {onOpenEntity ? (
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-subtle"
                onClick={() => onOpenEntity(selecionado.nome, selecionado.id)}
                type="button"
              >
                <ExternalLink aria-hidden="true" className="size-4" />
                Abrir no CRM
              </button>
            ) : null}
            {/* Quem abriu assumiu: fica explícito de quem é a análise. */}
            {analistaAberto ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-subtle px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
                <span className="flex size-4 items-center justify-center rounded-full bg-inverse text-[8px] font-bold text-brand-ink">
                  {iniciais(analistaAberto)}
                </span>
                {analistaAberto}
              </span>
            ) : null}
            <span className="text-xs text-ink-muted">
              {indiceAberto + 1} de {visiveis.length}
            </span>
            <button
              className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-subtle disabled:opacity-40"
              disabled={indiceAberto <= 0}
              onClick={() => irPara(-1)}
              type="button"
            >
              Anterior
            </button>
            <button
              className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-subtle disabled:opacity-40"
              disabled={indiceAberto < 0 || indiceAberto >= visiveis.length - 1}
              onClick={() => irPara(1)}
              type="button"
            >
              Próximo
            </button>
          </div>
        </header>

        {/* O SERVIDOR RECUSOU. Antes essa recusa era engolida e a tela seguia mostrando o avanço;
            é dela que nasce a sensação de "o cliente voltou sozinho". Fica em vermelho, com o
            motivo que veio do servidor, até a próxima tentativa. */}
        {avisoAcao ? (
          <p className="m-0 flex items-start gap-2 rounded-xl border border-line bg-subtle px-4 py-3 text-sm text-ink">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-muted" />
            <span>{avisoAcao}</span>
          </p>
        ) : null}

        {erroEtapa ? (
          <p className="m-0 flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong className="font-semibold">A etapa não foi gravada.</strong> {erroEtapa}
            </span>
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-surface p-5">
          <DetalheBoard
            emCorrecao={Boolean(emCorrecao[selecionado.id])}
            emRevisao={Boolean(emRevisao[selecionado.id])}
            etapaAtual={progresso[selecionado.id] ?? 0}
            indeferido={Boolean(indeferidos[selecionado.id])}
            item={selecionado}
            mensagens={(mensagens[selecionado.id] ?? []).length}
            onAbrirChat={() => setPainelAberto(true)}
            onAprovarRestricao={() => setModalRestricao(true)}
            onAvancar={(etapaAtualId) => avancarEtapa(selecionado, etapaAtualId)}
            onCorrecao={() => setModalMotivo("correcao")}
            onHabilitar={habilitarImobiliaria}
            onIdentidadeSalva={() => void carregarFila()}
            onCreditoResultado={(r) => {
              // O crédito moveu a etapa NO SERVIDOR; aqui a tela só reflete o que ele decidiu, sem
              // esperar o reload da fila. São TRÊS desfechos, não dois:
              //   aprovado + pré-venda ligada  -> prevenda (índice 2)
              //   aprovado + pré-venda DESLIGADA -> credenciado (índice 3), pulando o PIX
              //   reprovado -> fica na Análise de crédito com o desvio de revisão
              // ⚠️ O caso "credenciado" faltava aqui e a barra travava na Análise de crédito mesmo
              // com o banco já em credenciado (achado do Lucas, 05/08, testando a Vovo Braga no
              // Vale do Ouro, que está com a pré-venda desligada).
              // A posição sai da MESMA ponte que o reload da fila usa (`indiceDaEtapa`), que lê a
              // trilha DESTE item. Antes os números viviam soltos aqui, e bastava o servidor passar
              // a devolver uma etapa nova para a barra parar de acompanhar.
              const alvo = selecionado.id;
              const indice = indiceDaEtapa(selecionado, r.etapa);
              if (indice !== undefined) {
                setProgresso((prev) => ({ ...prev, [alvo]: indice }));
              }
              if (r.etapa === "revisao") {
                // Ancorado NA Análise de crédito, com o desvio de revisão.
                setEmRevisao((prev) => ({ ...prev, [alvo]: true }));
              } else if (r.etapa) {
                setEmRevisao((prev) => ({ ...prev, [alvo]: false }));
                setIndeferidos((prev) => ({ ...prev, [alvo]: false }));
              }
              registrarEvento(
                alvo,
                r.aprovado ? "aprovacao" : "sistema",
                r.aprovado
                  ? r.etapa === "credenciado"
                    ? "Crédito aprovado: credenciado direto (pré-venda desligada)"
                    : "Crédito aprovado: seguiu para a pré-venda"
                  : "Crédito reprovado: enviado para revisão",
              );
            }}
            onEnviarGestao={() => enviarParaRevisao(selecionado.id)}
            onIndeferir={() => setModalMotivo("indeferir")}
            onReabrir={() => reabrir(selecionado.id)}
            onVoltar={(etapaAtualId) => {
              // Voltar da imobiliária = reabrir o credenciamento (o papel volta para review).
              // Ela não tem etapa de esteira para onde voltar.
              if (selecionado.papel === "imobiliaria") {
                reabrir(selecionado.id);
                return;
              }

              // Voltar é decisão humana e a esteira permite (só o AUTOMÁTICO é que não rebaixa).
              // Mas grava, como tudo o mais: o "voltei o card e no dia seguinte ele estava lá na
              // frente de novo" é a mesma queixa vista pelo avesso.
              const destino = etapaAtualId === "credito" ? "validacao" : "credito";
              void moverEtapa(selecionado.id, destino, {
                aplicar: (etapaGravada) => {
                  const indice = indiceDaEtapa(selecionado, etapaGravada);
                  if (indice !== undefined) {
                    setProgresso((prev) => ({ ...prev, [selecionado.id]: indice }));
                  }
                },
                evento: ["etapa", "Etapa devolvida pelo operador"],
              });
            }}
          />
        </div>

        {/* Recusa e correção exigem motivo: popup antes de decidir. */}
        {modalMotivo ? (
          <ModalMotivo
            imob={selecionado.papel === "imobiliaria"}
            onCancelar={() => setModalMotivo(null)}
            onConfirmar={(motivo) => {
              if (modalMotivo === "correcao") enviarParaCorrecao(selecionado.id, motivo);
              else indeferir(selecionado.id, motivo);
              setModalMotivo(null);
            }}
            tipo={modalMotivo}
          />
        ) : null}

        {/* PROBLEMA 3 (Lucas, 04/08): override da coordenação. Exige a evidência do de-acordo
            (PDF/PNG/JPEG) antes de destravar o crédito reprovado. */}
        {modalRestricao ? (
          <ModalAprovarRestricao
            nome={toTitleCase(selecionado.nome)}
            onCancelar={() => setModalRestricao(false)}
            onConfirmar={async (payload) => {
              const r = await aprovarComRestricao(selecionado.id, payload);
              if (r.ok) setModalRestricao(false);
              return r;
            }}
          />
        ) : null}

        {/* Chat e histórico em POPUP (preferência do Lucas): a conferência fica com a tela toda. */}
        {painelAberto ? (
          <ModalChatHistorico
            eventos={historicoDoItem(selecionado, eventos[selecionado.id] ?? [])}
            mensagens={mensagens[selecionado.id] ?? []}
            nome={toTitleCase(selecionado.nome)}
            onEnviar={(texto) => enviarMensagem(selecionado.id, texto)}
            onFechar={() => setPainelAberto(false)}
          />
        ) : null}
      </section>
    );
  }

  // --- fila em TABELA cheia ---
  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <header className="shrink-0 rounded-xl border border-line bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Sem título: o nome da tela já vem do sidebar do Apolo. */}
          <p className="m-0 min-w-0 text-xs text-ink-muted">
            Tudo que entra no lançamento passa por aqui: imobiliárias, corretores e CADs.
          </p>
          <div className="flex items-center gap-2">
            {/* Mesmo alternador do board da Iris. */}
            <div className="inline-flex shrink-0 rounded-lg border border-line/70 bg-subtle/70 p-0.5">
              <button
                aria-label="Visão kanban"
                className={`inline-flex size-8 items-center justify-center rounded-md transition-colors ${
                  visao === "kanban"
                    ? "bg-surface text-ink shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
                onClick={() => {
                  // O quadro sempre abre nas CADs (decisão do Lucas); trocar é um clique na aba.
                  setFiltro("prospect");
                  setVisao("kanban");
                }}
                title="Kanban"
                type="button"
              >
                <LayoutGrid className="size-4" aria-hidden="true" />
              </button>
              <button
                aria-label="Visão lista"
                className={`inline-flex size-8 items-center justify-center rounded-md transition-colors ${
                  visao === "tabela"
                    ? "bg-surface text-ink shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
                onClick={() => setVisao("tabela")}
                title="Lista"
                type="button"
              >
                <List className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 flex gap-1">
          {(
            [
              // No kanban não existe "Todos": os funis são diferentes.
              ...(visao === "kanban" ? [] : [["todos", "Todos"] as const]),
              // CADs primeiro: é o volume do dia a dia.
              ["prospect", "CADs"] as const,
              ["imobiliaria", "Imobiliárias"] as const,
            ] as const
          ).map(([valor, rotulo]) => {
            const total = itens.filter((item) =>
              valor === "todos"
                ? true
                : valor === "imobiliaria"
                  ? item.papel === "imobiliaria"
                  : item.papel !== "imobiliaria",
            ).length;
            return (
              <button
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  filtro === valor ? "bg-inverse text-brand-ink" : "text-ink-soft hover:bg-subtle"
                }`}
                key={valor}
                onClick={() => setFiltro(valor)}
                type="button"
              >
                {rotulo}
                <span
                  className={`rounded-full px-1.5 text-[10px] ${
                    filtro === valor ? "bg-white/20" : "bg-subtle"
                  }`}
                >
                  {total}
                </span>
              </button>
            );
          })}
        </div>

        {/* Busca, empreendimento e ordenação valem pras duas visões. */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-line/70 bg-surface px-3">
            <Search aria-hidden="true" className="size-4 shrink-0 text-[#A07C3B]" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-ink outline-none placeholder:text-ink-muted"
              onChange={(event) => setBusca(event.target.value)}
              placeholder="Buscar por nome ou documento…"
              value={busca}
            />
          </label>

          <select
            className="h-9 rounded-lg border border-line/70 bg-surface px-2 text-sm text-ink outline-none [&>option]:bg-surface [&>option]:text-ink"
            onChange={(event) => setEmpreendimento(event.target.value)}
            value={empreendimento}
          >
            <option value="todos">Todos os empreendimentos</option>
            {empreendimentosDisponiveis.map((nome) => (
              <option key={nome} value={nome}>
                {toTitleCase(nome)}
              </option>
            ))}
          </select>

          {/* Filtro por etapa: mostra a contagem junto, para saber onde a fila está parada
              sem precisar abrir o kanban. */}
          <select
            className="h-9 rounded-lg border border-line/70 bg-surface px-2 text-sm text-ink outline-none [&>option]:bg-surface [&>option]:text-ink"
            onChange={(event) => setEtapaFiltro(event.target.value)}
            value={etapaFiltro}
          >
            <option value="todas">Todas as etapas</option>
            {colunasDoTipo(filtro === "imobiliaria", itens).map((coluna) => {
              const quantos = itens.filter(
                (item) =>
                  colunaDoItem(
                    item,
                    progresso[item.id] ?? 0,
                    Boolean(indeferidos[item.id]),
                    Boolean(emRevisao[item.id]),
                    Boolean(emCorrecao[item.id]),
                  ) === coluna.id,
              ).length;
              return (
                <option key={coluna.id} value={coluna.id}>
                  {coluna.label} ({quantos})
                </option>
              );
            })}
          </select>

          {/* Falha de envio: o chip só existe quando há alguma — sem erro, sem ruído na tela. */}
          {itens.some((item) => item.erroEnvio) ? (
            <button
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition-colors ${
                soErros
                  ? "border-rose-300 bg-rose-600 text-white"
                  : "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
              }`}
              onClick={() => setSoErros((v) => !v)}
              type="button"
            >
              <AlertTriangle aria-hidden="true" className="size-4" />
              {itens.filter((item) => item.erroEnvio).length} com erro de envio
            </button>
          ) : null}

          {/* PIX da pré-venda: separa quem pagou de quem só recebeu a cobrança. */}
          <select
            className="h-9 rounded-lg border border-line/70 bg-surface px-2 text-sm text-ink outline-none [&>option]:bg-surface [&>option]:text-ink"
            onChange={(event) => setPagoFiltro(event.target.value as typeof pagoFiltro)}
            value={pagoFiltro}
          >
            <option value="todos">PIX: todos</option>
            <option value="pagos">
              PIX pago ({itens.filter((item) => item.pagoEm).length})
            </option>
            <option value="pendentes">
              PIX pendente ({itens.filter((item) => !item.pagoEm).length})
            </option>
          </select>

          <select
            className="h-9 rounded-lg border border-line/70 bg-surface px-2 text-sm text-ink outline-none [&>option]:bg-surface [&>option]:text-ink"
            onChange={(event) => {
              setColunaOrdem(null);
              setOrdem(event.target.value as typeof ordem);
            }}
            value={ordem}
          >
            <option value="antigos">Mais antigos primeiro</option>
            <option value="recentes">Mais recentes primeiro</option>
            <option value="nome">Nome (A–Z)</option>
          </select>
        </div>
      </header>

      {visao === "kanban" ? (
        <KanbanBoard
          analistaDe={(id) =>
            analistas.find((pessoa) => pessoa.id === analistaPorItem[id])?.nome ?? ""
          }
          carregando={carregando}
          emCorrecao={emCorrecao}
          emRevisao={emRevisao}
          filtro={filtro}
          indeferidos={indeferidos}
          itens={visiveis}
          onAbrir={abrirItem}
          onSubirC2x={subirParaC2x}
          progresso={progresso}
        />
      ) : (
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-surface">
        {carregando ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 aria-hidden="true" className="size-5 animate-spin text-ink-muted" />
          </div>
        ) : visiveis.length === 0 ? (
          <p className="py-16 text-center text-sm text-ink-muted">Nada aguardando validação.</p>
        ) : (
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-line bg-subtle text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <ThOrdenavel
                  campo="nome"
                  className="px-4 py-2.5"
                  estado={colunaOrdem}
                  onOrdenar={setColunaOrdem}
                >
                  Quem
                </ThOrdenavel>
                <ThOrdenavel campo="etapa" estado={colunaOrdem} onOrdenar={setColunaOrdem}>
                  Etapa
                </ThOrdenavel>
                <th className="px-3 py-2.5">Analista</th>
                <ThOrdenavel
                  campo="documento"
                  estado={colunaOrdem}
                  onOrdenar={setColunaOrdem}
                >
                  Documento
                </ThOrdenavel>
                <ThOrdenavel
                  campo="empreendimento"
                  estado={colunaOrdem}
                  onOrdenar={setColunaOrdem}
                >
                  Empreendimento
                </ThOrdenavel>
                <ThOrdenavel campo="chegada" estado={colunaOrdem} onOrdenar={setColunaOrdem}>
                  Chegou em
                </ThOrdenavel>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((item) => {
                const imob = item.papel === "imobiliaria";
                return (
                  <tr
                    className="cursor-pointer border-b border-line/70 transition-colors last:border-b-0 hover:bg-[#A07C3B]/8"
                    key={item.id}
                    onClick={() => abrirItem(item)}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-subtle text-ink-muted">
                          {imob ? (
                            <Building2 aria-hidden="true" className="size-4" />
                          ) : (
                            <UserRound aria-hidden="true" className="size-4" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="m-0 flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
                            <span className="truncate">{toTitleCase(item.nome)}</span>
                            {item.erroEnvio ? (
                              <span
                                className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                                title="Falha no envio da cobrança ou do recibo"
                              >
                                <AlertTriangle aria-hidden="true" className="size-2.5" /> envio
                              </span>
                            ) : null}
                            {/* Não conseguiu subir para o C2X: motivo no tooltip. */}
                            <SeloC2x erro={item.c2xErro} falha={item.c2xFalha} />
                            {item.pagoEm ? (
                              <span
                                className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                                title={`PIX confirmado em ${new Date(item.pagoEm).toLocaleString(
                                  "pt-BR",
                                  { timeZone: "America/Sao_Paulo" },
                                )}`}
                              >
                                <Check aria-hidden="true" className="size-2.5" /> PIX pago
                              </span>
                            ) : null}
                          </p>
                          <p className="m-0 truncate text-[11px] text-ink-muted">
                            {imob ? "Imobiliária" : "CAD · prospect"}
                            {/* Quem indicou a CAD: vem da importação do Asana. O corretor é o
                                nome que o formulário trouxe, às vezes só o primeiro nome. */}
                            {item.imobiliaria ? ` · ${item.imobiliaria}` : ""}
                            {item.corretor ? ` · ${item.corretor}` : ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    {/* Etapa do workflow: mesma cor/rótulo das colunas do kanban. */}
                    <td className="px-3 py-2.5">
                      <EtapaChip
                        coluna={colunaDoItem(
                          item,
                          progresso[item.id] ?? 0,
                          Boolean(indeferidos[item.id]),
                          Boolean(emRevisao[item.id]),
                          Boolean(emCorrecao[item.id]),
                        )}
                        imob={imob}
                      />
                    </td>

                    {/* Analista: quem está cuidando. O clique no select não abre o item. */}
                    <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                      <select
                        className="h-8 max-w-[150px] rounded-lg border border-line/70 bg-surface px-2 text-xs text-ink outline-none [&>option]:bg-surface [&>option]:text-ink"
                        onChange={(event) =>
                          setAnalistaPorItem((prev) => ({
                            ...prev,
                            [item.id]: event.target.value,
                          }))
                        }
                        value={analistaPorItem[item.id] ?? ""}
                      >
                        <option value="">Sem analista</option>
                        {analistas.map((pessoa) => (
                          <option key={pessoa.id} value={pessoa.id}>
                            {pessoa.nome}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="px-3 py-2.5 text-ink-soft">{item.documento || "—"}</td>
                    <td className="px-3 py-2.5">
                      {item.empreendimentos.length ? (
                        <div className="flex flex-wrap gap-1">
                          {item.empreendimentos.map((nome) => (
                            <span
                              className="rounded border border-[#A07C3B]/25 bg-[#A07C3B]/8 px-1.5 py-0.5 text-[11px] font-medium text-[#7A5E2C] dark:text-[#d9b877]"
                              key={nome}
                            >
                              {toTitleCase(nome)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="m-0 text-sm text-ink-soft">{chegadaEm(item.criadoEm)}</p>
                      <p className="m-0 text-[11px] text-ink-muted">
                        há {esperaDesde(item.criadoEm)}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="inline-flex items-center rounded-lg border border-line bg-subtle px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
                        Validar
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      )}
    </section>
  );
}

// --- Kanban (mesmo padrão visual do board da Íris) --------------------------------------------

// O fluxo é UM só (Lucas 18/jul): Validação -> Análise de crédito -> Pré-venda -> Credenciado.
// "Em correção" é o desvio: item devolvido pra ajuste, podendo vir de qualquer etapa.
type Coluna = { accent: string; id: string; label: string };

// Funil da CAD (cliente): passa por crédito e paga a pré-venda.
const COLUNAS_CAD: Coluna[] = [
  { accent: "#2563EB", id: "validacao", label: "Validação" },
  { accent: "#A07C3B", id: "credito", label: "Análise de crédito" },
  // O analista escala e o COORDENADOR decide: pode aprovar um crédito que o analista barraria.
  { accent: "#7C3AED", id: "revisao", label: "Crédito em revisão" },
  { accent: "#0891B2", id: "prevenda", label: "Pré-venda" },
  { accent: "#10B981", id: "credenciado", label: "Credenciado" },
  { accent: "#F59E0B", id: "correcao", label: "Em correção" },
  { accent: "#DC2626", id: "indeferido", label: "Crédito indeferido" },
];

// Funil da IMOBILIÁRIA: credenciamento de parceiro. Sem crédito, sem pré-venda e SEM coluna de
// corretores — validar os corretores acontece dentro da própria Validação (Lucas 18/jul).
const COLUNAS_IMOBILIARIA: Coluna[] = [
  { accent: "#2563EB", id: "validacao", label: "Validação" },
  { accent: "#10B981", id: "habilitada", label: "Habilitada" },
  { accent: "#F59E0B", id: "correcao", label: "Em correção" },
  { accent: "#DC2626", id: "indeferido", label: "Recusada" },
];

// A coluna Pré-venda só existe se ALGUM item visível tiver a pré-venda ligada no empreendimento
// dele (regra do Lucas, 10/08). Numa operação onde a cobrança está desligada — o Vale do Ouro
// depois do lançamento, por exemplo — uma coluna Pré-venda vazia e permanentemente inalcançável
// só serve para o time achar que o cliente "caiu" nela.
const colunasDoTipo = (imob: boolean, itens: ItemFila[] = []): Coluna[] => {
  if (imob) return COLUNAS_IMOBILIARIA;

  // ⚠️ NA ABA "TODOS" A COLUNA "HABILITADA" PRECISA EXISTIR, senão o card da imobiliária
  // habilitada é DESCARTADO: `colunaDoItem` o classifica como `habilitada`, o kanban filtra por
  // coluna e nenhuma das COLUNAS_CAD casa — o item some da tela sem entrar em lista nenhuma nem
  // contar em badge. Só entra quando há de fato imobiliária na lista, para a aba de CAD não
  // ganhar uma coluna vazia permanente.
  const temImobiliaria = itens.some((item) => item.papel === "imobiliaria");
  const temPrevenda = itens.some(
    (item) => item.papel !== "imobiliaria" && item.prevendaHabilitada,
  );
  const base = temPrevenda ? COLUNAS_CAD : COLUNAS_CAD.filter((c) => c.id !== "prevenda");

  if (!temImobiliaria) return base;

  // Entra ao lado de "Credenciado", que é o terminal equivalente da CAD.
  const habilitada = COLUNAS_IMOBILIARIA.find((c) => c.id === "habilitada");
  if (!habilitada) return base;
  const posicao = base.findIndex((c) => c.id === "credenciado");
  if (posicao < 0) return [...base, habilitada];
  return [...base.slice(0, posicao + 1), habilitada, ...base.slice(posicao + 1)];
};

// Desvios têm precedência sobre a etapa: o item sai do caminho normal.
function colunaDoItem(
  item: ItemFila,
  etapa: number,
  indeferido = false,
  emRevisao = false,
  emCorrecao = false,
): string {
  if (indeferido) return "indeferido";
  if (emCorrecao) return "correcao";
  if (item.papel === "imobiliaria") {
    // O papel manda quando existe: `active` é habilitada, mesmo que ninguém tenha mexido na tela
    // nesta sessão. `etapa` fica de reserva para as fichas antigas, sem papel gravado.
    if (item.papelStatus === "active") return "habilitada";
    return etapa <= 0 ? "validacao" : "habilitada";
  }
  if (emRevisao) return "revisao";

  // A coluna sai da TRILHA DO ITEM, não de números fixos. Onde a pré-venda está desligada a trilha
  // tem um passo a menos, e o antigo `etapa === 2 -> "prevenda"` mandava para a coluna Pré-venda
  // gente que na verdade estava em Credenciado.
  const passo = etapasDoItem(item)[Math.max(0, etapa)]?.id;
  if (!passo) return "credenciado";
  return passo === "cadastro" ? "validacao" : passo;
}

type CampoOrdem = "chegada" | "documento" | "empreendimento" | "etapa" | "nome";
type EstadoOrdem = { campo: CampoOrdem; desc: boolean } | null;

// Cabeçalho que ordena ao clique: 1º clique ascendente, 2º descendente, 3º volta ao padrão.
// A seta mostra o estado — sem ela o operador clica no escuro.
function ThOrdenavel(props: {
  campo: CampoOrdem;
  children: React.ReactNode;
  className?: string;
  estado: EstadoOrdem;
  onOrdenar: (estado: EstadoOrdem) => void;
}) {
  const ativo = props.estado?.campo === props.campo;

  return (
    <th className={props.className ?? "px-3 py-2.5"}>
      <button
        className={`flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
          ativo ? "text-ink" : "text-ink-muted hover:text-ink"
        }`}
        onClick={() => {
          if (!ativo) props.onOrdenar({ campo: props.campo, desc: false });
          else if (!props.estado?.desc) props.onOrdenar({ campo: props.campo, desc: true });
          else props.onOrdenar(null);
        }}
        type="button"
      >
        {props.children}
        <span aria-hidden="true" className="text-[9px]">
          {ativo ? (props.estado?.desc ? "▼" : "▲") : "↕"}
        </span>
      </button>
    </th>
  );
}

// Onde o item está no workflow — o mesmo vocabulário visual do kanban, dentro da lista.
function EtapaChip({ coluna, imob }: { coluna: string; imob: boolean }) {
  // Rótulo e cor: usa o vocabulário COMPLETO de propósito. Se a coluna Pré-venda está escondida no
  // kanban, uma ficha residual nela ainda precisa ser nomeada corretamente na lista — não cair no
  // primeiro chip da lista, que seria "Validação".
  const colunas = imob ? COLUNAS_IMOBILIARIA : COLUNAS_CAD;
  const etapa = colunas.find((item) => item.id === coluna) ?? colunas[0];
  if (!etapa) return null;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-subtle px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: etapa.accent }}
      />
      {etapa.label}
    </span>
  );
}

function KanbanBoard({
  analistaDe,
  carregando,
  emCorrecao,
  emRevisao,
  filtro,
  indeferidos,
  itens,
  onAbrir,
  onSubirC2x,
  progresso,
}: {
  analistaDe: (id: string) => string;
  carregando: boolean;
  emCorrecao: Record<string, boolean>;
  emRevisao: Record<string, boolean>;
  filtro: "todos" | "imobiliaria" | "prospect";
  indeferidos: Record<string, boolean>;
  itens: ItemFila[];
  onAbrir: (item: ItemFila) => void;
  onSubirC2x: (entityId: string) => Promise<ResultadoSubidaC2x>;
  progresso: Record<string, number>;
}) {
  if (carregando) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-line bg-surface">
        <Loader2 aria-hidden="true" className="size-5 animate-spin text-ink-muted" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
      {colunasDoTipo(filtro === "imobiliaria", itens).map((coluna) => {
        const cards = itens.filter(
          (item) =>
            colunaDoItem(item, progresso[item.id] ?? 0, Boolean(indeferidos[item.id]), Boolean(emRevisao[item.id]), Boolean(emCorrecao[item.id])) ===
            coluna.id,
        );
        return (
          <div
            className="flex w-[264px] shrink-0 flex-col rounded-xl border border-line/70 bg-subtle/50"
            key={coluna.id}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: coluna.accent }}
                />
                <span className="truncate text-xs font-semibold uppercase tracking-normal text-ink-muted">
                  {coluna.label}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] font-bold text-ink-muted ring-1 ring-slate-200 dark:ring-white/10">
                {cards.length}
              </span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
              {cards.length > 0 ? (
                cards.map((item) => (
                  <CardBoard
                    analista={analistaDe(item.id)}
                    item={item}
                    key={item.id}
                    onAbrir={onAbrir}
                    onSubirC2x={onSubirC2x}
                  />
                ))
              ) : (
                <p className="px-1 py-6 text-center text-[11px] text-ink-muted">Nada por aqui</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// O histórico começa SEMPRE na chegada (regra do Lucas: registrar desde o primeiro dia) e
// recebe por cima o que foi acontecendo no Board.
function historicoDoItem(item: ItemFila, extras: EventoHistorico[]): EventoHistorico[] {
  const base: EventoHistorico = {
    autor: item.papel === "imobiliaria" ? "Portal de credenciamento" : "Corretor",
    em: item.criadoEm,
    id: "chegada",
    texto:
      item.papel === "imobiliaria"
        ? "Credenciamento recebido pelo portal"
        : "CAD recebida",
    tipo: "chegada",
  };
  return [base, ...extras];
}

function ModalChatHistorico({
  eventos,
  mensagens,
  nome,
  onEnviar,
  onFechar,
}: {
  eventos: EventoHistorico[];
  mensagens: Mensagem[];
  nome: string;
  onEnviar: (texto: string) => void;
  onFechar: () => void;
}) {
  const [aba, setAba] = useState<"chat" | "historico">("historico");
  const [texto, setTexto] = useState("");

  const enviar = () => {
    const limpo = texto.trim();
    if (!limpo) return;
    onEnviar(limpo);
    setTexto("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Clicar fora fecha. */}
      <button
        aria-label="Fechar"
        className="absolute inset-0 cursor-default bg-black/40"
        onClick={onFechar}
        type="button"
      />

      <aside className="relative flex h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-semibold text-ink">{nome}</p>
            <p className="m-0 text-[11px] text-ink-muted">Chat interno e histórico do processo</p>
          </div>
          <button
            aria-label="Fechar"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
            onClick={onFechar}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1 border-b border-line p-2">
          {(
            [
              ["chat", "Chat"],
              ["historico", "Histórico"],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                aba === valor ? "bg-inverse text-brand-ink" : "text-ink-soft hover:bg-subtle"
              }`}
              key={valor}
              onClick={() => setAba(valor)}
              type="button"
            >
              {rotulo}
            </button>
          ))}
        </div>

      {aba === "historico" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <ol className="relative grid gap-3 border-l border-line pl-4">
            {eventos.map((evento) => (
              <li className="relative" key={evento.id}>
                <span
                  className="absolute -left-[21px] top-1 size-2.5 rounded-full ring-2 ring-surface"
                  style={{ backgroundColor: corDoEvento(evento.tipo) }}
                  aria-hidden="true"
                />
                <p className="m-0 text-sm text-ink">{evento.texto}</p>
                <p className="m-0 mt-0.5 text-[11px] text-ink-muted">
                  {evento.autor} · {chegadaEm(evento.em)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {mensagens.length === 0 ? (
              <p className="py-8 text-center text-xs text-ink-muted">
                Sem mensagens. Use para falar com a gestão sobre este caso.
              </p>
            ) : (
              <div className="grid gap-2">
                {mensagens.map((msg) => (
                  <div className="rounded-lg border border-line bg-subtle/50 px-3 py-2" key={msg.id}>
                    <p className="m-0 text-sm text-ink">{msg.texto}</p>
                    <p className="m-0 mt-0.5 text-[11px] text-ink-muted">
                      {msg.autor} · {chegadaEm(msg.em)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-end gap-2 border-t border-line p-2">
            <textarea
              className="min-h-[38px] flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted"
              onChange={(event) => setTexto(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  enviar();
                }
              }}
              placeholder="Comentar com a gestão…"
              rows={1}
              value={texto}
            />
            <button
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-inverse text-brand-ink transition-colors hover:bg-inverse/90 disabled:opacity-40"
              disabled={!texto.trim()}
              onClick={enviar}
              type="button"
            >
              <Send aria-hidden="true" className="size-4" />
            </button>
          </div>
        </>
      )}
      </aside>
    </div>
  );
}

// Motivos frequentes: um clique preenche, e o operador ainda pode escrever. Acelera sem
// engessar — e garante que a devolutiva nunca vá vazia.
const MOTIVOS_CORRECAO = [
  "Documento ilegível",
  "Documento vencido",
  "Falta comprovante de endereço",
  "Falta documento do sócio",
  "Dados divergentes do documento",
  "CRECI não confere",
];

const MOTIVOS_REPROVACAO = [
  "Score de crédito insuficiente",
  "Negativações em aberto",
  "Protestos em aberto",
  "Documentação inconsistente",
  "Não atende aos critérios do empreendimento",
];

// Recusar CREDENCIAMENTO não é indeferir CRÉDITO: aqui se valida uma empresa (contrato social,
// CRECI, sócios), não a capacidade de pagamento de um comprador. O modal já trocava o título
// quando `imob`, mas seguia oferecendo "Score de crédito insuficiente" e "Negativações em
// aberto" como sugestão — motivos que não existem nesta análise e que iriam, escritos, para a
// imobiliária.
const MOTIVOS_RECUSA_IMOBILIARIA = [
  "Contrato social ilegível ou incompleto",
  "Cartão CNPJ não confere com o contrato social",
  "CRECI da imobiliária não localizado ou vencido",
  "Documento do sócio ilegível ou faltando",
  "Situação cadastral do CNPJ irregular na Receita",
  "Dados do responsável não conferem",
];

// CORREÇÃO de imobiliária tem motivos PRÓPRIOS. Os de CAD ("falta comprovante de endereço",
// "falta documento do sócio") são de comprador; aqui se pede ajuste de documento de EMPRESA. O
// primeiro item é o caso real que originou esta ação: a Beatriz Teodora enviou o Cartão de CNPJ
// no lugar do contrato social e foi indeferida três vezes por falta de uma opção de "corrigir".
const MOTIVOS_CORRECAO_IMOBILIARIA = [
  "Enviou o Cartão de CNPJ no lugar do contrato social",
  "Contrato social ilegível ou incompleto",
  "Falta a última alteração contratual",
  "CRECI da imobiliária vencido ou ilegível",
  "Documento do sócio ilegível ou faltando",
  "Dados do responsável não conferem com o documento",
];

function ModalMotivo({
  imob,
  onCancelar,
  onConfirmar,
  tipo,
}: {
  imob: boolean;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
  tipo: "correcao" | "indeferir";
}) {
  // CAIXINHAS, não chips que concatenam texto (Lucas, 15/08). Marcar e desmarcar é reversível e
  // deixa à vista o que já foi apontado; o chip "+" empilhava tudo num textarea, e tirar um
  // motivo virava edição de texto no meio da frase.
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const [observacao, setObservacao] = useState("");
  const correcao = tipo === "correcao";
  const sugestoes = correcao
    ? imob
      ? MOTIVOS_CORRECAO_IMOBILIARIA
      : MOTIVOS_CORRECAO
    : imob
      ? MOTIVOS_RECUSA_IMOBILIARIA
      : MOTIVOS_REPROVACAO;

  const escolhidos = sugestoes.filter((motivo) => marcados[motivo]);
  // O contrato com quem chama continua sendo UMA string: os outros fluxos (correção, indeferir
  // crédito) já gravam assim no histórico. A observação entra como um item a mais.
  const motivoFinal = [...escolhidos, observacao.trim()].filter(Boolean).join("; ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Fechar"
        className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-[2px]"
        onClick={onCancelar}
        type="button"
      />

      <div className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <span
            className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
              correcao ? "bg-[#D97706]/12 text-[#B45309]" : "bg-rose-500/12 text-rose-600"
            }`}
          >
            {correcao ? (
              <RefreshCw aria-hidden="true" className="size-4" />
            ) : (
              <ShieldAlert aria-hidden="true" className="size-4" />
            )}
          </span>
          <div className="min-w-0">
            <h2 className="m-0 text-base font-semibold text-ink">
              {correcao
                ? "Enviar para correção"
                : imob
                  ? "Recusar credenciamento"
                  : "Indeferir crédito"}
            </h2>
            <p className="m-0 mt-0.5 text-xs text-ink-muted">
              {correcao
                ? "Marque o que precisa ser corrigido. É isso que o corretor recebe de volta."
                : imob
                  ? "Marque o motivo. É isso que a imobiliária recebe, então seja específico."
                  : "Marque o motivo da reprovação. Fica no histórico do processo."}
            </p>
          </div>
        </div>

        <div className="grid max-h-[60vh] gap-2 overflow-y-auto px-5 py-4">
          {sugestoes.map((motivo) => {
            const ativo = Boolean(marcados[motivo]);
            return (
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                  ativo
                    ? "border-ink/30 bg-black/[0.045] text-ink dark:bg-white/[0.07]"
                    : "border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink"
                }`}
                key={motivo}
              >
                <input
                  checked={ativo}
                  className="size-4 shrink-0 accent-neutral-900 dark:accent-neutral-200"
                  onChange={(event) =>
                    setMarcados((atual) => ({ ...atual, [motivo]: event.target.checked }))
                  }
                  type="checkbox"
                />
                <span className="min-w-0">{motivo}</span>
              </label>
            );
          })}

          <label className="mt-1 grid gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Observação (opcional)
            </span>
            <textarea
              className="min-h-[72px] w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-ink/40"
              onChange={(event) => setObservacao(event.target.value)}
              placeholder="Algo específico deste caso…"
              value={observacao}
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <span className="text-xs text-ink-muted">
            {escolhidos.length === 0
              ? "Nenhum motivo marcado"
              : escolhidos.length === 1
                ? "1 motivo marcado"
                : `${escolhidos.length} motivos marcados`}
          </span>

          <div className="flex items-center gap-2">
            <button
              className="inline-flex h-9 items-center rounded-lg border border-line px-4 text-sm font-medium text-ink-soft transition-colors hover:bg-subtle"
              onClick={onCancelar}
              type="button"
            >
              Cancelar
            </button>
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-5 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!motivoFinal}
              onClick={() => onConfirmar(motivoFinal)}
              type="button"
            >
              {correcao ? "Enviar para correção" : "Confirmar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Lê um arquivo como data URL base64 ("data:<mime>;base64,..."). A rota aceita o prefixo `data:`
// (o `uploadApoloDocument` o remove antes de decodificar).
function lerArquivoBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

// PROBLEMA 3 (Lucas, 04/08): override da coordenação em crédito reprovado. Espelha o padrão do
// `ModalMotivo`, mas a peça central é a EVIDÊNCIA (PDF/PNG/JPEG) — obrigatória, o botão só habilita
// com o arquivo escolhido. O motivo é opcional. O envio (upload + destrava) é do servidor; o modal
// só monta o payload e mostra o erro que voltar.
function ModalAprovarRestricao({
  nome,
  onCancelar,
  onConfirmar,
}: {
  nome: string;
  onCancelar: () => void;
  onConfirmar: (payload: {
    fileBase64: string;
    fileName: string;
    mimeType: string;
    motivo: string;
  }) => Promise<{ error?: string; ok?: boolean }>;
}) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // O arquivo viaja em base64 (infla ~33%) e a plataforma corta o corpo em ~4,5 MB. Barrar aqui é o
  // que separa "arquivo grande demais, mande a página do de-acordo" de um 413 mudo no meio do
  // envio — ver [[reference_apolo_upload_413]].
  const MAX_MB = 3;

  const confirmar = async () => {
    if (!arquivo || salvando) return;
    if (arquivo.size > MAX_MB * 1024 * 1024) {
      setErro(
        `A evidência tem ${(arquivo.size / (1024 * 1024)).toFixed(1)} MB e o limite é ${MAX_MB} MB. ` +
          "Mande só a página do de-acordo, ou um print da tela.",
      );
      return;
    }
    setSalvando(true);
    setErro(null);
    let fileBase64: string;
    try {
      fileBase64 = await lerArquivoBase64(arquivo);
    } catch {
      setErro("Não foi possível ler o arquivo.");
      setSalvando(false);
      return;
    }
    const r = await onConfirmar({
      fileBase64,
      fileName: arquivo.name,
      mimeType: arquivo.type,
      motivo: motivo.trim(),
    });
    // Sucesso: o pai fecha o modal (desmonta). Só tratamos o erro aqui.
    if (r?.error) {
      setErro(r.error);
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Fechar"
        className="absolute inset-0 cursor-default bg-black/40"
        onClick={salvando ? undefined : onCancelar}
        type="button"
      />

      <div className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="border-b border-line px-5 py-4">
          <h2 className="m-0 text-base font-semibold text-ink">Aprovar com restrição</h2>
          <p className="m-0 mt-0.5 text-xs text-ink-muted">
            {nome} teve o crédito reprovado. A coordenação pode aprovar mesmo assim, anexando a
            evidência do de-acordo. Fica registrado quem aprovou e quando.
          </p>
        </div>

        <div className="grid gap-3 px-5 py-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-ink">
              Evidência do de-acordo <span className="text-rose-600">*</span>
            </span>
            <span className="text-[11px] text-ink-muted">PDF, PNG ou JPEG, até {MAX_MB} MB.</span>
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-subtle/40 px-3 py-2">
              <Upload aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
              <input
                accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                className="min-w-0 flex-1 text-xs text-ink file:mr-3 file:rounded-md file:border-0 file:bg-inverse file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-ink"
                disabled={salvando}
                onChange={(event) => {
                  setArquivo(event.target.files?.[0] ?? null);
                  setErro(null);
                }}
                type="file"
              />
            </div>
            {arquivo ? (
              <span className="truncate text-[11px] text-ink-soft">{arquivo.name}</span>
            ) : null}
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-ink">Motivo (opcional)</span>
            <textarea
              className="min-h-[80px] w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted"
              disabled={salvando}
              onChange={(event) => setMotivo(event.target.value)}
              placeholder="Ex.: cliente com fiador; acordo já quitado…"
              value={motivo}
            />
          </label>

          {erro ? (
            <p className="m-0 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
              {erro}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button
            className="inline-flex h-9 items-center rounded-lg border border-line px-4 text-sm font-medium text-ink-soft transition-colors hover:bg-subtle disabled:opacity-40"
            disabled={salvando}
            onClick={onCancelar}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#7C3AED] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!arquivo || salvando}
            onClick={() => void confirmar()}
            type="button"
          >
            {salvando ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <ShieldCheck aria-hidden="true" className="size-4" />
            )}
            {salvando ? "Aprovando…" : "Aprovar com restrição"}
          </button>
        </div>
      </div>
    </div>
  );
}

function corDoEvento(tipo: EventoHistorico["tipo"]): string {
  if (tipo === "chegada") return "#2563EB";
  if (tipo === "aprovacao") return "#A07C3B";
  if (tipo === "etapa") return "#10B981";
  if (tipo === "nota") return "#94A3B8";
  return "#64748B";
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? "") : "";
  return `${primeira}${ultima}`.toUpperCase();
}

// ALERTA: a CAD não está confirmada no C2X (pedido do Lucas 05/08: "é bom ter algum alerta caso
// eu não consiga subir uma cad para o c2x"). Ícone + tooltip com o motivo, no mesmo formato dos
// outros selos do card. Quem está no C2X não ganha marca nenhuma, senão o problema deixa de saltar
// aos olhos.
//
// Três estados porque são problemas diferentes:
//   vermelho = a API recusou (dá para ler o motivo e corrigir a ficha);
//   âmbar    = respondeu sucesso mas o cadastro não foi achado no banco do C2X. É o caso perigoso,
//              o que PARECE sucesso (incidente 28/jul e 01/08, escrita indo para o ambiente errado).
//   âmbar "sem C2X" = está CREDENCIADO no Apolo e NUNCA chegou a ser enviado. Não é erro (ninguém
//              recusou nada), é ausência: a ficha parou antes do envio e não deixou rastro em
//              lugar nenhum. Mesmo tom de atenção do anterior, porque para o operador a conclusão
//              é a mesma ("não está confirmado lá"); o que muda é o rótulo e o ícone.
//
// A DECISÃO de qual estado mostrar é do servidor (lib/apolo/c2x-alerta-board.ts). Aqui só se
// pinta: o selo aparece em DOIS lugares (card do kanban e linha da tabela) e não pode haver duas
// versões da mesma regra.
// O C2X é um Rails e devolve a recusa em HTML, com os campos separados por `<br>` (ex.:
// "Naturalidade não pode ficar em branco<br>Nacionalidade não pode ficar em branco"). Jogar isso
// cru no tooltip faz o operador ler a tag. Aqui viram "; " e qualquer outra tag é removida.
function motivoLegivel(bruto: string): string {
  return bruto
    .replace(/<br\s*\/?>/gi, "; ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s*;\s*(?=;)/g, "")
    .replace(/\s+/g, " ")
    .replace(/[;\s]+$/, "")
    .trim();
}

function SeloC2x({ erro, falha }: { erro?: string | null; falha?: string | null }) {
  // Mesmo critério do botão de subir (`foraDoC2x`, em lib/apolo/c2x-envio-card.ts): selo e botão
  // aparecem e somem JUNTOS. Selo sem botão é beco sem saída; botão sem selo é ruído.
  if (!foraDoC2x(falha)) return null;
  const nuncaEnviado = falha === "nunca_enviado";
  const semConfirmacao = falha === "sem_confirmacao";
  const motivo = motivoLegivel(erro ?? "");
  const titulo = nuncaEnviado
    ? "Credenciado no Apolo, mas sem confirmação de cadastro no C2X. Esta ficha nunca chegou a ser enviada: abra a ficha e confira o que falta."
    : semConfirmacao
      ? "Não confirmado no C2X: a API respondeu sucesso, mas o cadastro não apareceu no banco do C2X. Conferir antes de seguir."
      : `Não subiu para o C2X: ${motivo || "motivo não registrado."}`;
  const atencao = nuncaEnviado || semConfirmacao;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
        atencao
          ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
          : "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
      }`}
      title={titulo}
    >
      {nuncaEnviado ? (
        <>
          <CloudOff aria-hidden="true" className="size-2.5" /> sem C2X
        </>
      ) : (
        <>
          <AlertTriangle aria-hidden="true" className="size-2.5" /> C2X
        </>
      )}
    </span>
  );
}

const TOM_C2X: Record<"atencao" | "erro" | "ok", string> = {
  atencao: "text-amber-700 dark:text-amber-300",
  erro: "text-rose-700 dark:text-rose-300",
  ok: "text-emerald-700 dark:text-emerald-300",
};

// O QUE A TELA DIZ DEPOIS DO CLIQUE.
//
// A frase sai do STATUS que o servidor devolveu — nunca um "erro ao enviar" genérico. Quando o C2X
// recusa, quem fala é a mensagem DELE (`motivoLegivel` limpa o HTML que o Rails devolve); quando o
// gate para antes de bater na API, a frase diz O QUE FALTA, que é o que o operador precisa para
// agir. Em todo caminho aparece o HOST de destino: o incidente de 01/08 (8 cadastros criados no
// ambiente de teste) só foi possível porque o destino era invisível.
function vereditoC2x(r: ResultadoSubidaC2x): {
  texto: string;
  titulo: string;
  tom: "atencao" | "erro" | "ok";
} {
  const destino = r.hostDestino;
  const motivo = motivoLegivel(r.erro ?? "");
  // ⚠️ O DESTINO É JULGADO, NÃO SÓ EXIBIDO. Mostrar o host em texto verde não protege ninguém: em
  // 01/08 a escrita foi para `teste.careli.adm.br` e passou 4 dias despercebida justamente porque
  // quem lia a tela não tinha como saber que aquele host estava errado. Fora de produção o
  // desfecho vira ALERTA, com o host certo escrito ao lado para a comparação ser imediata.
  const producao = destinoEhProducao(destino);
  const alertaDestino = `⚠ Destino NÃO é produção: ${destino} (produção é ${HOST_C2X_PRODUCAO})`;
  const explicaDestino = `O destino configurado é ${destino}, e produção é ${HOST_C2X_PRODUCAO}. Confira C2X_WRITE_API_URL antes de liberar o envio: cadastro criado no ambiente errado não tem desfazer e some da fila como se tivesse dado certo.`;

  switch (r.status) {
    case "faltando": {
      const faltam = r.faltantes.join(", ");
      return {
        texto: `Falta ${faltam}`,
        // ⚠️ O MOTIVO DO SERVIDOR VEM PRIMEIRO. Montar a frase só com `faltantes` dá certo para
        // campo em branco e ERRA no caso da imobiliária: "Falta Imobiliária. Complete na ficha e
        // clique de novo." manda procurar, na ficha do CLIENTE, um campo que não existe lá — o
        // conserto é no cadastro da imobiliária (ou no vínculo dela com a CAD). O servidor já
        // manda a frase certa, a MESMA que fica gravada na fila; aqui era ignorada.
        titulo:
          motivo ||
          `NADA foi enviado ao C2X: esta ficha ainda não tem ${faltam}. Complete na ficha e clique de novo.`,
        tom: "atencao",
      };
    }
    case "conferir":
      return {
        texto: "Ficha para conferir",
        // ⚠️ A frase final é GENÉRICA de propósito: "conferir" cobre duas divergências diferentes —
        // a importação e a ficha discordando sobre a pessoa (nome da mãe, nascimento) e, desde a
        // trava anti-duplicado, o documento da ficha apontando para OUTRA pessoa no C2X. Citar só
        // "nome da mãe e nascimento" mandava o operador conferir o campo errado no segundo caso.
        titulo: `NADA foi enviado: ${
          (r.divergencias ?? []).join("; ") ||
          "os dados de identidade divergem entre a importação e a ficha"
        }. Estes dados vão no CONTRATO, então isto se resolve à mão antes de subir.`,
        tom: "atencao",
      };
    case "pronta":
      return r.ensaio
        ? {
            texto: producao ? `Ensaio OK — subiria para ${destino}` : alertaDestino,
            titulo: producao
              ? `ENSAIO: NADA foi enviado. A ficha passou em todos os campos obrigatórios e subiria para ${destino}. O envio de verdade ainda está travado no servidor.`
              : `ENSAIO: NADA foi enviado, e ainda bem. A ficha está completa, mas subiria para o lugar errado. ${explicaDestino}`,
            tom: producao ? "ok" : "erro",
          }
        : {
            texto: "Pronta, mas não foi a vez dela",
            titulo: `A ficha está pronta e não tem pendência, mas o teto de envios desta chamada foi atingido. Clique de novo. Destino: ${destino}.`,
            tom: "atencao",
          };
    case "enviada":
      return {
        texto: producao ? `Subiu para ${destino}` : `Subiu para ${destino} — ${alertaDestino}`,
        titulo: producao
          ? `Cadastro criado no C2X (${destino}).`
          : `CADASTRO CRIADO NO AMBIENTE ERRADO. ${explicaDestino}`,
        tom: producao ? "ok" : "erro",
      };
    case "duplicada":
      return {
        texto: producao ? `Já existia em ${destino}` : `Já existia em ${destino} — ${alertaDestino}`,
        titulo: producao
          ? `O C2X respondeu que este cadastro já existe (${destino}); o id foi reconciliado pelo documento.`
          : `O C2X respondeu que já existe — mas no ambiente errado. ${explicaDestino}`,
        tom: producao ? "ok" : "erro",
      };
    // JÁ ESTAVA LÁ — e isto é uma BOA notícia, não uma falha.
    //
    // Não passa pelo teste de produção: nada foi criado em lugar nenhum, então não há ambiente
    // errado a denunciar. A prova é a leitura do users.id no banco de PRODUÇÃO do C2X, e é
    // justamente por isso que o selo de alerta some na próxima carga do Board — o id fica gravado
    // na fila e na ficha.
    case "ja_no_c2x":
      return {
        texto: r.ensaio ? "Já está no C2X (ensaio, nada gravado)" : "Já estava no C2X",
        titulo: r.ensaio
          ? "ENSAIO: esta pessoa JÁ EXISTE no C2X e nada seria enviado. O ensaio não grava, então o aviso do card continua até rodar de verdade."
          : "Esta pessoa JÁ EXISTIA no C2X: nada foi enviado e nenhum cadastro foi criado. O id do C2X foi reconciliado na ficha, e o aviso deste card some ao recarregar o Board.",
        tom: "ok",
      };
    case "sem_confirmacao":
      return {
        texto: "Aceitou, mas não achei no C2X",
        titulo: `A API respondeu sucesso, mas o cadastro não apareceu no banco do C2X. Conferir para qual ambiente a escrita foi — o destino desta chamada foi ${destino} e produção é sistema.careli.adm.br.`,
        tom: "atencao",
      };
    case "ausente":
      return {
        texto: "Não entra na fila",
        titulo: motivo || "Esta ficha não entra na fila de envio para o C2X.",
        tom: "atencao",
      };
    default:
      return {
        texto: motivo || "O C2X recusou",
        titulo: `O C2X (${destino}) recusou: ${motivo || "motivo não informado."}`,
        tom: "erro",
      };
  }
}

// BOTÃO "SUBIR PARA O C2X", DENTRO DO CARD (pedido do Lucas, 08/08).
//
// Só aparece quando a CAD NÃO está confirmada no C2X — o mesmo critério do selo. O clique não pode
// abrir a ficha (o card inteiro é um botão), daí o `stopPropagation` no mouse e no teclado.
//
// O clique ENVIA de verdade (liberado em 08/08, depois de 18 CADs subirem por este mesmo caminho).
// Quem decide isso é o SERVIDOR, não este componente: se a rota responder `ensaio: true` — o que
// acontece com `C2X_ENVIO_CARD_LIBERADO=false`, o desligamento de emergência — a linha embaixo do
// botão carimba que foi simulação, para "subiu" e "subiria" nunca se parecerem na tela.
function BotaoSubirC2x({
  item,
  onSubir,
}: {
  item: ItemFila;
  onSubir: (entityId: string) => Promise<ResultadoSubidaC2x>;
}) {
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoSubidaC2x | null>(null);

  if (!foraDoC2x(item.c2xFalha)) return null;

  const clicar = async () => {
    // Trava de clique duplo: criar cadastro no C2X não tem desfazer, e o endpoint é genérico
    // (cada POST cria de novo). Dois cliques seriam duas pessoas no legado.
    if (enviando) return;
    setEnviando(true);
    setResultado(null);
    try {
      setResultado(await onSubir(item.id));
    } finally {
      setEnviando(false);
    }
  };

  const veredito = resultado ? vereditoC2x(resultado) : null;

  return (
    <div className="mt-2 border-t border-line/60 pt-1.5">
      <button
        className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-semibold text-ink-soft transition hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
        disabled={enviando}
        onClick={(event) => {
          event.stopPropagation();
          void clicar();
        }}
        onKeyDown={(event) => event.stopPropagation()}
        title="Sobe esta CAD para o C2X. Antes de enviar, confere os campos obrigatórios e diz o que falta."
        type="button"
      >
        {enviando ? (
          <Loader2 aria-hidden="true" className="size-3 animate-spin" />
        ) : (
          <Upload aria-hidden="true" className="size-3" />
        )}
        {enviando ? "Subindo…" : rotuloBotaoC2x(item.c2xFalha)}
      </button>

      {veredito ? (
        <p className={`m-0 mt-1 text-[10px] leading-tight ${TOM_C2X[veredito.tom]}`} title={veredito.titulo}>
          {veredito.texto}
          {resultado?.ensaio ? (
            <span className="ml-1 rounded border border-line px-1 py-px text-[9px] font-bold uppercase tracking-wide text-ink-muted">
              ensaio
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

// Card no padrão da Íris: borda esquerda colorida pelo TIPO, chip, nome, documento e rodapé.
function CardBoard({
  analista,
  item,
  onAbrir,
  onSubirC2x,
}: {
  analista: string;
  item: ItemFila;
  onAbrir: (item: ItemFila) => void;
  onSubirC2x: (entityId: string) => Promise<ResultadoSubidaC2x>;
}) {
  const imob = item.papel === "imobiliaria";
  const abrir = () => onAbrir(item);

  return (
    <article
      className="cursor-pointer rounded-lg border border-line/70 border-l-[3px] bg-surface px-2.5 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-subtle/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]/30"
      onClick={abrir}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          abrir();
        }
      }}
      role="button"
      style={{ borderLeftColor: imob ? "#A07C3B" : "#2563EB" }}
      tabIndex={0}
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        {imob ? (
          <Building2 className="size-3.5 shrink-0 text-[#A07C3B]" aria-hidden="true" />
        ) : (
          <UserRound className="size-3.5 shrink-0 text-blue-500" aria-hidden="true" />
        )}
        <span
          className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
            imob
              ? "border-[#A07C3B]/30 bg-[#A07C3B]/10 text-[#7A5E2C] dark:text-[#d9b877]"
              : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300"
          }`}
        >
          {imob ? "Imobiliária" : "CAD"}
        </span>
        {/* Falha de envio: o único estado que ganha destaque no card. Aparece SÓ quando existe. */}
        {item.erroEnvio ? (
          <span
            className="inline-flex items-center gap-0.5 rounded-full border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
            title="Falha no envio da cobrança ou do recibo — abra a ficha para ver o motivo"
          >
            <AlertTriangle aria-hidden="true" className="size-2.5" /> envio
          </span>
        ) : null}
        {/* SEM CAD: a ficha não tem linha na esteira, então não tem etapa nem empreendimento — ela
            aparece em Validação e VOLTA para lá a cada recarga, por mais que a análise de crédito
            já tenha sido feita. Marcar é o que transforma um fantasma numa pendência com dono.

            ⚠️ SÓ PARA CAD, NUNCA PARA IMOBILIÁRIA. Imobiliária não tem CAD — ela entra por
            credenciamento, e a esteira é de cadastro de cliente. Sem este `!imob`, o selo
            aparecia em 100% dos cards de imobiliária (conferido: 432 de 432 sem linha na
            esteira), o que é o oposto de um alerta: alarme que toca sempre ninguém escuta, e
            ainda mandava o operador procurar um empreendimento que não está faltando. */}
        {item.semCad && !imob ? (
          <span
            className="inline-flex items-center gap-0.5 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
            title="Esta ficha não tem CAD na esteira: falta informar o empreendimento no cadastro. Enquanto faltar, ela não sai da Validação."
          >
            <AlertTriangle aria-hidden="true" className="size-2.5" /> sem CAD
          </span>
        ) : null}
        {/* Não conseguiu subir para o C2X: o motivo fica no tooltip. */}
        <SeloC2x erro={item.c2xErro} falha={item.c2xFalha} />
        {/* PIX confirmado: dentro de "Credenciado" é o que separa quem pagou de quem só
            recebeu a cobrança. A hora fica no title (é ela que ordena a fila do Prometeu). */}
        {item.pagoEm ? (
          <span
            className="inline-flex items-center gap-0.5 rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
            title={`PIX confirmado em ${new Date(item.pagoEm).toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            })}`}
          >
            <Check aria-hidden="true" className="size-2.5" /> PIX pago
          </span>
        ) : null}
      </div>

      <p className="truncate text-sm font-semibold text-ink">{toTitleCase(item.nome)}</p>
      {item.documento ? (
        <p className="mt-0.5 truncate text-xs text-ink-muted tabular-nums">{item.documento}</p>
      ) : null}

      {/* Imobiliária e corretor (dado do Asana): de quem é a CAD. Só no funil da CAD. Em DUAS
          linhas — o corretor embaixo da imobiliária — pra nenhum dos dois ser cortado. */}
      {!imob && (item.imobiliaria || item.corretor) ? (
        <div className="mt-0.5 text-[11px] leading-tight text-ink-soft">
          <p className="m-0 truncate">{item.imobiliaria ?? "—"}</p>
          {item.corretor ? <p className="m-0 truncate text-ink-muted">{item.corretor}</p> : null}
        </div>
      ) : null}

      {/* Empreendimento em destaque: é a informação que o Lucas precisa bater de imediato. */}
      {item.empreendimentos.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.empreendimentos.map((nome) => (
            <span
              className="rounded border border-[#A07C3B]/25 bg-[#A07C3B]/8 px-1.5 py-0.5 text-[10px] font-semibold text-[#7A5E2C] dark:text-[#d9b877]"
              key={nome}
            >
              {toTitleCase(nome)}
            </span>
          ))}
        </div>
      ) : null}

      {/* O que veio junto: ajuda a dimensionar o trabalho antes de abrir. */}
      {item.socios || item.corretores ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {item.socios ? <MiniChip label={`${item.socios} sócio(s)`} /> : null}
          {item.corretores ? <MiniChip label={`${item.corretores} corretor(es)`} /> : null}
        </div>
      ) : null}

      {/* Subir esta CAD para o C2X. Fica logo acima do rodapé, colado no selo que denuncia a
          ausência: o operador vê o problema e a saída no mesmo lugar. Some sozinho quando a ficha
          passa a estar confirmada lá. */}
      <BotaoSubirC2x item={item} onSubir={onSubirC2x} />

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-ink-muted tabular-nums">
          {chegadaEm(item.criadoEm)}
        </span>
        {/* Analista responsável, no mesmo lugar em que a Íris mostra o operador. */}
        {analista ? (
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line bg-subtle text-[8px] font-bold text-ink-soft"
            title={analista}
          >
            {iniciais(analista)}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-ink-muted">
            há {esperaDesde(item.criadoEm)}
          </span>
        )}
      </div>
    </article>
  );
}

function MiniChip({ label }: { label: string }) {
  return (
    <span className="rounded border border-line bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">
      {label}
    </span>
  );
}

function DetalheBoard({
  emCorrecao,
  emRevisao,
  etapaAtual,
  indeferido,
  item,
  mensagens,
  onAbrirChat,
  onAprovarRestricao,
  onAvancar,
  onCorrecao,
  onCreditoResultado,
  onEnviarGestao,
  onHabilitar,
  onIdentidadeSalva,
  onIndeferir,
  onReabrir,
  onVoltar,
}: {
  etapaAtual: number;
  item: ItemFila;
  emCorrecao: boolean;
  emRevisao: boolean;
  indeferido: boolean;
  mensagens: number;
  onAbrirChat: () => void;
  // PROBLEMA 3: abre o modal do override da coordenação (evidência obrigatória).
  onAprovarRestricao: () => void;
  // Recebe o id da etapa em que o card está: é ele que diz para onde avançar (o Board não conta
  // posições, ele nomeia a etapa — trilhas de tamanhos diferentes convivem).
  onAvancar: (etapaAtualId: string) => void;
  onCorrecao: () => void;
  // Resultado do crédito: o servidor moveu a etapa (aprovado -> pré-venda, reprovado -> revisão)
  // e a tela reflete na hora.
  onCreditoResultado: (r: { aprovado: boolean; etapa?: string }) => void;
  // Escalar pro coordenador: o analista pede o aval de quem aprova o crédito.
  onEnviarGestao: () => void;
  // Habilita a imobiliária nos empreendimentos marcados. Só o card de imobiliária usa.
  onHabilitar?: (entityId: string, empreendimentos: string[]) => Promise<boolean>;
  // Nome/documento corrigido na validação: a fila precisa recarregar, senão o card fica velho.
  onIdentidadeSalva: () => void;
  onIndeferir: () => void;
  onReabrir: () => void;
  // Mesma ideia do `onAvancar`: o Board nomeia a etapa, não conta posições.
  onVoltar: (etapaAtualId: string) => void;
}) {
  const imob = item.papel === "imobiliaria";
  const etapas = etapasDoItem(item);
  const indice = Math.min(etapaAtual, etapas.length - 1);
  const etapa = etapas[indice];
  const concluida = etapaAtual >= etapas.length;

  // Revisitar uma etapa JÁ ALCANÇADA só para ver a tela (ex.: rever o resultado do crédito
  // estando na pré-venda), sem mexer na etapa real. `null` = mostra a etapa atual.
  const [visualizando, setVisualizando] = useState<number | null>(null);
  useEffect(() => setVisualizando(null), [item.id]);
  const indiceVisto = visualizando ?? indice;
  const etapaVista = etapas[indiceVisto] ?? etapa;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div className="min-w-0">
          <h2 className="m-0 truncate text-lg font-semibold tracking-tight text-ink">
            {toTitleCase(item.nome)}
          </h2>
          <p className="m-0 mt-0.5 text-xs text-ink-muted">
            {imob ? "Imobiliária" : "CAD · prospect"}
            {item.documento ? ` · ${item.documento}` : ""}
            {imob && item.corretores ? ` · ${item.corretores} corretor(es)` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {emRevisao ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#7C3AED]/10 px-3 py-1 text-xs font-semibold text-[#6D28D9] dark:text-[#c4b5fd]">
              <ShieldCheck aria-hidden="true" className="size-3.5" />
              Aguardando o coordenador
            </span>
          ) : null}
          {emCorrecao ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              <AlertTriangle aria-hidden="true" className="size-3.5" />
              Aguardando correção
            </span>
          ) : null}
          {indeferido ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              <X aria-hidden="true" className="size-3.5" />
              {imob ? "Recusada" : "Crédito indeferido"}
            </span>
          ) : null}
          {concluida ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              <Check aria-hidden="true" className="size-3.5" />
              {imob ? "Apta" : "Credenciado"}
            </span>
          ) : null}
        </div>
      </div>

      {/* trilha das etapas — cada etapa já alcançada é clicável para revisitar a tela */}
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {etapas.map((passo, i) => {
          const feita = i < etapaAtual;
          const atual = i === indice && !concluida;
          const alcancada = concluida || i <= indice;
          const vendo = i === indiceVisto;
          const conteudo = (
            <>
              <span
                className={`flex size-7 items-center justify-center rounded-full text-[11px] font-bold ${
                  feita
                    ? "bg-emerald-500 text-white"
                    : atual
                      ? "bg-inverse text-brand-ink"
                      : "border border-line bg-surface text-ink-muted"
                } ${vendo && !atual ? "ring-2 ring-[#A07C3B]/50 ring-offset-1" : ""}`}
              >
                {feita ? <Check aria-hidden="true" className="size-3.5" /> : i + 1}
              </span>
              <span className={`text-xs font-medium ${vendo ? "text-ink" : "text-ink-muted"}`}>
                {passo.label}
              </span>
            </>
          );
          return (
            <li className="flex items-center gap-2" key={passo.id}>
              {alcancada ? (
                <button
                  className="flex items-center gap-2 rounded-lg px-1 py-0.5 transition-colors hover:bg-subtle"
                  onClick={() => setVisualizando(atual ? null : i)}
                  title={`Ver ${passo.label}`}
                  type="button"
                >
                  {conteudo}
                </button>
              ) : (
                <span className="flex items-center gap-2 px-1 py-0.5">{conteudo}</span>
              )}
              {i < etapas.length - 1 ? (
                <span className="mx-1 h-px w-6 bg-line" />
              ) : null}
            </li>
          );
        })}
      </ol>

      {concluida && visualizando === null ? (
        <PainelConcluido imob={imob} />
      ) : etapaVista ? (
        <PainelEtapa
          entityId={item.id}
          etapa={etapaVista}
          imob={imob}
          onCreditoResultado={onCreditoResultado}
          onHabilitar={onHabilitar}
          onIdentidadeSalva={onIdentidadeSalva}
        />
      ) : (
        <PainelConcluido imob={imob} />
      )}

      <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
        <div className="flex items-center gap-2">
          <button
            className="inline-flex h-9 items-center rounded-lg border border-line px-4 text-sm font-medium text-ink-soft transition-colors hover:bg-subtle disabled:opacity-40"
            disabled={etapaAtual === 0}
            onClick={() => onVoltar(etapa?.id ?? "cadastro")}
            type="button"
          >
            Voltar
          </button>

          {/* Chat e histórico: compacto e destacado no dourado da marca, junto das ações. */}
          <button
            aria-label="Chat e histórico"
            className="relative inline-flex size-9 items-center justify-center rounded-lg border border-[#A07C3B]/40 bg-[#A07C3B]/10 text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/20 dark:text-[#d9b877]"
            onClick={onAbrirChat}
            title="Chat interno e histórico deste processo"
            type="button"
          >
            <MessageSquare aria-hidden="true" className="size-4" />
            {mensagens > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#A07C3B] px-1 text-[9px] font-bold text-white">
                {mensagens > 9 ? "9+" : mensagens}
              </span>
            ) : null}
          </button>
        </div>
        <div className="flex items-center gap-2">
          {indeferido || emCorrecao ? (
            // Não é beco sem saída: corrigida a pendência, a análise volta ao fluxo.
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-4 text-sm font-medium text-ink-soft transition-colors hover:bg-subtle"
              onClick={onReabrir}
              type="button"
            >
              {emCorrecao ? "Retomar análise" : "Reabrir análise"}
            </button>
          ) : emRevisao ? (
            // Em revisão = crédito REPROVADO. A decisão é da COORDENAÇÃO. Duas saídas (PROBLEMA 2 +
            // 3, Lucas 04/08): devolver para correção, OU aprovar COM RESTRIÇÃO — e aprovar exige a
            // evidência do de-acordo (o modal cobra o anexo). O antigo botão "Aprovar crédito
            // (coordenador)" empurrava reprovado -> prevenda sem evidência e sem registro; não
            // existe mais. Não há "indeferir": crédito reprovado vive na coluna de revisão.
            <>
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-300 px-4 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50 dark:border-amber-500/30 dark:text-amber-300 dark:hover:bg-amber-500/10"
                onClick={onCorrecao}
                type="button"
              >
                <AlertTriangle aria-hidden="true" className="size-4" />
                Enviar para correção
              </button>
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#7C3AED] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#6D28D9]"
                onClick={onAprovarRestricao}
                type="button"
              >
                <ShieldCheck aria-hidden="true" className="size-4" />
                Aprovar com restrição (coordenação)
              </button>
            </>
          ) : concluida ? null : (
            <>
              {/* "Recusar" é só do fluxo da IMOBILIÁRIA. No CAD não existe mais "indeferir
                  crédito": crédito reprovado vai sozinho para a coluna de revisão. */}
              {imob ? (
                <button
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 px-4 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                  onClick={onIndeferir}
                  type="button"
                >
                  <X aria-hidden="true" className="size-4" />
                  Recusar
                </button>
              ) : null}
              {/* Devolver pro corretor ajustar — não é reprovação, é pendência. */}
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-300 px-4 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50 dark:border-amber-500/30 dark:text-amber-300 dark:hover:bg-amber-500/10"
                onClick={onCorrecao}
                type="button"
              >
                <AlertTriangle aria-hidden="true" className="size-4" />
                Enviar para correção
              </button>
              {/* Escalar: quando o caso precisa do aval de quem aprova. */}
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#A07C3B]/40 px-4 text-sm font-medium text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10 dark:text-[#d9b877]"
                onClick={onEnviarGestao}
                type="button"
              >
                <ShieldCheck aria-hidden="true" className="size-4" />
                Enviar ao coordenador
              </button>
              {/* Na PRÉ-VENDA a ação de verdade (gerar o PIX e disparar a cobrança) vive no painel
                  da etapa, com feedback de envio — como o crédito faz com o Serasa. Um botão
                  genérico "Gerar PIX" aqui no rodapé só faria progresso++ e pularia pra Credenciado
                  SEM gerar nada, que era o que estava enganando. Por isso ele não aparece aqui. */}
              {/* ⚠️ NA ANÁLISE DE CRÉDITO O BOTÃO GENÉRICO TAMBÉM NÃO EXISTE MAIS. Ele dizia
                  "Consultar Serasa" e só fazia progresso++: o card pulava para a Pré-venda sem
                  consulta nenhuma, sem gravar nada, e o F5 desfazia — é o "cliente caindo em
                  pré-venda" que o Lucas viu em 10/08. A consulta de verdade vive no painel da
                  etapa, igual ao PIX. Sobra o avanço da Validação e a confirmação do Credenciado,
                  e os dois GRAVAM antes de mover a tela. */}
              {etapa && (etapa.id === "prevenda" || etapa.id === "credito") ? null : (
                <button
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-5 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90"
                  onClick={() => onAvancar(etapa?.id ?? "cadastro")}
                  type="button"
                >
                  <Check aria-hidden="true" className="size-4" />
                  {etapa ? acaoDaEtapa(etapa.id) : "Aprovar"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function acaoDaEtapa(id: string): string {
  if (id === "credito") return "Consultar Serasa";
  if (id === "prevenda") return "Gerar PIX";
  if (id === "credenciado") return "Confirmar pagamento";
  if (id === "habilitada") return "Habilitar imobiliária";
  return "Aprovar";
}

function PainelEtapa({
  entityId,
  etapa,
  imob,
  onCreditoResultado,
  onHabilitar,
  onIdentidadeSalva,
}: {
  entityId: string;
  etapa: Etapa;
  // `imob` PASSOU A SER USADO: a etapa "cadastro" da imobiliária ganha as caixinhas de
  // habilitação, que é a decisão que faltava. Antes ele chegava aqui e era ignorado, e o
  // operador validava os documentos sem ter onde concluir.
  imob?: boolean;
  onCreditoResultado?: (r: { aprovado: boolean; etapa?: string }) => void;
  onHabilitar?: (entityId: string, empreendimentos: string[]) => Promise<boolean>;
  onIdentidadeSalva?: () => void;
}) {
  const Icon = etapa.icon;
  return (
    <div className="rounded-xl border border-line bg-subtle/40 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-inverse text-brand-ink">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 className="m-0 text-sm font-semibold text-ink">{etapa.label}</h3>
          <p className="m-0 mt-1 text-xs text-ink-soft">{etapa.descricao}</p>
        </div>
      </div>

      {/* Validação cadastral = documento ORIGINAL ao lado dos dados lidos (ideia do Lucas): sem o
          documento à vista o operador estaria conferindo no escuro. As demais etapas ficam vazias
          até a lógica ser ligada — nada de dado de mentira na tela. */}
      {etapa.id === "cadastro" ? (
        <>
          <ValidacaoLadoALado entityId={entityId} onIdentidadeSalva={onIdentidadeSalva} />
          {/* Só a imobiliária conclui por aqui: a CAD de cliente avança pela trilha da esteira. */}
          {imob ? (
            <HabilitarEmpreendimentos entityId={entityId} onHabilitar={onHabilitar} />
          ) : null}
        </>
      ) : null}
      {etapa.id === "credito" ? (
        <CreditoSerasa entityId={entityId} onResultado={onCreditoResultado} />
      ) : null}
      {/* Pré-venda: o ciclo do PIX (gerou -> enviou -> recebeu), com os erros à vista. */}
      {etapa.id === "prevenda" ? <StatusPixPrevenda entityId={entityId} /> : null}
    </div>
  );
}

type DocItem = {
  documentType: string;
  fileName: string | null;
  hasFile: boolean;
  id: string;
  label: string;
};

type Ficha = {
  // O que o formulário do Asana diz sobre esta CAD. Referência para o operador decidir — ele
  // separa proponente de cônjuge e informa se é PF ou PJ.
  asana: {
    conjuge: string | null;
    perfil: string | null;
    proponente: string | null;
    tipoDiverge: boolean;
    tipoNoAsana: string | null;
    veredito: string | null;
  } | null;
  cadastro: Record<string, unknown>;
  conjuge: {
    cpf: string;
    dataNascimento: string;
    email: string;
    nome: string;
    nomeMae: string;
    telefone: string;
  };
  contato: { email: string; telefone: string };
  endereco: Record<string, string> | null;
  entidade: {
    criadoEm: string;
    documento: string;
    nome: string;
    nomeFantasia: string;
    papel: string;
    tipo: string;
  };
};

// `chave` = nome do campo em `apolo_esteira.ficha`. Campo COM chave é editável pelo operador;
// campo sem chave é só leitura (identidade da entidade, endereço e contato têm tabela própria).
// Regra do Lucas: "liberar os campos que a MOST não conseguiu nos devolver para que o operador
// possa completar o cadastro" — por isso o que é editável não depende do que veio preenchido.
type Edicao = {
  alteracoes: { campo: string; de: string; para: string }[];
  autor: string;
  quando: string;
};

type Campo = {
  chave?: string;
  full?: boolean;
  label: string;
  opcoes?: { id: number | string; label: string }[];
  tipo?: "data" | "select" | "texto";
  valor: string;
  valorCru?: string;
};
type SecaoFicha = { campos: Campo[]; titulo: string };

const texto = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const opcao = (lista: { id: number | string; label: string }[], id: unknown): string =>
  lista.find((o) => o.id.toString() === texto(id))?.label ?? "";

// Monta a ficha completa igual à REVISÃO do cadastro (decisão do Lucas: é essa tela que o
// operador quer ver na validação, com os dados de verdade, e não uma lista de rótulos).
// `rascunho` = o que o operador está digitando AGORA, ainda não salvo. Entra por cima do
// cadastro para que tudo que é DERIVADO acompanhe na hora: a idade recalcula ao trocar a data
// de nascimento, e a seção Cônjuge aparece assim que ele marca "Casado" — em vez de só depois
// de salvar e recarregar.
// `<input type="date">` só aceita yyyy-mm-dd: com "15/08/2020" ele renderiza VAZIO, e o operador
// vê um campo em branco onde havia data — e, se salvar sem perceber, apaga o que existia. As
// fichas trazem os dois formatos (o C2X entrega BR, o cadastro do Apolo entrega ISO).
function paraInputDate(valor: string): string {
  const limpo = valor.trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(limpo);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return limpo.slice(0, 10);
}

function montarSecoes(ficha: Ficha, rascunho: Record<string, string> = {}): SecaoFicha[] {
  const c = { ...ficha.cadastro, ...rascunho };
  const e = ficha.endereco;
  const pj = ficha.entidade.tipo === "pj";
  const secoes: SecaoFicha[] = [];
  // 2 = Casado, 6 = União Estável (ids do C2X, ver C2X_ESTADO_CIVIL). Decide o regime de bens
  // na Identificação E a existência da seção Cônjuge.
  const casado = ["2", "6"].includes(texto(c.estadoCivilId));

  if (pj) {
    // ⚠️ TODO CAMPO PRECISA DE `chave`, SENÃO NASCE TRAVADO. A tela só oferece input quando o
    // campo tem chave (`!editando || !campo.chave` → leitura). Estes campos vinham como
    // `{ label, valor }` puro, então continuavam cinza mesmo depois de clicar em Editar — foi o
    // que o Lucas encontrou ao tentar corrigir o telefone da imobiliária (15/08: "tudo tem que
    // ser editável quando eu clico em Editar").
    //
    // Razão social e CNPJ usam as chaves "__nome" e "__documento", que a tela já conhece: elas
    // viajam para a rota de IDENTIDADE (que valida dígito e colisão e audita), e não para o
    // patch cru da ficha. Trocar o CNPJ de uma empresa é mudar quem ela é.
    const empresaTexto = (chave: string, label: string, full = false): Campo => ({
      chave,
      full,
      label,
      tipo: "texto",
      valor: texto(c[chave]),
      valorCru: texto(c[chave]),
    });

    secoes.push({
      campos: [
        // ⚠️ RAZÃO SOCIAL E CNPJ FICAM SÓ DE LEITURA, e isso é decisão, não esquecimento.
        // Eles viajariam pela rota de IDENTIDADE, que recusa com 409 toda ficha espelho do C2X
        // ("a correção tem que ser feita no legado, senão o sync desfaz em até 6 horas") — e
        // **417 das 435 imobiliárias são espelho**. Pior que não gravar: em `salvarTudo` a
        // identidade vai PRIMEIRO e dá `throw`, então o 409 derrubaria a rodada inteira e o
        // telefone que o operador acabou de corrigir também não seria salvo.
        { full: true, label: "Razão social", valor: titleCase(ficha.entidade.nome) },
        {
          chave: "nomeFantasia",
          label: "Nome fantasia",
          tipo: "texto",
          valor: titleCase(texto(c.nomeFantasia) || ficha.entidade.nomeFantasia),
          valorCru: texto(c.nomeFantasia) || ficha.entidade.nomeFantasia,
        },
        { label: "CNPJ", valor: ficha.entidade.documento },
        empresaTexto("porte", "Porte"),
        {
          chave: "dataAbertura",
          label: "Abertura",
          tipo: "data",
          valor: formatDateBR(texto(c.dataAbertura)),
          valorCru: paraInputDate(texto(c.dataAbertura)),
        },
        {
          chave: "dataAtualizacaoCadastral",
          label: "Atualização cadastral",
          tipo: "data",
          valor: formatDateBR(texto(c.dataAtualizacaoCadastral)),
          valorCru: paraInputDate(texto(c.dataAtualizacaoCadastral)),
        },
        empresaTexto("situacaoCadastral", "Situação cadastral"),
        empresaTexto("naturezaJuridica", "Natureza jurídica", true),
        empresaTexto("cnae", "CNAE"),
        empresaTexto("atividade", "Atividade principal", true),
        // CRECI aparece SEMPRE no modo PJ: antes só existia se já estivesse preenchido, então
        // a imobiliária sem CRECI lido não tinha onde digitá-lo.
        empresaTexto("creci", "CRECI Jurídico"),
      ],
      titulo: "Dados da empresa",
    });
  } else {
    // A EXIBIÇÃO já sai padronizada, mesmo para o que foi importado antes da regra existir:
    // nome em "Primeira Maiúscula" e telefone em (37) 99956-9096. Assim o operador vê o padrão
    // sem precisar reescrever 392 fichas — e o que ele salvar já vai padronizado do servidor.
    const livre = (chave: string, label: string, full = false): Campo => {
      const bruto = texto(c[chave]);
      const ehNome = /nome|naturalidade|nacionalidade|logradouro|bairro|cidade/i.test(chave);
      const ehTelefone = /telefone/i.test(chave);
      return {
        chave,
        full,
        label,
        tipo: "texto",
        valor: ehTelefone ? formatarTelefoneBR(bruto) : ehNome ? titleCase(bruto) : bruto,
        valorCru: ehTelefone ? formatarTelefoneBR(bruto) : bruto,
      };
    };
    const lista = (
      chave: string,
      label: string,
      opcoes: { id: number | string; label: string }[],
    ): Campo => ({
      chave,
      label,
      opcoes,
      tipo: "select",
      valor: opcao(opcoes, c[chave]),
      valorCru: texto(c[chave]),
    });

    // ESPELHO DA REVISÃO DO FORMULÁRIO (decisão do Lucas 21/jul): a validação confere
    // exatamente os campos que a revisão do wizard mostra ao fim do cadastro — mesmas seções,
    // mesma ordem, mesmos rótulos. Ver `montarCadDoc` em blocks/cadastro/cadastro-flow.tsx.
    // Por isso NÃO há nome do pai, RG nem órgão emissor: o formulário não os revisa (o dado
    // lido do documento continua salvo, só não é conferido aqui).
    secoes.push({
      campos: [
        // As chaves "__" não são da ficha: viajam para a rota de IDENTIDADE, que valida o
        // documento, recusa duplicado, troca o identificador e refaz o índice de busca.
        {
          chave: "__nome",
          full: true,
          label: "Nome",
          tipo: "texto",
          valor: titleCase(ficha.entidade.nome),
          valorCru: ficha.entidade.nome,
        },
        {
          chave: "__documento",
          label: "CPF",
          tipo: "texto",
          valor: ficha.entidade.documento,
          valorCru: ficha.entidade.documento,
        },
        {
          chave: "__tipo",
          label: "Tipo",
          opcoes: [
            { id: "pf", label: "Pessoa Física" },
            { id: "pj", label: "Pessoa Jurídica" },
          ],
          tipo: "select",
          valor: ficha.entidade.tipo === "pj" ? "Pessoa Jurídica" : "Pessoa Física",
          valorCru: ficha.entidade.tipo,
        },
        {
          chave: "dataNascimento",
          label: "Nascimento",
          tipo: "data",
          valor: formatDateBR(texto(c.dataNascimento)),
          valorCru: texto(c.dataNascimento).slice(0, 10),
        },
        // Derivada do nascimento, como na revisão: não se digita idade, se digita a data.
        { label: "Idade", valor: calcIdade(texto(c.dataNascimento)) },
        livre("nomeMae", "Nome da mãe", true),
        livre("naturalidade", "Naturalidade"),
        livre("nacionalidade", "Nacionalidade"),
        lista("sexoId", "Sexo", C2X_SEXO),
        lista("estadoCivilId", "Estado civil", C2X_ESTADO_CIVIL),
        // Regime de bens só existe casado/união estável — igual à revisão.
        ...(casado ? [lista("regimeBensId", "Regime de bens", C2X_REGIME_BENS)] : []),
      ],
      titulo: "Identificação",
    });

    secoes.push({
      campos: [
        lista("escolaridadeId", "Escolaridade", C2X_ESCOLARIDADE),
        lista("rendaId", "Faixa de renda", C2X_FAIXA_RENDA),
        livre("patrimonio", "Patrimônio"),
        lista("profissaoId", "Profissão", C2X_PROFISSOES),
      ],
      titulo: "Perfil",
    });
  }

  // ENDEREÇO SEMPRE VISÍVEL, mesmo vazio (Lucas 21/jul: "não vi a parte de endereço").
  // As CADs importadas do Asana não trazem endereço, e a seção simplesmente sumia — o
  // operador não tinha onde preencher justamente o que falta. O valor mostrado vem da ficha
  // quando o operador já editou, senão do endereço cadastrado.
  const endCampo = (chave: string, label: string, full = false): Campo => {
    const bruto = texto(c[chave]) || texto(e?.[chave] ?? "");
    // Logradouro, bairro e cidade vêm em CAIXA ALTA do C2X e do OCR.
    const valor = /logradouro|bairro|cidade|complemento/i.test(chave)
      ? titleCase(bruto)
      : bruto;
    return { chave, full, label, tipo: "texto", valor, valorCru: valor };
  };

  secoes.push({
    campos: [
      endCampo("logradouro", "Logradouro", true),
      endCampo("numero", "Número"),
      endCampo("complemento", "Complemento"),
      endCampo("bairro", "Bairro"),
      endCampo("cep", "CEP"),
      endCampo("cidade", "Cidade"),
      endCampo("uf", "UF"),
    ],
    titulo: "Endereço",
  });

  secoes.push({
    campos: [
      {
        chave: "telefone",
        label: "Telefone",
        tipo: "texto",
        valor: formatarTelefoneBR(texto(c.telefone) || ficha.contato.telefone),
        valorCru: formatarTelefoneBR(texto(c.telefone) || ficha.contato.telefone),
      },
      {
        chave: "email",
        full: true,
        label: "E-mail",
        tipo: "texto",
        valor: texto(c.email) || ficha.contato.email,
        valorCru: texto(c.email) || ficha.contato.email,
      },
    ],
    titulo: "Contato",
  });

  // CÔNJUGE — a revisão do formulário mostra a ficha inteira dele quando casado, e é
  // material de contrato. Aqui é read-only: o cônjuge é entidade própria, com ficha própria.
  // CÔNJUGE — aparece SEMPRE que o estado civil é casado/união estável, mesmo vazio, e é
  // EDITÁVEL (Lucas 21/jul: "se o cliente for casado, temos que ter os dados do cônjuge; o
  // ideal é vir do documento, mas se não tiver jeito, habilita para o operador preencher").
  // Sem cônjuge não se fecha contrato de casado.
  const conj = ficha.conjuge;
  const campoConjuge = (
    chave: string,
    label: string,
    valor: string,
    full = false,
  ): Campo => ({
    chave,
    full,
    label,
    tipo: "texto",
    // O que o operador digitou na ficha ganha do que veio do relacionamento.
    valor: texto(c[chave]) || valor,
    valorCru: texto(c[chave]) || valor,
  });

  if (casado) {
    secoes.push({
      campos: [
        campoConjuge("conjugeNome", "Nome", titleCase(conj.nome), true),
        campoConjuge("conjugeCpf", "CPF", conj.cpf),
        {
          chave: "conjugeNascimento",
          label: "Nascimento",
          tipo: "data",
          valor: formatDateBR(texto(c.conjugeNascimento) || conj.dataNascimento),
          valorCru: (texto(c.conjugeNascimento) || conj.dataNascimento).slice(0, 10),
        },
        {
          label: "Idade",
          valor: calcIdade(texto(c.conjugeNascimento) || conj.dataNascimento),
        },
        campoConjuge("conjugeMae", "Nome da mãe", titleCase(conj.nomeMae), true),
        campoConjuge("conjugeTelefone", "Telefone", formatarTelefoneBR(conj.telefone)),
        campoConjuge("conjugeEmail", "E-mail", conj.email, true),
      ],
      titulo: "Cônjuge",
    });
  }

  // Sócios cadastrados (ficha própria de cada um).
  const socios = Array.isArray(c.socios) ? (c.socios as Record<string, unknown>[]) : [];
  socios.forEach((s, i) => {
    const end = (s.endereco ?? {}) as Record<string, string>;

    // Chave com CAMINHO (`socios.0.telefone`). O sócio mora dentro de um array, então não tem
    // chave plana como o resto da ficha — e sem chave o campo nasce só de leitura. `salvarTudo`
    // reagrupa esses caminhos e manda o array `socios` inteiro já corrigido.
    //
    // É por aqui que se corrige o TELEFONE DO REPRESENTANTE, que é justamente para onde saem as
    // mensagens de credenciamento (a flag `representanteLegal` escolhe o destinatário). Errado
    // ali, a imobiliária não recebe nada e ninguém descobre por quê.
    const doSocio = (
      campo: string,
      label: string,
      opts: { full?: boolean; opcoes?: { id: number | string; label: string }[]; tipo?: Campo["tipo"] } = {},
    ): Campo => {
      const bruto = texto(s[campo]);
      const ehNome = /nome|bairro|cidade|logradouro/i.test(campo);
      const ehTelefone = /telefone/i.test(campo);
      return {
        chave: `socios.${i}.${campo}`,
        full: opts.full,
        label,
        opcoes: opts.opcoes,
        tipo: opts.tipo ?? "texto",
        valor: opts.opcoes
          ? opcao(opts.opcoes, s[campo])
          : opts.tipo === "data"
            ? formatDateBR(bruto)
            : ehTelefone
              ? formatarTelefoneBR(bruto)
              : ehNome
                ? titleCase(bruto)
                : bruto,
        valorCru: opts.tipo === "data"
          ? paraInputDate(bruto)
          : ehTelefone
            ? formatarTelefoneBR(bruto)
            : bruto,
      };
    };
    const doEndereco = (campo: string, label: string, full = false): Campo => {
      const bruto = texto(end[campo]);
      const ehNome = /bairro|cidade|logradouro/i.test(campo);
      return {
        chave: `socios.${i}.endereco.${campo}`,
        full,
        label,
        tipo: "texto",
        valor: ehNome ? titleCase(bruto) : bruto,
        valorCru: bruto,
      };
    };

    secoes.push({
      campos: [
        doSocio("nome", "Nome", { full: true }),
        doSocio("cpf", "CPF"),
        doSocio("dataNascimento", "Nascimento", { tipo: "data" }),
        doSocio("sexoId", "Sexo", { opcoes: C2X_SEXO, tipo: "select" }),
        doSocio("estadoCivilId", "Estado civil", { opcoes: C2X_ESTADO_CIVIL, tipo: "select" }),
        doSocio("telefone", "Telefone"),
        doSocio("email", "E-mail", { full: true }),
        doEndereco("cep", "CEP"),
        doEndereco("logradouro", "Logradouro", true),
        doEndereco("numero", "Número"),
        doEndereco("complemento", "Complemento"),
        doEndereco("bairro", "Bairro"),
        doEndereco("cidade", "Cidade"),
        doEndereco("uf", "UF"),
      ],
      titulo: `Sócio ${i + 1}${s.representanteLegal ? " · representante legal" : ""}`,
    });
  });

  // Empreendimentos pedidos e corretores vinculados (imobiliária).
  const empreendimentos = Array.isArray(c.empreendimentos)
    ? (c.empreendimentos as Record<string, unknown>[])
    : [];
  if (empreendimentos.length) {
    secoes.push({
      campos: empreendimentos.map((emp, i) => ({
        full: true,
        label: `Empreendimento ${i + 1}`,
        valor: titleCase(texto(emp.label)),
      })),
      titulo: "Empreendimentos vinculados",
    });
  }

  const corretores = Array.isArray(c.corretores)
    ? (c.corretores as Record<string, unknown>[])
    : [];
  corretores.forEach((k, i) => {
    // Editável pelo mesmo caminho dos sócios. ⚠️ ESCOPO: corrige o que a imobiliária DECLAROU
    // no cadastro. O corretor também existe como entidade própria com vínculo em
    // `apolo_relationships`, e essa ficha tem tela própria — corrigir aqui não reescreve lá.
    const doCorretor = (campo: string, label: string, full = false): Campo => {
      const bruto = texto(k[campo]);
      const ehTelefone = /telefone/i.test(campo);
      return {
        chave: `corretores.${i}.${campo}`,
        full,
        label,
        tipo: "texto",
        valor: /nome/i.test(campo)
          ? titleCase(bruto)
          : ehTelefone
            ? formatarTelefoneBR(bruto)
            : bruto,
        valorCru: ehTelefone ? formatarTelefoneBR(bruto) : bruto,
      };
    };

    secoes.push({
      campos: [
        doCorretor("nome", "Nome", true),
        doCorretor("cpf", "CPF"),
        doCorretor("creci", "CRECI"),
        doCorretor("telefone", "Telefone"),
        doCorretor("email", "E-mail", true),
      ],
      titulo: `Corretor ${i + 1}`,
    });
  });

  return secoes;
}

// Ficha completa (esquerda) + documento original (direita). O operador lê a ficha e confere no
// documento antes de aprovar.
function ValidacaoLadoALado({
  entityId,
  onIdentidadeSalva,
}: {
  entityId: string;
  // Avisa a FILA que o nome/documento mudou. Sem isso, o card, a linha da tabela e o título
  // desta própria tela continuam com o nome antigo até um F5: eles leem de `itens`, carregado
  // uma vez só, e aqui a gente recarregava apenas a ficha. Ver o comentário de `carregarFila`.
  onIdentidadeSalva?: () => void;
}) {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ativo, setAtivo] = useState<DocItem | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  // MODO DE EDIÇÃO explícito (Lucas 21/jul): o operador confere a ficha em leitura, clica em
  // Editar, mexe no que precisa e salva UMA vez. Melhor que salvar campo a campo — a trilha
  // de auditoria fica coerente ("nesta edição mudou X, Y e Z") e não há gravação sem querer.
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  // Só o que o operador MEXEU. Campo intocado não vai no PATCH e não vira linha de auditoria.
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  // HISTÓRICO: o que mudou, para qual valor e quem. Carregado sob demanda — a maioria das
  // fichas nunca foi editada, e buscar isso em toda abertura seria consulta à toa.
  const [historico, setHistorico] = useState<Edicao[] | null>(null);
  const [abrindoHistorico, setAbrindoHistorico] = useState(false);
  const [edicaoAberta, setEdicaoAberta] = useState<number | null>(null);

  const verHistorico = async () => {
    if (historico) {
      setHistorico(null);
      return;
    }
    setAbrindoHistorico(true);
    try {
      const accessToken = await getApoloAccessToken();
      const resposta = await fetch(`/api/apolo/board/${entityId}/historico`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const corpo = (await resposta.json()) as { data?: { edicoes: Edicao[] } };
      setHistorico(corpo.data?.edicoes ?? []);
    } catch {
      setHistorico([]);
    } finally {
      setAbrindoHistorico(false);
    }
  };

  // Valor corrente de um campo: o que o operador digitou nesta edição, senão o que veio do banco.
  const valorDe = (chave: string, original: string) => rascunho[chave] ?? original;

  const mexer = (chave: string, valor: string) =>
    setRascunho((atual) => ({ ...atual, [chave]: valor }));

  // CEP digitado -> traz o resto do endereço (ViaCEP), igual ao wizard. Preenche só o que
  // estiver vazio, para não apagar o que o operador já corrigiu à mão.
  const preencherPorCep = async (valor: string) => {
    mexer("cep", valor);
    const achado = await buscarEnderecoPorCep(valor);
    if (!achado) return;
    const atual = (ficha?.cadastro ?? {}) as Record<string, unknown>;
    setRascunho((rasc) => {
      const proximo = { ...rasc };
      for (const [campo, vindo] of Object.entries({
        bairro: achado.bairro,
        cidade: achado.cidade,
        logradouro: achado.logradouro,
        uf: achado.uf,
      })) {
        if (vindo && !(proximo[campo] ?? texto(atual[campo]))) proximo[campo] = vindo;
      }
      return proximo;
    });
  };

  const cancelarEdicao = () => {
    setRascunho({});
    setEditando(false);
    setErroSalvar(null);
  };

  // SALVA TUDO de uma vez, ao fim da edição.
  //
  // São dois destinos, e a ordem importa: identidade (nome/documento/tipo) vai para a rota
  // própria, que valida CPF/CNPJ, recusa documento repetido, troca o identificador e refaz o
  // índice de busca. Se ela falhar, PARA — não faz sentido gravar o resto de uma ficha cuja
  // identidade não pôde ser corrigida.
  const salvarTudo = async () => {
    if (!ficha) return;
    setSalvando(true);
    setErroSalvar(null);

    try {
      const accessToken = await getApoloAccessToken();
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      };

      const nomeNovo = rascunho.__nome;
      const docNovo = rascunho.__documento;
      const tipoNovo = rascunho.__tipo;
      const mexeuNaIdentidade =
        nomeNovo !== undefined || docNovo !== undefined || tipoNovo !== undefined;

      if (mexeuNaIdentidade) {
        const resposta = await fetch(`/api/apolo/board/${entityId}/identidade`, {
          body: JSON.stringify({
            documento: docNovo ?? ficha.entidade.documento,
            motivo: "Correcao na validacao da CAD",
            nome: nomeNovo ?? ficha.entidade.nome,
            tipo: tipoNovo ?? ficha.entidade.tipo,
          }),
          headers,
          method: "POST",
        });
        if (!resposta.ok) {
          const payload = (await resposta.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Não foi possível salvar a identidade.");
        }
      }

      // O resto vai para a ficha. As chaves com "__" são da identidade e não entram aqui.
      const campos: Record<string, unknown> = Object.fromEntries(
        Object.entries(rascunho).filter(([chave]) => !chave.startsWith("__")),
      );

      // CAMINHOS (`socios.0.telefone`) viram o array `socios` INTEIRO, já corrigido — é o que
      // permite consertar o telefone do representante legal, que é justamente para onde saem as
      // mensagens de credenciamento. Ver `expandirCamposComCaminho` (com testes).
      const paraGravar = expandirCamposComCaminho(
        campos,
        (ficha.cadastro ?? {}) as Record<string, unknown>,
      );

      if (Object.keys(paraGravar).length > 0) {
        const resposta = await fetch(`/api/apolo/board/${entityId}`, {
          body: JSON.stringify({ campos: paraGravar }),
          headers,
          method: "PATCH",
        });
        if (!resposta.ok) {
          const payload = (await resposta.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Não foi possível salvar.");
        }
      }

      // Recarrega do servidor: a identidade mudou em outra tabela, e refletir só o rascunho
      // mostraria a tela "certa" com o banco em outro estado.
      const recarregada = await fetch(`/api/apolo/board/${entityId}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await recarregada.json()) as { data?: Ficha };
      if (payload.data) setFicha(payload.data);

      // Só quando a IDENTIDADE mudou: é o único caso em que a fila mostra dado velho. Salvar
      // profissão ou renda não muda o card, e refetch a cada salvamento seria peso à toa.
      if (mexeuNaIdentidade) {
        onIdentidadeSalva?.();
      }

      setRascunho({});
      setEditando(false);
    } catch (error) {
      setErroSalvar((error as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  useEffect(() => {
    let alive = true;
    setCarregando(true);
    void (async () => {
      try {
        const accessToken = await getApoloAccessToken();
        const headers = { Authorization: `Bearer ${accessToken}` };
        const [resDocs, resFicha] = await Promise.all([
          fetch(`/api/apolo/documentos?entityId=${encodeURIComponent(entityId)}`, {
            cache: "no-store",
            headers,
          }),
          fetch(`/api/apolo/board/${entityId}`, { cache: "no-store", headers }),
        ]);
        // ⚠️ /api/apolo/documentos devolve { documents } na RAIZ, sem envelope `data` —
        // diferente de /api/apolo/board/[id], que usa { data }. Ler data.documents aqui fazia
        // a lista vir SEMPRE vazia: a validação nunca mostrou documento nenhum, e só dava para
        // perceber depois que passou a existir documento para mostrar.
        const payloadDocs = (await resDocs.json()) as {
          documents?: DocItem[];
        };
        const payloadFicha = (await resFicha.json()) as { data?: Ficha };
        const lista = (payloadDocs.documents ?? []).filter((doc) => doc.hasFile);
        if (!alive) return;
        setDocs(lista);
        setAtivo(lista[0] ?? null);
        setFicha(payloadFicha.data ?? null);
      } catch {
        // sem documentos/ficha
      } finally {
        if (alive) setCarregando(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [entityId]);

  // Cada arquivo é servido por URL assinada (bucket privado).
  useEffect(() => {
    if (!ativo) {
      setUrl(null);
      return;
    }
    let alive = true;
    setAbrindo(true);
    setZoom(1);
    void (async () => {
      try {
        const accessToken = await getApoloAccessToken();
        const response = await fetch(`/api/apolo/documentos/${ativo.id}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const payload = (await response.json()) as { url?: string };
        if (alive) setUrl(payload.url ?? null);
      } catch {
        if (alive) setUrl(null);
      } finally {
        if (alive) setAbrindo(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ativo]);

  const ehPdf = (nome: string | null) => /\.pdf$/i.test(nome ?? "");

  return (
    <div className="mt-4 grid gap-3 xl:grid-cols-2">
      {/* ---- 1) ficha completa: os DADOS vêm primeiro (a mesma tela da revisão) ---- */}
      <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-surface p-4">
        {carregando ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 aria-hidden="true" className="size-5 animate-spin text-ink-muted" />
          </div>
        ) : !ficha ? (
          <p className="py-16 text-center text-xs text-ink-muted">
            Não foi possível carregar a ficha.
          </p>
        ) : (
          <div className="grid gap-5">
            {/* Barra de edição: leitura -> Editar -> mexe -> Salvar. Uma gravação só, com uma
                trilha de auditoria coerente do que mudou naquela passada. */}
            <div className="flex items-center gap-2">
              {editando ? (
                <>
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg bg-inverse px-3 py-1.5 text-xs font-bold text-brand-ink disabled:opacity-60"
                    disabled={salvando}
                    onClick={() => void salvarTudo()}
                    type="button"
                  >
                    {salvando ? (
                      <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                    ) : (
                      <Check aria-hidden="true" className="size-3.5" />
                    )}
                    {salvando ? "Salvando…" : "Salvar alterações"}
                  </button>
                  <button
                    className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-subtle disabled:opacity-60"
                    disabled={salvando}
                    onClick={cancelarEdicao}
                    type="button"
                  >
                    Cancelar
                  </button>
                  {Object.keys(rascunho).length > 0 ? (
                    <span className="text-[11px] text-ink-muted">
                      {Object.keys(rascunho).length} campo(s) alterado(s)
                    </span>
                  ) : null}
                </>
              ) : (
                <>
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-ink hover:bg-subtle"
                    onClick={() => setEditando(true)}
                    type="button"
                  >
                    <UserRound aria-hidden="true" className="size-3.5" />
                    Editar ficha
                  </button>
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-subtle"
                    onClick={() => void verHistorico()}
                    type="button"
                  >
                    {abrindoHistorico ? (
                      <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                    ) : (
                      <ListOrdered aria-hidden="true" className="size-3.5" />
                    )}
                    {historico ? "Fechar histórico" : "Histórico"}
                  </button>
                </>
              )}
            </div>

            {historico ? (
              <div className="rounded-lg border border-line bg-subtle/30 p-3">
                <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  Histórico de alterações
                </p>
                {historico.length === 0 ? (
                  <p className="m-0 text-xs text-ink-muted">Esta ficha ainda não foi editada.</p>
                ) : (
                  <ul className="m-0 grid list-none gap-1 p-0">
                    {historico.map((edicao, i) => (
                      <li key={`${edicao.quando}-${i}`}>
                        {/* Clicar abre o que mudou naquela edição. */}
                        <button
                          className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-subtle"
                          onClick={() => setEdicaoAberta(edicaoAberta === i ? null : i)}
                          type="button"
                        >
                          <span className="text-ink">
                            <b>{edicao.autor}</b> alterou {edicao.alteracoes.length} campo(s)
                          </span>
                          <span className="shrink-0 text-ink-muted">
                            {new Date(edicao.quando).toLocaleString("pt-BR", {
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                              month: "2-digit",
                            })}
                          </span>
                        </button>

                        {edicaoAberta === i ? (
                          <div className="mb-1 ml-2 grid gap-1 border-l border-line pl-3">
                            {edicao.alteracoes.map((alt, j) => (
                              <p className="m-0 text-xs text-ink-soft" key={`${alt.campo}-${j}`}>
                                <b className="text-ink">{alt.campo}</b>: {alt.de}{" "}
                                <span className="text-ink-muted">→</span>{" "}
                                <b className="text-ink">{alt.para}</b>
                              </p>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {/* O que o FORMULÁRIO do Asana diz. Só aparece quando diverge do que está na
                ficha: aviso que aparece sempre vira paisagem e ninguém lê. A correção é
                MANUAL de propósito (decisão do Lucas, 21/jul) — trocar identidade de cliente
                não é coisa para a máquina decidir sozinha. */}
            {ficha.asana && (ficha.asana.veredito === "trocado" || ficha.asana.tipoDiverge) ? (
              <div className="rounded-lg border border-amber-400 bg-amber-50/70 px-3 py-2 dark:bg-amber-950/25">
                <p className="m-0 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-amber-900 dark:text-amber-300">
                  <AlertTriangle className="shrink-0" size={13} />
                  Diverge do formulário do Asana
                </p>
                {ficha.asana.veredito === "trocado" ? (
                  <p className="m-0 mt-1 text-xs text-ink">
                    O proponente da CAD é <b>{ficha.asana.proponente}</b>
                    {ficha.asana.conjuge ? (
                      <>
                        {" "}
                        e o cônjuge é <b>{ficha.asana.conjuge}</b>
                      </>
                    ) : null}
                    . Esta ficha está no nome de <b>{titleCase(ficha.entidade.nome)}</b>.
                  </p>
                ) : null}
                {ficha.asana.tipoDiverge ? (
                  <p className="m-0 mt-1 text-xs text-ink">
                    O Asana marca esta CAD como <b>{ficha.asana.perfil}</b>, e a ficha está como{" "}
                    <b>{ficha.entidade.tipo === "pj" ? "Pessoa Jurídica" : "Pessoa Física"}</b>.
                    {ficha.asana.tipoNoAsana === "pj"
                      ? " O CNPJ não vem do formulário: preencha à mão."
                      : null}
                  </p>
                ) : null}
              </div>
            ) : null}

            {erroSalvar ? (
              <p className="m-0 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
                {erroSalvar}
              </p>
            ) : null}
            {montarSecoes(ficha, rascunho).map((secao) => (
              <div key={secao.titulo}>
                <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">
                  {secao.titulo}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {secao.campos.map((campo) => (
                    <div
                      className={`rounded-lg border px-3 py-2 ${
                        campo.chave ? "border-line bg-surface" : "border-line bg-subtle/40"
                      } ${campo.full ? "sm:col-span-2" : ""}`}
                      key={`${secao.titulo}-${campo.label}`}
                    >
                      <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                        {campo.label}
                      </p>

                      {/* Fora do modo de edição TUDO é leitura, inclusive o que é editável:
                          o operador confere primeiro e só mexe depois de clicar em Editar. */}
                      {!editando || !campo.chave ? (
                        <p className="m-0 mt-0.5 text-sm text-ink">
                          {(campo.chave ? valorDe(campo.chave, campo.valor) : campo.valor) || "—"}
                        </p>
                      ) : campo.tipo === "select" ? (
                        /* ⚠️ NÃO trocar por `bg-transparent`. O popup do <select> é desenhado
                           pelo browser usando a cor de fundo COMPUTADA do elemento, e
                           `transparent` resolve para BRANCO — enquanto a <option> herda o
                           `text-ink` claro do dark. Dá branco no branco, ilegível (bug visto
                           em 21/jul). O globals.css já amarra `color-scheme` ao tema, mas um
                           background explícito no select passa por cima disso. */
                        <select
                          className="mt-0.5 w-full rounded border border-line bg-surface px-1.5 py-1 text-sm text-ink outline-none [&>option]:bg-surface [&>option]:text-ink"
                          onChange={(event) => mexer(campo.chave!, event.target.value)}
                          value={valorDe(campo.chave, campo.valorCru ?? "")}
                        >
                          <option value="">—</option>
                          {(campo.opcoes ?? []).map((o) => (
                            <option key={o.id} value={o.id.toString()}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="mt-0.5 w-full rounded border border-line bg-surface px-1.5 py-1 text-sm text-ink outline-none placeholder:text-ink-muted"
                          onChange={(event) => {
                            const bruto = event.target.value;
                            if (campo.chave === "cep") return void preencherPorCep(bruto);
                            // Telefone ganha a máscara do Apolo enquanto se digita.
                            const ehTelefone = campo.chave!.toLowerCase().includes("telefone");
                            mexer(campo.chave!, ehTelefone ? formatarTelefoneBR(bruto) : bruto);
                          }}
                          placeholder="—"
                          type={campo.tipo === "data" ? "date" : "text"}
                          value={valorDe(campo.chave, campo.valorCru ?? "")}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- 2) documentos: a conferência vem depois dos dados ---- */}
      <div className="flex min-h-[360px] flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line p-2">
          {carregando ? (
            <span className="px-2 py-1 text-xs text-ink-muted">Carregando documentos…</span>
          ) : docs.length === 0 ? (
            <span className="px-2 py-1 text-xs text-ink-muted">Nenhum documento anexado.</span>
          ) : (
            docs.map((doc) => (
              <button
                className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  ativo?.id === doc.id
                    ? "bg-inverse text-brand-ink"
                    : "text-ink-soft hover:bg-subtle"
                }`}
                key={doc.id}
                onClick={() => setAtivo(doc)}
                type="button"
              >
                {doc.label}
              </button>
            ))
          )}
        </div>

        <div className="relative min-h-0 flex-1 overflow-auto bg-subtle/60">
          {abrindo ? (
            <div className="flex h-full items-center justify-center py-16">
              <Loader2 aria-hidden="true" className="size-5 animate-spin text-ink-muted" />
            </div>
          ) : !url ? (
            <div className="flex h-full items-center justify-center py-16 text-xs text-ink-muted">
              Selecione um documento.
            </div>
          ) : ehPdf(ativo?.fileName ?? null) ? (
            <iframe className="size-full min-h-[320px]" src={url} title={ativo?.label ?? "Documento"} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={ativo?.label ?? "Documento"}
              className="mx-auto block origin-top transition-transform"
              src={url}
              style={{ transform: `scale(${zoom})` }}
            />
          )}
        </div>

        {/* Foto de celular sem zoom não dá pra conferir: lupa igual à do Chronos. */}
        {url && !ehPdf(ativo?.fileName ?? null) ? (
          <div className="flex shrink-0 items-center justify-center gap-2 border-t border-line p-2">
            {[1, 1.5, 2, 3].map((nivel) => (
              <button
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                  zoom === nivel ? "bg-inverse text-brand-ink" : "text-ink-soft hover:bg-subtle"
                }`}
                key={nivel}
                onClick={() => setZoom(nivel)}
                type="button"
              >
                {nivel}x
              </button>
            ))}
          </div>
        ) : null}
      </div>

    </div>
  );
}


// AS CAIXINHAS DA HABILITAÇÃO. É aqui que a validação da imobiliária vira decisão: o operador
// confere os documentos ao lado (ValidacaoLadoALado) e marca o que libera.
//
// Mostra o que ela PEDIU, não a lista de empreendimentos ativos: liberar algo que a imobiliária
// não pediu seria decidir por ela, e o servidor recusa de qualquer forma.
function HabilitarEmpreendimentos({
  entityId,
  onHabilitar,
}: {
  entityId: string;
  onHabilitar?: (entityId: string, empreendimentos: string[]) => Promise<boolean>;
}) {
  const [lista, setLista] = useState<
    { enterpriseId: string; habilitado: boolean; label: string }[] | null
  >(null);
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<null | string>(null);

  useEffect(() => {
    let ativo = true;
    void (async () => {
      try {
        const token = await getApoloAccessToken();
        const resposta = await fetch(
          `/api/apolo/board/${encodeURIComponent(entityId)}/habilitar`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const corpo = (await resposta.json().catch(() => null)) as {
          data?: { empreendimentos?: { enterpriseId: string; habilitado: boolean; label: string }[] };
        } | null;
        if (!ativo) return;

        const empreendimentos = corpo?.data?.empreendimentos ?? [];
        setLista(empreendimentos);
        // Já habilitado nasce marcado: o operador vê o estado real, e desmarcar não desabilita
        // (o servidor nunca rebaixa por omissão).
        setMarcados(
          Object.fromEntries(
            empreendimentos.filter((e) => e.habilitado).map((e) => [e.enterpriseId, true]),
          ),
        );
      } catch {
        if (ativo) setLista([]);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [entityId]);

  if (lista === null) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-2xl border border-line bg-subtle/40 px-4 py-3 text-xs text-ink-muted">
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        Carregando os empreendimentos pedidos…
      </div>
    );
  }

  if (lista.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-line bg-subtle/40 px-4 py-3 text-xs text-ink-muted">
        Esta imobiliária não pediu nenhum empreendimento.
      </div>
    );
  }

  const escolhidos = lista.map((item) => item.enterpriseId).filter((id) => marcados[id]);
  const novos = lista.filter((item) => !item.habilitado && marcados[item.enterpriseId]).length;
  // Nada a liberar porque JÁ ESTÁ TUDO liberado é diferente de "você não marcou nada". A tela
  // dizia "Nenhum empreendimento novo marcado" nos dois casos e travava o botão, e o operador
  // ficava procurando o que tinha feito de errado numa imobiliária que já estava pronta.
  const tudoLiberado = lista.length > 0 && lista.every((item) => item.habilitado);

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-start gap-3 border-b border-line bg-subtle/40 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-inverse text-brand-ink">
          <ShieldCheck aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0">
          <h4 className="m-0 text-sm font-semibold text-ink">Empreendimentos a liberar</h4>
          <p className="m-0 mt-0.5 text-xs text-ink-muted">
            {tudoLiberado
              ? "Esta imobiliária já pode enviar CAD em todos os empreendimentos que pediu."
              : "Marque onde esta imobiliária pode enviar CAD. O que ficar de fora continua aguardando."}
          </p>
        </div>
      </div>

      <div className="grid gap-2 px-4 py-3">
        {lista.map((item) => {
          const ativo = Boolean(marcados[item.enterpriseId]);
          return (
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                ativo
                  ? "border-ink/30 bg-black/[0.045] text-ink dark:bg-white/[0.07]"
                  : "border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink"
              }`}
              key={item.enterpriseId}
            >
              <input
                checked={ativo}
                className="size-4 shrink-0 accent-neutral-900 dark:accent-neutral-200"
                onChange={(event) =>
                  setMarcados((atual) => ({
                    ...atual,
                    [item.enterpriseId]: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
              {item.habilitado ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <Check aria-hidden="true" className="size-3" />
                  habilitado
                </span>
              ) : null}
            </label>
          );
        })}
      </div>

      {erro ? (
        <p className="mx-4 mb-3 flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
          <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
          {erro}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
        <span className="text-xs text-ink-muted">
          {tudoLiberado
            ? "Tudo que ela pediu já está liberado"
            : novos === 0
              ? "Nenhum empreendimento novo marcado"
              : novos === 1
                ? "1 empreendimento será liberado"
                : `${novos} empreendimentos serão liberados`}
        </span>

        <button
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:cursor-not-allowed disabled:opacity-40"
          // `novos === 0` trava o botão: sem isto, marcar um empreendimento JÁ habilitado deixava o
          // botão ativo e cada clique disparava de novo o WhatsApp de boas-vindas para a
          // imobiliária e para o coordenador, sem liberar nada.
          disabled={salvando || novos === 0 || !onHabilitar}
          onClick={async () => {
            if (!onHabilitar) return;
            setSalvando(true);
            setErro(null);
            const ok = await onHabilitar(entityId, escolhidos);
            setSalvando(false);
            if (!ok) setErro("Não foi possível habilitar. Veja o aviso acima do card.");
          }}
          type="button"
        >
          {salvando ? (
            <>
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              Habilitando…
            </>
          ) : (
            <>
              <ShieldCheck aria-hidden="true" className="size-3.5" />
              Habilitar imobiliária
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function PainelConcluido({ imob }: { imob: boolean }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white">
          <Check aria-hidden="true" className="size-5" />
        </span>
        <div>
          <h3 className="m-0 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
            {imob ? "Imobiliária habilitada" : "Cliente credenciado"}
          </h3>
          <p className="m-0 mt-1 text-xs text-emerald-700 dark:text-emerald-300">
            {imob
              ? "Os corretores aprovados já podem enviar CADs para os empreendimentos liberados."
              : "Entrou na fila do lançamento pela data e hora do pagamento, dentro do Prometeu."}
          </p>
        </div>
      </div>
    </div>
  );
}
