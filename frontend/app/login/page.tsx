'use client';

import { useRouter } from 'next/navigation';
import LoginScreen from '../components/LoginScreen';

export default function LoginPage() {
  const router = useRouter();
  return <LoginScreen onLogin={() => router.replace('/')} />;
}
