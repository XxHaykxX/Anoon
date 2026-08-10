import AnoonApp from "@/components/anoon/AnoonApp";

export default function AnoonPage() {
  return (
    // p-2 (8px a side, 16px per axis) is the gutter AnoonApp's frame-fit
    // scale ladder budgets for; keep the two in step if this ever changes.
    // `anoon-app-page` is the hook that drops the gutter on a touch device,
    // where the phone frame goes away and the app runs full-bleed.
    <main className="anoon-app-page flex min-h-screen items-center justify-center overflow-auto bg-neutral-950 p-2">
      <AnoonApp />
    </main>
  );
}
