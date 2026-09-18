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
// ⚠️ DESDE 18/09/2026 ESTA PEÇA NÃO DECIDE SITUAÇÃO NENHUMA. Lucas: *"esses status tem que morar
// em um so lugar"* · *"no c2x não precisa olhar"*. Se o lote está livre, reservado ou vendido é
// pergunta para lib/hercules/situacao-da-unidade.ts, que já conta a reserva do salão
// (`prometeu_reservas`) junto com a do Hércules e a proposta viva. O telão já lê de lá.
//
// O que continua sendo daqui é o NOME de quem reservou no salão (o titular do cupom), que a
// régua única não carrega. Por isso o tropeço devolve Map vazio (ver abaixo): faltar o nome é
// tolerável. ⚠️ Usar a AUSÊNCIA de uma chave deste Map para dizer "livre" não é: numa falha de
// leitura, todo lote reservado no salão viraria disponível.

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
  /** A entidade do Apolo do titular — o que faz o nome virar link para o CRM. */
  entityId: null | string;
  /** De onde ele veio ("IMOBILIÁRIA · Corretor"), gravado na reserva no momento do bip. */
  origem: null | string;
};

type LinhaDeReserva = {
  codigo: string;
  proponentes:
    | null
    | {
        entityId?: null | string;
        nome?: null | string;
        origem?: null | string;
      }[];
};

/**
 * As unidades com reserva VIVA no Panteon, por código normalizado (`RVPB03`).
 *
 * Devolve um Map vazio em qualquer tropeço: uma tela do Apolo não pode quebrar porque faltou o
 * NOME de quem reservou. ⚠️ É por isso que este Map serve para o nome e nunca para a situação
 * (ver o cabeçalho): vazio por falha e vazio por não ter reserva são indistinguíveis aqui.
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
        entityId: String(titular?.entityId ?? "").trim() || null,
        // Reservas feitas antes de 28/08 não têm origem gravada; a linha simplesmente não sai.
        origem: String(titular?.origem ?? "").trim() || null,
      });
    }

    // Página incompleta = acabou. Página cheia pode ter mais atrás dela.
    if (data.length < PAGINA) return porCodigo;
  }
}
