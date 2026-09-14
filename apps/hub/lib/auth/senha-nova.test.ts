import { describe, expect, it } from "vitest";

import { conferirSenhaNova, MINIMO_DE_CARACTERES } from "./senha-nova";

describe("a régua da senha nova", () => {
  it("aceita uma senha comum de oito caracteres", () => {
    const r = conferirSenhaNova("chuva-de-maio");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.senha).toBe("chuva-de-maio");
  });

  it("recusa vazio e só espaço", () => {
    expect(conferirSenhaNova("").ok).toBe(false);
    expect(conferirSenhaNova("        ").ok).toBe(false);
  });

  it(`recusa abaixo de ${MINIMO_DE_CARACTERES} caracteres`, () => {
    const r = conferirSenhaNova("1234567");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain(String(MINIMO_DE_CARACTERES));
  });

  // ⚠️ ESTA LISTA NÃO É SEGURANÇA, É ATRITO CONTRA O ÓBVIO — ela pega exatamente a senha que alguém
  // digitaria sem pensar no primeiro acesso, que é o caso que motivou a troca.
  it("recusa as óbvias, com ou sem maiúscula e acento", () => {
    expect(conferirSenhaNova("12345678").ok).toBe(false);
    expect(conferirSenhaNova("Careli2026").ok).toBe(false);
    expect(conferirSenhaNova("PASSWORD").ok).toBe(false);
  });

  it("recusa um caractere repetido do começo ao fim", () => {
    expect(conferirSenhaNova("aaaaaaaa").ok).toBe(false);
    expect(conferirSenhaNova("!!!!!!!!!!").ok).toBe(false);
  });

  // ⚠️ O TETO DE 72 BYTES É DO bcrypt, e o Supabase Auth recusa acima dele com erro cru. Barrar aqui
  // dá uma frase que a pessoa entende, em vez de "unexpected error" no meio da troca.
  it("recusa acima de 72 BYTES, e conta bytes e não letras", () => {
    expect(conferirSenhaNova("a".repeat(73)).ok).toBe(false);
    // 37 emojis de 2 bytes cada em UTF-8… na verdade 4 bytes: 37 * 4 = 148 bytes, 37 "caracteres".
    expect(conferirSenhaNova("🔒".repeat(37)).ok).toBe(false);
    // 72 letras cabem exatamente.
    expect(conferirSenhaNova("b".repeat(71) + "c").ok).toBe(true);
  });

  // ⚠️ APARA AS PONTAS, NUNCA O MIOLO: mexer no meio mudaria a senha que a pessoa acha que escolheu,
  // e ela não entraria mais.
  it("apara as pontas e preserva o miolo", () => {
    const r = conferirSenhaNova("  duas palavras  ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.senha).toBe("duas palavras");
  });

  it("recusa o que não é texto", () => {
    expect(conferirSenhaNova(null).ok).toBe(false);
    expect(conferirSenhaNova(12345678).ok).toBe(false);
    expect(conferirSenhaNova(undefined).ok).toBe(false);
  });
});
