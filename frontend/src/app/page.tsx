import AnoonPage from "@/app/anoon/page";

/**
 * The site root IS the app.
 *
 * It used to be the design showcase — a gallery of every screen in phone
 * frames, with tabs and a light grey page behind them. That is an internal
 * tool, and on the live site it was the first thing anyone saw; the product
 * itself was one directory down at /anoon, which nothing linked to. The
 * showcase now lives at /showcase.
 *
 * This re-exports the /anoon page rather than redirecting: a redirect costs a
 * round trip on the very first paint, and both routes must keep working —
 * /anoon is what the e2e suites navigate to.
 */
export default function RootPage() {
  return <AnoonPage />;
}
