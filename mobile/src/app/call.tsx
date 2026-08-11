import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CHAT_COLORS, MicOffIcon, VideoOffIcon } from '@/components/chat/icons';
import { MicIcon, PhoneIcon, VideoIcon } from '@/components/icons';
import { AnoonAvatar } from '@/components/shared';
import { onCall, sendCall } from '@/lib/callSignaling';
import { RTCView, createPeerConnection, getUserMedia, type CallStream } from '@/lib/webrtc';
import { useCallStore, type CallEndReason, type CallMedia } from '@/store/callStore';

/**
 * Экран звонка — порт `CallScreen.tsx` + `IncomingCall.tsx` с веба, в одном
 * файле: на телефоне это один маршрут, состояние которого целиком описано
 * `callStore` (звонит / вызываем / разговор).
 *
 * Что переиспользовано, а не написано заново:
 *  • сигналинг — `@/lib/callSignaling` (кадры `call:*` по сокету companion);
 *  • состояние звонка — общий `@/store/callStore`, включая запись о звонке:
 *    его `endCall` зовёт `logCall`, а тот кладёт `head.call` в топик, поэтому
 *    история звонка с телефона переживает перезапуск и одинаково читается
 *    вебом, телефоном и админкой;
 *  • ICE-серверы — `RTC_CONFIG` из общего `lib/tinode.ts` (см. `@/lib/webrtc`).
 *
 * Отличия от веба, все вынужденные: удалённый звук на нативе играет сам (нет
 * элемента `<audio>`), видео рисует `RTCView` по `streamURL`, а не `<video>`.
 */

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const m = Math.floor(safe / 60).toString().padStart(2, '0');
  const s = Math.floor(safe % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Оттенок аватара из хендла — тот же приём, что на вебе: не «прыгает» между рендерами. */
function toneFor(id: string): number {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return sum % 6;
}

/** Круглая кнопка управления с подписью. */
function ControlButton({
  label,
  active,
  onPress,
  children,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <View className="items-center gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        onPress={onPress}
        className={`h-14 w-14 items-center justify-center rounded-full ${
          active ? 'bg-primary' : 'bg-foreground/10'
        }`}>
        {children}
      </Pressable>
      <Text className="text-xs text-foreground/70">{label}</Text>
    </View>
  );
}

/** Красная трубка — завершить/отклонить. */
function HangUpButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <View className="items-center gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        className="h-16 w-16 items-center justify-center rounded-full bg-destructive">
        <View className="rotate-[135deg]">
          <PhoneIcon size={26} color="#ffffff" />
        </View>
      </Pressable>
      <Text className="text-xs text-foreground/70">{label}</Text>
    </View>
  );
}

/** Экран звонящего телефона: принять или отклонить. */
function Ringing({
  peerName,
  peerId,
  media,
  onAccept,
  onDecline,
}: {
  peerName: string;
  peerId: string;
  media: CallMedia;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-between px-6 py-10">
      <View className="flex-1 items-center justify-center gap-4">
        <AnoonAvatar initials={initialsOf(peerName)} tone={toneFor(peerId)} size={128} />
        <View className="items-center gap-1.5">
          <Text className="text-xl font-semibold text-foreground">{peerName}</Text>
          {peerId ? <Text className="text-sm text-foreground/50">{peerId}</Text> : null}
          <Text className="mt-1 text-sm text-foreground/70">
            {media === 'video' ? 'Входящий видео-звонок' : 'Входящий аудио-звонок'}
          </Text>
        </View>
      </View>

      <View className="w-full flex-row items-center justify-around pb-4">
        <HangUpButton label="Отклонить" onPress={onDecline} />
        <View className="items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Принять звонок"
            onPress={onAccept}
            className="h-16 w-16 items-center justify-center rounded-full bg-online">
            <PhoneIcon size={26} color="#000000" />
          </Pressable>
          <Text className="text-xs text-foreground/70">Принять</Text>
        </View>
      </View>
    </View>
  );
}

/**
 * Разговор: владеет `RTCPeerConnection` целиком. Порт эффекта из веб-версии
 * `CallScreen`, вплоть до правил, которые там выведены кровью: «disconnected»
 * не терминален, любой локальный конец шлёт `call:hangup` пиру, ранние ICE
 * добираются из буфера в `callSignaling`.
 */
function ActiveCall({
  callId,
  peerId,
  peerName,
  media,
  role,
  initialOffer,
  onEnded,
}: {
  callId: string;
  peerId: string;
  peerName: string;
  media: CallMedia;
  role: 'caller' | 'callee';
  initialOffer?: unknown;
  onEnded: (reason?: CallEndReason) => void;
}) {
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [connected, setConnected] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [failed, setFailed] = useState(false);
  /** Непоправимая, но объяснимая беда с камерой/микрофоном — её надо ПОКАЗАТЬ. */
  const [notice, setNotice] = useState<string | null>(null);
  /** Есть ли свой видеопоток (после отката видеозвонка в аудио — нет). */
  const [hasVideo, setHasVideo] = useState(media === 'video');
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);

  const localStreamRef = useRef<CallStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingCandidatesRef = useRef<unknown[]>([]);
  // Завершение звонка, при необходимости с уведомлением пира. Ставится
  // эффектом, используется кнопкой «Завершить»: единственный путь наружу —
  // именно он держит обе стороны в согласии.
  const finishRef = useRef<(notifyPeer: boolean, reason?: CallEndReason) => void>(() => {});

  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    let disposed = false;
    const pc = createPeerConnection();

    pc.addEventListener('icecandidate', (e) => {
      if (e.candidate) {
        sendCall({ type: 'call:ice', to: peerId, callId, candidate: e.candidate.toJSON() });
      }
    });

    // Нативу не нужен элемент-приёмник: аудио удалённой стороны играет само,
    // видео достаточно отдать в `RTCView` по URL потока.
    pc.addEventListener('track', (e) => {
      const stream = e.streams[0] as CallStream | undefined;
      if (stream) setRemoteUrl(stream.toURL());
    });

    const flushPendingCandidates = async () => {
      const queue = pendingCandidatesRef.current;
      pendingCandidatesRef.current = [];
      for (const c of queue) {
        try {
          await pc.addIceCandidate(c as RTCIceCandidateInit);
        } catch {
          // Устаревший/дублирующий кандидат — не беда.
        }
      }
    };

    const unsub = onCall((frame) => {
      if (frame.callId !== callId) return;
      if (frame.type === 'call:answer' && role === 'caller' && frame.sdp) {
        void pc
          .setRemoteDescription(frame.sdp as RTCSessionDescriptionInit)
          .then(flushPendingCandidates);
      } else if (frame.type === 'call:ice' && frame.candidate) {
        if (pc.remoteDescription) {
          void pc.addIceCandidate(frame.candidate as RTCIceCandidateInit).catch(() => {});
        } else pendingCandidatesRef.current.push(frame.candidate);
      } else if (frame.type === 'call:hangup' || frame.type === 'call:unavailable') {
        // Положил трубку пир — сворачиваемся, НЕ отвечая своим hangup (иначе
        // пинг-понг). Причина едет в кадре и решает, чем звонок запишется в
        // историю: «отклонён», «не удалось дозвониться» или «отменён». Своей
        // плашки здесь нет намеренно: экран закрывается вместе со звонком, и
        // прочесть её было бы негде — причину пользователь видит строкой в
        // ленте чата, куда возвращается.
        setFailed(true);
        finish(
          false,
          frame.type === 'call:unavailable'
            ? 'unavailable'
            : frame.reason === 'declined' || frame.reason === 'busy'
              ? frame.reason
              : undefined,
        );
      }
    });

    let noticeTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      if (noticeTimer != null) {
        clearTimeout(noticeTimer);
        noticeTimer = null;
      }
      if (timerRef.current != null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      unsub();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current?.release();
      localStreamRef.current = null;
      try {
        pc.close();
      } catch {
        // Уже закрыт.
      }
    };

    const finish = (notifyPeer: boolean, reason?: CallEndReason) => {
      if (disposed) return;
      if (notifyPeer) sendCall({ type: 'call:hangup', to: peerId, callId });
      cleanup();
      onEndedRef.current(reason);
    };
    finishRef.current = finish;

    pc.addEventListener('connectionstatechange', () => {
      if (disposed) return;
      if (pc.connectionState === 'connected') {
        setConnected(true);
        // Метку ставим и в сторе: длительность звонка в историю пишет он, а
        // локальный `elapsed` до размонтирования не доживает.
        useCallStore.getState().markConnected();
        if (timerRef.current == null) {
          timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
        }
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        // «disconnected» намеренно не терминален: это чаще всего мигание ICE,
        // которое проходит само.
        setFailed(true);
        finish(true);
      }
    });

    // Отвалившийся микрофон/камера — причина, которую пользователь обязан
    // увидеть: молча свернуть экран неотличимо от «звонки не работают».
    const failWithNotice = (text: string) => {
      if (disposed) return;
      setFailed(true);
      setNotice(text);
      noticeTimer = setTimeout(() => {
        noticeTimer = null;
        finish(true);
      }, 2500);
    };

    const start = async () => {
      let stream: CallStream;
      try {
        stream = await getUserMedia(media === 'video');
      } catch {
        // Камеры нет или в ней отказали — видеозвонок продолжаем без видео.
        // Аудиозвонку падать некуда.
        if (media !== 'video') {
          failWithNotice('Нет доступа к микрофону — разрешите его в настройках');
          return;
        }
        try {
          stream = await getUserMedia(false);
          setCameraOff(true);
          setHasVideo(false);
          setNotice('Камера недоступна — звонок продолжится без видео');
        } catch {
          failWithNotice('Нет доступа к камере и микрофону — разрешите их в настройках');
          return;
        }
      }
      try {
        if (disposed) {
          stream.getTracks().forEach((t) => t.stop());
          stream.release();
          return;
        }
        localStreamRef.current = stream;
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        if (stream.getVideoTracks().length > 0) setLocalUrl(stream.toURL());

        if (role === 'caller') {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendCall({ type: 'call:offer', to: peerId, callId, media, sdp: offer });
        } else if (initialOffer) {
          await pc.setRemoteDescription(initialOffer as RTCSessionDescriptionInit);
          await flushPendingCandidates();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendCall({ type: 'call:answer', to: peerId, callId, media, sdp: answer });
        }
      } catch {
        setFailed(true);
        finish(true);
      }
    };
    void start();

    return cleanup;
    // Эти пять — и есть личность звонка: все приходят из одной записи
    // `callStore`, ни одна не меняется по ходу разговора. Плюс родитель даёт
    // `key={callId}`, так что другой звонок — это новый компонент.
  }, [callId, peerId, media, role, initialOffer]);

  const hangUp = useCallback(() => {
    finishRef.current(true);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      localStreamRef.current?.getAudioTracks().forEach((t) => {
        t.enabled = !next;
      });
      return next;
    });
  }, []);

  const toggleCamera = useCallback(() => {
    setCameraOff((prev) => {
      const next = !prev;
      localStreamRef.current?.getVideoTracks().forEach((t) => {
        t.enabled = !next;
      });
      return next;
    });
  }, []);

  const status = failed
    ? 'Звонок завершён'
    : connected
      ? formatDuration(elapsed)
      : role === 'caller'
        ? 'Вызов…'
        : 'Соединение…';

  return (
    <View className="flex-1">
      {notice ? (
        <View className="absolute left-0 right-0 top-3 z-10 items-center">
          <Text className="rounded-full bg-black/70 px-4 py-2 text-center text-xs text-white/90">
            {notice}
          </Text>
        </View>
      ) : null}

      <View className="flex-1">
        {media === 'video' ? (
          <>
            {remoteUrl ? (
              <RTCView streamURL={remoteUrl} objectFit="cover" style={StyleSheet.absoluteFill} />
            ) : null}
            {!connected ? (
              <View className="absolute inset-0 items-center justify-center gap-3 bg-background/70">
                <AnoonAvatar initials={initialsOf(peerName)} tone={toneFor(peerId)} size={96} />
                <Text className="text-lg font-semibold text-foreground">{peerName}</Text>
                <Text className="text-sm text-foreground/60">{status}</Text>
              </View>
            ) : null}
            {/* Своё изображение — «картинка в картинке», зеркально, как на вебе. */}
            <View className="absolute right-4 top-4 h-32 w-24 overflow-hidden rounded-2xl border border-white/15 bg-muted">
              {localUrl && !cameraOff ? (
                <RTCView streamURL={localUrl} mirror objectFit="cover" zOrder={1} style={StyleSheet.absoluteFill} />
              ) : (
                <View className="flex-1 items-center justify-center">
                  <Text className="text-center text-[11px] leading-tight text-foreground/60">
                    Камера{'\n'}выкл.
                  </Text>
                </View>
              )}
            </View>
          </>
        ) : (
          <View className="flex-1 items-center justify-center gap-4 px-6">
            <AnoonAvatar initials={initialsOf(peerName)} tone={toneFor(peerId)} size={128} />
            <View className="items-center gap-1">
              <Text className="text-xl font-semibold text-foreground">{peerName}</Text>
              <Text className="text-sm text-foreground/60">{status}</Text>
            </View>
          </View>
        )}
      </View>

      <View className="flex-row items-end justify-center gap-6 pb-10 pt-6">
        <ControlButton
          label={muted ? 'Микрофон выкл.' : 'Микрофон'}
          active={muted}
          onPress={toggleMute}>
          {muted ? (
            <MicOffIcon size={24} color={CHAT_COLORS.foreground} />
          ) : (
            <MicIcon size={24} color={CHAT_COLORS.foreground} />
          )}
        </ControlButton>

        {media === 'video' && hasVideo ? (
          <ControlButton
            label={cameraOff ? 'Камера выкл.' : 'Камера'}
            active={cameraOff}
            onPress={toggleCamera}>
            {cameraOff ? (
              <VideoOffIcon size={24} color={CHAT_COLORS.foreground} />
            ) : (
              <VideoIcon size={24} color={CHAT_COLORS.foreground} />
            )}
          </ControlButton>
        ) : null}

        <HangUpButton label="Завершить" onPress={hangUp} />
      </View>
    </View>
  );
}

export default function CallRoute() {
  const call = useCallStore((s) => s.call);

  // Звонок кончился где угодно — на этом экране, у пира, в глобальном
  // слушателе — и экран уходит сам. Единственный выход отсюда.
  useEffect(() => {
    if (!call && router.canGoBack()) router.back();
  }, [call]);

  const accept = useCallback(() => useCallStore.getState().setActive(), []);
  const decline = useCallback(() => {
    const c = useCallStore.getState().call;
    if (c) sendCall({ type: 'call:hangup', to: c.peerHashId, callId: c.callId, reason: 'declined' });
    useCallStore.getState().endCall('declined');
  }, []);
  const end = useCallback((reason?: CallEndReason) => {
    useCallStore.getState().endCall(reason);
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      {!call ? null : call.status === 'incoming' ? (
        <Ringing
          peerName={call.peerName}
          peerId={call.peerHashId}
          media={call.media}
          onAccept={accept}
          onDecline={decline}
        />
      ) : (
        <ActiveCall
          key={call.callId}
          callId={call.callId}
          peerId={call.peerHashId}
          peerName={call.peerName}
          media={call.media}
          role={call.incomingOffer ? 'callee' : 'caller'}
          initialOffer={call.incomingOffer}
          onEnded={end}
        />
      )}
    </SafeAreaView>
  );
}
