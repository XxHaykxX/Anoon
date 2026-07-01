-- Мут профиля: не может ОТПРАВЛЯТЬ сообщения до mutedUntil (мягче бана — читать/сидеть можно).
ALTER TABLE "Profile" ADD COLUMN "mutedUntil" TIMESTAMP(3);
ALTER TABLE "Profile" ADD COLUMN "muteReason" TEXT;
