import { useState } from 'react';
import { api, ApiError } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { AdminNav } from '../../components/AdminNav.js';
import { Alert, Badge, Button, EmptyState, Spinner } from '../../components/ui.js';
import { dateStr } from '../../lib/format.js';
import { useToast } from '../../lib/toast.js';

/**
 * Bring a policy version into force.
 *
 * The publish function existed from the start but was callable only from a
 * shell with DATABASE_URL, which this deployment does not have. So no policy
 * had ever been published: the live Privacy Policy and Terms carried a
 * permanent "Draft — not yet in force" banner, and readers (and crawlers) saw
 * [[EFFECTIVE_DATE]] on the page.
 *
 * Shows every version rather than just the newest, because the point of the
 * append-only version history is being able to see what was in force when --
 * a screen that only offered "publish latest" would hide exactly that.
 */
interface Version {
  id: number;
  version: string;
  publishedAt: string | null;
  effectiveAt: string | null;
  legalReviewedAt: string | null;
  legalReviewedBy: string | null;
  blockedBy: string[];
  isCurrent: boolean;
  createdAt: string;
}
interface Doc {
  id: number;
  slug: string;
  title: string;
  path: string | null;
  retired: boolean;
  currentVersionId: number | null;
  versions: Version[];
}

export function AdminLegal() {
  const toast = useToast();
  const { data, loading, reload } = useApi<{ documents: Doc[] }>('/admin/legal');
  const [busy, setBusy] = useState<number | null>(null);

  const publish = async (doc: Doc, version: Version) => {
    // Bringing a policy into force is not undoable from here -- a later
    // version can supersede it, but the record that this one was live stands.
    if (!window.confirm(
      `Publish "${doc.title}" version ${version.version}?\n\n`
      + 'This makes it the policy in force and removes the draft banner from '
      + `${doc.path ?? 'the public page'}.`,
    )) return;

    setBusy(version.id);
    try {
      await api.post(`/admin/legal/versions/${version.id}/publish`, {});
      toast(`${doc.title} published`, 'success');
      reload();
    } catch (e) {
      // The placeholder gate reports what is still missing, so show that
      // rather than a generic failure.
      const detail = e instanceof ApiError && Array.isArray((e.details as { placeholders?: string[] })?.placeholders)
        ? ` Missing: ${((e.details as { placeholders: string[] }).placeholders).join(', ')}`
        : '';
      toast((e instanceof ApiError ? e.message : 'Failed to publish') + detail, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Spinner />;
  const docs = data?.documents ?? [];

  return (
    <div className="stack">
      <AdminNav />
      <h1 className="mt-0">Legal documents</h1>
      <Alert type="info">
        Publishing marks a version as the policy in force and removes the draft banner from its
        public page. It does not mean a lawyer has reviewed it — that is recorded separately.
      </Alert>

      {docs.length === 0 ? (
        <EmptyState emoji="📄" title="No documents synced yet">
          They are created on boot from the source files.
        </EmptyState>
      ) : docs.map((doc) => (
        <div key={doc.id} className="card"><div className="card-body">
          <div className="spread">
            <h3 className="mt-0" style={{ marginBottom: 0 }}>{doc.title}</h3>
            {doc.retired
              ? <Badge>Retired</Badge>
              : doc.currentVersionId
                ? <Badge variant="success">Published</Badge>
                : <Badge variant="warning">Never published</Badge>}
          </div>
          {doc.path
            ? <p className="hint" style={{ marginTop: 4 }}><a href={doc.path}>{doc.path}</a></p>
            : <p className="hint" style={{ marginTop: 4 }}>
                No longer part of the site. Kept because acceptances reference it.
              </p>}

          <table className="table"><tbody>
            {doc.versions.map((v) => (
              <tr key={v.id}>
                <td>
                  <strong>{v.version}</strong>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    created {dateStr(v.createdAt)}
                    {v.effectiveAt && ` · in force from ${dateStr(v.effectiveAt)}`}
                  </div>
                  {v.blockedBy.length > 0 && (
                    <div className="field-error">
                      Cannot publish — details still to fill in: {v.blockedBy.join(', ')}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {v.isCurrent
                    ? <Badge variant="success">In force</Badge>
                    : (
                      <Button
                        className="btn-sm"
                        variant="primary"
                        loading={busy === v.id}
                        disabled={v.blockedBy.length > 0 || doc.retired}
                        onClick={() => publish(doc, v)}
                      >
                        Publish
                      </Button>
                    )}
                </td>
              </tr>
            ))}
          </tbody></table>
        </div></div>
      ))}
    </div>
  );
}
