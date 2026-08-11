import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { CheckIcon, SearchIcon } from '@/components/icons';
import { AnoonAvatar } from '@/components/shared';
import { getCompanionClient } from '@/lib/companion';
import { useAnoonStore } from '@/store';
import type { FriendSearchResult } from '@/types/companion';

interface Person {
  id: string;
  hashId: string;
  name: string;
  initials: string;
  tone: number;
  note: string;
  relation?: FriendSearchResult['relation'];
}

/** Голые цифры #ID, чтобы «#00012» и «00012» сравнивались как равные. */
const bareId = (id: string) => id.replace(/^#/, '').trim().toLowerCase();

interface LocalKnowledge {
  relation?: FriendSearchResult['relation'];
  tone?: number;
}

/**
 * Строка результата из ответа companion.
 *
 * `local` закрывает то, чего живой бэкенд не присылает: `GET /friends/search`
 * отвечает только `{displayName, hashId}` — без `relation` и `avatarTone`, —
 * поэтому поиск того, кто УЖЕ в друзьях, показывал бы «Добавить» и звал
 * отправить дубль заявки. Ответ уже есть в сторе. Присланный `relation` всё
 * равно главнее.
 */
function resultToPerson(r: FriendSearchResult, local: LocalKnowledge = {}): Person {
  const relation = r.relation ?? local.relation;
  return {
    id: r.hashId,
    // companion возвращает id УЖЕ с «#» — безусловный префикс давал «##00012».
    hashId: r.hashId.startsWith('#') ? r.hashId : `#${r.hashId}`,
    name: r.displayName,
    initials: (r.displayName.trim()[0] ?? '?').toUpperCase(),
    tone: r.avatarTone ?? local.tone ?? 0,
    note:
      relation === 'friends'
        ? 'уже в друзьях'
        : relation === 'request_sent'
          ? 'запрос отправлен'
          : 'нажмите «Добавить», чтобы отправить запрос',
    relation,
  };
}

/** Найти друга (`AnoonFriendSearch.tsx`). Мок-каталог веба на телефоне не нужен. */
export default function FriendSearchScreen() {
  const [query, setQuery] = useState('');
  const [sent, setSent] = useState<Record<string, boolean>>({});
  // Сырые строки от companion — намеренно не преобразованные, чтобы выведенный
  // из стора `relation` переприменялся, когда друзья/заявки меняются при
  // открытом результате.
  const [rows, setRows] = useState<FriendSearchResult[]>([]);

  const friends = useAnoonStore((s) => s.friends);
  const requests = useAnoonStore((s) => s.requests);
  const showError = useAnoonStore((s) => s.showError);

  /** #ID → что мы уже знаем об этом человеке локально. */
  const localById = useMemo(() => {
    const m = new Map<string, LocalKnowledge>();
    for (const r of requests) {
      m.set(bareId(r.hashId), {
        relation: r.direction === 'outgoing' ? 'request_sent' : 'request_received',
        tone: r.avatarTone,
      });
    }
    // Дружба важнее любой протухшей заявки к тому же человеку.
    for (const f of friends) m.set(bareId(f.hashId), { relation: 'friends', tone: f.avatarTone });
    return m;
  }, [friends, requests]);

  useEffect(() => {
    const q = query.trim();
    // Пустой запрос уже очистил строки в onChangeText.
    if (!q) return;
    const t = setTimeout(() => {
      void getCompanionClient()
        .friendsSearch(q)
        // Отказ (лимит) показывает пусто, а не выдуманных людей.
        .then(setRows)
        .catch(() => setRows([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const results = useMemo(
    () => rows.map((r) => resultToPerson(r, localById.get(bareId(r.hashId)))),
    [rows, localById],
  );

  const addFriend = (p: Person) => {
    // «Отправлено» — утверждение о бэкенде, поэтому откатывается, если бэкенд
    // не согласен: иначе «вас заблокировали» / «нет такого #ID» / лимит
    // превращаются в заявку, которую человек считает висящей.
    setSent((prev) => ({ ...prev, [p.id]: true }));
    void getCompanionClient()
      .friendRequest(p.id)
      .catch(() => {
        setSent((prev) => {
          const next = { ...prev };
          delete next[p.id];
          return next;
        });
        showError('Не удалось отправить заявку. Попробуйте ещё раз');
      });
  };

  return (
    <View className="flex-1 bg-background">
      <View className="px-5 pb-3 pt-14">
        <Text className="text-2xl font-bold text-foreground">Найти друга</Text>
        <Text className="mt-0.5 text-sm text-muted-foreground">Введите ID пользователя</Text>
      </View>

      <View className="px-5 pb-3">
        <View className="flex-row items-center gap-2 rounded-full bg-muted px-4 py-2.5">
          <SearchIcon size={20} color="#9a9aa0" />
          <TextInput
            value={query}
            onChangeText={(next) => {
              setQuery(next);
              // Опустевшее поле сразу убирает строки прошлого запроса: это
              // следствие события, а не рендера, поэтому здесь, а не в эффекте.
              if (!next.trim()) setRows([]);
            }}
            placeholder="Например, 00042"
            placeholderTextColor="#9a9aa0"
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-1 text-sm text-foreground"
          />
        </View>
      </View>

      <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
        {query.trim() === '' ? (
          <View className="items-center px-5 pt-20">
            <View className="mb-3 h-14 w-14 items-center justify-center rounded-full bg-muted">
              <SearchIcon size={24} color="#9a9aa0" />
            </View>
            <Text className="text-center text-sm text-muted-foreground">
              Введите ID — можно с решёткой или без
            </Text>
          </View>
        ) : results.length === 0 ? (
          <View className="items-center px-5 pt-20">
            <Text className="text-sm font-medium text-foreground">Ничего не найдено</Text>
            <Text className="mt-1 text-xs text-muted-foreground">Проверьте ID и попробуйте снова</Text>
          </View>
        ) : (
          <View className="gap-2.5 px-5">
            {results.map((p) => {
              const isFriend = p.relation === 'friends';
              const isSent = sent[p.id] || p.relation === 'request_sent';
              return (
                <View
                  key={p.id}
                  className="flex-row items-center gap-3 rounded-2xl border border-border bg-card p-3">
                  <AnoonAvatar initials={p.initials} tone={p.tone} size={44} />
                  <View className="min-w-0 flex-1">
                    <View className="flex-row items-center gap-1.5">
                      <Text numberOfLines={1} className="shrink font-semibold text-foreground">
                        {p.name}
                      </Text>
                      <Text className="shrink-0 text-xs text-muted-foreground">{p.hashId}</Text>
                    </View>
                    <Text numberOfLines={1} className="text-sm text-muted-foreground">
                      {p.note}
                    </Text>
                  </View>
                  {isFriend ? (
                    <View className="shrink-0 flex-row items-center gap-1 rounded-full bg-online/15 px-3 py-1.5">
                      <CheckIcon size={16} color="#32d74b" />
                      <Text className="text-xs font-medium text-online">В друзьях</Text>
                    </View>
                  ) : isSent ? (
                    <View className="shrink-0 flex-row items-center gap-1 rounded-full bg-muted px-3 py-1.5">
                      <CheckIcon size={16} color="#9a9aa0" />
                      <Text className="text-xs font-medium text-muted-foreground">Запрос отправлен</Text>
                    </View>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => addFriend(p)}
                      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                      className="shrink-0 rounded-full bg-primary px-4 py-1.5">
                      <Text className="text-xs font-semibold text-primary-foreground">Добавить</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
