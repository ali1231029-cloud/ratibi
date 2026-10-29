import { Link } from 'react-router-dom';
import { MORE } from '../components/Layout';

export default function More() {
  return (
    <div>
      <div className="page-head"><h1>المزيد</h1></div>
      <div className="more-grid">
        {MORE.map((m) => (
          <Link key={m.to} to={m.to}>
            <span className="ico">{m.icon}</span>
            {m.label}
            <small>{m.hint}</small>
          </Link>
        ))}
      </div>
    </div>
  );
}
