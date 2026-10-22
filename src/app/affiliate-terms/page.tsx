import { LegalPage, legalMetadata } from "@/components/LegalPage";

export function generateMetadata() {
  return legalMetadata(
    "affiliate-terms.md",
    "Affiliate Program Terms",
    "/affiliate-terms",
    "The terms of AutoEco's affiliate program: commissions, payouts and prohibited promotion."
  );
}

export default function Page() {
  return <LegalPage file="affiliate-terms.md" title="Affiliate Program Terms" />;
}
