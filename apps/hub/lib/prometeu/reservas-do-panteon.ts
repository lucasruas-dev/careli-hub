import type { createPrometeuClient } from "./data";
import type { ReservaDoC2x, UnidadeDoCliente } from "./reservas-c2x";

type AdminClient = NonNullable<ReturnType<typeof createPrometeuClient>>;

// AS RESERVAS FEITAS NO SALÃO, no formato que a Central já entende.
//
// ⚠️ ISTO INVERTE A REGRA DE 01/08 — de propósito (Lucas, 29/08/2026): *"agora que temos a
// reserva dentro do prometeu, a parte de monitoramento, e toda a central tem que ser alimentada
// por essas vias que criamos hoje, a parte de reserva tem que ser de agora do panteon e não mais
// do c2x"*. O cabeçalho de reservas-c2x.ts ainda diz "as reservas do dia vêm do C2X — o hub não
// registra nenhuma": era verdade até a posição de reserva existir.
//
// ⚠️ SOMA, NUNCA SUBSTITUI. O Lucas foi explícito em 28/08: *"os novos empreendimentos a partir
// de hoje não recebem reserva do c2x, vão receber direto do panteon. Os empreendimentos antigos
// ainda continuam"*. Trocar uma fonte pela outra apagaria da Central as reservas que o corretor
// lança no C2X nos lançamentos antigos. A Central lê as DUAS e junta pelo CPF.
//
// ⚠️ O CPF É A CHAVE DO CRUZAMENTO, e aqui ele vem do credenciado da fila — a mesma pessoa que
// o C2X identifica pelo CPF do comprador. Reserva de balcão pode não ter documento; nesse caso
// a chave cai para o id do credenciado, para a linha continuar aparecendo em vez de sumir (ou,
// pior, de se fundir com outra pessoa sem CPF).

export type ReservaDoPanteon = ReservaDoC2x & {
  /** Id do credenciado no evento — a Central usa para abrir a ficha sem procurar por nome. */
  credenciadoId: string;
  /** O cupom: uma reserva de vários lotes compartilha o grupo. */
  grupoId: string;
  imobiliaria: null | string;
};

type LinhaDaReserva = {
  codigo: string;
  created_at: string;
  credenciado_id: string;
  grupo_id: string;
  lote: string;
  quadra: string;
};

type LinhaDoCredenciado = {
  corretor: null | string;
  documento: null | string;
  id: string;
  imobiliaria: null | string;
  nome: string;
};

const soDigitos = (v: null | string | undefined) => String(v ?? "").replace(/\D/g, "");

/**
 * As reservas VIVAS do evento, já com nome, CPF, corretor e imobiliária de quem reservou.
 *
 * Devolve lista vazia (sem erro) quando o evento não tem nenhuma: Central sem reserva é um
 * estado normal do começo do dia, não uma falha.
 */
export async function reservasVivasDoPanteon(
  client: AdminClient,
  eventoId: string,
): Promise<{ error?: string; reservas: ReservaDoPanteon[] }> {
  const { data, error } = await client
    .from("prometeu_reservas")
    .select("codigo, quadra, lote, grupo_id, credenciado_id, created_at")
    .eq("evento_id", eventoId)
    .eq("situacao", "reservada")
    .order("created_at");

  if (error) return { error: error.message, reservas: [] };
  const linhas = (data ?? []) as LinhaDaReserva[];
  if (linhas.length === 0) return { reservas: [] };

  // Uma consulta para todos os credenciados envolvidos, em vez de uma por reserva.
  const ids = [...new Set(linhas.map((l) => l.credenciado_id).filter(Boolean))];
  const { data: pessoas } = await client
    .from("prometeu_credenciados")
    .select("id, nome, documento, imobiliaria, corretor")
    .in("id", ids);

  const porId = new Map(
    ((pessoas ?? []) as LinhaDoCredenciado[]).map((p) => [p.id, p]),
  );

  return {
    reservas: linhas.map((l) => {
      const p = porId.get(l.credenciado_id);
      return {
        cliente: p?.nome ?? "Sem identificação",
        corretor: p?.corretor ?? null,
        // Sem CPF (reserva de balcão), a chave vira o id do credenciado: a linha continua
        // aparecendo e NÃO se funde com outra pessoa sem documento.
        cpf: soDigitos(p?.documento) || `id:${l.credenciado_id}`,
        credenciadoId: l.credenciado_id,
        criadoEm: l.created_at,
        grupoId: l.grupo_id,
        imobiliaria: p?.imobiliaria ?? null,
        lote: l.lote,
        quadra: l.quadra,
        unidade: l.codigo,
      };
    }),
  };
}

/**
 * O mapa CPF → unidades na mão da pessoa, no formato que a Central já consome.
 *
 * ⚠️ ALIMENTA a coluna "Unidades" da lista, o "UN" de cada mesa e o funil. Antes vinha do C2X
 * (`unidadesVivasDoC2x`); desde 29/08/2026 vem daqui, junto com as reservas — Lucas: *"pode ler
 * somente o panteon"*.
 *
 * ⚠️ `vendida` é SEMPRE false: a posição de reserva do salão só reserva. Venda fechada continua
 * sendo estado do C2X, e marcar como vendido aqui inflaria o funil com negócio que não existe.
 * A etapa é a do salão — "Reservado" — que é o que a Central mostra na coluna.
 */
export function unidadesPorCpfDoPanteon(
  reservas: ReservaDoPanteon[],
): Record<string, UnidadeDoCliente[]> {
  const mapa: Record<string, UnidadeDoCliente[]> = {};
  for (const r of reservas) {
    (mapa[r.cpf] ??= []).push({
      etapa: "Reservado",
      lote: r.lote,
      quadra: r.quadra,
      unidade: r.unidade,
      vendida: false,
    });
  }
  return mapa;
}
