'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Brain,
  Check,
  ChevronsUpDown,
  Clock,
  Eye,
  KeyRound,
  Languages,
  Lock,
  LogIn,
  Mail,
  Palette,
  Server,
  Settings as SettingsIcon,
  Shield,
  SlidersHorizontal,
  Terminal,
  Trash2,
  User,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useI18n, type Lang } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { COMMON_TIMEZONES, useTimezone } from '@/lib/timezone';
import type { AuthUser, ModelInfo } from './ChatRoom';

interface Props {
  open: boolean;
  onClose: () => void;
  user?: AuthUser | null;
  // 사용자 정보(이름 등) 변경 후 부모의 user state 를 갱신하기 위한 콜백.
  onUserUpdated?: (user: AuthUser) => void;
  models?: ModelInfo[];
  reasoningModel?: string;
  visionModel?: string;
  onSelectReasoningModel?: (name: string) => void;
  onSelectVisionModel?: (name: string) => void;
  aiEndpoint?: string;
  onChangeAiEndpoint?: (v: string) => void;
  // 모델 fetch 결과 — 에러가 있으면 입력 박스 빨강 + 에러 메시지 표기.
  aiEndpointError?: string | null;
  aiEndpointLoading?: boolean;
}

type Tab =
  | 'general'
  | 'admin-ai'
  | 'admin-smtp'
  | 'admin-member'
  | 'admin-system';

export default function SettingsModal({
  open,
  onClose,
  user,
  onUserUpdated,
  models = [],
  reasoningModel,
  visionModel,
  onSelectReasoningModel,
  onSelectVisionModel,
  aiEndpoint,
  onChangeAiEndpoint,
  aiEndpointError,
  aiEndpointLoading,
}: Props) {
  const { t } = useI18n();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<Tab>('general');
  // onClose 가 inline 함수라 ref 로 잡아 effect 가 매 렌더마다 재실행되지 않게.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // 모달이 열리는 시점에만 General 로 초기화 (admin 권한 박탈 시 잘못된 탭에 머물지 않도록).
    // open 전환에만 의존 → 모델 선택처럼 다른 prop 이 바뀌어 부모가 re-render 해도 탭이 리셋되지 않음.
    setTab('general');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      // 모달 — 반투명 배경 + 가운데 정렬된 박스. 배경 클릭/Esc 로 닫기.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-background/70 backdrop-blur-sm p-4 animate-in fade-in-0 duration-150"
    >
      <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl animate-in zoom-in-95 duration-150">
        {/* 상단 헤더 — 좌측에 타이틀, 우측에 닫기 버튼. */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card/40 px-6">
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <SettingsIcon className="h-5 w-5 text-primary" />
            <span>{t('settings.title')}</span>
          </h1>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={onClose}
            title={t('settings.close')}
            aria-label={t('settings.close')}
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        {/* 좌측 사이드바(메뉴 목록) + 우측 본문.
            비-admin 은 General 만 있어 사이드바 생략하고 본문 풀폭. */}
        <div className="flex min-h-0 flex-1">
          {/* 사이드바 — 항상 노출. Admin 그룹은 admin 권한이 있는 경우에만 노출. */}
          <aside className="flex w-60 shrink-0 flex-col gap-1 border-r border-border bg-card/30 px-3 py-6">
          <NavItem
            active={tab === 'general'}
            onClick={() => setTab('general')}
            icon={<SlidersHorizontal className="h-4 w-4" />}
            label={t('settings.menu.general')}
          />
          {isAdmin && (
            <>
              <div className="mt-3 flex items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground">
                <Shield className="h-4 w-4" />
                <span>Admin</span>
              </div>
              <NavItem
                active={tab === 'admin-ai'}
                onClick={() => setTab('admin-ai')}
                icon={<Bot className="h-4 w-4" />}
                label={t('settings.menu.ai')}
                indent
              />
              <NavItem
                active={tab === 'admin-smtp'}
                onClick={() => setTab('admin-smtp')}
                icon={<Mail className="h-4 w-4" />}
                label={t('settings.menu.smtp')}
                indent
              />
              <NavItem
                active={tab === 'admin-member'}
                onClick={() => setTab('admin-member')}
                icon={<Users className="h-4 w-4" />}
                label={t('settings.menu.member')}
                indent
              />
              <NavItem
                active={tab === 'admin-system'}
                onClick={() => setTab('admin-system')}
                icon={<Terminal className="h-4 w-4" />}
                label={t('settings.menu.system')}
                indent
              />
            </>
          )}
        </aside>
        <main className="flex-1 overflow-y-auto">
          <div className="w-full max-w-4xl px-8 py-8">
            {tab === 'general' && (
              <GeneralTab user={user} onUserUpdated={onUserUpdated} />
            )}
            {isAdmin && tab === 'admin-ai' && (
              <AiSection
                models={models}
                reasoningModel={reasoningModel}
                visionModel={visionModel}
                onSelectReasoningModel={onSelectReasoningModel}
                onSelectVisionModel={onSelectVisionModel}
                aiEndpoint={aiEndpoint}
                onChangeAiEndpoint={onChangeAiEndpoint}
                aiEndpointError={aiEndpointError}
                aiEndpointLoading={aiEndpointLoading}
              />
            )}
            {isAdmin && tab === 'admin-smtp' && <SmtpSection />}
            {isAdmin && tab === 'admin-member' && (
              <MembersTab currentUserId={user?.id} />
            )}
            {isAdmin && tab === 'admin-system' && <SystemTab />}
          </div>
        </main>
        </div>
      </div>
    </div>
  );
}

// 좌측 사이드바 메뉴 항목.
function NavItem({
  active,
  onClick,
  icon,
  label,
  indent = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-md py-2 text-left text-sm transition-colors',
        indent ? 'pl-7 pr-3' : 'px-3',
        active
          ? 'bg-primary/15 font-medium text-primary'
          : 'text-foreground/80 hover:bg-accent/40 hover:text-foreground',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-2 text-sm transition-colors -mb-px border-b-2',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ─── General Tab ─────────────────────────────────────────────────

function GeneralTab({
  user,
  onUserUpdated,
}: {
  user?: AuthUser | null;
  onUserUpdated?: (user: AuthUser) => void;
}) {
  const { lang, setLang, t } = useI18n();
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex flex-col gap-8">
      {/* General 헤더 + User Information 은 묶어서 좁은 간격 유지. */}
      <div className="flex flex-col gap-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
          <SlidersHorizontal className="h-5 w-5 text-primary" />
          <span>{t('settings.menu.general')}</span>
        </h2>
        {user && (
        <UserInfoSection user={user} onUserUpdated={onUserUpdated} />
      )}
      </div>
      {/* 비밀번호/Google SSO. */}
      {user && <AccountSection user={user} />}
      {/* 2) 외관 — 언어/테마. 폭이 넓을 땐 2열 그리드, 좁을 땐 1열. */}
      <section className="last:border-b-0 last:pb-0 border-b border-border/50 pb-8">
        <div className="grid gap-4 md:grid-cols-2">
          <SettingField
            icon={<Languages className="h-3.5 w-3.5 text-primary" />}
            label={t('settings.language')}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span>{t(`settings.lang.${lang}` as const)}</span>
                  <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                sideOffset={4}
                className="z-[120] w-[var(--radix-dropdown-menu-trigger-width)]"
              >
                {(
                  [
                    { key: 'ko' as Lang, label: t('settings.lang.ko') },
                    { key: 'en' as Lang, label: t('settings.lang.en') },
                    { key: 'ja' as Lang, label: t('settings.lang.ja') },
                    { key: 'zh' as Lang, label: t('settings.lang.zh') },
                    { key: 'id' as Lang, label: t('settings.lang.id') },
                  ] as const
                ).map((opt) => {
                  const active = lang === opt.key;
                  return (
                    <DropdownMenuItem
                      key={opt.key}
                      onSelect={() => setLang(opt.key)}
                      className="gap-2"
                    >
                      <Check
                        className={cn(
                          'h-4 w-4',
                          active ? 'opacity-100 text-primary' : 'opacity-0',
                        )}
                      />
                      <span>{opt.label}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </SettingField>

          <SettingField
            icon={<Palette className="h-3.5 w-3.5 text-primary" />}
            label={t('settings.theme')}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span>
                    {theme === 'chocolate'
                      ? t('settings.theme.chocolate')
                      : t('settings.theme.white')}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                sideOffset={4}
                className="z-[120] w-[var(--radix-dropdown-menu-trigger-width)]"
              >
                {(
                  [
                    {
                      key: 'chocolate' as const,
                      label: t('settings.theme.chocolate'),
                    },
                    {
                      key: 'white' as const,
                      label: t('settings.theme.white'),
                    },
                  ] as const
                ).map((opt) => {
                  const active = theme === opt.key;
                  return (
                    <DropdownMenuItem
                      key={opt.key}
                      onSelect={() => setTheme(opt.key)}
                      className="gap-2"
                    >
                      <Check
                        className={cn(
                          'h-4 w-4',
                          active ? 'opacity-100 text-primary' : 'opacity-0',
                        )}
                      />
                      <span>{opt.label}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </SettingField>

          <SettingField
            icon={<Clock className="h-3.5 w-3.5 text-primary" />}
            label={t('settings.timezone')}
          >
            <TimezoneSelect />
          </SettingField>
        </div>
      </section>

    </div>
  );
}

// 타임존 드롭다운 — useTimezone 훅으로 상태 관리. COMMON_TIMEZONES 큐레이션 목록.
function TimezoneSelect() {
  const { t } = useI18n();
  const { timezone, setTimezone } = useTimezone();
  const display =
    timezone === 'auto' ? t('settings.timezone.auto') : timezone;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-full justify-between">
          <span className="truncate">{display}</span>
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className="z-[120] max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
      >
        {COMMON_TIMEZONES.map((tz) => {
          const active = timezone === tz;
          const label = tz === 'auto' ? t('settings.timezone.auto') : tz;
          return (
            <DropdownMenuItem
              key={tz}
              onSelect={() => setTimezone(tz)}
              className="gap-2"
            >
              <Check
                className={cn(
                  'h-4 w-4',
                  active ? 'opacity-100 text-primary' : 'opacity-0',
                )}
              />
              <span>{label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// 사용자 정보 — 이메일(읽기전용) + 사용자 이름(수정).
function UserInfoSection({
  user,
  onUserUpdated,
}: {
  user: AuthUser;
  onUserUpdated?: (user: AuthUser) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(user.name ?? '');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  async function saveName() {
    if (name.trim() === '') {
      setName(user.name ?? '');
      return;
    }
    if (name === (user.name ?? '')) return;
    setNameBusy(true);
    setNameSaved(false);
    try {
      const res = await fetch(`${API_URL}/auth/profile`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setNameSaved(true);
        try {
          const updated = (await res.json()) as AuthUser;
          // 부모 (ChatRoom) 의 user state 갱신 — Sidebar 프로필 영역도 즉시 반영.
          onUserUpdated?.(updated);
        } catch {
          // ignore parse error — name 변경은 저장됐고 UI 만 다음 /auth/me 때 갱신.
        }
        setTimeout(() => setNameSaved(false), 1500);
      }
    } catch {
      // ignore
    } finally {
      setNameBusy(false);
    }
  }
  return (
    <section className="flex flex-col gap-2">
      {/* 박스 밖 — General 바로 아래에 위치하는 서브 타이틀. */}
      <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
        <User className="h-3.5 w-3.5 text-primary" />
        <span>{t('settings.account.basicInfo')}</span>
      </h3>
      {/* 사각 박스 — Email ID / User Name / Save */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-secondary/30 p-4">
        <div className="grid gap-3 sm:grid-cols-[140px_1fr] sm:items-center">
          <label className="text-[12.5px] font-medium text-muted-foreground">
            {t('settings.account.emailId')}
          </label>
          <div className="text-[13px] text-foreground">{user.email}</div>

          <label className="text-[12.5px] font-medium text-muted-foreground">
            {t('settings.account.userName')}
            <span className="ml-0.5 text-destructive">*</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveName();
                }
              }}
              placeholder={t('settings.account.userNamePlaceholder')}
              maxLength={64}
              disabled={nameBusy}
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          {nameSaved && <Check className="h-4 w-4 text-emerald-500" />}
          <Button
            size="sm"
            onClick={saveName}
            disabled={
              nameBusy || name.trim() === '' || name === (user.name ?? '')
            }
          >
            {nameBusy ? t('settings.account.saving') : t('settings.account.save')}
          </Button>
        </div>
      </div>
    </section>
  );
}

// 비밀번호 변경 + Google SSO 연동.
function AccountSection({ user }: { user: AuthUser }) {
  const { t } = useI18n();
  const [pwOpen, setPwOpen] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{
    kind: 'ok' | 'err';
    text: string;
  } | null>(null);

  async function submitChangePw(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (newPw.length < 8) {
      setPwMsg({ kind: 'err', text: t('settings.account.errMinLen') });
      return;
    }
    if (newPw !== newPw2) {
      setPwMsg({ kind: 'err', text: t('settings.account.errMismatch') });
      return;
    }
    setPwBusy(true);
    try {
      const res = await fetch(`${API_URL}/auth/change-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: user.hasPassword ? curPw : undefined,
          newPassword: newPw,
        }),
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
      setPwMsg({ kind: 'ok', text: t('settings.account.success') });
      setCurPw('');
      setNewPw('');
      setNewPw2('');
      // 잠시 후 폼 닫기.
      setTimeout(() => {
        setPwOpen(false);
        setPwMsg(null);
      }, 1500);
    } catch (err) {
      setPwMsg({
        kind: 'err',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 border-b border-border/50 pb-8 last:border-b-0 last:pb-0">
      {/* 박스 밖 — Security 서브 타이틀. */}
      <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Shield className="h-3.5 w-3.5 text-primary" />
        <span>{t('settings.account.security')}</span>
      </h3>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-secondary/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            <span className="text-[13px] font-medium">{t('settings.password')}</span>
            <span
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
                user.hasPassword
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {user.hasPassword
                ? t('settings.account.statusActive')
                : t('settings.account.statusUnset')}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPwOpen((v) => !v);
              setPwMsg(null);
            }}
            className="gap-1.5"
          >
            <KeyRound className="h-3.5 w-3.5" />
            {user.hasPassword
              ? t('settings.account.changeBtn')
              : t('settings.account.setBtn')}
          </Button>
        </div>

        {pwOpen && (
          <form
            onSubmit={submitChangePw}
            className="flex flex-col gap-2 rounded-md border border-border bg-background p-3"
          >
            {user.hasPassword && (
              <input
                type="password"
                value={curPw}
                onChange={(e) => setCurPw(e.target.value)}
                placeholder={t('settings.account.currentPw')}
                autoComplete="current-password"
                required
                className="rounded-md border border-input bg-background px-3 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-ring"
              />
            )}
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder={t('settings.account.newPw')}
              autoComplete="new-password"
              required
              minLength={8}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-ring"
            />
            <input
              type="password"
              value={newPw2}
              onChange={(e) => setNewPw2(e.target.value)}
              placeholder={t('settings.account.confirmPw')}
              autoComplete="new-password"
              required
              minLength={8}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-ring"
            />
            {pwMsg && (
              <p
                className={cn(
                  'text-[12px]',
                  pwMsg.kind === 'ok' ? 'text-emerald-500' : 'text-destructive',
                )}
              >
                {pwMsg.text}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPwOpen(false);
                  setPwMsg(null);
                  setCurPw('');
                  setNewPw('');
                  setNewPw2('');
                }}
                disabled={pwBusy}
              >
                {t('settings.account.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={pwBusy}>
                {pwBusy ? t('settings.account.saving') : t('settings.account.save')}
              </Button>
            </div>
          </form>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LogIn className="h-4 w-4 text-primary" />
            <span className="text-[13px] font-medium">Google SSO</span>
            <span
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
                user.hasGoogle
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-amber-500/15 text-amber-400',
              )}
            >
              {user.hasGoogle
                ? t('settings.account.googleLinked')
                : t('settings.account.googleUnlinked')}
            </span>
          </div>
          {!user.hasGoogle && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.location.href = `${API_URL}/auth/google/link`;
              }}
            >
              {t('settings.account.linkGoogle')}
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t('settings.account.help')}
        </p>
      </div>
    </section>
  );
}

// AI 모델 섹션 — 단독 컴포넌트로 분리해 Admin > AI 탭에서 재사용.
function AiSection({
  models,
  reasoningModel,
  visionModel,
  onSelectReasoningModel,
  onSelectVisionModel,
  aiEndpoint,
  onChangeAiEndpoint,
  aiEndpointError,
  aiEndpointLoading,
}: {
  models: ModelInfo[];
  reasoningModel?: string;
  visionModel?: string;
  onSelectReasoningModel?: (name: string) => void;
  onSelectVisionModel?: (name: string) => void;
  aiEndpoint?: string;
  onChangeAiEndpoint?: (v: string) => void;
  aiEndpointError?: string | null;
  aiEndpointLoading?: boolean;
}) {
  const { t } = useI18n();
  return (
    <SettingSection
      icon={<Bot className="h-5 w-5 text-primary" />}
      title={t('settings.menu.ai')}
      description={t('settings.ai.subtitle')}
    >
      <div className="rounded-lg border border-border bg-secondary/30 p-5">
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="text-primary">
                <Server className="h-4 w-4" />
              </span>
              <span className="text-[13px] font-medium text-foreground">
                AI Endpoint
              </span>
              <span className="text-[11px] text-muted-foreground">
                · Ollama base URL
              </span>
            </div>
            <input
              type="url"
              value={aiEndpoint ?? ''}
              onChange={(e) => onChangeAiEndpoint?.(e.target.value)}
              placeholder="http://ai.example.com"
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2 text-[13px] outline-none transition-colors focus:ring-2',
                aiEndpointError
                  ? 'border-destructive ring-destructive/30 focus:ring-destructive/50'
                  : 'border-input focus:ring-ring',
              )}
              spellCheck={false}
              autoComplete="off"
            />
            {aiEndpointLoading && (
              <div className="mt-1 text-[11px] text-muted-foreground/80">
                모델 목록 새로고침 중…
              </div>
            )}
            {aiEndpointError && (
              <div className="mt-1 flex items-start gap-1 text-[11px] font-medium text-destructive">
                <span aria-hidden>⚠️</span>
                <span>모델 목록 로드 실패 — {aiEndpointError}</span>
              </div>
            )}
          </div>
          <ModelPickerRow
            icon={<Brain className="h-4 w-4" />}
            label={t('settings.ai.reasoning')}
            desc={t('settings.ai.reasoning.desc')}
            models={models}
            selected={reasoningModel}
            onSelect={onSelectReasoningModel}
          />
          <ModelPickerRow
            icon={<Eye className="h-4 w-4" />}
            label={t('settings.ai.vision')}
            desc={t('settings.ai.vision.desc')}
            models={models}
            selected={visionModel}
            onSelect={onSelectVisionModel}
          />
        </div>
      </div>

      {/* Tools — Tavily 등 외부 API 키 관리. */}
      <ToolsSubSection />
    </SettingSection>
  );
}

// AI 페이지 내 Tools 서브섹션 — 현재는 Tavily API key.
function ToolsSubSection() {
  const { t } = useI18n();
  const [apiKeySet, setApiKeySet] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/admin/tavily`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const j = (await res.json()) as { apiKeySet: boolean };
        if (!cancelled) setApiKeySet(j.apiKeySet);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    if (!apiKey.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/admin/tavily`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      if (res.ok) {
        const j = (await res.json()) as { apiKeySet: boolean };
        setApiKeySet(j.apiKeySet);
        setApiKey('');
        setSavedAt(Date.now());
        setTimeout(() => setSavedAt(null), 1500);
      }
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Wrench className="h-3.5 w-3.5 text-primary" />
        <span>{t('settings.ai.tools')}</span>
      </h3>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary/30 p-4">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-foreground">
            {t('settings.ai.tools.tavily')}
          </span>
          <span
            className={cn(
              'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
              apiKeySet
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {apiKeySet
              ? t('settings.ai.tools.set')
              : t('settings.ai.tools.notSet')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy && apiKey.trim()) save();
            }}
            placeholder={t('settings.ai.tools.placeholder')}
            autoComplete="off"
            spellCheck={false}
            className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-ring"
          />
          <Button size="sm" onClick={save} disabled={busy || !apiKey.trim()}>
            {busy ? t('settings.account.saving') : t('settings.account.save')}
          </Button>
          {savedAt && <Check className="h-4 w-4 text-emerald-500" />}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t('settings.ai.tools.tavilyDesc')}
        </p>
      </div>
    </div>
  );
}

// AdminTab/SubTabButton 은 좌측 사이드바 하위 메뉴로 통합되어 더 이상 사용하지 않음.

// 섹션 공통 헤더 + 본문 래퍼. title/description 는 좌측 컬럼처럼 보이도록 정리.
function SettingSection({
  icon,
  title,
  description,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-b border-border/50 pb-8 last:border-b-0 last:pb-0">
      <div className="flex flex-col gap-0.5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
          {icon}
          <span>{title}</span>
        </h2>
        {description && (
          <p className="text-[12.5px] text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function SettingField({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        {icon}
        <span>{label}</span>
      </label>
      {children}
    </div>
  );
}

// ─── SMTP Section (admin 전용) ──────────────────────────────────

interface SmtpConfigDto {
  host?: string;
  port?: number;
  user?: string;
  from?: string;
  secure?: boolean;
  passwordSet?: boolean;
}

function SmtpSection() {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<SmtpConfigDto | null>(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState<string>('587');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [from, setFrom] = useState('');
  const [secure, setSecure] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 테스트 발송 상태 — idle / sending / success / error.
  const [testState, setTestState] = useState<
    | { kind: 'idle' }
    | { kind: 'sending' }
    | { kind: 'success'; sentTo: string; from: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  // 초기 로드.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/admin/smtp`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SmtpConfigDto;
        if (cancelled) return;
        setCfg(data);
        setHost(data.host ?? '');
        setPort(String(data.port ?? 587));
        setUser(data.user ?? '');
        setFrom(data.from ?? '');
        setSecure(!!data.secure);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/admin/smtp`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: host.trim(),
          port: Number(port) || 587,
          user: user.trim(),
          // 빈 문자열이면 backend 가 기존 password 유지.
          password,
          from: from.trim(),
          secure,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SmtpConfigDto;
      setCfg(data);
      setPassword('');
      setSavedAt(Date.now());
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTestState({ kind: 'sending' });
    try {
      const res = await fetch(`${API_URL}/admin/smtp/test`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
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
      const j = (await res.json()) as { sentTo: string; from: string };
      setTestState({ kind: 'success', sentTo: j.sentTo, from: j.from });
      // 4 초 후 idle 로 복귀.
      setTimeout(() => {
        setTestState((cur) => (cur.kind === 'success' ? { kind: 'idle' } : cur));
      }, 4000);
    } catch (err) {
      setTestState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="mb-5 space-y-2">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
        <Mail className="h-5 w-5 text-primary" />
        <span>{t('settings.menu.smtp')}</span>
      </h2>
      <div className="space-y-2.5 rounded-lg border border-border bg-secondary/30 p-3">
        <div className="grid grid-cols-[1fr_120px] gap-2">
          <div>
            <label className="mb-1 block text-[11.5px] text-muted-foreground">
              Host
            </label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="smtp.example.com"
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] text-muted-foreground">
              Port
            </label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="587"
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11.5px] text-muted-foreground">
              User
            </label>
            <input
              type="text"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="login@example.com"
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] text-muted-foreground">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                cfg?.passwordSet ? '••••••••' : 'app password / smtp password'
              }
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
              autoComplete="new-password"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] text-muted-foreground">
            From
          </label>
          <input
            type="text"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="no-reply@example.com"
            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <label className="flex items-center gap-2 text-[12px] text-foreground">
          <input
            type="checkbox"
            checked={secure}
            onChange={(e) => setSecure(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          <span>TLS / SSL (port 465 자동 활성화)</span>
        </label>
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-[11px] text-muted-foreground">
            {error ? `오류: ${error}` : savedAt ? '저장됨' : ''}
          </span>
          <div className="flex items-center gap-2">
            {/* 테스트 결과 — 성공 시 그린 체크 + 보낸 곳, 실패 시 빨간 텍스트. */}
            {testState.kind === 'success' && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                <span aria-hidden>✅</span>
                <span>
                  {testState.from} → {testState.sentTo}
                </span>
              </span>
            )}
            {testState.kind === 'error' && (
              <span className="text-[11px] text-destructive">
                실패: {testState.message}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={sendTest}
              disabled={testState.kind === 'sending'}
            >
              {testState.kind === 'sending' ? '발송 중…' : '테스트 발송'}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={save}
              disabled={saving}
            >
              {saving ? '저장 중…' : '저장'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Members Tab ─────────────────────────────────────────────────

interface Member {
  id: string;
  email: string;
  name?: string | null;
  picture?: string | null;
  role: 'admin' | 'member';
  lastLoginAt?: string | null;
  createdAt: string;
}

interface Invitation {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'revoked';
  createdAt: string;
  acceptedAt?: string | null;
  mailError?: string;
}

const API_URL = '/api';

// HTML5 spec 와 호환되는 실용적인 이메일 정규식 (모든 RFC 5322 케이스를 커버하진 않음).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function MembersTab({ currentUserId }: { currentUserId?: string }) {
  const { t } = useI18n();
  const { formatDate } = useTimezone();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function loadAll() {
    try {
      const [m, i] = await Promise.all([
        fetch(`${API_URL}/admin/users`, { credentials: 'include' }),
        fetch(`${API_URL}/admin/invitations`, { credentials: 'include' }),
      ]);
      if (!m.ok) throw new Error(await m.text());
      if (!i.ok) throw new Error(await i.text());
      setMembers(await m.json());
      setInvitations(await i.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function invite() {
    setError(null);
    setInfo(null);
    if (!email.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/invitations`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? '초대 발송 실패');
      setEmail('');
      setInfo(
        body?.mailError
          ? `${t('settings.member.inviteSentMailFail')}: ${body.mailError}`
          : t('settings.member.inviteSent'),
      );
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function changeRole(id: string, role: 'admin' | 'member') {
    setError(null);
    // 낙관적 갱신.
    const before = members;
    setMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, role } : m)),
    );
    try {
      const res = await fetch(`${API_URL}/admin/users/${id}/role`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        let msg = t('settings.member.roleUpdateFailed');
        try {
          const j = (await res.json()) as { message?: string };
          if (j.message) msg = j.message;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }
    } catch (e) {
      // 롤백.
      setMembers(before);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function revoke(id: string) {
    if (!window.confirm(t('settings.member.revokeConfirm'))) return;
    try {
      const res = await fetch(`${API_URL}/admin/invitations/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const pending = invitations.filter((i) => i.status === 'pending');

  // 활성 멤버 + 대기 중 초대를 하나의 통합 테이블로. pending 은 lastLoginAt 없음 + 취소 버튼.
  type Row =
    | {
        kind: 'active';
        id: string;
        email: string;
        name?: string | null;
        picture?: string | null;
        role: 'admin' | 'member';
        lastLoginAt?: string | null;
        createdAt: string;
      }
    | {
        kind: 'pending';
        id: string;
        email: string;
        createdAt: string;
      };
  const rows: Row[] = [
    ...members.map(
      (m): Row => ({
        kind: 'active',
        id: m.id,
        email: m.email,
        name: m.name,
        picture: m.picture,
        role: m.role,
        lastLoginAt: m.lastLoginAt,
        createdAt: m.createdAt,
      }),
    ),
    ...pending.map(
      (p): Row => ({
        kind: 'pending',
        id: p.id,
        email: p.email,
        createdAt: p.createdAt,
      }),
    ),
  ];

  return (
    <div className="space-y-5">
      {/* 페이지 헤더 — 우측에 새 초대 입력 인라인 배치 */}
      <div className="flex items-center gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
          <Users className="h-5 w-5 text-primary" />
          <span>{t('settings.menu.member')}</span>
        </h2>
        <div className="ml-auto flex items-center gap-1.5">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loading && EMAIL_RE.test(email.trim()))
                invite();
            }}
            placeholder={t('settings.member.invitePlaceholder')}
            className="w-56 rounded-md border border-input bg-background px-2.5 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button
            size="sm"
            onClick={invite}
            disabled={loading || !EMAIL_RE.test(email.trim())}
            className="gap-1.5 h-7 px-2"
          >
            <Mail className="h-3.5 w-3.5" />
            {loading
              ? t('settings.member.inviteSending')
              : t('settings.member.inviteBtn')}
          </Button>
        </div>
      </div>

      {/* 멤버 + 대기 초대 통합 테이블 */}
      <div>
        {rows.length === 0 ? (
          <Empty>{t('settings.member.inviteEmpty')}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-3 text-left font-semibold">
                    {t('settings.member.tableName')}
                  </th>
                  <th className="py-2 pr-3 text-left font-semibold">
                    {t('settings.member.tableType')}
                  </th>
                  <th className="py-2 pr-3 text-left font-semibold">
                    {t('settings.member.tableLastLogin')}
                  </th>
                  <th className="py-2 text-right font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className="align-middle">
                    {/* 유저명 (아바타 + 이름/이메일) */}
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-[11px] font-medium">
                          {r.kind === 'active' && r.picture ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={r.picture}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : r.kind === 'active' ? (
                            (r.name ?? r.email).charAt(0).toUpperCase()
                          ) : (
                            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {r.kind === 'active'
                              ? (r.name ?? r.email)
                              : r.email}
                          </div>
                          {r.kind === 'active' && r.name && (
                            <div className="truncate text-[11px] text-muted-foreground">
                              {r.email}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* 계정 타입 — pending 은 배지, active 는 드롭다운(자기 자신은 비활성화) */}
                    <td className="py-2 pr-3">
                      {r.kind === 'pending' ? (
                        <span className="inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-400">
                          {t('settings.member.typePending')}
                        </span>
                      ) : (
                        <RoleSelect
                          value={r.role}
                          disabled={r.id === currentUserId}
                          onChange={(role) => changeRole(r.id, role)}
                          adminLabel={t('settings.member.typeAdmin')}
                          memberLabel={t('settings.member.typeMember')}
                        />
                      )}
                    </td>

                    {/* 마지막 로그인 시각 */}
                    <td className="py-2 pr-3 text-muted-foreground">
                      {r.kind === 'active' && r.lastLoginAt
                        ? formatDate(r.lastLoginAt)
                        : t('settings.member.never')}
                    </td>

                    {/* 액션 (pending 만 취소 버튼) */}
                    <td className="py-2 text-right">
                      {r.kind === 'pending' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-500 hover:bg-red-500/15"
                          onClick={() => revoke(r.id)}
                          title={t('settings.member.revokeTitle')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 초대 발송 결과 — 멤버 헤더의 인라인 초대 입력에서 발생. */}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-md border border-primary/40 bg-primary/10 p-2 text-xs text-primary">
          {info}
        </div>
      )}

    </div>
  );
}

// ─── System Tab (admin) — 서버 로그 실시간 뷰어 ──────────────────

interface LogEntry {
  ts: string;
  level: 'log' | 'error' | 'warn' | 'debug' | 'verbose';
  ctx?: string;
  msg: string;
}

function SystemTab() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    // Init: 최근 500건 일괄 로드.
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/admin/system/logs/recent`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const j = (await res.json()) as { entries: LogEntry[] };
        if (!cancelled) setEntries(j.entries ?? []);
      } catch {
        // ignore
      }
    })();

    // SSE — 새 로그 push.
    const es = new EventSource(`${API_URL}/admin/system/logs/stream`, {
      withCredentials: true,
    });
    es.onmessage = (ev) => {
      if (pausedRef.current) return;
      try {
        const e = JSON.parse(ev.data) as LogEntry;
        setEntries((prev) => {
          const next = [...prev, e];
          if (next.length > 2000) next.splice(0, next.length - 2000);
          return next;
        });
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      // 연결 끊기면 EventSource 가 자동 재연결 시도. 별도 처리 X.
    };

    return () => {
      cancelled = true;
      es.close();
    };
  }, []);

  // 새 로그 들어오면 자동 스크롤.
  useEffect(() => {
    if (!autoScroll) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries, autoScroll]);

  return (
    <div className="flex h-full max-h-[calc(85vh-7rem)] flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
          <Terminal className="h-5 w-5 text-primary" />
          <span>{t('settings.menu.system')}</span>
        </h2>
        <div className="ml-auto flex items-center gap-2 text-[12px]">
          <Button
            size="sm"
            variant={paused ? 'default' : 'outline'}
            onClick={() => setPaused((v) => !v)}
            className="h-7 px-2"
          >
            {paused ? t('settings.system.resume') : t('settings.system.pause')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEntries([])}
            className="h-7 px-2"
          >
            {t('settings.system.clear')}
          </Button>
          <label className="flex items-center gap-1 text-muted-foreground">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            {t('settings.system.autoScroll')}
          </label>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto rounded-lg border border-border bg-[#0b0f14] p-3 font-mono text-[11.5px] leading-snug text-zinc-100 shadow-[0_4px_14px_rgba(0,0,0,0.35)]"
      >
        {entries.length === 0 ? (
          <div className="text-muted-foreground">
            {t('settings.system.empty')}
          </div>
        ) : (
          entries.map((e, i) => (
            <div
              key={`${e.ts}-${i}`}
              className={cn(
                'whitespace-pre-wrap break-all',
                e.level === 'error' && 'text-red-400',
                e.level === 'warn' && 'text-amber-300',
                e.level === 'debug' && 'text-sky-300',
                e.level === 'verbose' && 'text-zinc-400',
              )}
            >
              <span className="text-zinc-500">
                {new Date(e.ts).toLocaleTimeString()}{' '}
              </span>
              <span className="font-semibold uppercase opacity-80">
                {e.level}
              </span>
              {e.ctx && (
                <span className="ml-1 text-zinc-400">[{e.ctx}]</span>
              )}{' '}
              {e.msg}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// member <-> admin role 전환 드롭다운 (DropdownMenu 기반).
function RoleSelect({
  value,
  disabled,
  onChange,
  adminLabel,
  memberLabel,
}: {
  value: 'admin' | 'member';
  disabled?: boolean;
  onChange: (role: 'admin' | 'member') => void;
  adminLabel: string;
  memberLabel: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors',
            value === 'admin'
              ? 'bg-primary/15 text-primary hover:bg-primary/25'
              : 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25',
            disabled && 'cursor-not-allowed opacity-70 hover:bg-transparent',
          )}
        >
          {value === 'admin' && <Shield className="h-3 w-3" />}
          <span>{value === 'admin' ? adminLabel : memberLabel}</span>
          {!disabled && <ChevronsUpDown className="h-3 w-3 opacity-60" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="z-[120]">
        <DropdownMenuItem
          onSelect={() => value !== 'admin' && onChange('admin')}
          className="gap-2"
        >
          <Check
            className={cn(
              'h-4 w-4',
              value === 'admin' ? 'opacity-100 text-primary' : 'opacity-0',
            )}
          />
          <Shield className="h-3.5 w-3.5" />
          <span>{adminLabel}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => value !== 'member' && onChange('member')}
          className="gap-2"
        >
          <Check
            className={cn(
              'h-4 w-4',
              value === 'member' ? 'opacity-100 text-primary' : 'opacity-0',
            )}
          />
          <span className="ml-[18px]">{memberLabel}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Section({
  icon,
  title,
  right,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        {icon}
        <span>{title}</span>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-3 text-center text-xs text-muted-foreground">{children}</p>
  );
}

// ─── Shared UI ───────────────────────────────────────────────────

function ModelPickerRow({
  icon,
  label,
  desc,
  models,
  selected,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  models: ModelInfo[];
  selected?: string;
  onSelect?: (name: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-primary">{icon}</span>
        <span className="text-[13px] font-medium text-foreground">
          {label}
        </span>
        <span className="text-[11px] text-muted-foreground">· {desc}</span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="w-full justify-between">
            <span className="truncate text-[12px]">
              {selected ?? '미설정'}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={4}
          className="z-[120] max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
        >
          {models.length === 0 && (
            <div className="px-2 py-1.5 text-[11.5px] text-muted-foreground">
              사용 가능한 모델이 없습니다
            </div>
          )}
          {models.map((m) => {
            const active = m.name === selected;
            return (
              <DropdownMenuItem
                key={m.name}
                onSelect={() => onSelect?.(m.name)}
                className="gap-2"
              >
                <Check
                  className={cn(
                    'h-4 w-4',
                    active ? 'opacity-100 text-primary' : 'opacity-0',
                  )}
                />
                <span className="flex-1 truncate text-[12.5px]">{m.name}</span>
                {m.parameterSize && (
                  <span className="shrink-0 text-[10.5px] text-muted-foreground">
                    {m.parameterSize}
                  </span>
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AiPersonSvg({
  hasReasoning,
  hasVision,
}: {
  hasReasoning: boolean;
  hasVision: boolean;
}) {
  const reasonColor = hasReasoning
    ? 'hsl(var(--primary))'
    : 'hsl(var(--muted-foreground))';
  const visionColor = hasVision
    ? 'hsl(var(--primary))'
    : 'hsl(var(--muted-foreground))';
  const reasonFill = hasReasoning ? 0.85 : 0.18;
  const visionFill = hasVision ? 0.9 : 0.3;
  const brainOpacity = hasReasoning ? 0.7 : 0.25;

  return (
    <svg
      viewBox="0 0 120 160"
      role="img"
      aria-label="AI configuration profile"
      className="h-full w-full"
    >
      <path
        d="M 38 150 L 38 130 C 38 124 42 120 52 118 L 78 118 L 78 150 Z"
        fill="hsl(var(--secondary))"
        stroke="hsl(var(--border))"
        strokeWidth="1.5"
      />
      <path
        d="
          M 70 18
          C 92 16 104 32 104 60
          C 104 86 100 102 92 116
          L 78 116
          L 70 105
          L 50 105
          C 44 105 40 102 38 98
          L 36 88
          L 30 84
          L 22 76
          L 18 68
          L 28 62
          L 28 52
          C 28 40 34 30 46 24
          C 54 19 62 18 70 18
          Z
        "
        fill={reasonColor}
        fillOpacity={reasonFill}
        stroke={reasonColor}
        strokeOpacity="0.9"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <g
        fill="none"
        stroke="hsl(var(--card))"
        strokeOpacity={brainOpacity}
        strokeWidth="1.4"
        strokeLinecap="round"
      >
        <path d="M 50 32 Q 60 28 72 32 Q 84 36 92 48" />
        <path d="M 52 44 Q 64 42 76 46 Q 86 50 92 60" />
        <path d="M 56 56 Q 68 56 80 60 Q 88 64 92 72" />
        <path d="M 62 70 Q 74 72 84 76" />
      </g>
      <ellipse
        cx="80"
        cy="64"
        rx="5"
        ry="8"
        fill={reasonColor}
        fillOpacity={reasonFill * 0.6}
        stroke={reasonColor}
        strokeOpacity="0.6"
        strokeWidth="1"
      />
      <path
        d="M 78 60 Q 82 64 78 70"
        fill="none"
        stroke="hsl(var(--card))"
        strokeOpacity="0.6"
        strokeWidth="1.1"
      />
      <g>
        <ellipse
          cx="42"
          cy="62"
          rx="6"
          ry="3.6"
          fill="hsl(var(--card))"
          stroke={visionColor}
          strokeWidth="1.8"
        />
        <circle
          cx="42"
          cy="62"
          r="2.2"
          fill={visionColor}
          fillOpacity={visionFill}
        />
        <path
          d="M 36 58 L 34 56 M 42 57 L 42 55 M 48 58 L 50 56"
          stroke={visionColor}
          strokeOpacity={hasVision ? 0.85 : 0.4}
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </g>
      <path
        d="M 32 88 Q 38 92 44 88"
        fill="none"
        stroke="hsl(var(--card))"
        strokeOpacity="0.7"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="22" cy="74" r="0.9" fill="hsl(var(--card))" opacity="0.7" />
    </svg>
  );
}
