// CHEGOU EM "CREDENCIADO" NO BOARD → ESTÁ NA FILA DO LANÇAMENTO E PODE IMPRIMIR ETIQUETA.
//
// Regra do Lucas, dita no dia do evento (01/08): "chegou em credenciado ele deve ir para
// etiquetas". Antes disso a fila do Prometeu só era alimentada pelo fluxo do PIX de R$ 1.000
// (`prevenda-fluxo.ts`), então quem entrava em "credenciado" por qualquer outro caminho —
// importação, correção de etapa na mão, ajuste do time — ficava invisível para o evento: não
// aparecia na fila, não aparecia na tela de etiquetas, e ninguém percebia até alguém procurar
// o nome. No dia do lançamento eram 3 pessoas nessa situação, achadas por acaso.
//
// BEST-EFFORT: nunca lança e nunca segura a mudança de etapa. Se o Prometeu estiver fora do ar
// ou não houver evento ativo, a etapa muda do mesmo jeito — a fila é consequência, não condição.
import { adicionarCredenciado, eventoOperavelId } from "@/lib/prometeu/data";

import { lerCadDaEsteira } from "./esteira-cad";
import type { createApoloAdminClient } from "./server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export async function garantirNaFilaDoLancamento(
  client: AdminClient,
  entityId: string,
  // `pagoEm` só é informado por quem JÁ sabe a hora do pagamento (o webhook do Asaas). É o que
  // vira `ordem_fila` lá no Prometeu: sem ele a pessoa entra, mas no fim da fila. Quem chama sem
  // isto (Board, importação) não sabe a hora e não deve inventar uma.
  //
  // `enterpriseId` diz de qual CAD sair o corretor/imobiliária que vão na etiqueta. Sem ele, a
  // CAD mais recente — a fila é do evento do dia, e a CAD mais recente é a que o trouxe até aqui.
  opts: { enterpriseId?: null | string; pagoEm?: string | null } = {},
  // `entrou` = ESTA chamada inseriu. `naFila` = a regra está satisfeita, tendo sido esta chamada
  // que resolveu ou não. Quem só quer saber se a pessoa vai aparecer na etiqueta lê `naFila`:
  // "já estava lá" é sucesso, não falha.
): Promise<{ entrou: boolean; motivo: string; naFila: boolean }> {
  try {
    const eventoId = await eventoOperavelId(client);
    if (!eventoId) return { entrou: false, motivo: "sem evento ativo", naFila: false };

    // Já está lá? Nada a fazer — nem quando veio pelo PIX, nem quando entrou por aqui antes.
    const { data: existente } = await client
      .from("prometeu_credenciados")
      .select("id")
      .eq("evento_id", eventoId)
      .eq("entity_id", entityId)
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (existente) return { entrou: false, motivo: "já estava na fila", naFila: true };

    const { data: entidade } = await client
      .from("apolo_entities")
      .select("display_name, legal_name, document_masked")
      .eq("id", entityId)
      .maybeSingle<{
        display_name: string | null;
        document_masked: string | null;
        legal_name: string | null;
      }>();

    const nome = (entidade?.legal_name || entidade?.display_name || "").trim();
    if (!nome) return { entrou: false, motivo: "ficha sem nome", naFila: false };

    const esteira = await lerCadDaEsteira<{ corretor: null | string; imobiliaria: null | string }>(
      client,
      entityId,
      "corretor, imobiliaria",
      { enterpriseId: opts.enterpriseId },
    );

    // SEM `pagoEm`: quem não pagou entra atrás de quem pagou, que é a ordem do dia. Se o
    // pagamento chegar depois, `aoConfirmarPagamentoPrevenda` carimba a hora e a fila se
    // reordena sozinha.
    const r = await adicionarCredenciado({
      client,
      corretor: esteira?.corretor ?? null,
      documento: entidade?.document_masked ?? null,
      entityId,
      eventoId,
      imobiliaria: esteira?.imobiliaria ?? null,
      nome: nome.toUpperCase(),
      origem: "prevenda",
      origemRef: entityId,
      pagoEm: opts.pagoEm ?? null,
    });

    if (r.error) return { entrou: false, motivo: r.error, naFila: false };
    return { entrou: true, motivo: "entrou na fila", naFila: true };
  } catch (erro) {
    return {
      entrou: false,
      motivo: erro instanceof Error ? erro.message : String(erro),
      naFila: false,
    };
  }
}
