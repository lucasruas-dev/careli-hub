"use client";

import { API_DA_TEMIS_DO_PORTAL, ApiDaTemisProvider } from "@/modules/temis/api-da-temis";
import { TemisKanban } from "@/modules/temis/blocks/board/temis-kanban";

// CONTRATOS DO PORTAL QUE CONFECCIONA — o quadro da Têmis OPERÁVEL, na mão do time do cliente.
//
// Lucas (16/09/2026), sobre a Cecílio Rocha: a venda feita pela equipe dela no portal vai para a
// confecção DELA, no portal; a equipe gera o contrato, manda para assinatura (Clicksign da conta da
// Careli, com registro de quem enviou) e cria e edita as minutas. A Gurgel continua vendendo os
// mesmos produtos, e o contrato das vendas DELA vai para a Têmis da Careli. Quem confecciona
// depende da ORIGEM da venda — e a separação é do servidor: a rota do quadro do portal lista só os
// trabalhos com `operado_por` = este incorporador, dentro do escopo da sessão.
//
// ⚠️ É A TÊMIS DO HUB, NÃO UMA CÓPIA. O quadro é o `TemisKanban` e o clique abre a mesma
// `TelaDeTrabalho` (análise, prévia do contrato, organização da assinatura, chat, documentos e
// histórico). O que muda é a PORTA: o `ApiDaTemisProvider` em modo cookie faz cada chamada dessas
// telas sair para `/api/incorporador/temis/<o mesmo subcaminho>` com o cookie `apolo_inc`, em vez de
// `/api/temis` com o Bearer do hub. Nenhuma tela sabe onde está.
//
// ⚠️ SEM O SETUP. Na Têmis do hub o menu tem Board e Setup; aqui entra só o Board. As minutas dos
// produtos do cliente moram na ficha do produto (`MinutasDoProduto`), e plano comercial não é da
// Têmis em lugar nenhum (Lucas, 02/09/2026: *"plano não vive aqui no contrato"*).
//
// ⚠️ SÓ PARA QUEM CONFECCIONA. Quem decide é `portalConfeccionaContrato(slug, tipo)`, lido por quem
// monta a tela (TelaContratos recebe `confecciona`). O portal comercial nunca chega aqui: lá o
// quadro continua só-leitura, na rota `/api/incorporador/contratos`. E esconder não é a trava — cada
// rota do portal passa por `autorizarTemisDoPortal`, que responde 404 para quem não confecciona.

export function ContratosDaCecilio({
  enterpriseId = null,
}: {
  /**
   * O produto escolhido no filtro da aba (o mesmo id que as outras visões de Contratos recebem).
   * `null` = tudo o que a sessão alcança. O parâmetro só REDUZ: a rota recorta pelo escopo dela.
   */
  enterpriseId?: null | string;
}) {
  return (
    <ApiDaTemisProvider {...API_DA_TEMIS_DO_PORTAL}>
      {/* ⚠️ A ALTURA SÓ É FIXADA COM A TELA DE TRABALHO ABERTA, pelo mesmo truque da `TemisPage`.
          A tela de trabalho é `absolute inset-0` sobre o quadro e copia a altura de quem a
          posiciona; no portal ninguém acima dá altura definida, então sem isto ela herdaria a altura
          da coluna de cards (um card só daria uma análise espremida em ~300px). O
          `data-temis-trabalho` só existe enquanto ela está montada: com o quadro sozinho, a moldura
          cresce com os cards e a página rola por fora, como em qualquer aba do portal. O desconto de
          10rem é o cabeçalho, as sub-abas e o respiro da aba Contratos. */}
      <div className="flex flex-col has-[[data-temis-trabalho]]:h-[calc(100dvh-10rem)] has-[[data-temis-trabalho]]:min-h-[36rem]">
        <TemisKanban enterpriseId={enterpriseId} />
      </div>
    </ApiDaTemisProvider>
  );
}
