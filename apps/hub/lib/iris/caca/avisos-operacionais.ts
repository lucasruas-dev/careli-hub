import type { SupabaseClient } from "@supabase/supabase-js";

// MURAL DE AVISOS OPERACIONAIS da CACA: "o que esta' acontecendo agora" na operacao, escrito
// pelo time e lido por ela antes de responder. Ver a migration 0073 pro porque.
//
// Em julho a emissao dos boletos atrasou (correcao do IPCA) e a CACA nao sabia: ela achava a
// parcela, nao achava o link e transferia. A operadora respondia o MESMO texto explicando o
// atraso, 216 vezes. Com o mural, a CACA da' essa resposta sozinha e o atendimento encerra ali.
//
// O aviso tem PRAZO (`vale_ate`): contexto datado que nao expira sozinho vira mentira dentro do
// cerebro dela — foi o que aconteceu com o bloco "TEMPORARIO" escrito a mao na persona.

export type AvisoOperacional = {
  assunto: string | null;
  texto: string;
  titulo: string;
  valeAte: string | null;
};

type LinhaDeAviso = {
  assunto: string | null;
  ativo: boolean | null;
  texto: string | null;
  titulo: string | null;
  vale_ate: string | null;
};

// Logica pura (testavel): fica so' o que esta' ativo E dentro do prazo.
export function filtrarVigentes(
  linhas: LinhaDeAviso[],
  agora: Date = new Date(),
): AvisoOperacional[] {
  return linhas
    .filter((linha) => {
      if (linha.ativo === false) {
        return false;
      }

      const texto = linha.texto?.trim();

      if (!texto) {
        return false;
      }

      if (!linha.vale_ate) {
        // Sem prazo: vale ate' alguem desligar na mao.
        return true;
      }

      const prazo = new Date(linha.vale_ate);

      if (Number.isNaN(prazo.getTime())) {
        // Data quebrada: trata como sem prazo em vez de descartar um aviso que pode ser
        // importante. Quem escreveu erra o campo, nao perde o recado.
        return true;
      }

      return prazo.getTime() >= agora.getTime();
    })
    .map((linha) => ({
      assunto: linha.assunto?.trim() || null,
      texto: (linha.texto ?? "").trim(),
      titulo: linha.titulo?.trim() || "Aviso",
      valeAte: linha.vale_ate,
    }));
}

export async function carregarAvisosVigentes(
  client: SupabaseClient,
): Promise<AvisoOperacional[]> {
  const { data, error } = (await client
    .from("iris_avisos_operacionais")
    .select("titulo,texto,assunto,ativo,vale_ate")
    .eq("ativo", true)
    .limit(20)) as { data: LinhaDeAviso[] | null; error: unknown };

  if (error || !data) {
    // Mural indisponivel nao pode calar a CACA: ela responde sem o contexto extra.
    return [];
  }

  return filtrarVigentes(data);
}
