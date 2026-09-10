// OS LINKS PÚBLICOS DE UM EMPREENDIMENTO — o que o corretor manda para fora.
//
// Lucas (10/09/2026): *"vai ter o espelho - cads - imobiliaria"*, numa aba dentro do
// empreendimento, nos dois lugares (Apolo e portal da Gurgel).
//
// ⚠️ DOIS DOS TRÊS LINKS NÃO SÃO DESTE EMPREENDIMENTO — SÃO DA CASA. Conferido em
// `app/publico/cad/page.tsx` e `app/publico/imobiliaria/page.tsx`: nenhuma das duas páginas lê
// searchParams, e a de imobiliária monta a própria lista de empreendimentos no servidor. Quem
// abre escolhe o empreendimento LÁ DENTRO. Só o espelho muda de empreendimento para
// empreendimento. A aba os reúne porque é onde se fala do produto, e é de lá que o link sai para
// o WhatsApp — mas a tela precisa DIZER isso, senão alguém manda o link do CAD achando que ele
// já vem com o Garden escolhido e o corretor cadastra no empreendimento errado.
//
// ⚠️ O LINK EXISTE SEMPRE, COM MAPA OU SEM. Lucas (10/09/2026): *"os que não tiverem
// espelho vão ter a grade"*. Só 8 dos 37 empreendimentos têm masterplan publicado; os outros 29
// abrem na grade. O que o masterplan decide é se a página oferece as DUAS visões ou só uma.
//
// ⚠️ O ESPELHO É SEMPRE O DO PAI. Medido no banco em 10/09/2026: dos oito masterplans publicados
// em `hercules_masterplans`, TODOS são de empreendimento sem pai (GDN, JDG, LAB, REP, RVP, VAL,
// VDO, VLO). Nenhum filho tem mapa próprio — VOC, VOL, VOR, LBF, LBP e LBR herdam o do pai. É o
// modelo do Lucas ([[reference_pai_e_o_macro_filho_tem_autonomia_variavel]]): o desenho é do
// macro, e o recorte é uma leitura por cima dele.
import { linkDoEspelho } from "./link-do-espelho";

/** As três chaves são estáveis: a tela e os testes se referem a elas. */
export type ChaveDoLink = "cad" | "espelho" | "imobiliaria";

export type LinkPublico = {
  chave: ChaveDoLink;
  /** O que a página faz, na língua de quem vai mandar o link. */
  descricao: string;
  /**
   * `false` quando o link é o mesmo para a casa inteira (CAD e imobiliária). A tela precisa
   * mostrar isso — ver o aviso no topo do arquivo.
   */
  doEmpreendimento: boolean;
  /** Por que não há link, quando `url` é null. Sempre acionável. */
  motivo: null | string;
  rotulo: string;
  url: null | string;
};

// Fixo, e não NEXT_PUBLIC_APP_URL — a env vem errada em alguns ambientes. Mesma decisão de
// lib/prometeu/link-da-fila.ts.
const BASE_URL = "https://c2x.app.br";

/**
 * Os três links de um empreendimento.
 *
 * O primeiro sai desligado, com o motivo escrito, apenas quando falta a chave de assinatura no
 * ambiente — nunca por falta de masterplan. Desligado e não escondido: uma linha que some não
 * responde "por que não tem link aqui?".
 */
export function linksDoEmpreendimento({
  codigoDoTopo,
  nomeDoTopo,
  temMapa,
}: {
  /**
   * O código do TOPO da árvore — o pai, ou o próprio quando não há pai. É sempre ele no token,
   * mesmo quando o link é aberto de um filho: para quem está de fora o loteamento é um só
   * ([[feedback_corretor_nao_ve_divisao_interna]]), e grade e espelho mostram o mesmo conjunto.
   */
  codigoDoTopo: null | string;
  nomeDoTopo: null | string;
  /**
   * Há masterplan publicado na árvore?
   *
   * ⚠️ ISTO NÃO LIGA NEM DESLIGA O LINK — só muda o que a página abre. Lucas (10/09/2026): *"os
   * que não tiverem espelho vão ter a grade"*. Dos 37 empreendimentos cadastrados, 8 têm mapa;
   * os outros 29 continuam tendo link público, e ele abre na GRADE (os lotes em quadradinhos,
   * por quadra), que é a mesma informação sem a planta por baixo.
   */
  temMapa: boolean;
}): LinkPublico[] {
  const url = codigoDoTopo && nomeDoTopo ? linkDoEspelho(codigoDoTopo, nomeDoTopo) : null;
  const onde = nomeDoTopo ? ` de ${nomeDoTopo}` : "";

  return [
    {
      chave: "espelho",
      descricao: temMapa
        ? `O mapa de lotes${onde}, com preço e metragem. Sem nenhum dado de cliente.`
        : `Os lotes${onde} em grade, com preço e metragem. Sem masterplan publicado, então abre sem a planta.`,
      doEmpreendimento: true,
      motivo: url
        ? null
        : // Falha fechada do token: sem SESSAO_CAD_SECRET não sai link nenhum.
          "O link não pôde ser assinado. Falta a chave de sessão no ambiente.",
      rotulo: temMapa ? "Espelho do empreendimento" : "Lotes em grade",
      url,
    },
    {
      chave: "cad",
      descricao:
        "Formulário de CAD do corretor. Quem abre escolhe o empreendimento dentro do formulário.",
      doEmpreendimento: false,
      motivo: null,
      rotulo: "Enviar CAD",
      url: `${BASE_URL}/publico/cad`,
    },
    {
      chave: "imobiliaria",
      descricao:
        "Credenciamento de imobiliária. A lista de empreendimentos aparece dentro da página.",
      doEmpreendimento: false,
      motivo: null,
      rotulo: "Credenciar imobiliária",
      url: `${BASE_URL}/publico/imobiliaria`,
    },
  ];
}
