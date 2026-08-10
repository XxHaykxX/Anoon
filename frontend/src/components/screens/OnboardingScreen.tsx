"use client";

import { useState } from "react";

interface Slide {
  title: string;
  tagline: string;
}

const slides: Slide[] = [
  {
    title: "Welcome to Anoon",
    tagline: "Fast, private messaging. Beautifully simple.",
  },
  {
    title: "Stay in sync",
    tagline: "Real-time chats that keep you close to the people who matter.",
  },
  {
    title: "Your data, protected",
    tagline: "End-to-end encryption keeps every conversation just between you.",
  },
  {
    title: "Ready when you are",
    tagline: "Set up your profile in seconds and start chatting instantly.",
  },
];

export default function OnboardingScreen() {
  const [activeSlide, setActiveSlide] = useState(0);

  const isLastSlide = activeSlide === slides.length - 1;

  const goToSlide = (index: number) => {
    setActiveSlide(Math.min(Math.max(index, 0), slides.length - 1));
  };

  const handlePrev = () => {
    goToSlide(activeSlide - 1);
  };

  const handleNext = () => {
    if (isLastSlide) {
      // Final CTA action (e.g. navigate to sign up) would go here.
      return;
    }
    goToSlide(activeSlide + 1);
  };

  const handleSkip = () => {
    goToSlide(slides.length - 1);
  };

  const current = slides[activeSlide];

  return (
    <div className="w-full bg-background text-foreground flex flex-col h-full items-center justify-between relative overflow-hidden py-16 px-8 text-center">
      {/* Soft brand glow */}
      <div
        className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 w-[420px] h-[420px] rounded-full blur-3xl"
        style={{ background: "rgb(var(--brand-rgb) / 0.16)" }}
      />

      {/* Top bar: Skip */}
      <div className="relative z-10 w-full flex justify-end">
        {!isLastSlide && (
          <button
            onClick={handleSkip}
            className="text-sm text-muted-foreground font-medium active:scale-95 transition-transform cursor-pointer"
          >
            Skip
          </button>
        )}
      </div>

      {/* Middle block */}
      <div className="relative z-10 flex flex-col items-center">
        <div
          className="size-24 rounded-[28px] bg-primary grid place-items-center"
          style={{ boxShadow: "0 20px 48px -12px rgb(var(--brand-rgb) / 0.5)" }}
        >
          <span className="text-6xl font-bold text-primary-foreground">
            B
          </span>
        </div>

        <div key={activeSlide} className="anoon-screen-in flex flex-col items-center">
          <h1 className="mt-8 text-2xl font-bold">{current.title}</h1>
          <p className="mt-2 text-muted-foreground">{current.tagline}</p>
        </div>

        <div className="mt-8 flex items-center gap-3">
          {activeSlide > 0 && (
            <button
              onClick={handlePrev}
              aria-label="Previous slide"
              className="text-muted-foreground active:scale-95 transition-transform cursor-pointer"
            >
              ‹
            </button>
          )}

          <div className="flex items-center gap-2">
            {slides.map((slide, index) => (
              <span
                key={slide.title}
                onClick={() => goToSlide(index)}
                className={`h-2 rounded-full active:scale-95 transition-transform cursor-pointer ${
                  index === activeSlide ? "w-6 bg-primary" : "size-2 bg-muted"
                }`}
              />
            ))}
          </div>

          {!isLastSlide && (
            <button
              onClick={handleNext}
              aria-label="Next slide"
              className="text-muted-foreground active:scale-95 transition-transform cursor-pointer"
            >
              ›
            </button>
          )}
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="relative z-10 w-full flex flex-col items-center gap-4">
        <button
          onClick={handleNext}
          className="w-full rounded-2xl bg-primary text-primary-foreground py-4 font-semibold active:scale-95 transition-transform cursor-pointer"
          style={{ boxShadow: "0 12px 32px -8px rgb(var(--brand-rgb) / 0.45)" }}
        >
          {isLastSlide ? "Get Started" : "Next"}
        </button>
        <p className="text-muted-foreground text-sm">
          Already have an account?{" "}
          <span className="text-primary font-medium active:scale-95 transition-transform cursor-pointer inline-block">
            Log in
          </span>
        </p>
      </div>
    </div>
  );
}
