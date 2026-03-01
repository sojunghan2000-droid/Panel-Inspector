/**
 * Supabase 클라이언트 초기화
 * .env.local에서 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 읽는다.
 */
import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON &&
  !SUPABASE_URL.includes('your-project-id'));

if (!isConfigured) {
  console.warn('[Supabase] 환경변수가 설정되지 않았습니다. .env.local 파일을 확인하세요.');
}

export { isConfigured };

export const supabase: SupabaseClient = createClient(
  SUPABASE_URL  || 'https://placeholder.supabase.co',
  SUPABASE_ANON || 'placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }
);

export const getSession = async (): Promise<Session | null> => {
  if (!isConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
};

export type { Session };
