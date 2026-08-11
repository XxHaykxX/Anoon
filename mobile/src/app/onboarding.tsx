import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AnoonLogo } from '@/components/shared';

interface Slide {
  title: string;
  tagline: string;
}

/* anoon-specific onboarding: anonymous roulette → chat → friends. */
const slides: Slide[] = [
  {
    title: 'Живая рулётка',
    tagline: 'Один тап — и ты в анонимном чате с новым человеком. Пол подбираем противоположный.',
  },
  {
    title: 'Полная анонимность',
    tagline: 'Никаких имён и фото. Настоящий профиль виден, только если оба захотят открыться.',
  },
  {
    title: 'Открывайтесь и дружите',
    tagline: 'Понравился собеседник — жмите «открыться». Взаимно — и он в твоих друзьях навсегда.',
  },
  {
    title: 'Твой #ID вместо номера',
    tagline: 'Короткий 5-значный #ID — по нему добавляют в друзья. Готов начать?',
  },
];

/**
 * Онбординг (`AnoonOnboarding.tsx`). Четыре слайда, переключаются кнопкой
 * «Далее» и точками, последний ведёт на вход (не на регистрацию: форма входа
 * сама уводит на регистрацию ссылкой внизу).
 *
 * Не портируется: мягкое брендовое свечение под шапкой — это `blur-3xl` на
 * круге, у RN нет размытия слоя; expo-linear-gradient рисует линейный градиент,
 * а не радиальный ореол, поэтому подмена выглядела бы иначе, чем на вебе.
 * Десктопная колонка (`DESKTOP_FORM`) на телефоне тоже не нужна.
 */
export default function OnboardingScreen() {
  const [activeSlide, setActiveSlide] = useState(0);
  const isLastSlide = activeSlide === slides.length - 1;

  const goToSlide = (index: number) => setActiveSlide(Math.min(Math.max(index, 0), slides.length - 1));

  const handleNext = () => {
    if (isLastSlide) {
      router.push('/auth-login');
      return;
    }
    goToSlide(activeSlide + 1);
  };

  const current = slides[activeSlide];

  return (
    <View className="flex-1 items-center justify-between bg-background px-8 py-14">
      {/* Верхняя строка: логотип и «Пропустить» → вход */}
      <View className="w-full flex-row items-center justify-between">
        <AnoonLogo size={20} />
        {!isLastSlide && (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/auth-login')}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <Text className="text-sm font-medium text-muted-foreground">Пропустить</Text>
          </Pressable>
        )}
      </View>

      <View className="items-center">
        <View className="h-24 w-24 items-center justify-center rounded-[28px] bg-primary">
          {/* «a» из вордмарка: плитка нарисована мимо AnoonLogo, и это первый
              экран нового пользователя — чужая буква видна раньше всего. */}
          <Text className="text-5xl font-bold text-primary-foreground">a</Text>
        </View>

        <Text className="mt-8 text-center text-2xl font-bold text-foreground">{current.title}</Text>
        <Text className="mt-3 max-w-[272px] text-center text-sm leading-relaxed text-muted-foreground">
          {current.tagline}
        </Text>

        {/* Точки прогресса */}
        <View className="mt-8 flex-row items-center gap-2">
          {slides.map((slide, index) => (
            <Pressable
              key={slide.title}
              accessibilityRole="button"
              accessibilityLabel={`Слайд ${index + 1}`}
              onPress={() => goToSlide(index)}
              className={`h-2 rounded-full ${index === activeSlide ? 'w-6 bg-primary' : 'w-2 bg-muted'}`}
            />
          ))}
        </View>
      </View>

      <View className="w-full items-center gap-3">
        <Pressable
          accessibilityRole="button"
          onPress={handleNext}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          className="w-full items-center rounded-2xl bg-primary py-3.5">
          <Text className="text-base font-semibold text-primary-foreground">
            {isLastSlide ? 'Начать' : 'Далее'}
          </Text>
        </Pressable>
        {/* Зеркало кнопки выше: раз «Начать» ведёт на вход, здесь второй путь. */}
        <View className="flex-row items-center gap-1.5">
          <Text className="text-sm text-muted-foreground">Нет аккаунта?</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/auth-register')}>
            <Text className="text-sm font-medium text-primary">Зарегистрироваться</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
