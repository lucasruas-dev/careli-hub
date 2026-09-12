import type { EventoDaUnidade } from "@/lib/hercules/historico-da-unidade";
import { rotuloDoMotivo } from "@/lib/temis/indeferimento";
import {
  type EstagioDoTrabalho,
  ESTAGIOS,
  NOME_DO_TIPO,
  nomeDoEstagio,
  type TipoDeTrabalho,
} from "@/lib/temis/trabalhos";

// AS PASSAGENS DE ETAPA DO CARD, VIRANDO LINHA DO TEMPO.
//
// Lucas (11/09/2026): *"o historico nao esta trazendo essas aprovacoes de analise - contrato -
// contrato para assinatura, tem que trazer"*.
//
// ⚠️ AS FRASES SAEM DE `nomeDoEstagio`, E NUNCA DO VALOR CRU. O banco guarda `prazo_legal` e a tela
// chama aquilo de "Pré-venda" desde 11/09; guarda `faturado` e a tela chama de "Concluído" em tudo
// que não é contrato. Um histórico que imprimisse o valor cru falaria uma língua que não existe em
// nenhuma outra tela do módulo — e quem lê teria de aprender duas palavras para a mesma etapa.
//
// ⚠️ MAS A PALAVRA GRAVADA SOBREVIVE AO QUE O VOCABULÁRIO NÃO CONHECE. `de`/`para` não têm check na
// 0153 de propósito: cada linha é fato datado, e a 0150 já renomeou três estágios. Uma linha antiga
// com `confeccao` sai escrita `confeccao` mesmo — é o que estava na tela naquele dia, e reescrever
// o passado é exatamente o que uma auditoria de contrato não pode encontrar.
//
// ⚠️ E O TIPO ENTRA NA FRENTE QUANDO NÃO É CONTRATO. Uma proposta pode ter DOIS cards (medido em
// 10/09/2026: a venda do Henrique e o pedido de cancelamento dela), e os dois caem na mesma lista.
// "Contrato → Em assinatura" ao lado de "Análise → Contrato" sem dizer de qual dos dois trabalhos
// se fala é ambíguo no pior lugar possível: o da auditoria.

/** Uma linha de `temis_trabalho_etapas`, como o PostgREST devolve. */
export type PassagemGravada = {
  de: null | string;
  motivo: null | string;
  observacao: null | string;
  origem: null | string;
  para: string;
  proposta_id: null | string;
  quando: string;
  quem_nome: null | string;
  trabalho_id: string;
  trabalho_tipo: string;
};

/** O card, para o caso em que a tabela não tem nenhuma linha dele. */
export type CardDoHistorico = {
  estagio: string;
  estagio_desde: string;
  id: string;
  proposta_id: null | string;
  tipo: string;
};

const ESTAGIOS_CONHECIDOS: EstagioDoTrabalho[] = [
  ...ESTAGIOS.map((e) => e.id),
  "indeferido",
];

const TIPOS_CONHECIDOS = Object.keys(NOME_DO_TIPO) as TipoDeTrabalho[];

function tipoConhecido(bruto: string): null | TipoDeTrabalho {
  const limpo = bruto.trim();
  return TIPOS_CONHECIDOS.find((t) => t === limpo) ?? null;
}

/**
 * Como a etapa se escreve na linha do tempo.
 *
 * ⚠️ VALOR DESCONHECIDO SAI COMO ELE MESMO. É o caso das linhas gravadas antes de uma renomeação —
 * e o certo é mostrá-las com a palavra que valeu, não traduzi-las para o vocabulário de hoje nem
 * escondê-las atrás de um "etapa desconhecida".
 */
function comoSeEscreveAEtapa(bruto: string, tipo: null | TipoDeTrabalho): string {
  const limpo = bruto.trim();
  const conhecido = ESTAGIOS_CONHECIDOS.find((e) => e === limpo);
  // Sem tipo conhecido a régua de `nomeDoEstagio` que depende dele (faturado = "Concluído" fora do
  // contrato) não tem como ser aplicada; `contrato` é o caminho completo e o rótulo neutro.
  return conhecido ? nomeDoEstagio(conhecido, tipo ?? "contrato") : limpo;
}

/**
 * "Cancelamento · " — o prefixo que diz de qual card é a linha.
 *
 * Vazio no contrato, que é a regra: prefixar TODA linha com "Contrato ·" gastaria a metade
 * esquerda da coluna repetindo o óbvio.
 */
/**
 * O nome de tela de um estágio COMO ELE ESTÁ GRAVADO no banco, cru, com o tipo também cru.
 *
 * ⚠️ É O ÚNICO TRADUTOR DE ETAPA GRAVADA DA CASA, e é por isso que ele é exportado: a rota do card
 * precisa da mesma palavra para dizer "este trabalho está em Pré-venda" numa recusa, e uma segunda
 * régua escrita lá divergiria desta no primeiro rótulo que mudasse — foi o que aconteceu com a
 * classificação da cor da linha do tempo, que vivia dentro do componente.
 */
export function nomeDaEtapaGravada(estagio: string, tipoDoTrabalho: string): string {
  return comoSeEscreveAEtapa(estagio, tipoConhecido(tipoDoTrabalho));
}

function prefixoDoTipo(bruto: string): string {
  const conhecido = tipoConhecido(bruto);
  if (conhecido === "contrato") return "";
  const nome = conhecido ? NOME_DO_TIPO[conhecido] : bruto.trim();
  return nome ? `${nome} · ` : "";
}

const texto = (v: null | string | undefined): null | string => {
  const t = String(v ?? "").trim();
  return t || null;
};

/**
 * O contexto da passagem: o motivo do catálogo e o que a pessoa escreveu.
 *
 * ⚠️ OS DOIS JUNTOS, E NÃO UM OU OUTRO. No indeferimento o motivo é o código do catálogo e a
 * observação é o caso concreto — mostrar só o primeiro devolve uma categoria, e só o segundo perde
 * a categoria que se conta depois ("qual motivo mais repete?").
 *
 * ⚠️ E O MOTIVO SAI PELO RÓTULO, PELA MESMA RAZÃO QUE A ETAPA SAI POR `nomeDoEstagio`. O que está
 * gravado é o CÓDIGO (`documento_faltando`), que existe para nunca mudar e poder ser contado; quem
 * o traduz é `rotuloDoMotivo` (`lib/temis/indeferimento.ts`), e é ele que a tela do indeferimento e
 * a mensagem que sai para o corretor já usam. Sem isso a linha saía "documento_faltando · falta o
 * RG do cônjuge": snake_case no meio de uma coluna escrita em português, e uma segunda palavra para
 * a mesma coisa.
 *
 * ⚠️ CÓDIGO FORA DO CATÁLOGO NÃO SOME NEM VIRA VAZIO: `rotuloDoMotivo` devolve o valor cru, que é
 * melhor que nada — é a mesma disciplina de `comoSeEscreveAEtapa` com a palavra que a 0150 renomeou.
 */
function contexto(p: PassagemGravada): null | string {
  const motivo = texto(p.motivo);
  const partes = [motivo ? rotuloDoMotivo(motivo) : null, texto(p.observacao)].filter(Boolean);
  return partes.length > 0 ? partes.join(" · ") : null;
}

/**
 * A linha do tempo das etapas de UM card.
 *
 * ⚠️ SEM NENHUMA LINHA GRAVADA, DERIVA-SE UMA DO PRÓPRIO CARD — a mesma técnica do `ETAPA_DERIVADA`
 * do Hércules. Os cards vivos já andaram sem deixar rastro (a tabela não existia), e a tabela
 * também pode ainda não ter sido criada: nos dois casos a aba diria "Nada registrado ainda" sobre
 * um contrato que atravessou três etapas esta semana. A derivada diz o que dá para provar — em que
 * etapa ele está e desde quando — e a observação avisa que o caminho anterior não foi gravado.
 *
 * ⚠️ E NADA DE BACKFILL SINTÉTICO. Escrever "analise → contrato" com data chutada é fabricar fato
 * datado em auditoria de contrato: a linha pareceria idêntica a uma verdadeira, e daqui a seis
 * meses ninguém saberia quais eram quais.
 */
export function historicoDeEtapas(
  passagens: PassagemGravada[],
  card: CardDoHistorico,
): EventoDaUnidade[] {
  if (passagens.length === 0) return [derivadaDoCard(card)];

  return passagens
    .map((p): EventoDaUnidade => {
      const tipo = tipoConhecido(p.trabalho_tipo);
      const prefixo = prefixoDoTipo(p.trabalho_tipo);
      const para = comoSeEscreveAEtapa(p.para, tipo);
      const de = p.de ? comoSeEscreveAEtapa(p.de, tipo) : null;

      return {
        // Dentro de um card há um comprador só. A coluna existe porque no Hércules o eixo é o
        // LOTE, que passa por várias pessoas; aqui ela não acrescenta nada à linha.
        cliente: null,
        codigo: null,
        fato: de
          ? `${prefixo}${de} → ${para}`
          : // ⚠️ `de` NULO É O NASCIMENTO DO CARD, e não dado faltando (0153). "→ Análise" sem
            // origem pareceria uma transição com metade apagada.
            `${prefixo}Trabalho aberto na Têmis`,
        fonte: "temis",
        // ⚠️ O PREFIXO `temis-etapa:` EXISTE PARA NÃO COLIDIR com os `mov:` e `etapa:` do Hércules:
        // as duas listas entram no mesmo `map` do React, e id repetido ali some com uma das linhas.
        id: `temis-etapa:${p.trabalho_id}:${p.quando}:${p.de ?? "-"}:${p.para}`,
        observacao: contexto(p),
        propostaId: p.proposta_id ?? `temis:${p.trabalho_id}`,
        quando: p.quando,
        quem: texto(p.quem_nome),
        // ⚠️ CONTINUA `etapa`, E NÃO UM QUARTO VALOR. `tipo` responde "que natureza de fato é
        // este" (etapa | pagamento | assinatura) e é quem manda na cor da borda; "quem registrou"
        // é outra pergunta, e ela é respondida por `fonte`.
        tipo: "etapa",
        valor: null,
      };
    })
    .sort((a, b) => b.quando.localeCompare(a.quando));
}

/** O que o próprio card conta quando ninguém gravou o caminho dele. */
function derivadaDoCard(card: CardDoHistorico): EventoDaUnidade {
  const tipo = tipoConhecido(card.tipo);
  const prefixo = prefixoDoTipo(card.tipo);
  const etapa = comoSeEscreveAEtapa(card.estagio, tipo);

  return {
    cliente: null,
    codigo: null,
    fato: `${prefixo}Em ${etapa}`,
    fonte: "temis",
    id: `temis-etapa:${card.id}:derivada`,
    observacao:
      "O caminho até esta etapa não foi gravado: o registro das passagens começou depois deste card.",
    propostaId: card.proposta_id ?? `temis:${card.id}`,
    quando: card.estagio_desde,
    // O card sabe QUANDO entrou na etapa (`estagio_desde`) e não sabe por quem: quem move grava
    // só o estágio. Vazio continua melhor que errado.
    quem: null,
    tipo: "etapa",
    valor: null,
  };
}
