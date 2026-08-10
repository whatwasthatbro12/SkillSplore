import { NavLink } from 'react-router-dom';

const LINKS: Array<[string, string]> = [
  ['/admin', 'Overview'],
  ['/admin/applications', 'Applications'],
  ['/admin/requests', 'Requests'],
  ['/admin/users', 'Users'],
  ['/admin/reports', 'Reports'],
  ['/admin/reviews', 'Reviews'],
  ['/admin/taxonomy', 'Taxonomy'],
  ['/admin/subject-suggestions', 'Suggestions'],
  ['/admin/feedback', 'Feedback'],
  ['/admin/legal', 'Legal'],
  ['/admin/privacy-requests', 'Privacy'],
  ['/admin/audit', 'Audit log'],
];

// Optional external link to the separate, self-hostable marketing agent
// (apps/marketing-agent — its own service, own database, own login; see
// docs/marketing-agent/ARCHITECTURE.md). This is the ONLY reference to that
// service anywhere in the marketplace codebase: a plain link, no shared
// auth, no API call, no build-time dependency. Hidden entirely when
// VITE_MARKETING_AGENT_URL isn't set, so an installation that never deploys
// the marketing agent sees nothing different here.
const MARKETING_AGENT_URL = import.meta.env.VITE_MARKETING_AGENT_URL as string | undefined;

export function AdminNav() {
  return (
    <nav className="row-wrap" style={{ marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
      {LINKS.map(([to, label]) => (
        <NavLink key={to} to={to} end={to === '/admin'} className="nav-link">{label}</NavLink>
      ))}
      {MARKETING_AGENT_URL && (
        <a href={MARKETING_AGENT_URL} target="_blank" rel="noreferrer" className="nav-link">
          Marketing ↗
        </a>
      )}
    </nav>
  );
}
