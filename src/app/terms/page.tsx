import { LegalPage, legalMetadata } from "@/components/LegalPage";

export function generateMetadata() {
  return legalMetadata(
    "terms.md",
    "Terms of Service",
    "/terms",
    "AutoEco's terms of service: what the service is, what it is not, and the rules that apply."
  );
}

export default function Page() {
  return <LegalPage file="terms.md" title="Terms of Service" />;
}
