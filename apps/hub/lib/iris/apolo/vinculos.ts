// Vínculos que o operador pode criar do cockpit da Iris.
//
// ⚠️ ARQUIVO SEM IMPORT NENHUM, DE PROPÓSITO. Esta lista é usada pelo modal (componente de
// browser) e pela camada de escrita (servidor). Enquanto ela morava em `escrita-contato.ts`, o
// modal arrastava para o bundle do navegador toda a cadeia `lib/apolo/server` → `lib/guardian/db`
// → `mysql2` → `node:buffer`, e a página da Iris parava de compilar. O typecheck passa nesse
// caso: só o bundler reclama, e só quando alguém abre a tela.
//
// AS DUAS FAMÍLIAS SÃO AS DO APOLO, copiadas de `modules/apolo/blocks/crm/add-relationship-modal.tsx`
// para o cockpit falar a MESMA língua do CRM:
//   • TRABALHO  — a relação é de negócio (corretor de uma imobiliária, comprador de um
//     empreendimento). No banco vai com `metadata.kind = "trabalho"`.
//   • CONTATO   — a relação é pessoal (cônjuge, mãe, sócio). Vai com `metadata.kind = "contato"`.
//
// O `relationship_type` guarda o rótulo escolhido; o `kind` é o que separa as duas famílias na
// leitura (ver `relationships-panel.tsx`). Inventar tipo novo aqui quebraria essa leitura.

export type TipoDeVinculo = { kind: "contato" | "trabalho"; rotulo: string };

export const VINCULOS_TRABALHO: TipoDeVinculo[] = [
  { kind: "trabalho", rotulo: "Comprador" },
  { kind: "trabalho", rotulo: "Prospect" },
  { kind: "trabalho", rotulo: "Corretor" },
  { kind: "trabalho", rotulo: "Imobiliária" },
  { kind: "trabalho", rotulo: "Incorporador" },
  { kind: "trabalho", rotulo: "Sócio" },
  { kind: "trabalho", rotulo: "Parceiro" },
  { kind: "trabalho", rotulo: "Fornecedor" },
  { kind: "trabalho", rotulo: "Funcionário" },
];

export const VINCULOS_CONTATO: TipoDeVinculo[] = [
  { kind: "contato", rotulo: "Cônjuge" },
  { kind: "contato", rotulo: "Mãe" },
  { kind: "contato", rotulo: "Pai" },
  { kind: "contato", rotulo: "Filho(a)" },
  { kind: "contato", rotulo: "Irmão(ã)" },
  { kind: "contato", rotulo: "Sócio(a)" },
  { kind: "contato", rotulo: "Amigo(a)" },
  { kind: "contato", rotulo: "Outro" },
];

export const TODOS_OS_VINCULOS = [...VINCULOS_TRABALHO, ...VINCULOS_CONTATO];

export function vinculoPermitido(rotulo: string, kind: string): boolean {
  return TODOS_OS_VINCULOS.some(
    (vinculo) => vinculo.rotulo === rotulo && vinculo.kind === kind,
  );
}
