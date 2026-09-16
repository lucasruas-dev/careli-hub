"use client";

import { useState } from "react";

import { QuadroDeAssinaturaCard } from "@/modules/apolo/blocks/empreendimentos/quadro-de-assinatura-card";
import { API_DA_TEMIS_DO_PORTAL, ApiDaTemisProvider } from "@/modules/temis/api-da-temis";
import { DocumentosDoEmpreendimento } from "@/modules/temis/TemisPage";

// MINUTAS DO PRODUTO — os modelos de contrato que o time do cliente cria e edita.
//
// Lucas (16/09/2026), sobre a Cecílio Rocha: a equipe dela gera o contrato das vendas que ela mesma
// faz e TAMBÉM cria e edita os modelos (minutas) dos produtos dela. A minuta é do PRODUTO, e Careli
// e Cecílio dividem o produto: a Gurgel vende o mesmo loteamento e o contrato dela sai da minuta
// publicada aqui, confeccionado pela Careli.
//
// ⚠️ É A ABA DE DOCUMENTOS DA TÊMIS, NÃO UMA CÓPIA. Por baixo está `DocumentosDoEmpreendimento`
// (TemisPage), a mesma que o Setup da Têmis usa: as quatro abas (minuta do contrato, termos de
// cessão, distrato e cancelamento) sobre a `MinutasTab` do Apolo, com a conferência antes de
// publicar, o editor, a capa e os anexos do contrato. As QUATRO, e não só a minuta que a ficha do
// Apolo mostra: quem confecciona o cancelamento precisa do termo de cancelamento.
//
// ⚠️ O QUE MUDA É A PORTA. O `ApiDaTemisProvider` em modo cookie faz a lista, o editor, o agente da
// minuta, o upload de mídia, a capa e os anexos falarem com `/api/incorporador/temis/*` pelo cookie
// `apolo_inc`. A rota de lá confere o escopo do incorporador ANTES de ler (`enterpriseNoAlcance`),
// e um id fora dele responde 404 sem dizer por quê.
//
// ⚠️ SÓ NO PORTAL QUE CONFECCIONA (`portalConfeccionaContrato`). O comercial não edita minuta. E SÓ
// NO PRODUTO QUE ELE OPERA (decisão do Lucas, 16/09/2026): a ficha monta esta aba com
// `linha.podeEscrever`, e as rotas recusam com 403 só consulta quem chegar por outro caminho.
//
// ⚠️ O QUADRO DE ASSINATURA VEM JUNTO, DEBAIXO DOS DOCUMENTOS (revisão da onda 3, achado 21). Quem
// confecciona o contrato é quem diz quem assina pela vendedora, pela coordenação e como testemunha;
// sem o quadro no portal, o contrato da Cecílio sairia com essas linhas vazias. É o mesmo card do
// Apolo, pela mesma porta (`useApiDaTemis`) do provedor abaixo.

export function MinutasDoProduto({
  enterpriseId,
  nome,
}: {
  /** O empreendimento como a Têmis o amarra (`temis_minutas.enterprise_id`). */
  enterpriseId: string;
  /** O nome que a aba escreve ("Minutas de …"). Sem ele, "seu produto". */
  nome?: string;
}) {
  // Abre na minuta do contrato, como o Setup: é o documento que toda venda usa.
  const [aba, setAba] = useState<string>("contrato");

  return (
    <ApiDaTemisProvider {...API_DA_TEMIS_DO_PORTAL}>
      {/* ⚠️ ALTURA DEFINIDA, E É O EDITOR QUE PEDE. Com uma minuta aberta, o editor é `flex-1` e
          rola por dentro; sem pai de altura definida ele cresceria com o documento (136 mil
          caracteres no Villa Paris) e a barra de ferramentas sumiria rolando. A lista, que é curta,
          rola por fora se precisar. */}
      <div className="flex h-[calc(100dvh-12rem)] min-h-[36rem] flex-col overflow-auto rounded-xl border border-line bg-surface">
        <DocumentosDoEmpreendimento
          aba={aba}
          aoTrocarAba={setAba}
          enterpriseId={enterpriseId}
          // A aba escreve "Minutas de {name}" e "Nova minuta em {name}": o neutro precisa caber nas
          // duas frases.
          name={nome?.trim() || "seu produto"}
        />
      </div>
      <div className="mt-4">
        <QuadroDeAssinaturaCard enterpriseId={enterpriseId} />
      </div>
    </ApiDaTemisProvider>
  );
}
