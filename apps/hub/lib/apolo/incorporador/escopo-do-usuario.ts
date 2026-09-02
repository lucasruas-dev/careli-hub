// O QUE ESTA PESSOA ENXERGA — o recorte da sessão, decidido antes de assinar o cookie.
//
// Regra do Lucas (02/09/2026), sobre o portal comercial: *"todos terão o mesmo link, final do
// c2x.app.br/gurgel, o que vai mudar são os acessos. irei vincular os coordenadores aos
// empreendimentos"*.
//
// ⚠️ DUAS FONTES, E O TIPO DO PORTAL DECIDE QUAL VALE. No portal do incorporador o recorte é do
// PORTAL (`apolo_incorporador_empreendimentos`): todo usuário do Cecílio vê o que o Cecílio vê,
// e uma linha própria da conta, quando existe, manda no lugar dela. No comercial, o `/gurgel` é um
// só e cada coordenador vê SOMENTE os empreendimentos DELE (`apolo_incorporador_usuario_
// empreendimentos`, migration 0122) — a lista do portal não entra.
//
// ⚠️ NO COMERCIAL, CONTA SEM VÍNCULO NÃO HERDA NADA. Herdar o recorte do portal (a primeira
// versão fazia isso) deixava toda conta nova onipotente: CRM, Vendas, Carteira e Contratos de todos
// os empreendimentos do /gurgel até alguém lembrar de restringir — o oposto de "o que vai mudar são
// os acessos". Escopo vazio é recusado no login (403 "Seu acesso ainda não tem empreendimento
// liberado") e derruba a sessão na revalidação: fail-closed, sem ninguém precisar lembrar.
//
// ⚠️ É FUNÇÃO PURA DE PROPÓSITO: a mesma regra roda no login (POST) e na revalidação de cada carga
// de tela (GET). Duas cópias divergiriam na primeira mudança, e o coordenador veria uma lista no
// login e outra no F5.

import type { TipoDePortal } from "./perfis-de-portal";

export type VinculoDoPortal = { carteiraAdministrada: boolean; enterpriseId: string };

export type EscopoDaSessao = {
  enterpriseIds: string[];
  enterpriseIdsComCarteira: string[];
};

function limpar(ids: string[]): string[] {
  const vistos = new Set<string>();
  for (const id of ids) {
    const limpo = String(id ?? "").trim();
    if (limpo) vistos.add(limpo);
  }
  return [...vistos];
}

export function escopoDoUsuario(input: {
  doPortal: VinculoDoPortal[];
  doUsuario: string[];
  tipo: TipoDePortal;
}): EscopoDaSessao {
  const proprios = limpar(input.doUsuario);

  // ⚠️ NO COMERCIAL, SÓ O VÍNCULO PRÓPRIO — sem vínculo, escopo vazio (ver o cabeçalho).
  //
  // E "FINANCEIRO" É DE TODO EMPREENDIMENTO DO ESCOPO. A flag `carteira_administrada` responde
  // "a Careli cobra por este incorporador?", e é o que decide se o DONO do loteamento vê a aba
  // Carteira. O coordenador não é dono: ele vende, e precisa do financeiro de tudo que vende.
  // Condicionar à flag esconderia a aba justamente onde ele mais precisa dela.
  if (input.tipo === "comercial") {
    return { enterpriseIds: proprios, enterpriseIdsComCarteira: [...proprios] };
  }

  const enterpriseIds =
    proprios.length > 0 ? proprios : limpar(input.doPortal.map((v) => v.enterpriseId));

  const comCarteira = new Set(
    input.doPortal.filter((v) => v.carteiraAdministrada).map((v) => String(v.enterpriseId).trim()),
  );

  return {
    enterpriseIds,
    enterpriseIdsComCarteira: enterpriseIds.filter((id) => comCarteira.has(id)),
  };
}
