"use client";

import { useState } from "react";
import { AnoonLogo } from "@/components/anoon/_shared";
import { useAnoonNav } from "@/components/anoon/anoonNav";

interface Slide {
  title: string;
  tagline: string;
}

/* anoon-specific onboarding: anonymous roulette → chat → friends. */
const slides: Slide[] = [
  {
    title: "Живая рулётка",
    tagline: "Один тап — и ты в анонимном чате с новым человеком. Пол подбираем противоположный.",
  },
  {
    title: "Полная анонимность",
    tagline: "Никаких имён и фото. Настоящий профиль виден, только если оба захотят открыться.",
  },
  {
    title: "Открывайтесь и дружите",
    tagline: "Понравился собеседник — жмите «открыться». Взаимно — и он в твоих друзьях навсегда.",
  },
  {
    title: "Твой #ID вместо номера",
    tagline: "Короткий 5-значный #ID — по нему добавляют в друзья. Готов начать?",
  },
];

/**
 * Desktop (≥1024): this screen is a narrow form, so it becomes one centered
 * column of a readable width instead of stretching across the shell's 60rem
 * work area; the background stays full-bleed, only the content is capped.
 * Both halves of the variant are load-bearing — see docs/DESKTOP-LAYOUT.md,
 * «Как писать десктопные стили в файле экрана».
 */
const DESKTOP_FORM =
  "lg:[.anoon-desktop_&]:mx-auto lg:[.anoon-desktop_&]:w-full lg:[.anoon-desktop_&]:max-w-[26rem]";

export default function AnoonOnboarding() {
  const nav = useAnoonNav();
  const [activeSlide, setActiveSlide] = useState(0);
  const isLastSlide = activeSlide === slides.length - 1;

  const goToSlide = (index: number) =>
    setActiveSlide(Math.min(Math.max(index, 0), slides.length - 1));

  const handleNext = () => {
    if (isLastSlide) {
      // Вход, не регистрация: заводить аккаунт — это одна из двух вещей, которые
      // человек может хотеть после онбординга, и меньшая по частоте, а «Войти
      // через Google» вообще снимает вопрос анкеты. Форма входа сама уводит на
      // регистрацию по email ссылкой внизу, так что путь для новых не длиннее.
      nav.push("auth-login");
      return;
    }
    goToSlide(activeSlide + 1);
  };

  const current = slides[activeSlide];

  return (
    <div className="anoon-auth relative flex h-full w-full flex-col items-center justify-between overflow-hidden bg-background px-8 py-14 text-center text-foreground">
      {/* Soft brand glow */}
      <div
        className="pointer-events-none absolute -top-16 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: "rgba(253,191,45,0.16)" }}
      />

      {/* Top bar: Skip → login */}
      <div className={`relative z-10 flex w-full items-center justify-between ${DESKTOP_FORM}`}>
        <AnoonLogo className="text-xl" />
        {!isLastSlide && (
          <button
            type="button"
            onClick={() => nav.push("auth-login")}
            className="cursor-pointer text-sm font-medium text-muted-foreground transition-transform active:scale-95"
          >
            Пропустить
          </button>
        )}
      </div>

      {/* Middle block */}
      <div className="relative z-10 flex flex-col items-center">
        <div
          className="grid size-24 place-items-center rounded-[28px] bg-primary"
          style={{ boxShadow: "0 20px 48px -12px rgba(253,191,45,0.5)" }}
        >
          {/*
            «a», а не «b»: буква взята из вордмарка, а переименование продукта
            (badu → anoon, 2026-08-05) до этой плитки не доехало — она нарисована
            мимо AnoonLogo. Это первый экран, который видит новый пользователь,
            то есть чужое имя продукта показывалось раньше всего остального.
          */}
          <span className="text-5xl font-bold text-primary-foreground">a</span>
        </div>

        <div key={activeSlide} className="anoon-screen-in flex flex-col items-center">
          <h1 className="mt-8 text-2xl font-bold text-balance">{current.title}</h1>
          <p className="mt-3 max-w-[17rem] text-sm leading-relaxed text-muted-foreground">
            {current.tagline}
          </p>
        </div>

        {/* Progress dots */}
        <div className="mt-8 flex items-center gap-2">
          {slides.map((slide, index) => (
            <button
              key={slide.title}
              type="button"
              aria-label={`Слайд ${index + 1}`}
              onClick={() => goToSlide(index)}
              className={`h-2 cursor-pointer rounded-full transition-all active:scale-95 ${
                index === activeSlide ? "w-6 bg-primary" : "w-2 bg-muted"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Bottom CTA */}
      <div className={`relative z-10 flex w-full flex-col items-center gap-3 ${DESKTOP_FORM}`}>
        <button
          type="button"
          onClick={handleNext}
          className="w-full cursor-pointer rounded-2xl bg-primary py-3.5 font-semibold text-primary-foreground transition-transform active:scale-95"
          style={{ boxShadow: "0 12px 32px -8px rgba(253,191,45,0.45)" }}
        >
          {isLastSlide ? "Начать" : "Далее"}
        </button>
        {/* Зеркало кнопки выше: раз «Начать» ведёт на вход, здесь стоит второй
            путь, а не тот же самый — «Уже есть аккаунт? Войти» после кнопки,
            которая и так открывает вход, отправляла бы в одно и то же место. */}
        <p className="text-sm text-muted-foreground">
          Нет аккаунта?{" "}
          <button
            type="button"
            onClick={() => nav.push("auth-register")}
            className="cursor-pointer font-medium text-primary transition-transform active:scale-95"
          >
            Зарегистрироваться
          </button>
        </p>
      </div>
    </div>
  );
}
