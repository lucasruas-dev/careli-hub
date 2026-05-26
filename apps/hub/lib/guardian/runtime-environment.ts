export function shouldRestrictHadesEnterprises() {
  const appEnvironment = process.env.NEXT_PUBLIC_CARELI_APP_ENV?.toLowerCase() ?? "";
  const vercelEnvironment = process.env.VERCEL_ENV?.toLowerCase() ?? "";
  const appUrl = (
    process.env.NEXT_PUBLIC_CARELI_APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    ""
  ).toLowerCase();

  return (
    vercelEnvironment === "production" ||
    appEnvironment.includes("prod") ||
    (appUrl.includes("c2x.app.br") &&
      !appUrl.includes("homo.c2x.app.br") &&
      !appUrl.includes("homolog.c2x.app.br"))
  );
}
