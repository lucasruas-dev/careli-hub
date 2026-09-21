"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileDown,
  FileText,
  Loader2,
  Pencil,
  Save,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type DocumentoParaVer,
  VisualizadorDeDocumento,
} from "@/components/documento/VisualizadorDeDocumento";
import { useApiDaTemis } from "@/modules/temis/api-da-temis";
import { regrasParaATela } from "@/lib/temis/css-do-documento";
import { contratoVigente } from "@/lib/temis/contrato-guardado";

import { T } from "../tema";

// A PRÉVIA DO CONTRATO NA TELA — a minuta preenchida com os dados da proposta.
//
// Lucas, 08/09/2026: *"eu havia falado que deveria ter um campo para visualização do contrato
// preenchido, tipo uma prévia antes de enviar, isso foi construído?"*. Não estava: até aquela manhã
// não existia motor nenhum, e as variáveis marcadas na minuta eram lidas só por auditoria.
//
// ⚠️ ESTA É A TELA DE CONFERÊNCIA, e é onde o erro sai barato. Um contrato errado descoberto aqui
// custa um clique; o mesmo contrato descoberto depois de assinado custa um aditivo, uma conversa
// com o cliente e, quando envolve preço, uma renegociação.
//
// ⚠️ AQUI NÃO SE EMITE CONTRATO, E POR ISSO NÃO HÁ AVISO TÉCNICO. Lucas, 08/09/2026: *"não precisa
// ter aquele escrito de alerta de emissão, pois na Gurgel não há emissão de contrato, é somente uma
// prévia. Essas mensagens têm que estar dentro da Têmis"*.
//
// A distinção é de PAPÉIS, não de tela. No portal quem olha é o comercial, e o que ele quer saber é
// como o contrato ficou para aquele cliente — uma lista de nomes de variável entre colchetes não lhe
// diz o que fazer, porque preencher cadastro e ajustar minuta não é trabalho dele. Na Têmis quem
// olha é o jurídico, e ali a mesma lista é a pauta do dia.
//
// ⚠️ O QUE FALTA CONTINUA VISÍVEL NO CORPO, nos dois lugares: `[cpf_cliente]` sai impresso no texto,
// como manda `preencherContrato`. O que muda é só o resumo do topo — quem lê o contrato inteiro vê
// o buraco de qualquer jeito, que é o ponto.
//
// ── GERAR E GUARDAR (09/09/2026) ────────────────────────────────────────────
//
// ⚠️ O BOTÃO NÃO BAIXA UM ARQUIVO: ELE GUARDA. Um "baixar PDF" produziria um contrato que existe
// só na pasta de downloads de quem clicou — e a pergunta seguinte ("cadê o contrato do Henrique?")
// não teria resposta no sistema. O que este botão faz é gravar o documento na gaveta da venda
// (`hercules_documentos`), de onde a aba Documentos, a ficha do cliente no Apolo e o card da Têmis
// já sabem ler.
//
// ⚠️ ELE RECUSA COM VARIÁVEL EM BRANCO, e a recusa é do servidor — a tela só antecipa o motivo. Ver
// a decisão medida em `lib/temis/contrato-guardado.ts`.
//
// ⚠️ E ELE DIZ QUE VAI CRIAR UMA VERSÃO NOVA ANTES DE CRIAR. Descobrir que se gerou a v2 depois de
// gerada é a ordem errada de descobrir, num documento que vai a cartório.
//
// ── QUEM EMITE: A PROP `podeGerar` (08/09/2026) ─────────────────────────────
//
// ⚠️ A PRÉVIA É DE TODO MUNDO; A EMISSÃO NÃO. Lucas, vendo "Gerar e guardar o contrato" no rodapé
// com o portal comercial da Gurgel aberto: *"estou como coordenador, não pode ter esse botão de
// gerar contrato, isso é somente o time administrativo interno"*; e a régua: *"para o perfil da
// gurgel, comercial, pode tirar. Na Têmis só quem tiver relacionado ao setor de contratos e os
// admin"*. Conferir e emitir são de gente diferente — o botão sai, a folha fica inteira.
//
// ⚠️ É PROP EXPLÍCITA, NÃO CHEIRO DE ROTA. Um `usePathname().startsWith("/comercial")` acertaria
// hoje e erraria no dia em que a prévia abrisse num terceiro lugar — e erraria calado, mostrando o
// botão. Sem valor-padrão, a tela nova não compila sem dizer o que quer.
//
// ⚠️ ESCONDER O BOTÃO NÃO É A TRAVA. A rota `/api/temis/contrato/gerar` é chamável direto; quem
// fecha é `autorizarEmissaoDeContrato` (`lib/temis/autorizacao.ts`). Esta prop é a metade da tela.
//
// ⚠️ "ABRIR O CONTRATO GUARDADO" FICA, e fica de propósito: ver o documento já emitido é
// conferência, não emissão — e é justamente o que o comercial precisa fazer no portal.

type ContratoGuardado = {
  criadoEm: string;
  id: string;
  nome: string;
  observacao?: null | string;
  versao: null | number;
};

/** A alteração manual vigente desta venda, como o servidor a devolve. */
type EdicaoNaTela = {
  atualizadoEm: string;
  /**
   * O contrato da minuta mudou DEPOIS que esta alteração foi salva.
   *
   * ⚠️ O TEXTO EDITADO É UMA FOTO. Se alguém corrigiu o CPF no Apolo, publicou outra minuta ou
   * mudou o valor da proposta depois da edição, o que está na tela contém o dado ANTIGO — e o
   * contrato sai errado sem ninguém ter feito nada errado. Esta bandeira é o único aviso.
   */
  baseMudou: boolean;
  editadoPorNome: null | string;
  html: string;
};

type Resposta = {
  /**
   * As peças que vão JUNTO do corpo no PDF montado, já somadas pela cadeia e na ordem da posição.
   *
   * ⚠️ O SERVIDOR JÁ MANDAVA ISTO E A TELA NÃO LIA. Até 21/09/2026 esta tela tipava a resposta com
   * `minuta` e nada mais: `anexos`, `marcadores`, `minuta.origemFrase` e `minuta.herdada` chegavam
   * prontos de `contrato-servico.ts` e eram descartados na porta. Ela não é só do portal — é
   * montada nas duas pontas (`modules/temis/blocks/trabalho/tela-de-trabalho.tsx` e `TelaVenda`),
   * ou seja, a conferência do jurídico também era cega.
   */
  anexos?: { nome: string; posicao: number; rotuloDoNivel: string }[];
  avisos?: string[];
  /** sha-256 do contrato montado agora; volta no salvamento. Ver `contrato-editado.ts`. */
  baseImpressao?: string;
  edicao?: EdicaoNaTela | null;
  erro?: string;
  html?: string;
  /** Os marcadores de montagem que a minuta usou: `capa_contrato`, `anexo_3`. */
  marcadores?: string[];
  minuta?: {
    /**
     * A frase pronta do degrau de onde o modelo veio: "modelo da divisão Vale do Ouro VOL".
     *
     * ⚠️ MONTADA NO SERVIDOR, e nunca recalculada aqui. Regra do Lucas (21/09/2026): quando a
     * divisão ou a categoria não tem minuta própria, ela HERDA do nível de cima e *"a TELA MOSTRA
     * DE ONDE VEIO"*. Se a tela refizesse a travessia, ela e o motor passariam a discordar sobre o
     * mesmo contrato — e a discordância não apareceria no dia em que fosse escrita.
     */
    origemFrase?: string;
    /** `true` = veio de um degrau ACIMA do mais específico que a venda tinha. Aí a linha destaca. */
    herdada?: boolean;
    id: string;
    nome: string;
    versao: null | number;
  };
  semValor?: string[];
  vezesDoLaco?: number;
};

export function PreviaDoContrato({
  aoFechar,
  aoGerar,
  comAvisos = false,
  podeEditar = false,
  podeGerar,
  propostaId,
}: {
  aoFechar: () => void;
  /**
   * O contrato acabou de ser gerado e guardado.
   *
   * ⚠️ QUEM ABRIU A PRÉVIA DECIDE O QUE FAZER DEPOIS, e é por isso que isto é um aviso e não uma
   * navegação daqui. Na Têmis, gerar encerra a etapa: a tela fecha e o quadro mostra o recado. No
   * portal comercial, que nem gera, ninguém escuta. Um `router.push` aqui dentro amarraria a prévia
   * a uma tela só.
   */
  aoGerar?: (contrato: { nome: string; versao: number }) => void;
  /** Liga o resumo do que falta. Só a Têmis usa: ver a nota do topo. */
  comAvisos?: boolean;
  /**
   * Deixa alterar o contrato à mão antes de fechar.
   *
   * Lucas (10/09/2026): *"quando eu clicar no abrir contrato, esse contrato tem que me permitir
   * fazer alteração manual, salvar, fechar contrato"*.
   *
   * ⚠️ PADRÃO `false`, AO CONTRÁRIO DE `podeGerar`. A diferença é de risco: uma tela nova que
   * esqueça `podeGerar` não compila, porque emitir contrato sem querer é grave; uma que esqueça
   * esta prop apenas não deixa editar, que é o comportamento de hoje em todo lugar. Exigir as
   * duas obrigaria a mexer no portal da Gurgel para ligar um recurso que ele não vai ter.
   *
   * ⚠️ E ELA NÃO É A TRAVA: quem fecha a edição é `autorizarEmissaoDeContrato`, no servidor.
   */
  podeEditar?: boolean;
  /**
   * Mostra (ou não) a AÇÃO de emitir. Sem valor-padrão de propósito: quem abrir esta prévia numa
   * tela nova é obrigado a declarar se ali se emite contrato — herdar "sim" por omissão é como o
   * botão foi parar no portal comercial. Ver a nota "QUEM EMITE" acima.
   */
  podeGerar: boolean;
  propostaId: string;
}) {
  const [carregando, setCarregando] = useState(true);
  const [resposta, setResposta] = useState<null | Resposta>(null);
  const [guardados, setGuardados] = useState<ContratoGuardado[]>([]);
  const [gerando, setGerando] = useState(false);
  const [erroDaGeracao, setErroDaGeracao] = useState<null | string>(null);
  const [gerado, setGerado] = useState<null | { id: string; nome: string; versao: number }>(null);
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  /** O contrato guardado, aberto na janela sobre a tela. `null` = fechada. */
  const [contratoAberto, setContratoAberto] = useState<DocumentoParaVer | null>(null);
  /** O que a faxina do servidor tirou do texto colado. Vazio = nada mexeu. */
  const [faxina, setFaxina] = useState<string[]>([]);
  /**
   * O salvamento falhou e a pessoa ja foi avisada: o proximo "fechar" sai e perde o texto.
   *
   * ⚠️ SEM ESTA VALVULA A JANELA VIRA ARMADILHA. Se fechar passa a salvar e o servidor recusa
   * sempre (e o que acontece hoje com quem nao e da coordenacao), a pessoa ficaria presa numa
   * janela que nao fecha. O primeiro clique tenta salvar e explica; o segundo sai, sabendo.
   */
  const [sairSemSalvar, setSairSemSalvar] = useState(false);

  /**
   * A folha, para ler o que a pessoa escreveu.
   *
   * ⚠️ O TEXTO EDITADO NÃO VIRA ESTADO A CADA TECLA, e isso é deliberado: guardar o `innerHTML`
   * em `useState` no `onInput` faria o React reescrever a folha inteira a cada letra digitada, e o
   * cursor voltaria para o começo do documento. Quem edita é o navegador; o React só lê o
   * resultado quando se clica em salvar.
   */
  const folha = useRef<HTMLDivElement>(null);
  /** Conta os pedidos em voo: resposta velha não sobrescreve tela nova. */
  const pedido = useRef(0);
  /** O clique que fecha pelo fundo começou no fundo? Ver a nota do `onMouseDown` do fundo. */
  const gestoNoFundo = useRef(false);
  /**
   * O que estava na folha quando a edição abriu.
   *
   * ⚠️ ABRIR PARA LER NÃO PODE VIRAR UMA ALTERAÇÃO. O texto salvo é uma FOTO (migration 0152):
   * gravar uma "alteração" idêntica à minuta faz a tela passar a dizer "Alterado à mão por
   * Fulano" e, pior, CONGELA o contrato — corrigir o CPF no Apolo ou publicar minuta nova
   * deixa de alcançar aquele papel. Comparar com o que havia ao abrir é o que separa "li" de
   * "reescrevi", e a comparação é justa porque os dois lados saem do MESMO `innerHTML`.
   */
  const textoAoAbrir = useRef<null | string>(null);
  /** O último texto que NÓS escrevemos na folha, e em qual elemento. Ver `escreverNaFolha`. */
  const ultimoEscrito = useRef<null | { alvo: HTMLDivElement; html: string }>(null);
  /** Já há um fechamento em curso? Ver a nota da trava em `fechar`. */
  const fechamentoEmCurso = useRef(false);
  /**
   * A porta da Têmis.
   *
   * ⚠️ SEM PROVEDOR É O HUB, E É ASSIM QUE O PORTAL COMERCIAL CONTINUA. A Gurgel abre esta prévia
   * na Venda sem `ApiDaTemisProvider` por cima: sai `/api/temis` com o Bearer do hub, exatamente como
   * antes, e sem sessão do hub a prévia não abre (a confecção das vendas dela é da Careli). Só o
   * portal que confecciona (`portalConfeccionaContrato`) monta o provedor e passa a falar com
   * `/api/incorporador/temis` pelo cookie.
   */
  const { temisFetch } = useApiDaTemis();

  const carregar = useCallback(async () => {
    const meu = ++pedido.current;
    setCarregando(true);
    try {
      const cabecalho = { "Content-Type": "application/json" };

      // ⚠️ AS DUAS LEITURAS JUNTAS. Saber o que JÁ foi gerado é o que muda o texto do botão de
      // "Gerar contrato" para "Gerar a versão 2" — e essa frase é a única chance de alguém parar
      // antes de criar uma segunda folha por engano. Pedir depois faria o botão nascer mentindo.
      const [previa, jaGuardados] = await Promise.all([
        temisFetch("/contrato/previa", {
          body: JSON.stringify({ propostaId }),
          headers: cabecalho,
          method: "POST",
        }),
        temisFetch(`/contrato/gerar?proposta=${encodeURIComponent(propostaId)}`),
      ]);

      const dados = (await previa.json().catch(() => ({}))) as Resposta;
      const lista = (await jaGuardados.json().catch(() => ({}))) as {
        data?: { contratos: ContratoGuardado[] };
      };
      if (meu !== pedido.current) return;
      setResposta(dados);
      setGuardados(lista.data?.contratos ?? []);
    } catch (e) {
      // ⚠️ O MOTIVO CHEGA À TELA. Uma prévia que falha calada manda a pessoa tentar de novo sem
      // saber o que mudar — e foi exatamente o que custou duas rodadas de teste no agente da
      // minuta, na mesma semana.
      if (meu !== pedido.current) return;
      setResposta({ erro: e instanceof Error ? e.message : "Falha ao gerar a prévia." });
    } finally {
      if (meu === pedido.current) setCarregando(false);
    }
  }, [propostaId, temisFetch]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const gerar = useCallback(async () => {
    setGerando(true);
    setErroDaGeracao(null);
    try {
      const r = await temisFetch("/contrato/gerar", {
        body: JSON.stringify({ propostaId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const j = (await r.json().catch(() => ({}))) as {
        data?: { documentoId: string; nome: string; versao: number };
        erro?: string;
      };
      if (!r.ok || !j.data) throw new Error(j.erro ?? `Não foi possível gerar (${r.status}).`);

      setGerado({ id: j.data.documentoId, nome: j.data.nome, versao: j.data.versao });
      aoGerar?.({ nome: j.data.nome, versao: j.data.versao });
      setGuardados((antes) => [
        {
          criadoEm: new Date().toISOString(),
          id: j.data!.documentoId,
          nome: j.data!.nome,
          versao: j.data!.versao,
        },
        ...antes,
      ]);
    } catch (e) {
      setErroDaGeracao(e instanceof Error ? e.message : "Não foi possível gerar o contrato.");
    } finally {
      setGerando(false);
    }
  }, [aoGerar, propostaId, temisFetch]);

  /**
   * Grava a alteração manual.
   *
   * ⚠️ DEPOIS DE SALVAR, A PRÉVIA É RECARREGADA — e não só por capricho. O servidor faxina o
   * texto antes de gravar, e o que ele guardou pode não ser byte a byte o que saiu do navegador;
   * ele também recalcula o que ficou sem valor sobre o texto novo. Sem a releitura, a tela mostra
   * uma coisa e o papel sai outra — exatamente o que esta tela existe para impedir.
   */
  const salvar = useCallback(async (opcoes?: { recarregar?: boolean }): Promise<boolean> => {
    const html = folha.current?.innerHTML ?? "";

    // ⚠️ SEM ALTERAÇÃO NÃO HÁ O QUE GRAVAR, e gravar assim mesmo tem preço: a linha nasce em
    // `temis_contrato_edicoes`, a tela passa a dizer "Alterado à mão" e o contrato congela no
    // texto daquele instante. Quem abriu para conferir uma cláusula não pediu isso.
    if (textoAoAbrir.current !== null && html === textoAoAbrir.current) {
      setEditando(false);
      setSairSemSalvar(false);
      textoAoAbrir.current = null;
      return true;
    }

    setSalvando(true);
    setErroDaGeracao(null);
    setFaxina([]);
    try {
      const r = await temisFetch("/contrato/edicao", {
        body: JSON.stringify({
          baseImpressao: resposta?.baseImpressao,
          html,
          minutaId: resposta?.minuta?.id,
          propostaId,
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      const j = (await r.json().catch(() => ({}))) as {
        data?: { removeu: string[] };
        erro?: string;
      };
      // ⚠️ "NÃO CONSEGUI SALVAR (403)" NÃO É UM RECADO, É UM CÓDIGO. Quem grava é
      // `autorizarEmissaoDeContrato` (admin + leader), e a tela oferece a edição olhando só a
      // etapa do card. Medido em 21/09/2026: há 2 `operator` ATIVOS no hub (entraram em 16/09)
      // que veem o botão e levam 403 ao fechar — e a mensagem antiga não dizia a quem pedir.
      if (r.status === 401 || r.status === 403) {
        throw new Error(
          "Seu perfil não pode alterar o contrato: isso é do time de contratos (coordenação). " +
            "Copie o que você escreveu antes de sair e peça a alteração a quem emite.",
        );
      }
      if (!r.ok) throw new Error(j.erro ?? `Não consegui salvar (${r.status}).`);

      setFaxina(j.data?.removeu ?? []);
      setEditando(false);
      setSairSemSalvar(false);
      textoAoAbrir.current = null;
      // ⚠️ QUEM VAI FECHAR NÃO ESPERA A PRÉVIA SER REMONTADA. Com a janela saindo da frente, o
      // PUT mais a prévia mais a lista de guardados deixavam no lugar do contrato o esqueleto
      // "Montando o contrato" e o botão em "Salvando…" — segundos de espera por uma tela que a
      // pessoa já mandou sumir. Quem CONTINUA na tela recarrega, e aí a releitura é obrigatória:
      // o servidor faxina o texto antes de gravar e recalcula o que ficou sem valor.
      if (opcoes?.recarregar === false) return true;
      await carregar();
      return true;
    } catch (e) {
      setErroDaGeracao(e instanceof Error ? e.message : "Não consegui salvar a alteração.");
      return false;
    } finally {
      setSalvando(false);
    }
  }, [carregar, propostaId, resposta?.baseImpressao, resposta?.minuta?.id, temisFetch]);

  /**
   * Fechar a JANELA no meio da edição — e o texto digitado vai junto, ou não vai ninguém.
   *
   * Lucas, 21/09/2026, com o relato do time: *"ela abre, altera, fecha, depois que atualiza o
   * valor que estava antes, ou seja, não está salvando"*.
   *
   * ⚠️ ERAM DOIS "FECHAR" NA MESMA TELA, E UM DELES MENTIA. O botão do rodapé chama-se "Fechar
   * o contrato" e salva — é a regra do Lucas de 11/09/2026 (*"automaticamente ao fechar o
   * contrato salva"*). O X do cabeçalho e o fundo escuro fechavam a JANELA e jogavam fora o que
   * tinha sido escrito, calados. Para quem digita, os dois são "fechar o contrato".
   *
   * ⚠️ E NADA DE `confirm()`: um diálogo do navegador no meio de um contrato de 27 páginas é a
   * pergunta que se responde no automático. Fechar salva; quando o servidor recusa, a janela
   * fica aberta, com o texto na tela e o motivo escrito.
   */
  const fechar = useCallback(async () => {
    // ⚠️ DOIS CLIQUES NO X SÃO UM GESTO SÓ. Sem esta trava saem dois PUT concorrentes, dois
    // registros de "alterou o contrato à mão" no log e um `aoFechar()` duplicado no pai.
    //
    // ⚠️ E A TRAVA É UM `ref`, NÃO O ESTADO `salvando`: os dois cliques chegam ANTES de o React
    // re-renderizar, então o segundo ainda leria `salvando === false`. O `ref` muda na hora.
    if (fechamentoEmCurso.current) return;
    fechamentoEmCurso.current = true;
    try {
      if (!editando) {
        aoFechar();
        return;
      }
      // ⚠️ CLICAR DE NOVO É "TENTA OUTRA VEZ", e a queda mais comum é a rede piscando por dois
      // segundos. Sair calado na segunda vez jogaria fora um texto que o servidor já estava
      // pronto para aceitar. Só depois de falhar DE NOVO, e com o aviso na tela, a janela sai.
      if (await salvar({ recarregar: false })) {
        aoFechar();
        return;
      }
      if (sairSemSalvar) {
        aoFechar();
        return;
      }
      setSairSemSalvar(true);
    } finally {
      fechamentoEmCurso.current = false;
    }
  }, [aoFechar, editando, sairSemSalvar, salvar]);

  /**
   * O Esc é o TERCEIRO "fechar", e era o mais caro.
   *
   * ⚠️ QUEM ESCUTA O Esc NÃO É ESTA JANELA: é a MOLDURA da tela de trabalho, que fecha o CARD
   * inteiro e volta para o quadro. Reescrever uma cláusula e apertar Esc — o reflexo de quem
   * quer fechar uma janela — perdia o texto E a tela, de uma vez. Aqui o Esc vira o mesmo
   * gesto do X: salva e fecha só a prévia.
   *
   * ⚠️ NA CAPTURA, E NÃO NA BOLHA: o evento nasce na folha e tem de ser interceptado na
   * DESCIDA, antes de chegar a quem escuta lá embaixo. Com a janela do documento guardado
   * aberta por cima, o Esc fecha ELA primeiro — a de cima é a que o Esc fecha.
   */
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key !== "Escape") return;
      evento.stopPropagation();
      evento.preventDefault();
      if (contratoAberto) {
        setContratoAberto(null);
        return;
      }
      void fechar();
    };
    document.addEventListener("keydown", aoTeclar, true);
    return () => document.removeEventListener("keydown", aoTeclar, true);
  }, [contratoAberto, fechar]);

  /** Joga fora a alteração manual: o contrato volta a ser o texto da minuta. */
  const descartar = useCallback(async () => {
    setSalvando(true);
    setErroDaGeracao(null);
    setFaxina([]);
    try {
      const r = await temisFetch(
        `/contrato/edicao?proposta=${encodeURIComponent(propostaId)}`,
        { method: "DELETE" },
      );
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { erro?: string };
        throw new Error(j.erro ?? `Não consegui descartar (${r.status}).`);
      }
      setEditando(false);
      await carregar();
    } catch (e) {
      setErroDaGeracao(e instanceof Error ? e.message : "Não consegui descartar a alteração.");
    } finally {
      setSalvando(false);
    }
  }, [carregar, propostaId, temisFetch]);

  /**
   * Abre o contrato guardado na janela sobre a tela, com botão de baixar (Lucas, 18/09/2026:
   * *"os documentos não precisam abrir em uma nova tela para ser visto, pode abrir em pop up e ter
   * um botão de baixar"*). A URL assinada é baixada aqui: ver `VisualizadorDeDocumento`.
   */
  const abrir = useCallback(
    (documentoId: string, versao: null | number) => {
      const nome = versao ? `Contrato v${versao}.pdf` : "Contrato.pdf";
      setContratoAberto({
        carregar: async () => {
          const r = await temisFetch(
            `/contrato/gerar?documento=${encodeURIComponent(documentoId)}`,
          );
          const j = (await r.json().catch(() => ({}))) as { data?: { url: string }; erro?: string };
          if (!r.ok || !j.data?.url) throw new Error(j.erro ?? "Não foi possível abrir o contrato.");
          const arquivo = await fetch(j.data.url);
          if (!arquivo.ok) throw new Error("Não foi possível baixar o contrato.");
          return { blob: await arquivo.blob(), nome };
        },
        nomeDoArquivo: nome,
        titulo: versao ? `Contrato · versão ${versao}` : "Contrato",
      });
    },
    [temisFetch],
  );

  const edicao = resposta?.edicao ?? null;
  /**
   * O texto que vale — o alterado à mão quando existe, senão o da minuta.
   *
   * ⚠️ É O MESMO CRITÉRIO DO SERVIDOR (`gerar/route.ts`). A folha na tela e o PDF que sai têm de
   * ser o mesmo documento; um critério aqui e outro lá faria a conferência não provar nada.
   */
  const htmlDaFolha = edicao?.html ?? resposta?.html ?? "";

  /**
   * Escreve o contrato na folha — e só quando o texto vem do SERVIDOR.
   *
   * ⚠️ ISTO ERA UM `dangerouslySetInnerHTML`, E ERA A CAUSA DE O TIME PERDER O QUE DIGITAVA.
   * O arquivo apostava que a prop "só reescreve a folha quando o texto vem do servidor";
   * medido em 21/09/2026, em React 19, é falso: QUALQUER re-render reaplica o `__html` no DOM,
   * mesmo com a string idêntica à do render anterior — e o DOM, ali, é onde a pessoa estava
   * escrevendo. Bastava um `setState` (o do próprio salvamento, um do pai, um relógio de outra
   * parte da tela) para o contrato voltar sozinho ao texto da minuta, sem erro e sem aviso.
   *
   * ⚠️ ENQUANTO SE EDITA, A FOLHA É DE QUEM DIGITA. O efeito não escreve no meio da edição:
   * uma resposta do servidor chegando atrasada apagaria o parágrafo em curso. Fechada a
   * edição, o servidor volta a mandar — é assim que o texto salvo e o descarte aparecem.
   *
   * ⚠️ E RODA A CADA RENDER, DE PROPÓSITO: a folha só existe no DOM depois que a carga acaba,
   * e um efeito com lista de dependências poderia disparar antes do elemento existir e nunca
   * mais — deixando a folha em branco.
   *
   * ⚠️ E A GUARDA NÃO COMPARA COM O `innerHTML`: comparar os dois NUNCA dá igual num contrato
   * real. O servidor serializa no estilo XHTML (`<br />`, `<hr />`, `&quot;` — ver
   * `lib/temis/documento-html.ts`) e o getter do navegador devolve `<br>`, `<hr>`, `"`. A
   * guarda antiga era sempre verdadeira, e as 27 páginas eram destruídas e reparseadas a cada
   * render, levando junto a seleção de quem estava copiando um trecho. Guardar o que NÓS
   * escrevemos, e em QUAL elemento, compara maçã com maçã — e o elemento entra na conta porque
   * a folha é desmontada a cada carga (o esqueleto ocupa o lugar dela) e volta vazia.
   */
  const escreverNaFolha = () => {
    const alvo = folha.current;
    if (!alvo || editando) return;
    const ultimo = ultimoEscrito.current;
    if (ultimo && ultimo.alvo === alvo && ultimo.html === htmlDaFolha) return;
    alvo.innerHTML = htmlDaFolha;
    ultimoEscrito.current = { alvo, html: htmlDaFolha };
  };
  useEffect(escreverNaFolha);
  const semValor = resposta?.semValor ?? [];
  const semValorVisivel = comAvisos ? semValor : [];
  const avisos = comAvisos ? (resposta?.avisos ?? []) : [];
  const vigente = contratoVigente(guardados);
  const proximaVersao = (vigente?.versao ?? guardados.length) + 1;
  // O CONTRATO ESTÁ EM CONDIÇÃO DE SER EMITIDO — nada a ver com quem está olhando. Quem decide o
  // DIREITO é a prop `podeGerar`; isto aqui decide se o botão, quando existe, está aceso.
  const prontoParaGerar =
    !carregando && !resposta?.erro && Boolean(resposta?.html) && semValor.length === 0;
  // ⚠️ O RODAPÉ SOME INTEIRO QUANDO NÃO SOBRA AÇÃO NENHUMA. Sem isto, o portal ganharia uma faixa
  // com borda e 12px de padding embaixo da folha — a moldura de um botão que foi embora.
  // ⚠️ O RODAPÉ ESPERA O CONTRATO CHEGAR. Aparecendo durante a carga, ele nasce com o botão
  // apagado e some/volta quando a resposta chega — um segundo salto de ~50px por cima do
  // primeiro. As ações só fazem sentido sobre um documento que já está na tela.
  const temRodape =
    !carregando &&
    !resposta?.erro &&
    (podeGerar || podeEditar || Boolean(vigente) || Boolean(erroDaGeracao));

  return (
    <div
      // ⚠️ SÓ FECHA O GESTO QUE NASCEU NO FUNDO. Selecionar um parágrafo arrastando até fora
      // da folha é o gesto de quem edita, e o `click` daí nasce no ANCESTRAL COMUM — este fundo.
      // A janela fechava no meio da frase, levando o texto junto.
      onClick={(e) => {
        if (e.target !== e.currentTarget || !gestoNoFundo.current) return;
        void fechar();
      }}
      onMouseDown={(e) => {
        gestoNoFundo.current = e.target === e.currentTarget;
      }}
      style={{
        alignItems: "center",
        background: "rgba(0,0,0,.45)",
        display: "flex",
        inset: 0,
        justifyContent: "center",
        padding: 20,
        position: "fixed",
        zIndex: 60,
      }}
    >
      {/* O contrato guardado, na janela sobre esta. Vai por portal; o clique nela não fecha esta. */}
      <VisualizadorDeDocumento documento={contratoAberto} aoFechar={() => setContratoAberto(null)} />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
          boxShadow: T.sombra,
          display: "flex",
          flexDirection: "column",
          maxHeight: "92vh",
          maxWidth: 900,
          // ⚠️ O PISO IMPEDE O COLAPSO. Sem ele a altura era a soma dos filhos: com a frase de
          // carregamento o cartão inteiro media ~176px — um balão de aviso, não um documento — e
          // saltava para 92vh quando o contrato chegava. O `min()` cede primeiro em janela
          // baixa, para o cartão nunca passar do `maxHeight`.
          minHeight: "min(92vh, 680px)",
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: "center",
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            gap: 10,
            padding: "12px 16px",
          }}
        >
          <FileText aria-hidden="true" size={16} style={{ color: T.gold }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: T.text, fontSize: 13.5, fontWeight: 700 }}>
              Prévia do contrato
            </div>
            {/* ⚠️ DIZ QUE NÃO EMITE. O portal mostra o contrato para conferência do comercial; a
                emissão, quando existir, é da Têmis. Sem esta linha alguém fecha a tela achando que
                o contrato foi gerado. */}
            <div style={{ color: T.muted, fontSize: 11 }}>
              {resposta?.minuta ? (
                <>
                  {resposta.minuta.nome}
                  {resposta.minuta.versao ? ` · v${resposta.minuta.versao}` : ""}
                  {resposta.vezesDoLaco
                    ? ` · ${resposta.vezesDoLaco} ${resposta.vezesDoLaco === 1 ? "comprador" : "compradores"}`
                    : ""}
                  {/* ⚠️ A FRASE SEGUE A AÇÃO, NÃO O AVISO. Ela promete "não emite", e quem
                      cumpre a promessa é `podeGerar` — amarrá-la a `comAvisos` faria a linha
                      mentir na primeira tela que ligasse um sem o outro. */}
                  {podeGerar ? "" : " · conferência, não emite"}
                </>
              ) : null}
            </div>

            {/*
              ⚠️ DE ONDE VEIO O MODELO, E O QUE VAI JUNTO. É a regra do Lucas de 21/09/2026 dita por
              extenso: quando a divisão ou a categoria não tem minuta própria ela HERDA, e *"a TELA
              MOSTRA DE ONDE VEIO"*. Até essa data isso só aparecia DEPOIS de gerar, no recado da
              tela de trabalho — ou seja, a conferência acontecia sem saber qual contrato estava
              sendo conferido. As 189 propostas que mudam de comportamento (Vale do Ouro com lote no
              VOL) são exatamente estas: o cabeçalho diz "Vale do Ouro" e o modelo vem do VOL.
            */}
            {resposta?.minuta?.origemFrase ? (
              <div
                style={{
                  color: resposta.minuta.herdada ? T.gold : T.muted,
                  fontSize: 11,
                  fontWeight: resposta.minuta.herdada ? 700 : 400,
                  marginTop: 2,
                }}
              >
                {resposta.minuta.origemFrase}
                {resposta.minuta.herdada ? " — herdado de um nível acima" : ""}
              </div>
            ) : null}

            {/*
              ⚠️ AS PEÇAS ANEXAS SÃO PARTE DO CONTRATO, e o corpo que está na tela NÃO as mostra: o
              montador as costura no PDF final (`montar-pdf-do-contrato.ts`). Sem esta linha, quem
              confere lê o texto inteiro sem saber que a convenção de condomínio vai atrás dele.
            */}
            {resposta?.anexos && resposta.anexos.length > 0 ? (
              <div style={{ color: T.muted, fontSize: 11, marginTop: 2 }}>
                Vai junto:{" "}
                {resposta.anexos
                  .map((a) => `${a.nome} (${a.rotuloDoNivel})`)
                  .join(", ")}
              </div>
            ) : null}
          </div>
          <button
            aria-label="Fechar"
            onClick={() => void fechar()}
            style={{
              background: "transparent",
              border: "none",
              color: T.muted,
              cursor: "pointer",
              padding: 4,
            }}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        {/* `flex: 1` anda junto com o piso do painel: sem ele o miolo continua do tamanho do
            conteúdo e a altura nova viraria uma faixa vazia depois do rodapé. */}
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16 }}>
          {carregando ? (
            <FolhaEsqueleto />
          ) : resposta?.erro ? (
            <p
              style={{
                background: T.dangerBg,
                borderRadius: 10,
                color: T.danger,
                fontSize: 12.5,
                margin: 0,
                padding: "10px 12px",
              }}
            >
              {resposta.erro}
            </p>
          ) : (
            <>
              {/* ⚠️ O AVISO DA BASE VEM ANTES DE TUDO, inclusive das variáveis em branco. Uma
                  alteração manual feita sobre dados que mudaram depois é o único defeito desta tela
                  que a leitura do contrato NÃO revela: o texto está impecável, só que com o CPF
                  antigo. Quem lê não tem como perceber — só o sistema sabe. */}
              {edicao?.baseMudou ? (
                <div
                  style={{
                    background: T.dangerBg,
                    borderRadius: 10,
                    marginBottom: 14,
                    padding: "10px 12px",
                  }}
                >
                  <div
                    style={{
                      alignItems: "center",
                      color: T.danger,
                      display: "flex",
                      fontSize: 12,
                      fontWeight: 700,
                      gap: 6,
                    }}
                  >
                    <AlertTriangle aria-hidden="true" size={13} />
                    O contrato mudou depois desta alteração
                  </div>
                  <p style={{ color: T.sub, fontSize: 11.5, margin: "6px 0 0" }}>
                    O cadastro, a proposta ou a minuta foram alterados depois que este texto foi
                    salvo — o que está na tela pode conter dado antigo. Confira o que mudou, ou
                    descarte a alteração para partir do contrato de hoje e refazer o ajuste.
                  </p>
                </div>
              ) : null}

              {semValorVisivel.length > 0 || avisos.length > 0 ? (
                <div
                  style={{
                    background: T.dangerBg,
                    borderRadius: 10,
                    marginBottom: 14,
                    padding: "10px 12px",
                  }}
                >
                  <div
                    style={{
                      alignItems: "center",
                      color: T.danger,
                      display: "flex",
                      fontSize: 12,
                      fontWeight: 700,
                      gap: 6,
                    }}
                  >
                    <AlertTriangle aria-hidden="true" size={13} />
                    Confira antes de emitir
                  </div>
                  {semValorVisivel.length > 0 ? (
                    <p style={{ color: T.sub, fontSize: 11.5, margin: "6px 0 0" }}>
                      {semValorVisivel.length === 1
                        ? "1 variável ficou sem valor e saiu impressa no texto: "
                        : `${semValorVisivel.length} variáveis ficaram sem valor e saíram impressas no texto: `}
                      <span style={{ fontFamily: "ui-monospace, monospace" }}>
                        {semValorVisivel.join(", ")}
                      </span>
                    </p>
                  ) : null}
                  {avisos.map((a) => (
                    <p key={a} style={{ color: T.sub, fontSize: 11.5, margin: "4px 0 0" }}>
                      {a}
                    </p>
                  ))}
                </div>
              ) : null}

              {/* ⚠️ A FOLHA IMITA O PAPEL — fundo branco, margem de página, serifa. Conferir um
                  contrato com a cara do editor esconde justamente os problemas de diagramação que
                  só aparecem no papel.

                  ⚠️ AS REGRAS SÃO AS MESMAS DO PDF (`css-do-documento.ts`), e é isso que faz a
                  conferência valer: se a tela usasse um CSS e o papel outro, aprovar aqui não
                  provaria nada sobre o que o cliente recebe. Elas precisam vir num `<style>` porque
                  o conteúdo entra por `dangerouslySetInnerHTML` — estilo inline no container não
                  alcança os `<p>` de dentro, e o preflight do Tailwind já zerou a margem deles.

                  ⚠️ O HTML VEM DO NOSSO SERIALIZADOR, sobre a nossa minuta e os nossos dados — não é
                  conteúdo de terceiro. */}
              <style>{regrasParaATela(".previa-do-contrato")}</style>
              {/* ⚠️ `contentEditable` NO PRÓPRIO DOCUMENTO, e não um editor ao lado. O que se
                  confere é a folha com a cara do papel; abrir o texto num segundo componente
                  faria a pessoa escrever num lugar e conferir noutro, com dois CSS diferentes.

                  ⚠️ E O CONTEÚDO NÃO VEM POR `dangerouslySetInnerHTML`: quem escreve na folha é
                  `escreverNaFolha`, acima. A prop reaplicava o texto do servidor a cada
                  re-render e apagava o que estava sendo digitado. */}
              <div
                className="previa-do-contrato"
                contentEditable={editando}
                ref={folha}
                spellCheck={editando}
                style={{
                  background: "#fff",
                  border: `1px solid ${editando ? T.gold : T.border}`,
                  borderRadius: 8,
                  boxShadow: editando ? `0 0 0 3px ${T.gold}22` : undefined,
                  outline: "none",
                  padding: "40px 48px",
                }}
                suppressContentEditableWarning
              />
            </>
          )}
        </div>

        {/* ── O RODAPÉ: GERAR E GUARDAR ─────────────────────────────────────
            ⚠️ ELE FICA FORA DA ÁREA QUE ROLA. Um botão que só aparece no fim de 27 páginas é um
            botão que ninguém acha — e o contrato não é lido de cima a baixo toda vez.

            ⚠️ SEM `podeGerar` SÓ SOBREVIVE O QUE NÃO EMITE: abrir o contrato guardado e o recado de
            erro (que também é o erro de ABRIR — ver `abrir()`). O resto do rodapé é a emissão. */}
        {!temRodape ? null : (
          <div
            style={{
              borderTop: `1px solid ${T.border}`,
              display: "grid",
              gap: 8,
              padding: "10px 16px 12px",
            }}
          >
            {gerado ? (
              <div
                style={{
                  alignItems: "flex-start",
                  background: T.okBg,
                  borderRadius: 10,
                  color: T.ok,
                  display: "flex",
                  fontSize: 12,
                  gap: 8,
                  padding: "9px 11px",
                }}
              >
                <CheckCircle2 aria-hidden="true" size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ minWidth: 0 }}>
                  <b>Contrato guardado.</b> {gerado.nome}
                  <span style={{ color: T.sub, display: "block", fontSize: 11.5 }}>
                    Está na aba Documentos desta venda, na ficha do cliente no Apolo e no card da
                    Têmis.
                  </span>
                </span>
              </div>
            ) : null}

            {erroDaGeracao ? (
              <p
                style={{
                  background: T.dangerBg,
                  borderRadius: 10,
                  color: T.danger,
                  fontSize: 12,
                  margin: 0,
                  padding: "9px 11px",
                }}
              >
                {erroDaGeracao}
              </p>
            ) : null}

            {/* ⚠️ A SAÍDA EXISTE, E ELA DIZ O QUE CUSTA. Sem esta linha, uma recusa do servidor
                trancaria a pessoa numa janela que não fecha; com ela, sair vira uma decisão
                tomada sabendo que o texto digitado não foi guardado. */}
            {sairSemSalvar ? (
              <p style={{ color: T.muted, fontSize: 11.5, margin: 0 }}>
                A alteração não foi salva. Clique em fechar de novo para sair sem salvar — o que
                você digitou será perdido.
              </p>
            ) : null}

            {/* ⚠️ O QUE JÁ EXISTE APARECE ANTES DE SE GERAR MAIS UM — e continua aparecendo DEPOIS
                de gerar. A primeira versão desta tela escondia o botão quando a geração acabava de
                acontecer, e o efeito era o pior possível: a pessoa clicava "Gerar", lia "contrato
                guardado" e não tinha como VER o papel que acabara de criar. */}
            {vigente ? (
              <button
                onClick={() => abrir(vigente.id, vigente.versao ?? null)}
                style={{
                  alignItems: "center",
                  background: "transparent",
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                  color: T.text,
                  cursor: "pointer",
                  display: "flex",
                  fontSize: 11.5,
                  gap: 6,
                  padding: "7px 10px",
                  textAlign: "left",
                }}
                type="button"
              >
                <ExternalLink aria-hidden="true" size={12} style={{ flexShrink: 0 }} />
                <span style={{ minWidth: 0 }}>
                  {gerado ? "Abrir o contrato que acabou de sair" : "Abrir o contrato guardado"}
                  {vigente.versao ? ` (versão ${vigente.versao})` : ""}
                </span>
              </button>
            ) : null}

            {/* ⚠️ A ETIQUETA DE QUEM MEXEU FICA COLADA NAS AÇÕES. Um contrato com cláusula
                reescrita à mão é indistinguível do texto da minuta para quem lê — as duas coisas
                são só parágrafos na folha. Sem esta linha, quem abre a tela depois não tem como
                saber que está conferindo um texto ajustado. */}
            {edicao && !editando ? (
              <div
                style={{
                  alignItems: "center",
                  color: T.sub,
                  display: "flex",
                  fontSize: 11.5,
                  gap: 6,
                }}
              >
                <Pencil aria-hidden="true" size={12} style={{ flexShrink: 0 }} />
                <span style={{ minWidth: 0 }}>
                  Alterado à mão
                  {edicao.editadoPorNome ? ` por ${edicao.editadoPorNome}` : ""} ·{" "}
                  {new Date(edicao.atualizadoEm).toLocaleString("pt-BR", {
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    month: "2-digit",
                  })}
                </span>
              </div>
            ) : null}

            {/* O que a faxina do servidor tirou do que foi colado — ver a rota `edicao`. */}
            {faxina.length > 0 ? (
              <p style={{ color: T.muted, fontSize: 11, margin: 0 }}>
                Ao salvar, foi retirado do texto: {faxina.join("; ")}. O resto foi mantido.
              </p>
            ) : null}

            {/* ⚠️ UM BOTÃO POR VEZ — Lucas (11/09/2026): *"deixa o botão de abrir, se abrir ter o
                botão de fechar, não precisa ter os dois"* e *"não precisa de um botão de salvar,
                automaticamente ao fechar o contrato salva"*.

                O par ABRIR/FECHAR controla a EDIÇÃO, e nada mais: abriu, o texto fica editável;
                fechou, o que foi escrito é salvo e a folha volta a ser só leitura. Antes eram três
                botões ao mesmo tempo — alterar, salvar, sair sem salvar — e a pessoa tinha de
                decidir qual era qual antes de poder escrever uma vírgula.

                ⚠️ "DESCARTAR" SOBREVIVEU porque é a única saída de quem se arrependeu do que já
                está salvo: ele apaga a alteração e devolve o texto da minuta. Fica pequeno, ao
                lado, e só aparece quando existe alteração para jogar fora. */}
            {!podeEditar ? null : (
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  disabled={salvando}
                  onClick={() => {
                    if (editando) {
                      void salvar();
                      return;
                    }
                    setFaxina([]);
                    setSairSemSalvar(false);
                    // O ponto de partida da comparação — ver a nota de `textoAoAbrir`.
                    textoAoAbrir.current = folha.current?.innerHTML ?? "";
                    setEditando(true);
                  }}
                  style={{
                    alignItems: "center",
                    background: "transparent",
                    border: `1px solid ${editando ? T.gold : T.border}`,
                    borderRadius: 8,
                    color: T.text,
                    cursor: salvando ? "wait" : "pointer",
                    display: "flex",
                    flex: 1,
                    fontSize: 12,
                    fontWeight: 700,
                    gap: 6,
                    justifyContent: "center",
                    padding: "8px 12px",
                  }}
                  type="button"
                >
                  {salvando ? (
                    <Loader2 aria-hidden="true" className="animate-spin" size={13} />
                  ) : editando ? (
                    <Save aria-hidden="true" size={13} />
                  ) : (
                    <Pencil aria-hidden="true" size={13} />
                  )}
                  {salvando
                    ? "Salvando…"
                    : editando
                      ? "Fechar o contrato"
                      : "Abrir o contrato"}
                </button>

                {!editando && edicao ? (
                  <button
                    disabled={salvando}
                    onClick={() => void descartar()}
                    style={{
                      alignItems: "center",
                      background: "transparent",
                      border: `1px solid ${T.border}`,
                      borderRadius: 8,
                      color: T.muted,
                      cursor: "pointer",
                      display: "flex",
                      fontSize: 12,
                      gap: 6,
                      padding: "8px 12px",
                    }}
                    title="Joga fora a alteração e volta ao texto da minuta"
                    type="button"
                  >
                    <Undo2 aria-hidden="true" size={13} />
                    Descartar
                  </button>
                ) : null}
              </div>
            )}

            {!podeGerar ? null : (
              <button
                disabled={!prontoParaGerar || gerando || editando}
                onClick={() => void gerar()}
                style={{
                  alignItems: "center",
                  // ⚠️ O DESTAQUE É DELE — Lucas: *"gerar contrato merece um destaque"*. É a ação
                  // que encerra a etapa; o resto do rodapé é preparação para ela.
                  background: prontoParaGerar && !gerando ? T.gold : "transparent",
                  border: `1px solid ${prontoParaGerar && !gerando ? T.gold : T.border}`,
                  borderRadius: 8,
                  // ⚠️ A TINTA VEM DO TOKEN, e não cravada: `#1a1a1a` sobre o fundo invertido do
                  // hub escuro (que é BRANCO) dava grafite sobre branco no portal e some no
                  // tema escuro da Têmis. `btnFg` é o par certo de `btnBg` nos dois temas.
                  color: prontoParaGerar && !gerando ? T.btnFg : T.muted,
                  cursor: prontoParaGerar && !gerando ? "pointer" : "not-allowed",
                  display: "flex",
                  fontSize: 12.5,
                  fontWeight: 700,
                  gap: 7,
                  justifyContent: "center",
                  padding: "9px 12px",
                  width: "100%",
                }}
                title={
                  semValor.length > 0
                    ? "O contrato tem campos em branco. Complete o cadastro ou a minuta antes de gerar."
                    : undefined
                }
                type="button"
              >
                {gerando ? (
                  <Loader2 aria-hidden="true" className="animate-spin" size={13} />
                ) : (
                  <FileDown aria-hidden="true" size={13} />
                )}
                {/* ⚠️ "FECHAR" NA TÊMIS, "GERAR" NO PORTAL — Lucas (10/09/2026): *"fazer
                    alteração manual, salvar, fechar contrato"*. Onde se pode alterar o texto, o
                    botão encerra um trabalho: ele congela o texto em PDF, guarda na gaveta da
                    venda e o card anda. Onde não se altera nada, ele só gera o documento — e
                    chamar isso de "fechar" prometeria um efeito que ali não existe. */}
                {/* ⚠️ O NOME É SEMPRE "GERAR", e isso é o conserto de uma ambiguidade que este
                    botão carregava: onde dava para editar, ele se chamava "Fechar o contrato" — a
                    mesma palavra que agora fecha a EDIÇÃO, logo acima. Duas ações vizinhas com o
                    mesmo nome e efeitos completamente diferentes (uma salva texto, a outra emite um
                    PDF e move o card) é o tipo de coisa que faz alguém clicar sem querer. */}
                {gerando
                  ? "Gerando o PDF…"
                  : guardados.length > 0
                    ? `Gerar a versão ${proximaVersao}`
                    : "Gerar contrato"}
              </button>
            )}

            {/* ⚠️ O MOTIVO DA TRAVA, NA LÍNGUA DE QUEM ESTÁ OLHANDO. Na Têmis (comAvisos) os nomes
                das variáveis são a pauta do dia; no portal eles não dizem nada a quem não mexe em
                cadastro nem em minuta — ali o recado útil é quantos campos faltam e de quem é a
                bola. Sem uma frase qualquer, o botão apagado vira "o sistema quebrou".

                ⚠️ AS DUAS FRASES ANDAM COM O BOTÃO. Elas explicam por que ele está apagado e o que
                acontece ao clicar; sem botão viram legenda de nada — e, no portal, ressuscitariam
                pela porta dos fundos o aviso de emissão que o Lucas mandou tirar de lá. */}
            {!podeGerar ? null : semValor.length > 0 ? (
              <p style={{ color: T.muted, fontSize: 11, margin: 0 }}>
                {comAvisos
                  ? `${semValor.length === 1 ? "1 variável está" : `${semValor.length} variáveis estão`} sem valor e o documento não pode ser gerado: ${semValor.join(", ")}.`
                  : `${semValor.length === 1 ? "1 campo do contrato está" : `${semValor.length} campos do contrato estão`} em branco. A Têmis precisa completar o cadastro ou a minuta antes de o documento ser gerado.`}
              </p>
            ) : guardados.length > 0 && !gerado ? (
              <p style={{ color: T.muted, fontSize: 11, margin: 0 }}>
                Já existe contrato guardado. Gerar de novo cria uma versão nova; a anterior continua
                na gaveta, marcada como substituída.
              </p>
            ) : podeEditar ? (
              <p style={{ color: T.muted, fontSize: 11, margin: 0 }}>
                Fechar gera o PDF{edicao ? " com a alteração manual" : ""}, guarda na gaveta desta
                venda e faz o card andar. O texto continua editável depois — cada fechamento vira
                uma versão nova, e nenhuma se apaga.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A silhueta de uma folha de contrato: o título, a qualificação das partes e as cláusulas, cada
 * uma com o seu rótulo curto. Larguras em %, para o desenho acompanhar a folha em qualquer janela.
 */
const BLOCOS_DA_FOLHA: string[][] = [
  ["58%", "34%"],
  ["100%", "100%", "96%", "72%"],
  ["44%"],
  ["100%", "97%", "100%", "61%"],
  ["51%"],
  ["100%", "100%", "93%", "46%"],
  ["38%"],
  ["100%", "95%", "100%", "68%"],
];

/**
 * A FOLHA ENQUANTO ELA NÃO CHEGA.
 *
 * Lucas (10/09/2026): *"esse carregando está ruim"*.
 *
 * ⚠️ ELE EXISTE PARA A MOLDURA NÃO MUDAR DE TAMANHO. A frase "Montando o contrato…" ocupava ~95px
 * no meio de um cartão sem altura: a prévia nascia como uma tira fina e saltava para a tela inteira
 * quando o contrato chegava. O esqueleto tem a altura de uma folha, então a prévia abre no tamanho
 * que vai ter, e o contrato só preenche um desenho que já estava lá.
 *
 * ⚠️ ELE COPIA A MOLDURA DA FOLHA REAL — mesmo fundo, mesmo raio, mesmo `padding: "40px 48px"`.
 * É o que faz a troca ser um preenchimento, e não uma substituição.
 *
 * ⚠️ OS CINZAS SÃO FIXOS, e não token de tema. A folha imita PAPEL e é branca nos dois temas (ver
 * `css-do-documento.ts`); um cinza que clareasse no escuro sumiria dentro do branco.
 */
function FolhaEsqueleto() {
  return (
    <div
      aria-label="Montando o contrato"
      className="animate-pulse"
      role="status"
      style={{
        background: "#fff",
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: "40px 48px",
      }}
    >
      {BLOCOS_DA_FOLHA.map((grupo, i) => (
        <div
          key={`g${i}`}
          style={{
            display: "grid",
            gap: 9,
            justifyItems: i === 0 ? "center" : "stretch",
            marginTop: i === 0 ? 0 : 22,
          }}
        >
          {grupo.map((largura, j) => (
            <div
              key={`g${i}l${j}`}
              style={{
                background: "#e9ecf1",
                borderRadius: 4,
                height: i === 0 ? 13 : 11,
                width: largura,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
