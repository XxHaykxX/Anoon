import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, Text, TextInput, View, type PressableProps, type TextInputProps } from 'react-native';

/**
 * The native half of `frontend/src/components/anoon/_shared.tsx` plus the form
 * primitives the web screens spell out inline with Tailwind classes that have no
 * React Native counterpart (`focus:ring`, `placeholder:text-…`, `disabled:`).
 *
 * Everything here is presentation. Behaviour lives in the shared store, which is
 * the same file the web imports.
 */

/** Calm, desaturated avatar gradients — the web list, as colour stops. */
export const AVATAR_GRADIENTS: readonly [string, string][] = [
  ['#8E9BC0', '#5F6F9E'], // slate
  ['#93BEA0', '#64977B'], // sage
  ['#CE93A6', '#AC6C86'], // rose
  ['#E7B75F', '#C98F3B'], // amber
  ['#A995C9', '#7F68A8'], // violet
  ['#86B7BD', '#5D939B'], // teal
];

/**
 * Circle avatar: the photo when there is one, the brand gradient with initials
 * otherwise. A photo that fails to load falls back to the gradient, remembered
 * by WHICH url failed so a new one is retried on the render that introduces it.
 *
 * Anonymity is not this component's job — in the roulette the peer simply has no
 * photo to hand it (the server blanks the peer's `public` while anonymous).
 */
export function AnoonAvatar({
  initials,
  tone = 0,
  size = 44,
  photoUrl,
}: {
  initials: string;
  tone?: number;
  size?: number;
  photoUrl?: string | null;
}) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  if (photoUrl && brokenUrl !== photoUrl) {
    return (
      <Image
        source={{ uri: photoUrl }}
        onError={() => setBrokenUrl(photoUrl)}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
      />
    );
  }
  const [from, to] = AVATAR_GRADIENTS[tone % AVATAR_GRADIENTS.length];
  return (
    <LinearGradient
      colors={[from, to]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ fontSize: Math.round(size * 0.34), fontWeight: '600', color: 'rgba(255,255,255,0.95)' }}>
        {initials}
      </Text>
    </LinearGradient>
  );
}

/** Small online/offline presence dot. */
export function StatusDot({ online = true }: { online?: boolean }) {
  return (
    <View
      className={`h-2.5 w-2.5 rounded-full border-2 border-background ${online ? 'bg-online' : 'bg-muted-foreground'}`}
    />
  );
}

/** anoon wordmark — the only place the product name is drawn. */
export function AnoonLogo({ size = 24 }: { size?: number }) {
  return (
    <Text style={{ fontSize: size, fontWeight: '800', letterSpacing: -0.5 }}>
      <Text className="text-primary">a</Text>
      <Text className="text-foreground">noon</Text>
    </Text>
  );
}

/**
 * Primary/secondary/ghost button. The web writes these as class soup on a
 * `<button>`; native needs a component because `active:scale-95`, `disabled:`
 * and hover have no equivalent — press feedback is opacity via Pressable.
 */
export function AnoonButton({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  className = '',
  ...rest
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
} & Omit<PressableProps, 'onPress' | 'disabled' | 'children'>) {
  const off = disabled || loading;
  const tone =
    variant === 'primary'
      ? 'bg-primary'
      : variant === 'secondary'
        ? 'bg-secondary'
        : 'bg-transparent';
  const text =
    variant === 'primary' ? 'text-primary-foreground' : variant === 'secondary' ? 'text-foreground' : 'text-primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: off ? 0.5 : pressed ? 0.85 : 1 })}
      className={`h-12 flex-row items-center justify-center rounded-2xl px-5 ${tone} ${className}`}
      {...rest}>
      <Text className={`text-base font-semibold ${text}`}>{loading ? 'Подождите…' : label}</Text>
    </Pressable>
  );
}

/** Labelled text field with the app's input treatment and an error slot. */
export function AnoonInput({
  label,
  error,
  className = '',
  ...rest
}: { label?: string; error?: string | null; className?: string } & TextInputProps) {
  return (
    <View className={`gap-1.5 ${className}`}>
      {label ? <Text className="text-sm text-muted-foreground">{label}</Text> : null}
      <TextInput
        placeholderTextColor="#9a9aa0"
        className={`h-12 rounded-2xl bg-input px-4 text-base text-foreground ${error ? 'border border-destructive' : ''}`}
        {...rest}
      />
      {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
    </View>
  );
}

/**
 * The one-line error/notice strip the auth screens show above the form. Rendered
 * as nothing when there is no message, so callers can drop it in unconditionally.
 */
export function AnoonNotice({ message, tone = 'error' }: { message?: string | null; tone?: 'error' | 'info' }) {
  if (!message) return null;
  return (
    <View className={`rounded-2xl px-4 py-3 ${tone === 'error' ? 'bg-destructive/15' : 'bg-secondary'}`}>
      <Text className={`text-sm ${tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{message}</Text>
    </View>
  );
}
