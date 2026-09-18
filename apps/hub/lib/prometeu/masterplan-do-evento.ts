// O ESTADO DO MAPA PARA O TELÃO DO LANÇAMENTO.
//
// ⚠️ A COR SAI DO PANTEON, E SÓ DELE (Lucas, 18/09/2026: *"esses status tem que morar em um so
// lugar"* · *"no c2x não precisa olhar"* · *"se eu precisar atualizar eu faço um sync"*). A
// situação de cada lote vem de `lerSituacaoDasUnidades` (lib/hercules/situacao-da-unidade.ts), a
// mesma leitura da tela Venda e do Apolo, e ela já conta a reserva do salão (`prometeu_reservas`)
// junto com a do Hércules e a proposta viva. Até 18/09 este arquivo juntava o C2X ao vivo com as
// reservas do evento numa régua própria, e o telão podia pintar de verde um lote que o
// coordenador tinha bloqueado no Panteon.
//
// ⚠️ LEITURA A CADA PEDIDO, SEM CACHE. É o que deixa a reserva feita no tótem pintar o lote em
// segundos: o POST da reserva avisa o canal do evento, o telão pede o mapa de novo e a régua lê
// `prometeu_reservas` na hora. Guardar a resposta, aqui ou na CDN, é projetar mapa velho na
// frente do cliente que acabou de reservar (ver o no-store da rota pública).
//
// ⚠️ O QUE SAI DAQUI É PÚBLICO. Esta resposta viaja por um link sem login, para um computador
// de terceiro, e é projetada para o salão inteiro. Por isso ela carrega SÓ o nome da unidade e
// UMA palavra de situação: nunca comprador, nunca valor, nunca corretor. Se algum dia alguém
// precisar de mais campo aqui, a pergunta certa é se essa tela ainda pode ser pública.
import {
  lerSituacaoDasUnidades,
  type SituacaoDasUnidades,
} from "@/lib/hercules/situacao-da-unidade";

import { normalizarCodigoDeUnidade } from "./cupom";
import type { createPrometeuClient } from "./data";
import {
  contarSituacoes,
  situacaoNoTelao,
  type SituacaoDoLote,
} from "./situacao-do-lote";

type AdminClient = NonNullable<ReturnType<typeof createPrometeuClient>>;

export type MasterplanDoEvento = {
  /** ISO: o telão mostra discretamente, para ninguém projetar mapa congelado sem perceber. */
  atualizadoEm: string;
  contagem: Record<SituacaoDoLote, number>;
  /** { "RVPA01": "disponivel", ... }: nome da unidade para situação, e nada mais. */
  lotes: Record<string, SituacaoDoLote>;
};

export async function masterplanDoEvento(
  client: AdminClient,
  evento: {
    config?: null | Record<string, unknown>;
    enterpriseId: null | string;
    id: string;
  },
): Promise<{ dados?: MasterplanDoEvento; error?: string }> {
  const enterpriseId = Number(evento.enterpriseId);
  if (!Number.isFinite(enterpriseId) || enterpriseId <= 0) {
    return { error: "Evento sem empreendimento vinculado no Setup." };
  }

  // ⚠️ FALHA DE LEITURA VIRA ERRO, NUNCA MAPA VERDE. A régua lança quando não consegue ler, e é
  // de propósito: devolver um mapa pela metade pintaria de livre o que não se conseguiu ler. Com o
  // erro, a página mostra o aviso na primeira carga e o telão já aberto mantém o último mapa bom
  // (TelaoMasterplan.tsx ignora a resposta que não é 200).
  let situacoes: SituacaoDasUnidades;
  try {
    // `hercules_unidades.enterprise_id` guarda o id do C2X como texto ("35"); o Number acima
    // normaliza o que veio do Setup (" 35", "035") para a mesma forma.
    situacoes = await lerSituacaoDasUnidades(client, [String(enterpriseId)]);
  } catch (erro) {
    // O detalhe fica no log do servidor: esta resposta sai por uma rota pública, e mensagem crua
    // do banco (nome de tabela, de coluna) não tem o que fazer num computador de terceiro.
    console.error("[prometeu/masterplan] falha ao ler a situação das unidades", erro);
    return { error: "Não foi possível ler a situação das unidades agora." };
  }

  // ⚠️ NENHUMA UNIDADE NO PANTEON É DEFEITO DE CARGA, NÃO MAPA VAZIO. Sem isto o telão abriria
  // com todos os lotes sem cor, e lote sem cor é lido pelo salão como "disponível, o sistema é que
  // falhou". O remédio é o sync do empreendimento, e o aviso diz isso.
  if (situacoes.unidades.length === 0) {
    return {
      error:
        "O Panteon ainda não tem as unidades deste empreendimento. Sincronize o cadastro antes de projetar o mapa.",
    };
  }

  // ⚠️ A PERGUNTA É PELO TERRENO. Nos produtos divididos (Vale do Ouro, Lagoa Bonita) o mesmo lote
  // tem o código do pai e o da gleba, e os dois respondem a MESMA situação: é o `porCodigo` da
  // régua que garante isso. O mapa sai com todos os códigos do terreno; o desenho pinta só os que
  // ele tem, e a contagem soma cada terreno uma vez.
  const lotes: Record<string, SituacaoDoLote> = {};
  const porTerreno = new Map<string, SituacaoDoLote>();
  for (const [codigoBruto, unidade] of situacoes.porCodigo) {
    const codigo = normalizarCodigoDeUnidade(codigoBruto);
    if (!codigo) continue;
    const situacao = situacaoNoTelao(unidade.situacao);
    lotes[codigo] = situacao;
    porTerreno.set(unidade.id, situacao);
  }

  // ⚠️ A TRAVA DO EVENTO SÓ TAPA BURACO. `lotesBloqueados` (PrometeuEventoConfig) nasceu para o
  // lote que NÃO TEM CADASTRO (vendido antes da carga, permuta, área remanescente): sem chave no
  // mapa ele ficaria sem cor, lido como livre. Continua assim: o código que o Panteon não conhece
  // entra como indisponível. Mas o código que o Panteon CONHECE segue a régua única, e não a
  // lista: se a lista mandasse também nele, o telão voltaria a ter uma situação diferente da tela
  // Venda, que é exatamente o defeito que este arquivo deixou de ter. Para travar um lote que tem
  // cadastro, o caminho é bloqueá-lo no Panteon, e aí ele sai bloqueado em todas as telas.
  const travados = new Set(
    (Array.isArray(evento.config?.lotesBloqueados)
      ? (evento.config.lotesBloqueados as unknown[])
      : []
    )
      .map((c) => normalizarCodigoDeUnidade(String(c ?? "")))
      .filter(Boolean),
  );
  const soNaTrava: SituacaoDoLote[] = [];
  for (const codigo of travados) {
    if (lotes[codigo]) continue;
    lotes[codigo] = "indisponivel";
    soNaTrava.push("indisponivel");
  }

  return {
    dados: {
      atualizadoEm: new Date().toISOString(),
      contagem: contarSituacoes([...porTerreno.values(), ...soNaTrava]),
      lotes,
    },
  };
}
