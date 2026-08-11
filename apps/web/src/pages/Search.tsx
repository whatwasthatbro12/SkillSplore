import { useEffect, useMemo, useState } from 'react';
import { COUNTRY_OPTIONS } from '../lib/countries.js';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/useApi.js';
import type { PageMeta, SearchResult } from '../lib/types.js';
import { Link } from 'react-router-dom';
import { TutorCard } from '../components/TutorCard.js';
import { EmptyState, Field, Input, Select, Spinner, Button } from '../components/ui.js';

interface Category { id: number; name: string; subjects: Array<{ id: number; name: string }> }
interface Level { id: number; name: string }

export function Search() {
  const [urlParams] = useSearchParams();
  const [filters, setFilters] = useState({
    q: urlParams.get('q') ?? '',
    subjectId: urlParams.get('subjectId') ?? '',
    categoryId: urlParams.get('categoryId') ?? '',
    levelId: '',
    country: '',
    city: '',
    mode: '',
    maxPrice: '',
    availableOnly: false,
    sort: 'relevance',
    page: 1,
  });

  const { data: tax } = useApi<{ categories: Category[] }>('/taxonomy/categories');
  const { data: levelData } = useApi<{ levels: Level[] }>('/taxonomy/levels');

  const path = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.q) p.set('q', filters.q);
    if (filters.subjectId) p.set('subjectId', filters.subjectId);
    if (filters.categoryId) p.set('categoryId', filters.categoryId);
    if (filters.levelId) p.set('levelId', filters.levelId);
    if (filters.country) p.set('country', filters.country);
    if (filters.city) p.set('city', filters.city);
    if (filters.mode) p.set('mode', filters.mode);
    if (filters.maxPrice) p.set('maxPrice', String(Math.round(Number(filters.maxPrice) * 100)));
    if (filters.availableOnly) p.set('availableOnly', '1');
    p.set('sort', filters.sort);
    p.set('page', String(filters.page));
    return `/search?${p.toString()}`;
  }, [filters]);

  const { data, loading } = useApi<{ results: SearchResult[]; meta: PageMeta }>(path);

  // Reset to page 1 when a filter (other than page) changes.
  useEffect(() => {
    setFilters((f) => (f.page === 1 ? f : { ...f, page: 1 }));
  }, [filters.q, filters.subjectId, filters.categoryId, filters.levelId, filters.country, filters.city, filters.mode, filters.maxPrice, filters.availableOnly, filters.sort]);

  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch }));

  const activeCategory = tax?.categories.find((c) => String(c.id) === filters.categoryId);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '270px 1fr', gap: 24, alignItems: 'start' }} className="search-layout">
      <aside className="card">
        <div className="card-body">
          <h3 className="mt-0">Filters</h3>
          <Field label="Keyword"><Input value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="Subject, name…" /></Field>
          <Field label="Category">
            <Select value={filters.categoryId} onChange={(e) => set({ categoryId: e.target.value, subjectId: '' })}>
              <option value="">Any category</option>
              {tax?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Subject">
            <Select value={filters.subjectId} onChange={(e) => set({ subjectId: e.target.value })}>
              <option value="">Any subject</option>
              {(activeCategory ? [activeCategory] : tax?.categories ?? []).map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {c.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="Level">
            <Select value={filters.levelId} onChange={(e) => set({ levelId: e.target.value })}>
              <option value="">Any level</option>
              {levelData?.levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="Format">
            <Select value={filters.mode} onChange={(e) => set({ mode: e.target.value })}>
              <option value="">Online or in person</option>
              <option value="online">Online</option>
              <option value="in_person">In person</option>
            </Select>
          </Field>
          <Field label="Country">
            <Select value={filters.country} onChange={(e) => set({ country: e.target.value })}>
              <option value="">Any country</option>
              {COUNTRY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="City"><Input value={filters.city} onChange={(e) => set({ city: e.target.value })} placeholder="e.g. Auckland" /></Field>
          <Field label="Max price / hour"><Input type="number" min={0} value={filters.maxPrice} onChange={(e) => set({ maxPrice: e.target.value })} placeholder="Any" /></Field>
          <label className="check" style={{ marginBottom: 12 }}>
            <input type="checkbox" checked={filters.availableOnly} onChange={(e) => set({ availableOnly: e.target.checked })} />
            <span>Has availability listed</span>
          </label>
          <Button className="btn-block" onClick={() => setFilters({ q: '', subjectId: '', categoryId: '', levelId: '', country: '', city: '', mode: '', maxPrice: '', availableOnly: false, sort: 'relevance', page: 1 })}>Clear filters</Button>
        </div>
      </aside>

      <div>
        <div className="section-title">
          <h2 className="mt-0">{data ? `${data.meta.total} ${data.meta.total === 1 ? 'person' : 'people'}` : 'People'}{activeCategory ? ` in ${activeCategory.name}` : ''}</h2>
          <Select aria-label="Sort results by" value={filters.sort} onChange={(e) => set({ sort: e.target.value })} style={{ width: 'auto' }}>
            <option value="relevance">Most relevant</option>
            <option value="rating">Highest rated</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="newest">Newest</option>
          </Select>
        </div>

        {loading ? <Spinner /> : !data || data.results.length === 0 ? (
          <EmptyState emoji="🔍" title="Couldn't find the right person?">
            Try widening your search or clearing filters, or{' '}
            <Link to="/requests/new">post what you want to learn</Link> and let people respond.
          </EmptyState>
        ) : (
          <>
            <div className="grid grid-cards">{data.results.map((t) => <TutorCard key={t.id} t={t} />)}</div>
            {data.meta.totalPages > 1 && (
              <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
                <Button disabled={filters.page <= 1} onClick={() => set({ page: filters.page - 1 })}>← Prev</Button>
                <span className="muted">Page {data.meta.page} of {data.meta.totalPages}</span>
                <Button disabled={filters.page >= data.meta.totalPages} onClick={() => set({ page: filters.page + 1 })}>Next →</Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
