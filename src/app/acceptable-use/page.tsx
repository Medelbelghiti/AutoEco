import { LegalPage, legalMetadata } from "@/components/LegalPage";

export function generateMetadata() {
  return legalMetadata(
    "acceptable-use.md",
    "Acceptable Use Policy",
    "/acceptable-use",
    "What is and is not allowed when using AutoEco, including prohibited data practices."
  );
}

export default function Page() {
  return <LegalPage file="acceptable-use.md" title="Acceptable Use Policy" />;
}
