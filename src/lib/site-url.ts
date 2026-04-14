const localhostSiteUrl = "http://localhost:4321";

export function resolveSiteUrl(siteUrl: string | undefined, allowLocalhostFallback: boolean) {
  const normalizedSiteUrl = siteUrl?.trim();

  if (normalizedSiteUrl) {
    return normalizedSiteUrl;
  }

  if (!allowLocalhostFallback) {
    throw new Error("PUBLIC_SITE_URL must be set for production builds.");
  }

  return localhostSiteUrl;
}
