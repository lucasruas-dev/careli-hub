import { describe, expect, it } from "vitest";

import {
  compareInstallmentsByDueDate,
  sortInstallmentsByDueDate,
} from "./installment-order";

describe("sortInstallmentsByDueDate", () => {
  it("regressão bug 30/jun: jul/2026 vem antes de jan/2027 (sort BR invertia)", () => {
    // Com localeCompare em dueDate BR (DD/MM/AAAA), "20/01/2027" < "20/07/2026"
    // e a Cacá apontava jan/2027 como próxima parcela. O ISO corrige.
    const items = [
      { dueDate: "20/01/2027", dueDateInput: "2027-01-20" },
      { dueDate: "20/07/2026", dueDateInput: "2026-07-20" },
    ];

    const sorted = sortInstallmentsByDueDate(items);

    expect(sorted[0]?.dueDateInput).toBe("2026-07-20");
    expect(sorted[1]?.dueDateInput).toBe("2027-01-20");
  });

  it("ordena cronologicamente uma lista embaralhada", () => {
    const sorted = sortInstallmentsByDueDate([
      { dueDateInput: "2026-12-01" },
      { dueDateInput: "2026-07-05" },
      { dueDateInput: "2027-03-10" },
      { dueDateInput: "2026-07-04" },
    ]);

    expect(sorted.map((item) => item.dueDateInput)).toEqual([
      "2026-07-04",
      "2026-07-05",
      "2026-12-01",
      "2027-03-10",
    ]);
  });

  it("cai no dueDate quando dueDateInput falta (registro legado)", () => {
    const first = { dueDate: "2026-08-01", dueDateInput: null };
    const second = { dueDateInput: "2026-09-01" };

    expect(compareInstallmentsByDueDate(first, second)).toBeLessThan(0);
  });

  it("não muta a lista original e aceita lista vazia", () => {
    const original = [
      { dueDateInput: "2027-01-01" },
      { dueDateInput: "2026-01-01" },
    ];
    const copy = [...original];

    sortInstallmentsByDueDate(original);

    expect(original).toEqual(copy);
    expect(sortInstallmentsByDueDate([])).toEqual([]);
  });
});
