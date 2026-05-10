// /settings — 루트 ChatRoom 을 그대로 렌더. ChatRoom 이 pathname='/settings' 를
// 감지해 settings 모달을 자동으로 연다. URL 직접 진입 / refresh 시에도 동일 동작.
import ChatRoom from '../components/ChatRoom';

export default function SettingsPage() {
  return <ChatRoom />;
}
