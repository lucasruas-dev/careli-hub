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
// ⚠️ QUEM CRIAR TELA NOVA QUE LEIA `sale_status_id` PRECISA PASSAR POR AQUI. A lista está em
// lib/apolo/balde-da-unidade.ts (Apolo) e lib/prometeu/situacao-do-lote.ts (telão).

// O PostgREST corta em 1.000 linhas SEM ERRO — a página some e ninguém percebe. Paginar é a
// única forma de ter certeza de que a resposta está inteira.
const PAGINA = 1000;

/**
 * Os códigos de unidade com reserva VIVA no Panteon, normalizados (`RVPB03`).
 *
 * Devolve um Set vazio em qualquer tropeço: uma tela do Apolo não pode quebrar porque a consulta
 * de reservas falhou — ela volta a mostrar o que o C2X diz, que é o comportamento de antes.
 */
export async function codigosReservadosNoPanteon(
  client: AdminClient,
): Promise<Set<string>> {
  const codigos = new Set<string>();

  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await client
      .from("prometeu_reservas")
      .select("codigo")
      .eq("situacao", "reservada")
      .range(inicio, inicio + PAGINA - 1);

    if (error || !data) return codigos;

    for (const linha of data as { codigo: string }[]) {
      const codigo = normalizarCodigoDeUnidade(linha.codigo);
      if (codigo) codigos.add(codigo);
    }

    // Página incompleta = acabou. Página cheia pode ter mais atrás dela.
    if (data.length < PAGINA) return codigos;
  }
}
