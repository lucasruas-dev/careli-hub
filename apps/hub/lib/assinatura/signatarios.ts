import type { DadosDoContrato } from "@/lib/temis/preencher-contrato";

import type { PapelNoContrato, Signatario } from "./tipos";

// QUEM ASSINA — extraído do CONTRATO, nunca digitado.
//
// ⚠️ ISTO NÃO É UM FORMULÁRIO, E ESSA É A DECISÃO INTEIRA DO ARQUIVO. O operador não digita nome
// nem e-mail de signatário: eles saem de `dadosDaProposta`, a MESMA leitura que imprimiu a
// qualificação no papel. Digitar de novo criaria a possibilidade de o contrato dizer "Henrique
// Sales do Vale, CPF 999.999.004-53" e o envelope ir para outra pessoa — e o defeito só apareceria
// quando alguém comparasse o PDF assinado com o cadastro, meses depois.
//
// ⚠️ E POR ISSO A CONFERÊNCIA ACONTECE AQUI, ANTES DA API. Ver `conferirSignatarios`: e-mail
// repetido e signatário sem e-mail são recusados com nome e sobrenome de quem falha, ANTES de
// existir envelope. A alternativa — deixar a Clicksign recusar — deixaria um envelope criado, pago
// e (depois de ativado) impossível de apagar, com metade dos signatários dentro.
//
// ── DE ONDE SAI CADA UM ──────────────────────────────────────────────────────
//
//     comprador   compradores[i].valores.nome_cliente / email_cliente / cpf_cliente
//     cônjuge     compradores[i].valores.nome_conjuge / email_conjuge / cpf_conjuge
//     vendedora   gerais.vendedora_representante_nome / _email / _cpf
//
// ⚠️ A VENDEDORA NÃO EXISTE NO BANCO HOJE, e é um fato MEDIDO (08/09/2026): dos 18 empreendimentos
// com linha em `apolo_enterprise_settings`, ZERO têm `vendedor_entity_id`; das 2 categorias
// cadastradas, zero também. E `dados-do-contrato.ts` não escreve nenhuma chave `vendedora_*` — o
// grupo inteiro está marcado PENDENTE no catálogo de variáveis. Então hoje o envelope sai com
// comprador e cônjuge, e mais ninguém.
//
// Isso NÃO recusa o envio: recusar travaria o primeiro teste do ZZ TESTE por um cadastro que
// ninguém preencheu ainda. Sai como AVISO, que a tela mostra ao lado do botão — quem confirma vê
// que a vendedora não vai no envelope. No dia em que a 0141 for preenchida, o signatário aparece
// sozinho, sem mudar uma linha daqui.

/** Uma pessoa pronta para virar signatário: o `Signatario` sem o número da ordem. */
export type Pessoa = Omit<Signatario, "ordem">;

export type MontagemDosSignatarios = {
  /** O que falta e não impede o envio (a vendedora sem cadastro é o caso de hoje). */
  avisos: string[];
  pessoas: Pessoa[];
};

/**
 * Os signatários deste contrato.
 *
 * ⚠️ A ORDEM DA LISTA É A DO CONTRATO — titular, cônjuge do titular, segundo comprador, cônjuge do
 * segundo… e a vendedora por último. Não é a ordem de ASSINATURA (quem decide isso é
 * `ordenarSignatarios`, por papel): é a ordem em que a tela mostra as pessoas para conferência, e
 * ela tem de bater com a ordem em que os nomes aparecem na qualificação do papel. Ler uma lista
 * fora da ordem do documento é o que faz alguém aprovar o cônjuge errado num contrato de dois
 * casais.
 */
export function signatariosDoContrato(dados: DadosDoContrato): MontagemDosSignatarios {
  const pessoas: Pessoa[] = [];
  const avisos: string[] = [];

  for (const comprador of dados.compradores) {
    const v = comprador.valores;

    const nome = texto(v.nome_cliente);
    if (nome) {
      pessoas.push({
        cpf: texto(v.cpf_cliente) || texto(v.cnpj_cliente) || null,
        email: texto(v.email_cliente),
        nome,
        papel: "comprador",
        telefone: texto(v.telefone_cliente) || null,
      });
    }

    // ⚠️ O CÔNJUGE SÓ ENTRA SE `temConjuge`, e não "se tiver nome_conjuge". É a mesma bandeira que
    // liga o bloco `[inicio_dados_conjuge]` no papel: se o contrato NÃO qualificou o cônjuge,
    // mandá-lo assinar poria no envelope alguém que o documento não menciona.
    if (comprador.temConjuge) {
      const nomeDoConjuge = texto(v.nome_conjuge);
      if (nomeDoConjuge) {
        pessoas.push({
          cpf: texto(v.cpf_conjuge) || null,
          email: texto(v.email_conjuge),
          nome: nomeDoConjuge,
          papel: "conjuge",
          telefone: texto(v.telefone_conjuge) || null,
        });
      }
    }
  }

  const vendedora = texto(dados.gerais.vendedora_representante_nome);
  if (vendedora) {
    pessoas.push({
      cpf: texto(dados.gerais.vendedora_representante_cpf) || null,
      email: texto(dados.gerais.vendedora_representante_email),
      nome: vendedora,
      papel: "vendedora",
      telefone: texto(dados.gerais.vendedora_representante_telefone) || null,
    });
  } else {
    avisos.push(
      "A vendedora não tem representante cadastrado, então ela NÃO vai no envelope: só os compradores assinam. " +
        "O cadastro é o campo 'vendedora' do empreendimento (ou da categoria).",
    );
  }

  return { avisos, pessoas };
}

// ── A CONFERÊNCIA, ANTES DE EXISTIR ENVELOPE ────────────────────────────────

export type Veredito = { ok: true } | { erro: string; ok: false };

/**
 * Dá para mandar esta lista para a Clicksign?
 *
 * A ordem das checagens é a ordem em que elas ajudam quem lê: primeiro "não há ninguém", depois
 * "falta e-mail de fulano", depois "fulano e beltrano têm o mesmo e-mail", e por último o formato do
 * nome. Uma mensagem por vez, com NOMES — "2 signatários inválidos" manda a pessoa procurar.
 */
export function conferirSignatarios(pessoas: readonly Pessoa[]): Veredito {
  if (pessoas.length === 0) {
    return {
      erro:
        "Este contrato não tem nenhum signatário: a proposta não trouxe comprador com nome. " +
        "Confira o cadastro do comprador e gere o contrato de novo.",
      ok: false,
    };
  }

  // ⚠️ SEM E-MAIL NÃO HÁ SIGNATÁRIO. É o campo por onde o convite sai, e a Clicksign cadastra o
  // signatário sem ele (o e-mail é "condicional" na doc) — o que produziria uma pessoa dentro do
  // envelope que NUNCA recebe o link e trava o contrato para sempre, sem erro nenhum.
  const semEmail = pessoas.filter((p) => !p.email);
  if (semEmail.length > 0) {
    return {
      erro:
        `${listar(semEmail.map((p) => `${p.nome} (${rotulo(p.papel)})`))} ${semEmail.length === 1 ? "está" : "estão"} sem e-mail, ` +
        "e é por ele que a Clicksign manda o convite de assinatura. Preencha o e-mail no cadastro e tente de novo.",
      ok: false,
    };
  }

  // ⚠️ E-MAIL REPETIDO É A ARMADILHA CONHECIDA, e ela tem um dono: o cônjuge que compartilha a caixa
  // do titular. Está catalogada nas armadilhas do D4Sign da casa
  // ([[reference_d4sign_escrita_armadilhas]]) e é a razão de a CAD ter passado a travar e-mail
  // repetido (`lib/apolo/email-unico.ts`).
  //
  // ⚠️ A COMPARAÇÃO É EM MINÚSCULAS E SEM ESPAÇO, porque é assim que os dois provedores comparam.
  // "Joao@X.com" e "joao@x.com " são o MESMO endereço lá; conferir letra a letra aqui deixaria
  // passar exatamente o caso que esta função existe para pegar.
  const porEmail = new Map<string, Pessoa[]>();
  for (const p of pessoas) {
    const chave = p.email.trim().toLowerCase();
    porEmail.set(chave, [...(porEmail.get(chave) ?? []), p]);
  }

  for (const [email, donos] of porEmail) {
    if (donos.length > 1) {
      return {
        erro:
          `${listar(donos.map((p) => `${p.nome} (${rotulo(p.papel)})`))} usam o MESMO e-mail (${email}), ` +
          "e a Clicksign não aceita dois signatários com o mesmo endereço — o envelope sairia com uma pessoa a menos. " +
          "Cadastre um e-mail próprio para cada um e tente de novo.",
        ok: false,
      };
    }
  }

  // ⚠️ NOME DE UMA PALAVRA SÓ É RECUSADO PELA CLICKSIGN, e isso é da doc deles, não invenção nossa:
  // *"Informe ao menos um `Nome` e um `Sobrenome`"*, e o campo não aceita numerais. Descobrir isso
  // no meio do cadastro dos signatários deixaria o envelope criado com os primeiros dentro.
  const nomeCurto = pessoas.filter((p) => p.nome.trim().split(/\s+/).length < 2);
  if (nomeCurto.length > 0) {
    return {
      erro:
        `${listar(nomeCurto.map((p) => `"${p.nome}" (${rotulo(p.papel)})`))} ${nomeCurto.length === 1 ? "está" : "estão"} sem sobrenome no cadastro, ` +
        "e a Clicksign exige nome e sobrenome. Complete o nome no cadastro e tente de novo.",
      ok: false,
    };
  }

  const nomeComNumero = pessoas.filter((p) => /\d/.test(p.nome));
  if (nomeComNumero.length > 0) {
    return {
      erro:
        `${listar(nomeComNumero.map((p) => `"${p.nome}" (${rotulo(p.papel)})`))} ${nomeComNumero.length === 1 ? "tem" : "têm"} número no nome, ` +
        "e a Clicksign recusa. Corrija o nome no cadastro e tente de novo.",
      ok: false,
    };
  }

  return { ok: true };
}

// ── AUXILIARES ──────────────────────────────────────────────────────────────

/**
 * ⚠️ `?? ""` NÃO SERVE AQUI. `dados-do-contrato.ts` promete não escrever string vazia ("ou a chave
 * tem valor de verdade, ou ela não é escrita"), mas quem chama esta função pode montar o objeto de
 * outro jeito — e o nullish deixaria `""` passar como se fosse um e-mail
 * ([[reference_nullish_nao_troca_string_vazia]]).
 */
function texto(bruto: undefined | string): string {
  return String(bruto ?? "").trim();
}

/** "A", "A e B", "A, B e C" — a lista como uma pessoa lê, não como um array. */
function listar(itens: readonly string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/**
 * O papel em minúsculas, para caber no meio da frase.
 *
 * ⚠️ NÃO REUSA `rotuloDoPapel`: aquele é o rótulo de TELA ("Coordenadora de vendas"), com
 * maiúscula, e no meio de uma frase ele sairia como "Fulano (Coordenadora de vendas) está sem
 * e-mail". Dois usos diferentes do mesmo dado.
 */
function rotulo(papel: PapelNoContrato): string {
  const mapa: Record<PapelNoContrato, string> = {
    comprador: "comprador",
    conjuge: "cônjuge",
    coordenadora: "coordenadora",
    corretor: "corretor",
    interveniente: "interveniente",
    testemunha: "testemunha",
    vendedora: "vendedora",
  };
  return mapa[papel];
}
