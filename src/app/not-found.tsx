import Link from "next/link";

/**
 * Branded 404. Reached by any URL that does not resolve, so it doubles as
 * the safety net for stale links in transactional emails.
 */
export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-charcoal-50 dark:bg-charcoal-950 p-6">
      <div className="w-full max-w-lg text-center">
        <p className="label">Error 404</p>
        <h1 className="text-3xl md:text-4xl font-extrabold mt-2">This page doesn&apos;t exist</h1>
        <p className="mt-3 text-charcoal-600 dark:text-charcoal-300">
          The link may be out of date. Here is where most people want to go:
        </p>
        <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
          <Link href="/" className="btn btn-primary">Home</Link>
          <Link href="/calculators/car-cost" className="btn btn-accent">Car cost calculator</Link>
          <Link href="/pricing" className="btn btn-secondary">Plans</Link>
        </div>
        <nav aria-label="Site sections" className="mt-8 text-sm">
          <ul className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-charcoal-600 dark:text-charcoal-300">
            <li><Link href="/features" className="underline">Features</Link></li>
            <li><Link href="/docs" className="underline">Docs</Link></li>
            <li><Link href="/faq" className="underline">FAQ</Link></li>
            <li><Link href="/login" className="underline">Log in</Link></li>
            <li><Link href="/signup" className="underline">Sign up</Link></li>
          </ul>
        </nav>
      </div>
    </main>
  );
}