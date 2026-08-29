import { normalizarCodigoDeUnidade } from "./cupom";
import type { createPrometeuClient } from "./data";

type AdminClient = NonNullable<ReturnType<typeof createPrometeuClient>>;

// AS UNIDADES RESERVADAS NO SALÃO, para quem lê situação de unidade fora do Prometeu.
//
// ⚠️ ESTA PEÇA EXISTE PORQUE A RESERVA PASSOU A NASCER NO PANTEON (28/08/2026). O C2X só fica
// sabendo depois — hoje, na verdade, ainda não fica: o endpoint de reserva da API nunca foi
// entregue. Enquanto isso, qualquer tela que pergunte "esse lote está livre?" para o legado vai
// responder que sim, mesmo com o cliente segurando o cupom impresso na mão.
//
// Foi o que aconteceu: o Lucas reservou o RVPB03 no tótem e a tela de Unidades do Apolo seguiu
// mostrando "Disponível". *"Tem que refletir em tudo essa reserva"* — daí este módulo, que dá a
// mesma resposta para todos os leitores.
//
// ⚠️ E TRAZ O NOME DE QUEM RESERVOU, não só o código. Sem ele acontece coisa pior que faltar
// dado: a tela de Unidades mostrava o lote como "Reservado" e, ao lado, o comprador da ÚLTIMA
// proposta antiga do C2X — uma pessoa que não tem nada a ver com a reserva de agora. Nome
// errado numa tela de atendimento faz alguém atender o cliente errado.
//
// ⚠️ QUEM CRIAR TELA NOVA QUE LEIA `sale_status_id` PRECISA PASSAR POR AQUI. A lista está em
// lib/apolo/balde-da-unidade.ts (Apolo) e lib/prometeu/situacao-do-lote.ts (telão).

// O PostgREST corta em 1.000 linhas SEM ERRO — a página some e ninguém percebe. Paginar é a
// única forma de ter certeza de que a resposta está inteira.
const PAGINA = 1000;

export type ReservaViva = {
  /**
   * O titular — o 1º proponente, o mesmo nome que saiu no cupom.
   *
   * ⚠️ SÓ ELE (Lucas, 28/08: "nessa tela pode deixar somente o primeiro proponente"). A lista de
   * unidades é de leitura rápida, uma linha por lote; a composição inteira da reserva é assunto
   * da proposta de aquisição, não desta tela.
   */
  cliente: null | string;
  /** De onde ele veio ("IMOBILIÁRIA · Corretor"), gravado na reserva no momento do bip. */
  origem: null | string;
};

type LinhaDeReserva = {
  codigo: string;
  proponentes: null | { nome?: null | string; origem?: null | string }[];
};

/**
 * As unidades com reserva VIVA no Panteon, por código normalizado (`RVPB03`).
 *
 * Devolve um Map vazio em qualquer tropeço: uma tela do Apolo não pode quebrar porque a consulta
 * de reservas falhou — ela volta a mostrar o que o C2X diz, que é o comportamento de antes.
 */
export async function reservasVivasPorCodigo(
  client: AdminClient,
): Promise<Map<string, ReservaViva>> {
  const porCodigo = new Map<string, ReservaViva>();

  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await client
      .from("prometeu_reservas")
      .select("codigo, proponentes")
      .eq("situacao", "reservada")
      .range(inicio, inicio + PAGINA - 1);

    if (error || !data) return porCodigo;

    for (const linha of data as LinhaDeReserva[]) {
      const codigo = normalizarCodigoDeUnidade(linha.codigo);
      if (!codigo) continue;
      const lista = Array.isArray(linha.proponentes) ? linha.proponentes : [];
      // O titular é sempre o primeiro — mesma ordem que o cupom imprime.
      const titular = lista[0];
      porCodigo.set(codigo, {
        cliente: String(titular?.nome ?? "").trim() || null,
        // Reservas feitas antes de 28/08 não têm origem gravada; a linha simplesmente não sai.
        origem: String(titular?.origem ?? "").trim() || null,
      });
    }

    // Página incompleta = acabou. Página cheia pode ter mais atrás dela.
    if (data.length < PAGINA) return porCodigo;
  }
}
