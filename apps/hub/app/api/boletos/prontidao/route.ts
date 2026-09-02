import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { estadoDaConta, TODAS_AS_CONTAS } from "@/lib/apolo/asaas-contas";
import { conferirConta, situacaoCadastral } from "@/lib/apolo/boletos/emissao";
import { EMPREENDIMENTOS_DE_BOLETO } from "@/lib/apolo/boletos/empreendimentos";
import { lerCarteiraDoLsoft } from "@/lib/lsoft/carteira";

// O QUE FALTA PARA CADA EMPREENDIMENTO PODER EMITIR — a resposta que a tela mostra antes do clique.
//
// ⚠️ NUNCA DEVOLVE CHAVE. Só se a variável existe e de que ambiente ela é, pelo prefixo
// (`$aact_prod_` / `$aact_hmlg_`). Ver `lib/apolo/asaas-contas.ts`.
//
// ⚠️ O CPF É O BLOQUEIO REAL, e ele não está na planilha: nenhuma das nove abas tem coluna de
// CPF, e o Asaas não cria cliente sem CPF/CNPJ — nem `foreignCustomer` dispensa. Para Garden e
// Vale do Sol o documento vem do LSoft; para os outros sete não existe fonte nenhuma. Por isso a
// cobertura de CPF é contada aqui e mostrada por empreendimento, e não descoberta no meio da
// emissão, com metade dos boletos já criados.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  // As contas de verdade, na ordem em que a tela cita. `careli` entra para o operador conseguir
  // comparar: se a do Garden estiver vazia e a da Careli cheia, o erro é de configuração.
  // ⚠️ A LISTA VEM DE `TODAS_AS_CONTAS`, e não escrita aqui. Antes era fixa — conta nova cadastrada
  // em `asaas-contas.ts` não aparecia neste painel, e o operador conferia uma lista incompleta
  // achando que era tudo.
  // ⚠️ A CHAVE EXISTIR NÃO PROVA QUE É A CHAVE CERTA. Ter `ASAAS_GARDEN_API_KEY` preenchida diz
  // que alguém colou algo ali; não diz de quem é a conta. Uma chave no lugar errado emite o boleto
  // no CNPJ de outra empresa e o dinheiro cai na conta dela — e nada nesta tela denunciava, porque
  // o erro não é técnico: a emissão funciona perfeitamente, na conta errada.
  //
  // `/myAccount` é a única resposta que vem do lado do Asaas dizendo o NOME de quem é a chave.
  // Custa uma chamada por conta e só roda nesta tela de conferência, não na emissão.
  const contas = await Promise.all(
    TODAS_AS_CONTAS.map(async (c) => {
      const estado = estadoDaConta(c);
      if (!estado.configurada) {
        return { ...estado, cadastro: null, donoDaChave: null, erroDaChave: null };
      }

      // ⚠️ A CHAVE FUNCIONAR NÃO SIGNIFICA QUE A CONTA EMITE. O On Sky e o Guaimbé tinham a chave
      // certa e a emissão não saía: o CADASTRO no Asaas ainda não estava aprovado. O erro só
      // aparecia depois de tentar, uma cobrança por vez — e, como a tela não mostrava a tentativa,
      // do lado de quem clicava não acontecia nada. Aqui a conta diz o que falta ANTES do clique.
      const [conferida, situacao] = await Promise.all([conferirConta(c), situacaoCadastral(c)]);

      return {
        ...estado,
        cadastro: situacao.ok
          ? {
              aprovado: situacao.data.general === "APPROVED",
              banco: situacao.data.bankAccountInfo,
              comercial: situacao.data.commercialInfo,
              documentos: situacao.data.documentation,
              geral: situacao.data.general,
            }
          : null,
        donoDaChave: conferida.ok
          ? (conferida.data.companyName ?? conferida.data.name ?? null)
          : null,
        erroDaChave: conferida.ok ? null : conferida.erro,
      };
    }),
  );

  const empreendimentos = await Promise.all(
    EMPREENDIMENTOS_DE_BOLETO.map(async (e) => {
      const conta = e.conta ? estadoDaConta(e.conta) : null;
      const base = {
        ambiente: conta?.ambiente ?? null,
        conta: e.conta,
        contaConfigurada: conta?.configurada ?? false,
        nome: e.nome,
        origem: e.origem,
        slug: e.slug,
        variavel: conta?.variavel ?? null,
      };

      // Só a origem LSoft tem onde buscar CPF. Para `planilha` a resposta honesta é "não há
      // fonte" — e a tela precisa dizer isso, não deixar o campo vazio parecendo zero.
      if (e.origem !== "lsoft" || !e.chaveLsoft) return { ...base, cpf: null };

      const carteira = await lerCarteiraDoLsoft({ empreendimento: e.chaveLsoft });
      if (!carteira.ok) return { ...base, cpf: null };

      const clientes = carteira.clientes.length;
      const comCpf = carteira.clientes.filter((c) => (c.cpf ?? "").trim().length > 0).length;
      return { ...base, cpf: { clientes, comCpf, semCpf: clientes - comCpf } };
    }),
  );

  return NextResponse.json(
    { data: { contas, empreendimentos } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
