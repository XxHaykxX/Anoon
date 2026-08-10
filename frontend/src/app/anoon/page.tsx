import AnoonApp from "@/components/anoon/AnoonApp";

export default function AnoonPage() {
  return (
    // No gutter and no centring: the app is the viewport. Both existed to sit a
    // drawn phone frame in the middle of the page, and that frame is gone.
    <main className="h-dvh w-full overflow-hidden bg-neutral-950">
      <AnoonApp />
    </main>
  );
}
