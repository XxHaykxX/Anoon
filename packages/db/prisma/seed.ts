// Сидинг dev-данных. Запуск: pnpm --filter @anoon/db seed (после migrate).
// Идемпотентно по возможности (upsert по уникальным полям).
import { prisma } from "../index";

async function main() {
  // Два анонимных юзера + профили
  const alice = await prisma.user.upsert({
    where: { provider_providerId: { provider: "anonymous", providerId: "seed-alice" } },
    update: {},
    create: {
      provider: "anonymous",
      providerId: "seed-alice",
      profile: {
        create: { publicId: "00001", nickname: "Аноним-1", online: true },
      },
    },
    include: { profile: true },
  });

  const bob = await prisma.user.upsert({
    where: { provider_providerId: { provider: "anonymous", providerId: "seed-bob" } },
    update: {},
    create: {
      provider: "anonymous",
      providerId: "seed-bob",
      profile: {
        create: { publicId: "00002", nickname: "Аноним-2", online: false, reportCount: 2 },
      },
    },
    include: { profile: true },
  });

  const aliceP = alice.profile!;
  const bobP = bob.profile!;

  // Диалог + пара сообщений
  const conv = await prisma.conversation.create({
    data: {
      profileAId: aliceP.id,
      profileBId: bobP.id,
      lastMessageAt: new Date(),
      messages: {
        create: [
          { senderId: aliceP.id, kind: "text", text: "Привет! Как дела?", status: "read" },
          { senderId: bobP.id, kind: "text", text: "Интересно 🙂", status: "delivered" },
        ],
      },
    },
  });

  // Жалоба на Боба
  await prisma.report.create({
    data: {
      reporterId: aliceP.id,
      targetProfileId: bobP.id,
      reason: "spam",
      note: "Рассылает рекламу",
      status: "open",
    },
  });

  // Админ (пароль-хеш заглушка — заменить реальным argon2id на Фазе F)
  await prisma.adminUser.upsert({
    where: { email: "admin@anoon.local" },
    update: {},
    create: {
      email: "admin@anoon.local",
      passwordHash: "REPLACE_WITH_ARGON2ID_HASH",
      role: "super_admin",
    },
  });

  console.log("Seed готов:", { conv: conv.id, profiles: [aliceP.publicId, bobP.publicId] });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
