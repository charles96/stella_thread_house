// /dashboard — 루트 ChatRoom 을 그대로 렌더. ChatRoom 이 pathname 을 보고
// view='dashboard' 로 전환한다. 별도 페이지를 만든 이유는 URL bookmark / refresh 호환성.
import ChatRoom from '../components/ChatRoom';

export default function DashboardPage() {
  return <ChatRoom />;
}
