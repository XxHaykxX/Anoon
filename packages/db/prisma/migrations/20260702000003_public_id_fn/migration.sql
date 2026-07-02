-- next_public_id() — атомарная выдача следующего #ID через SEQUENCE profile_public_seq
-- (создан миграцией 20260702000002_accounts). Нужна как RPC, т.к. supabase-js (PostgREST)
-- не умеет сырой `SELECT nextval(...)`; профиль-роут зовёт admin.rpc('next_public_id').
-- Снимает гонку параллельных регистраций (раньше count(Profile)+1 давал дубли → 500 на unique).
CREATE OR REPLACE FUNCTION public.next_public_id() RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT lpad(nextval('profile_public_seq')::text, 5, '0');
$$;
