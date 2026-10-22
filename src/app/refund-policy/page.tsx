import { LegalPage, legalMetadata } from "@/components/LegalPage";

export function generateMetadata() {
  return legalMetadata(
    "refund-policy.md",
    "Refund Policy",
    "/refund-policy",
    "AutoEco's refund policy for subscriptions and one-time purchases, and how to request one."
  );
}

export default function Page() {
  return <LegalPage file="refund-policy.md" title="Refund Policy" />;
}
