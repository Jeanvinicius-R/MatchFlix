/**
 * Primeiro ADMIN sem acesso ao banco (ex.: Render): quem se cadastrar com o e-mail
 * configurado em ADMIN_EMAIL vira ADMIN — mas só enquanto não existir nenhum ADMIN.
 * Depois disso a variável não promove mais ninguém (novos admins: direto no banco).
 *
 * O e-mail não é verificado, então cadastre a conta logo após o deploy.
 */
export function isBootstrapAdminEmail(
  email: string,
  configuredAdminEmail: string | undefined,
): boolean {
  const configured = configuredAdminEmail?.trim().toLowerCase();
  if (!configured) return false;
  return email.trim().toLowerCase() === configured;
}
