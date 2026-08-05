# anoon — Оплаты и монетизация: техническая спека (D2)

> Исследование армянских платёжных систем + архитектура платёжного модуля companion.
> Обновлён 2026-07-03. Опирается на BUSINESS-PLAN.md (модель), BUILD-PLAN.md (фаза D2),
> COMPANION-PLAN.md (companion = Go + Postgres `anoon`).
> Пометка **[не подтверждено]** = данные из вторичных источников, проверить при подписании договора.

---

## 1. Провайдеры: что выяснено

### Сводная таблица

| Провайдер | Тип | Интеграция | Рекуррентные (авто-списание) | Подтверждение оплаты | Комиссия | Онбординг |
|---|---|---|---|---|---|---|
| **Idram** | кошелёк (крупнейший, лицензия ЦБ РА) | redirect: form-POST на `web.idram.am/payment.aspx`, поля `EDP_*` | ❌ только разовые | server-to-server на `RESULT_URL`: precheck → confirm, MD5-чексумма с `SECRET_KEY`, ответ «OK» | не публикуется; порядок 1,5–3% **[не подтверждено]**, встречается «0% для онлайн-магазинов» (акция?) | договор с Idram; 3 URL + secret key + email заводят их техники |
| **Telcell Wallet** | кошелёк (~900 тыс. юзеров) | invoice-API: POST-создание счёта (base64 + MD5), redirect на `telcellmoney.am/payments/invoice/` | ❌ только разовые | POST-callback на URL мерчанта при смене статуса счёта, MD5-чексумма | не публикуется **[не подтверждено]** | регистрация мерчанта → выдают issuer ID + ключ; docs: developer.telcell.am |
| **EasyPay (easywallet)** | кошелёк | redirect + Bearer-token API; есть sandbox | ❌ не документировано | callback (path-параметры) | не публикуется **[не подтверждено]** | Bearer token через b2b@easypay.am; идентификация — платная услуга через партнёра |
| **ArCa EPG** (через банк-участник: Ineco, ACBA, Converse, Ardshin, Evoca…) | карточный эквайринг (ArCa + локальные Visa/MC) | REST `epg.arca.am/payment/rest/`: register order → redirect на платёжную страницу → возврат `returnUrl?orderId=` → мерчант сам опрашивает статус | ✅ **card binding**: register c `clientId` → `bindingId` → «pay with saved card» (тихое списание) | НЕТ push-вебхука в базовой схеме — возврат юзера + опрос `getOrderStatus` (надёжность — своим поллером) | 2–5% (интернет-эквайринг в целом по рынку) | договор эквайринга с банком-участником ArCa; тестовый стенд `testepg.arca.am` |
| **Ameriabank vPOS** | карточный эквайринг (ArCa + Visa/MC), своя обёртка над EPG | REST API (`InitPayment`, `GetPaymentDetails`…), докс: `servicestest.ameriabank.am/VPOS/help`, есть SDK сообщества (JS/PHP/Laravel) | ✅ `MakeBindingPayment` + `CardHolderID`; **binding включается отдельной заявкой в банк** | redirect назад + запрос деталей платежа по `PaymentID` (та же модель «сам проверь») | индивидуально по договору; vPOS как софт — бесплатно | договор с Ameriabank; тестовая среда выдаётся с инструкцией |

Ключевые факты:

- **Кошельки (Idram/Telcell/EasyPay) умеют только разовые платежи.** Ни у одного в
  публичной мерчант-документации нет авто-списаний/подписок.
- **Настоящие рекуррентные платежи в Армении есть только у карточного эквайринга** через
  привязку карты (binding): ArCa EPG `bindingId` или Ameriabank `MakeBindingPayment`.
  Binding — отдельное разрешение от банка (заявка от директора юрлица).
- **Callback-модели разные:** Idram/Telcell шлют server-to-server подтверждение сами (push);
  карточные — «юзер вернулся, а ты сходи и спроси статус» (pull). Модуль должен уметь обе.
- Всё в **AMD**; расчёты с мерчантом — на армянский банковский счёт (карты: зачисление до ~5
  банковских дней).
- **Онбординг:** нужно юрлицо (ООО) или ИП в Армении + счёт в банке + договор. Банки проверяют
  сайт, описание услуги, модель. Сроки: ~1–3 недели.
- ⚠️ **Риск «18+»:** adult относят к high-risk нишам, подписочные модели проверяют строже.
  anoon надо позиционировать банку как «анонимные знакомства/чат» (dating/social), без
  явного adult-контента на витрине. Это главный риск онбординга — выяснить заранее.

### Рекомендация на запуск

1. **Idram — первый и обязательный.** Крупнейшее покрытие, простейшая интеграция (redirect +
   RESULT_URL), надёжное server-to-server подтверждение. Закрывает монеты и «пропуска» на 30 дней.
2. **Карточный эквайринг с binding — второй, для настоящих подписок и Visa/MC.**
   Кандидат №1 — **Ameriabank vPOS** (лучшая публичная документация, `MakeBindingPayment`,
   комьюнити-SDK); равноценная альтернатива — любой банк ArCa EPG (Ineco/Evoca часто гибче к
   малому бизнесу — сравнить условия при обзвоне).
3. **Telcell Wallet — быстрый второй кошелёк** после запуска (API простой, аудитория большая).
   **EasyPay — потом** (меньше всего публичной ценности на старте).

---

## 2. Подписки vs монеты: как обрабатываем

### Подписки (Premium ~1990 AMD/мес, Super Premium ~4990 AMD/мес, год −40%)

Два режима, оба поддерживаем с первого дня:

- **Карта + binding (авто-продление).** Первый платёж через vPOS с привязкой → храним
  `binding_ref` → воркер продления списывает за N дней до конца периода. Неудача → ретраи
  (день 0/1/3) → grace 3 дня → даунгрейд в Free + пуш.
- **Кошелёк (Idram/Telcell) = «пропуск на период», без авто-продления.** Подписка — это
  оплаченный период до `expires_at`. Эмуляция продления: пуш-напоминание за 3 дня и за 1 день
  («Premium заканчивается — продлить в 1 тап») + deep-link на предсозданный заказ. Продлил до
  истечения — период прирастает от `expires_at` (дни не сгорают).

Единая модель: **подписка = запись с `expires_at`**; авто-продление — лишь способ сдвигать
`expires_at`. Энтайтлменты всегда проверяются по `expires_at > now()`, а не по «активна ли
подписка у провайдера» (провайдеры этого всё равно не знают).

Годовой план = тот же продукт с периодом 365 дней и своей ценой. Апгрейд Premium→Super:
доплата с зачётом остатка дней (пересчёт по дневной цене) — v1 можно упростить: новый план
стартует сразу, остаток старого конвертируем в дни нового.

### Монеты (пачки 490–4900 AMD)

- Покупка — разовый платёж любым провайдером → зачисление в кошелёк юзера (ledger).
- Траты: **буст** (подъём в очереди), **подарки**, **супер-оценка**, **снятие дневного лимита
  на 24 ч**. Все списания — server-side, атомарно, баланс в минус не уходит.
- Монеты не выводятся и не возвращаются (прописать в оферте); бонусные монеты Super Premium —
  ежемесячное начисление тем же ledger'ом с типом `bonus`.

---

## 3. Платёжный модуль companion (Go)

### 3.1 Слой провайдеров

Интерфейс `PSP` + реализации `idram`, `telcell`, `vpos` (ArCa/Ameria):

```
CreatePayment(order) → redirectURL          // все
HandleCallback(req) → (orderRef, status)    // idram, telcell (push)
QueryStatus(orderRef) → status              // vpos (pull), и как сверка для всех
ChargeBinding(bindingRef, amount) → status  // только vpos (рекуррент)
```

Для vpos — свой **поллер**: после возврата юзера на `returnUrl` и по крону добиваем статусы
«pending» заказов (юзер мог закрыть вкладку — оплата всё равно засчитается).

### 3.2 Таблицы (Postgres `anoon`, схема `billing`)

```sql
products            -- каталог: id, kind(sub|coins), tier, period_days, coins, price_amd, active
orders              -- id(uuid), user_id, product_id, provider, provider_ref, amount_amd,
                    -- status(new|pending|paid|failed|refunded), idempotency_key,
                    -- created_at, paid_at
payment_events      -- сырые callback'и/ответы поллера: id, provider, raw jsonb, order_id,
                    -- received_at  (аудит + идемпотентность + разбор споров)
subscriptions       -- id, user_id, tier(premium|super), expires_at, auto_renew bool,
                    -- binding_id → card_bindings, last_order_id, status(active|grace|expired)
card_bindings       -- id, user_id, provider, binding_ref, masked_pan, active, created_at
coin_ledger         -- id, user_id, delta (+покупка/бонус, −трата), reason(purchase|bonus|boost|
                    -- gift|super_rating|limit_off|admin), order_id/null, ref jsonb, created_at
coin_balances       -- user_id PK, balance (обновляется в той же транзакции, CHECK balance>=0)
```

### 3.3 REST-эндпоинты (companion API, под юзерским JWT)

```
GET  /billing/products                     — каталог с ценами
POST /billing/orders {product_id, provider}— создать заказ → {order_id, redirect_url}
GET  /billing/orders/:id                   — статус (фронт опрашивает на странице возврата)
POST /billing/callbacks/idram              — server-to-server (precheck + confirm, MD5, «OK»)
POST /billing/callbacks/telcell            — callback смены статуса счёта (MD5)
GET  /billing/return/vpos?orderID=…        — возврат юзера → QueryStatus → редирект на фронт
GET  /me/entitlements                      — {tier, expires_at, auto_renew, coins}
POST /me/subscription/cancel               — выключить auto_renew (доступ до expires_at)
POST /coins/spend {reason, target?}        — трата (boost/gift/super_rating/limit_off)
```

### 3.4 Поток подтверждения оплаты (webhook flow)

1. Callback/поллер → верифицируем чексумму/источник; сырьё в `payment_events`.
2. Идемпотентность: по `provider+provider_ref` (unique) — повтор колбэка = no-op «OK».
3. Сверяем сумму с `orders.amount_amd` (не доверяем сумме из колбэка).
4. В одной транзакции: `orders.status=paid` → грант:
   - sub: `subscriptions.expires_at += period` (или создать), tier по продукту;
   - coins: `coin_ledger` +delta и `coin_balances` += delta.
5. Событие в companion-WS фронту (`entitlements_changed`) + пуш «Оплата прошла».
6. **Грант — только по серверному подтверждению.** SUCCESS_URL/redirect юзера — никогда.

### 3.5 Воркеры (в процессе companion, по тикеру)

- **renewals**: подписки с `auto_renew && expires_at < now()+3d` → `ChargeBinding`;
  ретраи 0/1/3 дн; после grace — `status=expired`, событие даунгрейда.
- **reminders**: кошельковые подписки → пуши за 3 дня / 1 день до `expires_at`.
- **vpos-poller**: заказы `pending` старше 2 мин → `QueryStatus`; старше 24 ч → `failed`.
- **bonus-coins**: Super Premium — ежемесячное начисление бонусных монет.

### 3.6 Энтайтлменты в матчинге (ядро монетизации)

Очередь рулетки (фаза C2) читает энтайтлменты при входе юзера в очередь:

```
priority: 0 = Super Premium, 1 = Premium, 2 = Free      (из subscriptions)
boosted_until: timestamp                                 (покупка буста → now()+N мин)
```

- Подбор сортирует кандидатов по `(effective_priority, enqueued_at)`, где буст временно
  даёт `effective_priority = 0` (наравне с Super) до `boosted_until`.
- Дневной лимит поисков Free: счётчик в companion; `limit_off` в ledger снимает на 24 ч.
- Чтение — из Postgres при enqueue + инвалидация по WS-событию `entitlements_changed`
  (кэш в памяти процесса, TTL 60 сек). Отдельный поход в БД на каждый матч не нужен.
- Силу форы (мягко/жёстко) выносим в конфиг: веса/квоты по классам, чтобы крутить без деплоя.

---

## 4. Порядок работ D2

1. Схема `billing` + миграции + каталог продуктов (конфигом/сидом).
2. Ledger монет + `/coins/spend` + `/me/entitlements` (работает ещё без реальных оплат —
   админ-начисление для тестов).
3. Интеграция **Idram** (redirect + RESULT_URL) на sandbox-заглушке → монеты и пропуска.
4. Приоритет очереди + буст в матчере (C2 hook) — читаем энтайтлменты.
5. Интеграция **vPOS + binding** → авто-продление, воркер renewals.
6. Telcell — вторым кошельком; EasyPay — по остаточному принципу.
7. Прод: договоры, боевые ключи, сверка (reconciliation-отчёт по `payment_events` vs выписка).

---

## 5. Открытые вопросы (к тебе)

1. ❓ **Юрлицо.** ООО или ИП в Армении? Кто и когда регистрирует? Без этого ни один договор
   не подписать — это критический путь (1–3 недели на онбординг после регистрации).
2. ❓ **Позиционирование для банка/Idram.** «Анонимные знакомства 18+» проходят как dating или
   попадают в high-risk adult? Предлагаю на этапе переговоров показывать как «анонимный
   чат/знакомства» без adult-акцента. ОК?
3. ❓ **Очерёдность договоров.** Рекомендую параллельно: заявка в Idram + обзвон 2–3 банков
   (Ameria, Ineco, Evoca) про vPOS с binding для подписок. Подтверди.
4. ❓ **Binding у нового мерчанта.** Дают ли банки авто-списания молодому юрлицу без истории —
   выяснится только в переговорах. Если нет — на старте все подписки живут как «пропуска»
   с напоминаниями (модуль это уже умеет), binding добавим позже без переделок.
5. ❓ Возвраты/refund-политика (юзер передумал, спор) — прописать в оферте; монеты не возвращаем?
6. ❓ Налоги/касса: нужен ли онлайн-чек (ЭКА/e-invoice) на каждый платёж по армянскому
   законодательству — уточнить у бухгалтера при регистрации юрлица.

---

## 6. Юрлицо, налоги и запрет зарубежных PSP

> Влито из бывшего `PAYMENTS-ARMENIA.md`. Всё непроверенное помечено **[не подтверждено]**.

### 6.1 Зарубежные PSP отпадают — это блокер, не техничность
- **Stripe** — Армения не поддерживается как страна-мерчант (только сбор налога с покупателей).
- **Paddle** — Acceptable Use Policy **прямо запрещает «dating services/applications»** (в одном пункте с adult). Не тратить время.
- **LemonSqueezy / Payoneer** — широкий запрет «adult entertainment» → dating/чат почти наверняка отклонят/заморозят.
- Вывод: **только локальные армянские рельсы** (Idram + карточный эквайринг банка). См. §1.
- Отдельно: **порнография в Армении уголовно наказуема** — anoon это dating/чат, не порно, но если в рулетке/видео есть риск наготы/сексконтента — это юр-экспозиция, к местному юристу (вне scope оплат).

### 6.2 Юрлицо — быстрый путь (ИП)
1. **ИП (Individual Entrepreneur)** — не ООО на старте. ~AMD 3 000 (~$8), онлайн через e-Register, ~1 день. Личная ответственность по долгам.
2. **В течение 20 дней** после регистрации — подать на смену налогового режима на **IT turnover tax = 1% выручки** (до AMD 115 млн/год). Пропустишь окно → дефолтный общий режим (до 23%). Критический дедлайн. *(Подтвердить у бухгалтера, что anoon = «IT-деятельность».)*
3. **Бизнес-счёт** в банке с интернет-эквайрингом (vPOS). Рекомендация — **Ameriabank** (лучшая публичная докментация, подтверждён recurring).
4. **Договор Internet-Acquiring** — банк требует рабочий сайт с обязательными разделами (см. 6.4).
5. Далее — API для Visa/MC/ArCa, включая **подписки**.
6. **Idram** — вторым, после карточного шлюза.
- **ООО vs ИП:** ООО = защита ответственности + больше доверия банка для high-risk, но дороже/дольше. Старт — ИП, ООО позже когда виден риск-профиль.

### 6.3 Ориентир по расходам
| Статья | Стоимость |
|---|---|
| Регистрация ИП | ~AMD 3 000 разово (~$8) |
| Налог (IT turnover) | 1% выручки |
| Мед-страховка (с 2026, если оборот > AMD 2,4 млн) | AMD 129 600/год |
| Карточная комиссия | ~2,5–4% за транзакцию **[не подтверждено — брать письменный оффер]** |
| Idram | ~1–3% **[не подтверждено]** |
> ЦБ РА кэпирует interchange 0,5% (ArCa) / 0,9% (Visa/MC) при обороте < AMD 150 млн — это оптовый кэп, не розничная комиссия банка.

### 6.4 Ameriabank vPOS — подтверждено из офиц. T&C (ред. 2022-08-22)
- **Recurring есть:** §35.2 токенизация карты, §37.3 списание «через регулярные интервалы» по согласию держателя, §28.12/§29 правила free-trial (уведомить ≥2 дн до конца, ясная отмена). Ровно форма месячной подписки.
- **Требования к сайту (проверяет банк):** About Us, контакты, полное описание услуги, цены **в AMD**, условия/возвраты, политика конфиденциальности и безопасности карт, логотипы ArCa/Visa/MC, и — **обязательный age-gating** («технические решения для соблюдения законов РА, включая возрастные ограничения»).
- **Онбординг:** активация до 10 банковских дней после подписания. Расчёт до 5 банковских дней. Hosted-page → минимум PCI-нагрузки. **Гарантийный депозит** банк может потребовать для «high-risk» вида деятельности (§47) — спросить про dating-категорию заранее.
- Источник: [Ameriabank Internet Acquiring T&C (PDF)](https://ameriabank.am/userfiles/file/Retail/Internet_Acquiring_Terms_and_Conditions_eng.pdf)

## Источники
- Idram merchant interface (EDP_*, RESULT_URL, MD5): slideshare «Idram merchant API», idram.am
- Telcell invoice API: developer.telcell.am/priyom-platejey-cherez-telcell-wallet/
- EasyPay easywallet: wordpress.org/plugins/payment-gateway-for-easywallet/ (Bearer token, b2b@easypay.am)
- ArCa EPG + binding: github.com/tobelyan/omnipay-arca-epg (epg.arca.am/payment/rest), old.arca.am/en/emerchants
- Ameriabank vPOS: servicestest.ameriabank.am/VPOS/help (MakeBindingPayment), ameriabank.am (e-commerce)
- Рынок/требования/риски: vc.ru «Интернет-эквайринг в Армении 2026», armenian-lawyer.com
