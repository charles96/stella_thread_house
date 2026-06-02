'use client';

import { Eye, LogIn, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

const API_URL = '/api';

type Mode = 'login' | 'register';

export default function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const { t } = useI18n();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPassword2, setShowPassword2] = useState(false);
  // 초대 토큰 (URL 의 ?token=...) — 등록 모드 자동 전환 + 폼 처리.
  // 첫 admin 은 별도 가입 폼이 없고, 그냥 로그인 시도하면 backend 가 0명 + env 매칭 시 자동 생성.
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  // 초대된 이메일 — backend 에서 token 으로 조회한 후 락 처리.
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);

  // ?login_error=, ?token= 둘 다 처리.
  useEffect(() => {
    const url = new URL(window.location.href);
    const err = url.searchParams.get('login_error');
    if (err) {
      setErrorMsg(err);
      url.searchParams.delete('login_error');
    }
    const tok = url.searchParams.get('token');
    if (tok) {
      setInviteToken(tok);
      setMode('register');
      url.searchParams.delete('token');
      // 토큰으로 초대된 이메일 조회 — 성공 시 폼에 자동 채움 + 락.
      (async () => {
        try {
          const res = await fetch(
            `${API_URL}/auth/invitation/${encodeURIComponent(tok)}`,
          );
          if (!res.ok) {
            setErrorMsg(t('login.invalidInvite'));
            return;
          }
          const j = (await res.json()) as { email: string };
          setInvitedEmail(j.email);
          setEmail(j.email);
        } catch {
          setErrorMsg(t('login.inviteLoadError'));
        }
      })();
    }
    if (err || tok) window.history.replaceState({}, '', url.toString());
  }, []);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setErrorMsg(null);
    // register 모드 — 비밀번호 일치 검증.
    if (mode === 'register' && password !== password2) {
      setErrorMsg(t('login.passwordMismatch'));
      return;
    }
    setBusy(true);
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const body =
        mode === 'login'
          ? { email, password }
          : { email, password, token: inviteToken ?? undefined };
      const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // 백엔드가 message 를 주면 그대로 사용, 없으면 상태코드 노출 대신 사람이 읽을 영어 문구.
        let msg = '';
        try {
          const j = (await res.json()) as { message?: string };
          if (j.message) msg = j.message;
        } catch {
          // ignore
        }
        if (!msg) {
          if (res.status >= 500) {
            msg = 'Server error. Please try again in a moment.';
          } else if (res.status === 401 || res.status === 403) {
            msg = 'Incorrect email or password.';
          } else if (res.status === 429) {
            msg = 'Too many attempts. Please wait a moment and try again.';
          } else {
            msg = `Request failed (${res.status}). Please try again.`;
          }
        }
        throw new Error(msg);
      }
      // 로그인/등록 성공 → 부모(Auth check) 가 다시 /auth/me 로 fetch 하도록.
      onLogin();
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      // fetch 자체 실패(서버 미응답·네트워크 단절) — "Failed to fetch" 대신 명확한 영어 문구.
      setErrorMsg(
        /failed to fetch|networkerror|load failed/i.test(m)
          ? 'Unable to reach the server. Please check your connection and try again.'
          : m,
      );
    } finally {
      setBusy(false);
    }
  }

  const heading =
    mode === 'register'
      ? inviteToken
        ? t('login.inviteRegister')
        : t('login.doRegister')
      : t('login.title');

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 px-6 text-center">
        <img src="/logo.svg" alt="Stella" className="h-20 w-20" />
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
          {mode === 'login' && (
            <p className="text-sm text-muted-foreground">
              Co-creating knowledge with AI
            </p>
          )}
          {mode === 'register' && inviteToken && (
            <p className="text-sm text-muted-foreground">
              {t('login.inviteDesc')}
            </p>
          )}
        </div>

        {errorMsg && (
          <div className="w-full rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {errorMsg}
          </div>
        )}

        {/* 이메일/비밀번호 폼 */}
        <form onSubmit={submit} className="flex w-full flex-col gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            autoComplete="email"
            required
            readOnly={!!invitedEmail}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/40 read-only:cursor-not-allowed"
          />
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                mode === 'register' ? t('login.passwordMin') : t('login.password')
              }
              autoComplete={
                mode === 'register' ? 'new-password' : 'current-password'
              }
              required
              minLength={mode === 'register' ? 8 : undefined}
              className="w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              onPointerDown={() => setShowPassword(true)}
              onPointerUp={() => setShowPassword(false)}
              onPointerLeave={() => setShowPassword(false)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground select-none"
              tabIndex={-1}
            >
              <Eye className="h-4 w-4" />
            </button>
          </div>
          {mode === 'register' && (
            <div className="relative">
              <input
                type={showPassword2 ? 'text' : 'password'}
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                placeholder={t('login.passwordConfirm')}
                autoComplete="new-password"
                required
                minLength={8}
                className="w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onPointerDown={() => setShowPassword2(true)}
                onPointerUp={() => setShowPassword2(false)}
                onPointerLeave={() => setShowPassword2(false)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground select-none"
                tabIndex={-1}
              >
                <Eye className="h-4 w-4" />
              </button>
            </div>
          )}
          <Button size="lg" type="submit" disabled={busy} className="w-full gap-2">
            {mode === 'register' ? (
              <UserPlus className="h-4 w-4" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            {busy
              ? '...'
              : mode === 'register'
                ? t('login.doRegister')
                : t('login.doLogin')}
          </Button>
        </form>

      </div>
    </div>
  );
}
