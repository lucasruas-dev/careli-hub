import type { IrisCrm360Registration } from "@/modules/caredesk/types/iris-types";

// Chip de PERFIL do contato (igual ao board do desktop, readBoardTicketCrm):
// Comprador (com bolinha verde=adimplente / vermelha=inadimplente) ou Prospect;
// demais papéis viram rótulo curto (Imob./Corretor/Incorp./Colab./Forn./Parc.).

export type IrisProfileChipData = {
  dotColor: "green" | "red" | null;
  label: string | null;
};

const PROFILE_PRIORITY = [
  "usuario",
  "incorporador",
  "imobiliaria",
  "corretor",
  "colaborador",
  "fornecedor",
  "parceiro",
];

const PROFILE_LABELS: Record<string, string> = {
  colaborador: "Colab.",
  corretor: "Corretor",
  fornecedor: "Forn.",
  imobiliaria: "Imob.",
  incorporador: "Incorp.",
  parceiro: "Parc.",
};

function normalizeProfileKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function readIrisProfileChip(
  registration?: IrisCrm360Registration | null,
): IrisProfileChipData {
  if (!registration || registration.status !== "registered") {
    return { dotColor: null, label: null };
  }

  const profileKeys = new Set<string>();

  for (const profile of registration.profiles ?? []) {
    if (profile.trim()) {
      profileKeys.add(normalizeProfileKey(profile));
    }
  }

  if (registration.profileLabel?.trim()) {
    profileKeys.add(normalizeProfileKey(registration.profileLabel));
  }

  const delinquency =
    registration.delinquency === "adimplente" ||
    registration.delinquency === "inadimplente"
      ? registration.delinquency
      : null;

  const role = PROFILE_PRIORITY.find((candidate) => profileKeys.has(candidate));

  if (role === "usuario") {
    if (delinquency) {
      return {
        dotColor: delinquency === "inadimplente" ? "red" : "green",
        label: "Comprador",
      };
    }

    return { dotColor: null, label: "Prospect" };
  }

  if (role && PROFILE_LABELS[role]) {
    return { dotColor: null, label: PROFILE_LABELS[role] };
  }

  return { dotColor: null, label: null };
}
