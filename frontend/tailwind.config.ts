import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem' },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
        },
        bubble: {
          bot: 'hsl(var(--bubble-bot))',
          'bot-foreground': 'hsl(var(--bubble-bot-foreground))',
          user: 'hsl(var(--bubble-user))',
          'user-foreground': 'hsl(var(--bubble-user-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'caret-blink': {
          '0%,70%,100%': { opacity: '1' },
          '20%,50%': { opacity: '0' },
        },
        // 포커 카드가 로딩 완료 직후 팝콘 터지듯 살짝 위로 튀어 올랐다가 제자리로 돌아오는 모션.
        // transform 은 부모의 회전/translateY 와 합성되므로 여기선 scale 만 사용해 충돌 방지.
        'card-pop': {
          '0%': { transform: 'scale(0.95)', opacity: '0.6' },
          '40%': { transform: 'scale(1.08)', opacity: '1' },
          '70%': { transform: 'scale(0.98)' },
          '100%': { transform: 'scale(1)' },
        },
        // 사이드바 항목이 위로 접히며 사라지는 모션(unpin 등) — 높이/패딩/마진을 0 으로 줄여
        // 아래 항목들이 자연스럽게 당겨 올라오게. overflow-hidden 과 함께 사용.
        'collapse-up': {
          '0%': { maxHeight: '3.5rem', opacity: '1' },
          '70%': { opacity: '0' },
          '100%': {
            maxHeight: '0px',
            opacity: '0',
            paddingTop: '0',
            paddingBottom: '0',
            marginTop: '0',
            marginBottom: '0',
          },
        },
        // collapse-up 의 역방향 — 항목이 0 에서 펼쳐지며 등장(pin 추가). 패딩/마진은
        // 100% 에서 미지정 → 브라우저가 자연값으로 복원(implicit keyframe)하므로 breakpoint 정확.
        'expand-down': {
          '0%': {
            maxHeight: '0px',
            opacity: '0',
            paddingTop: '0',
            paddingBottom: '0',
            marginTop: '0',
            marginBottom: '0',
          },
          '30%': { opacity: '0' },
          '100%': { maxHeight: '3.5rem', opacity: '1' },
        },
        // Reference documents 행이 검색 중 한 줄씩 도착할 때 — 높이를 0 에서 펼치고
        // 살짝 위에서 내려앉으며 페이드인. 행이 쌓이면서 References 라운드가 자연스럽게 확장됨.
        // (단일 라인 행이라 maxHeight 상한은 넉넉히, 실제 높이는 컨텐츠에 맞춰 멈춤)
        'ref-row-in': {
          '0%': { maxHeight: '0px', opacity: '0', transform: 'translateY(-3px)' },
          '30%': { opacity: '0' },
          '100%': { maxHeight: '2.25rem', opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'caret-blink': 'caret-blink 1.25s ease-out infinite',
        'card-pop': 'card-pop 480ms cubic-bezier(0.34, 1.56, 0.64, 1) 1',
        'collapse-up': 'collapse-up 280ms cubic-bezier(0.4, 0, 0.2, 1) forwards',
        'expand-down': 'expand-down 280ms cubic-bezier(0.4, 0, 0.2, 1)',
        'ref-row-in': 'ref-row-in 380ms cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
