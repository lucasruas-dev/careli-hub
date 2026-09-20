import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A PORTA DO ENVIO PARA ASSINATURA, LIDA COMO TEXTO.
//
// ⚠️ ISTO COBRA O QUE O TYPECHECK NÃO VÊ, e cada item aqui já custou caro em alguma parte da casa:
// sem `maxDuration` a rota cai no teto padrão da Vercel e o timeout chega na tela como erro de JSON
// ([[reference_vercel_timeout_vira_erro_de_json]]); com o portão de LEITURA no lugar do de escrita,
// o `viewer` do Hades mandaria instrumento para assinatura; e sem o gate em CADA método que mexe na
// Clicksign, a régua do Lucas (*"o acordo so pode ficar disponivel para envio depois da
// aprovacao"*) valeria só para o botão. As três trocas compilam limpas.
//
// ⚠️ O COMPORTAMENTO É EXERCITADO EM `lib/hades/acordo/envio-db.test.ts`, com o duplo da Clicksign:
// é lá que se prova que acordo sem aprovação e acordo reprovado não chamam a API nem uma vez. Esta
// rota é só a porta.

const ROTA = readFileSync(join(__dirname, "route.ts"), "utf8");
const CODIGO = ROTA.split("\n")
  .filter((linha) => !/^\s*(\/\/|\/\*|\*)/.test(linha))
  .join("\n");

/** O corpo de um método exportado, do `export async function X` até o próximo `export`. */
function metodo(nome: string): string {
  const inicio = CODIGO.indexOf(`export async function ${nome}(`);
  expect(inicio).toBeGreaterThan(-1);
  const resto = CODIGO.slice(inicio + 1);
  const fim = resto.indexOf("\nexport ");
  return fim === -1 ? resto : resto.slice(0, fim);
}

describe("a porta do envio para assinatura", () => {
  it("declara o teto de 120s, o runtime node e o dinâmico", () => {
    // ⚠️ 120s, O MESMO DA ROTA DE CONTRATO: o envio são até 14 chamadas HTTP e o upload leva o PDF
    // inteiro em base64, depois de montar o papel com uma leitura do C2X.
    expect(CODIGO).toContain("export const maxDuration = 120;");
    expect(CODIGO).toContain('export const runtime = "nodejs";');
    expect(CODIGO).toContain('export const dynamic = "force-dynamic";');
  });

  // ⚠️ INCLUSIVE O GET: a resposta dele lista NOME e E-MAIL de comprador e de representante, que é
  // dado de pessoa, e quem não pode enviar não precisa da lista.
  it.each(["GET", "POST", "PATCH", "DELETE"])("%s passa pelo portão de ESCRITA", (nome) => {
    expect(metodo(nome)).toContain("authorizeHadesWrite(request)");
    expect(CODIGO).not.toContain("authorizeHadesRead");
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // ⚠️ A REGRA DO LUCAS (20/09/2026), NOS DOIS MÉTODOS QUE MANDAM E-MAIL PARA O CLIENTE.
  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("o envio e o reenvio passam pelo gate da aprovação", () => {
    // O POST chama o gate por dentro de `enviarAcordoParaAssinatura` — é a MESMA função que apaga o
    // botão da tela, e ela é a primeira pergunta de lá.
    expect(metodo("POST")).toContain("enviarAcordoParaAssinatura(sb, acordo");
    // O PATCH chama o gate DIRETO, porque o `impedimento` do preparo carrega também a guarda do
    // envelope vivo — que aqui está sempre acesa e recusaria todo convite.
    expect(metodo("PATCH")).toContain("motivoParaNaoEnviarParaAssinatura(acordo)");
  });

  // ⚠️ O CANCELAMENTO NÃO PASSA PELO GATE, E A AUSÊNCIA É DELIBERADA. Ele é o gesto CORRETIVO: o
  // caso em que mais se precisa dele é exatamente o acordo que o gestor reprovou DEPOIS de o termo
  // ter saído. Gatear o cancelamento deixaria o termo errado na mão do cliente, sem saída.
  it("o cancelamento NÃO é gateado pela aprovação", () => {
    expect(metodo("DELETE")).not.toContain("motivoParaNaoEnviarParaAssinatura");
    expect(metodo("DELETE")).toContain("cancelarAssinaturaDoAcordo(sb, acordo");
  });

  // ⚠️ SEM CHAVE, NEM COMEÇA. `chamar` recusaria também, mas só na primeira chamada — e a essa
  // altura a linha de registro já teria nascido. A causa mais provável é a variável marcada
  // "Sensitive" na Vercel, que chega VAZIA sem erro nenhum ([[reference_vercel_env_sensitive]]).
  it("o POST confere as chaves da Clicksign antes de qualquer leitura", () => {
    const post = metodo("POST");

    expect(post).toContain("conferirConfiguracao()");
    expect(post).toContain("Sensitive");
    // E a conferência vem ANTES de abrir o acordo.
    expect(post.indexOf("conferirConfiguracao()")).toBeLessThan(post.indexOf("comOAcordo("));
  });

  // ⚠️ `CLICKSIGN_WEBHOOK_SECRET` NÃO SEGURA O ENVIO, e essa distinção é de propósito: ele é a chave
  // do webhook (a VOLTA), e sem ele o termo sai e é assinado — o que se perde é a notícia disso,
  // que o operador consegue conferir na Clicksign. Exigi-lo aqui travaria o envio por causa de uma
  // chave que o envio não usa.
  it("a chave do webhook não impede o envio", () => {
    expect(metodo("POST")).toContain('nome !== "CLICKSIGN_WEBHOOK_SECRET"');
  });

  // ⚠️ A RESPOSTA LISTA NOME E E-MAIL DE PESSOA: `no-store` em todas.
  it("nenhuma resposta é cacheável", () => {
    expect(CODIGO).not.toMatch(/Cache-Control": "(?!no-store)/);
    expect(CODIGO.match(/"Cache-Control": "no-store"/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  // ⚠️ O ID DO ACORDO É CONFERIDO ANTES DE QUALQUER LEITURA. Ele vem do navegador, e um uuid torto
  // não pode virar uma consulta.
  it("todo método confere o uuid do acordo antes de ler o banco", () => {
    for (const nome of ["GET", "POST", "PATCH", "DELETE"]) {
      expect(metodo(nome)).toContain("UUID.test(");
    }
  });
});
