import React, { useState } from 'react';
import { supabase, isConfigured } from '../services/supabaseClient';
import { ShieldCheck, LogIn, UserPlus, AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound } from 'lucide-react';

interface LoginPageProps {
  onLoginSuccess: () => void;
}

type Mode = 'login' | 'signup';

const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [commonKey, setCommonKey] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const getKoreanError = (msg: string): string => {
    if (msg.includes('Invalid login credentials')) return '이메일 또는 비밀번호가 올바르지 않습니다.';
    if (msg.includes('Email not confirmed')) return '이메일 인증이 필요합니다. 메일함을 확인해 주세요.';
    if (msg.includes('Too many requests')) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
    if (msg.includes('User not found')) return '등록되지 않은 이메일입니다.';
    if (msg.includes('User already registered')) return '이미 등록된 이메일입니다.';
    if (msg.includes('Sign ups not allowed')) return '회원가입이 비활성화되어 있습니다. 관리자에게 문의하세요.';
    if (msg.includes('Password should be at least')) return '비밀번호는 최소 6자 이상이어야 합니다.';
    if (msg.includes('Unable to validate email')) return '유효한 이메일 주소를 입력해 주세요.';
    if (msg.includes('network') || msg.includes('fetch')) return '네트워크 오류가 발생했습니다. 인터넷 연결을 확인해 주세요.';
    return mode === 'login' ? `로그인 오류: ${msg}` : `회원가입 오류: ${msg}`;
  };

  const switchMode = (newMode: Mode) => {
    setMode(newMode);
    setError(null);
    setSuccessMsg(null);
    setPassword('');
    setConfirmPassword('');
    setCommonKey('');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('이메일과 비밀번호를 모두 입력해 주세요.');
      return;
    }
    if (!isConfigured) {
      setError('Supabase 환경변수가 설정되지 않았습니다.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) {
        setError(getKoreanError(authError.message));
      } else {
        onLoginSuccess();
      }
    } catch (err) {
      setError(getKoreanError(String(err)));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('이메일과 비밀번호를 모두 입력해 주세요.');
      return;
    }
    if (commonKey !== 'secc') {
      setError('공통키가 올바르지 않습니다.');
      return;
    }
    if (password !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }
    if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (!isConfigured) {
      setError('Supabase 환경변수가 설정되지 않았습니다.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (authError) {
        setError(getKoreanError(authError.message));
      } else {
        setSuccessMsg('계정이 생성되었습니다. 로그인해 주세요.');
        switchMode('login');
      }
    } catch (err) {
      setError(getKoreanError(String(err)));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg">
            <ShieldCheck size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Panel Inspector</h1>
          <p className="text-slate-400 mt-1 text-sm">성수동 K-PJT 가설분전반 점검 시스템</p>
        </div>

        {/* 카드 */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-bold text-slate-800 mb-6">
            {mode === 'login' ? '로그인' : '회원가입'}
          </h2>

          {!isConfigured && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
              <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-amber-700 text-sm">
                Supabase 미설정 상태입니다.{' '}
                <code className="font-mono bg-amber-100 px-1 rounded">.env.local</code> 파일에
                VITE_SUPABASE_URL 및 VITE_SUPABASE_ANON_KEY를 설정해 주세요.
              </p>
            </div>
          )}

          {/* 성공 메시지 */}
          {successMsg && (
            <div className="mb-4 flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 size={16} className="text-green-500 shrink-0 mt-0.5" />
              <p className="text-green-700 text-sm">{successMsg}</p>
            </div>
          )}

          <form onSubmit={mode === 'login' ? handleLogin : handleSignup} className="space-y-4">
            {/* 이메일 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">이메일</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@company.com"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm transition-colors"
                disabled={isLoading}
                autoComplete="email"
              />
            </div>

            {/* 비밀번호 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">비밀번호</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호 입력"
                  className="w-full px-3 py-2.5 pr-10 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm transition-colors"
                  disabled={isLoading}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* 회원가입 전용 필드 */}
            {mode === 'signup' && (
              <>
                {/* 비밀번호 확인 */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">비밀번호 확인</label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="비밀번호 재입력"
                      className="w-full px-3 py-2.5 pr-10 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm transition-colors"
                      disabled={isLoading}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                      tabIndex={-1}
                    >
                      {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* 공통키 */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">공통키</label>
                  <div className="relative">
                    <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="password"
                      value={commonKey}
                      onChange={(e) => setCommonKey(e.target.value)}
                      placeholder="팀 공통키 입력"
                      className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm transition-colors"
                      disabled={isLoading}
                      autoComplete="off"
                    />
                  </div>
                  <p className="text-xs text-slate-400 mt-1">관리자에게 공통키를 문의하세요</p>
                </div>
              </>
            )}

            {/* 에러 메시지 */}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            {/* 제출 버튼 */}
            <button
              type="submit"
              disabled={isLoading || !isConfigured}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isLoading || !isConfigured
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
              }`}
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                  <span>{mode === 'login' ? '로그인 중...' : '가입 중...'}</span>
                </>
              ) : mode === 'login' ? (
                <>
                  <LogIn size={16} />
                  <span>로그인</span>
                </>
              ) : (
                <>
                  <UserPlus size={16} />
                  <span>회원가입</span>
                </>
              )}
            </button>
          </form>

          {/* 모드 전환 */}
          <div className="mt-6 text-center text-sm text-slate-500">
            {mode === 'login' ? (
              <>
                계정이 없으신가요?{' '}
                <button
                  onClick={() => switchMode('signup')}
                  className="text-blue-600 hover:text-blue-700 font-medium transition-colors"
                >
                  회원가입
                </button>
              </>
            ) : (
              <>
                이미 계정이 있으신가요?{' '}
                <button
                  onClick={() => switchMode('login')}
                  className="text-blue-600 hover:text-blue-700 font-medium transition-colors"
                >
                  로그인
                </button>
              </>
            )}
          </div>
        </div>

        <p className="text-center text-slate-600 text-xs mt-4">
          Panel Inspector v1.1.0 · 성수동 K-PJT
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
