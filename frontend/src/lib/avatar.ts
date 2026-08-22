// Letter avatar text: the fallback whenever a company has no logo (MAR-54).
// Lives here rather than in Search so CompanyLogo and Search don't import each other.
export function avatarText(ticker: string): string {
  return ticker.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
}
