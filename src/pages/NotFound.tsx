import { Link } from 'react-router';
import { EmptyState } from '../components/ui';

export function NotFound() {
  return (
    <div className="card">
      <EmptyState title="找不到這個頁面" action={<Link className="btn" to="/">回到首頁</Link>}>
        連結可能有誤，或該課綱代碼不存在。
      </EmptyState>
    </div>
  );
}
