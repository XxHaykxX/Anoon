-- Facebook OAuth: новое значение провайдера. Отдельная миграция (ADD VALUE вне транзакции с
-- использованием), как и email (20260702000001_accounts_enum).
ALTER TYPE "AuthProvider" ADD VALUE IF NOT EXISTS 'facebook';
