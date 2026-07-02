-- One-view (одноразовое медиа): сервер-истина факта просмотра (раньше только localStorage →
-- на новом устройстве уже-просмотренное показывалось снова). Аддитивно, обратно совместимо.
ALTER TABLE "Message" ADD COLUMN "once" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Message" ADD COLUMN "viewedAt" TIMESTAMP(3);
