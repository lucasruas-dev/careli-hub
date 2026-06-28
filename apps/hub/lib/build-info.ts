import { PANTEON_CHANGELOG } from "@/lib/changelog/changelog";

// Versao atual do Panteon, exibida pro usuario (hover no avatar do topbar e no
// painel de Novidades da Home). FONTE UNICA = a entrada mais nova do changelog
// (indice 0): atualizar o painel de Novidades ja atualiza a versao do avatar,
// sem bump manual em dois lugares. Serve para confirmar que o build novo carregou
// (a PWA cacheia o app).
export const PANTEON_VERSION = PANTEON_CHANGELOG[0]?.version ?? "v0.0.0";

// Marcador tecnico detalhado do build (uso interno / diagnostico no Zeus).
export const PANTEON_BUILD_TAG = PANTEON_CHANGELOG[0]?.buildTag ?? "";
