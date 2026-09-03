// QUEM PODE VENDER NESTE EMPREENDIMENTO — a lista que a reserva oferece.
//
// Lucas (03/09/2026): *"para criar uma reserva em nome de um corretor ou imobiliária é OBRIGATÓRIO
// que esses dois estejam habilitados para vender nesse empreendimento"*.
//
// ⚠️ O FILTRO DE PAPEL NÃO É OPCIONAL. O vínculo `empreendimento` do Apolo não é só de imobiliária:
// prospect e corretor recebem o MESMO `relationship_type`, e das 151 linhas medidas 71 são de
// prospect ou corretor. Sem cruzar com `apolo_entity_profiles`, o painel do coordenador já contou
// 76 "imobiliárias" onde havia 30 — e aqui o efeito seria pior: a reserva sairia no nome de um
// prospect. Quem resolve isso é `lerImobiliariasVinculadas`, e é ela que esta camada usa.
//
// ⚠️ O CORRETOR NÃO PRECISA DE VÍNCULO PRÓPRIO COM O EMPREENDIMENTO — quem precisa é a
// IMOBILIÁRIA dele. A primeira versão exigia os dois, lendo ao pé da letra o *"é obrigatório que
// esses dois estejam habilitados"*, e o Lucas corrigiu na hora em que viu o efeito: *"não entendi o
// motivo de não trazer todos os corretores"*. O dado dava razão a ele — dos 65 corretores das 37
// imobiliárias do Vale do Ouro, só 23 tinham vínculo individual, e os outros 42 apareciam cinza sem
// que isso significasse nada sobre o direito de vender.
//
// A regra que sobrou é a que corresponde ao mundo: a imobiliária é credenciada no empreendimento, e
// o corretor é credenciado NA IMOBILIÁRIA. As duas continuam sendo conferidas na gravação.

import type { SupabaseClient } from "@supabase/supabase-js";

import { corretoresDaImobiliaria } from "@/lib/apolo/disparo-credenciamento";
import { lerImobiliariasVinculadas } from "@/lib/apolo/incorporador/crm";

/**
 * O empreendimento da unidade e TODA a família dele (pai e filhos), em ids do C2X.
 *
 * ⚠️ SEM ISSO A LISTA VEM VAZIA, e foi o que aconteceu na primeira reserva de verdade: o Lucas
 * clicou num lote do Vale do Ouro e leu "nenhuma imobiliária habilitada". As unidades do Vale do
 * Ouro estão espalhadas entre VLO (35), VOL (36) e VOC (37) — mas as 37 imobiliárias credenciadas
 * estão vinculadas ao 35, e só a ele. Perguntar "quem vende no 37?" devolve zero, e a tela conclui
 * que ninguém pode vender num empreendimento onde quase quarenta imobiliárias podem.
 *
 * A família é o recorte certo porque é o mesmo loteamento: o pai é o espelho de onde saem as
 * unidades, e os filhos são as visões que respondem pela burocracia. Uma imobiliária credenciada em
 * qualquer um deles vende o mesmo produto.
 */
export function familiaDoEmpreendimento(
  cadastro: Array<{ c2xEnterpriseId: null | string; id: string; paiId: null | string }>,
  c2xEnterpriseId: string,
): string[] {
  const alvo = String(c2xEnterpriseId).trim();
  if (!alvo) return [];

  const linha = cadastro.find((l) => l.c2xEnterpriseId === alvo);
  // Empreendimento fora do cadastro do Hércules: sobra o que veio, que é melhor do que nada.
  if (!linha) return [alvo];

  const raizId = linha.paiId ?? linha.id;
  const familia = cadastro.filter((l) => l.id === raizId || l.paiId === raizId);

  const ids = new Set<string>([alvo]);
  for (const membro of familia) {
    if (membro.c2xEnterpriseId) ids.add(membro.c2xEnterpriseId);
  }
  return [...ids];
}

export type ImobiliariaQueVende = {
  documento: null | string;
  id: string;
  nome: string;
  /** Vínculo verificado no Apolo. Não impede a reserva; a tela mostra a diferença. */
  verificada: boolean;
};

export type CorretorQueVende = {
  id: string;
  imobiliariaId: string;
  imobiliariaNome: string;
  nome: string;
  telefone: null | string;
};

export type QuemPodeVender = {
  corretores: CorretorQueVende[];
  imobiliarias: ImobiliariaQueVende[];
};

/**
 * Quem pode vender neste empreendimento: as imobiliárias e os corretores delas.
 *
 * ⚠️ UMA CARGA SÓ, E A BUSCA É NA TELA. São ~30 imobiliárias e ~58 corretores no total medido —
 * cabe numa resposta. Autocomplete no servidor exigiria debounce, estado de carregando e uma rota
 * por tecla, para procurar dentro de uma lista que já cabe na memória do navegador.
 */
export async function quemPodeVender(
  admin: SupabaseClient,
  enterpriseIds: string[],
): Promise<QuemPodeVender> {
  const vinculadas = await lerImobiliariasVinculadas(admin, enterpriseIds);
  if (!vinculadas.ok) throw new Error(vinculadas.erro);

  const imobiliarias: ImobiliariaQueVende[] = vinculadas.credenciadas
    .map((i) => ({
      documento: i.documento,
      id: i.id,
      nome: i.nome,
      verificada: i.verificada,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  if (imobiliarias.length === 0) return { corretores: [], imobiliarias: [] };

  // Os corretores de cada imobiliária, em paralelo: são poucas, e em série a tela esperaria a soma.
  const listas = await Promise.all(
    imobiliarias.map(async (imobiliaria) => {
      const corretores = await corretoresDaImobiliaria(admin, imobiliaria.id);
      return corretores.map((c) => ({
        id: c.entityId,
        imobiliariaId: imobiliaria.id,
        imobiliariaNome: imobiliaria.nome,
        nome: c.nome,
        telefone: c.telefone,
      }));
    }),
  );

  return {
    corretores: listas.flat().sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    imobiliarias,
  };
}

/**
 * A imobiliária e o corretor estão habilitados para vender AQUI?
 *
 * ⚠️ É A CONFERÊNCIA DA GRAVAÇÃO, e ela não confia na tela. A lista já vem filtrada, mas quem
 * grava é um POST: sem esta checagem, um pedido montado à mão criaria reserva no nome de qualquer
 * entidade do Apolo.
 */
export async function podemVender(
  admin: SupabaseClient,
  enterpriseIds: string[],
  alvos: { corretorId?: null | string; imobiliariaId: string },
): Promise<{ motivo: string; ok: false } | { ok: true }> {
  const vinculadas = await lerImobiliariasVinculadas(admin, enterpriseIds);
  if (!vinculadas.ok) return { motivo: vinculadas.erro, ok: false };

  if (!vinculadas.credenciadas.some((i) => i.id === alvos.imobiliariaId)) {
    return { motivo: "Esta imobiliária não está habilitada a vender neste empreendimento.", ok: false };
  }

  if (!alvos.corretorId) return { ok: true };

  // ⚠️ A TRAVA DO CORRETOR É A IMOBILIÁRIA DELE, e continua existindo: sem esta linha, um pedido
  // montado à mão colocaria na reserva um corretor de outra imobiliária — ou qualquer entidade do
  // Apolo — e a comissão iria para quem não vendeu.
  const daImobiliaria = await corretoresDaImobiliaria(admin, alvos.imobiliariaId);
  if (!daImobiliaria.some((c) => c.entityId === alvos.corretorId)) {
    return { motivo: "Este corretor não está ligado a esta imobiliária.", ok: false };
  }

  return { ok: true };
}
