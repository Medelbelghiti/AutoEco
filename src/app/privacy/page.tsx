import { LegalPage, legalMetadata } from "@/components/LegalPage";

export function generateMetadata() {
  return legalMetadata(
    "privacy.md",
    "Privacy Policy",
    "/privacy",
    "How AutoEco collects, uses, stores and deletes your vehicle and financial data."
  );
}

export default function Page() {
  return <LegalPage file="privacy.md" title="Privacy Policy" />;
}
