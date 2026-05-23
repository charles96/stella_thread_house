'use client';

import { LogIn, UserPlus } from 'lucide-react';
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
            setErrorMsg('유효하지 않은 초대 링크입니다.');
            return;
          }
          const j = (await res.json()) as { email: string };
          setInvitedEmail(j.email);
          setEmail(j.email);
        } catch {
          setErrorMsg('초대 정보를 불러오지 못했습니다.');
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
      setErrorMsg('비밀번호가 일치하지 않습니다.');
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
        let msg = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { message?: string };
          if (j.message) msg = j.message;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }
      // 로그인/등록 성공 → 부모(Auth check) 가 다시 /auth/me 로 fetch 하도록.
      onLogin();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const heading =
    mode === 'register'
      ? inviteToken
        ? '초대받은 가입'
        : '가입'
      : t('login.title');

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-2xl font-bold shadow-lg">
          S
        </div>
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
          {mode === 'login' && (
            <p className="whitespace-pre-line text-sm text-muted-foreground">
              {t('login.subtitle')}
            </p>
          )}
          {mode === 'register' && inviteToken && (
            <p className="text-sm text-muted-foreground">
              비밀번호를 설정하여 가입을 완료하세요. 가입 후 Settings 에서 Google 계정을 연동할 수 있습니다.
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
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              mode === 'register' ? '비밀번호 (8자 이상)' : '비밀번호'
            }
            autoComplete={
              mode === 'register' ? 'new-password' : 'current-password'
            }
            required
            minLength={mode === 'register' ? 8 : undefined}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          {mode === 'register' && (
            <input
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              placeholder="비밀번호 확인"
              autoComplete="new-password"
              required
              minLength={8}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
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
                ? '가입'
                : '로그인'}
          </Button>
        </form>

      </div>
    </div>
  );
}
