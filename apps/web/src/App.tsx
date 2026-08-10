import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './lib/auth.js';
import { Layout } from './components/Layout.js';
import { Spinner } from './components/ui.js';

import { Home } from './pages/Home.js';
import { Search } from './pages/Search.js';
import { TutorProfile } from './pages/TutorProfile.js';
import { Login } from './pages/Login.js';
import { Register } from './pages/Register.js';
import { VerifyEmail } from './pages/VerifyEmail.js';
import { ForgotPassword } from './pages/ForgotPassword.js';
import { ResetPassword } from './pages/ResetPassword.js';
import { Dashboard } from './pages/Dashboard.js';
import { Account } from './pages/Account.js';
import { Onboarding } from './pages/tutor/Onboarding.js';
import { RequestFeed } from './pages/tutor/RequestFeed.js';
import { MyResponses } from './pages/tutor/MyResponses.js';
import { MyRequests } from './pages/requests/MyRequests.js';
import { CreateRequest } from './pages/requests/CreateRequest.js';
import { RequestDetail } from './pages/requests/RequestDetail.js';
import { Messages } from './pages/Messages.js';
import { Engagements } from './pages/Engagements.js';
import { Notifications } from './pages/Notifications.js';
import { AdminDashboard } from './pages/admin/AdminDashboard.js';
import { Applications } from './pages/admin/Applications.js';
import { ApplicationDetail } from './pages/admin/ApplicationDetail.js';
import { AdminUsers } from './pages/admin/AdminUsers.js';
import { AdminReports } from './pages/admin/AdminReports.js';
import { ReportDetail } from './pages/admin/ReportDetail.js';
import { AdminReviews } from './pages/admin/AdminReviews.js';
import { AdminRequests } from './pages/admin/AdminRequests.js';
import { AdminTaxonomy } from './pages/admin/AdminTaxonomy.js';
import { AdminSubjectSuggestions } from './pages/admin/AdminSubjectSuggestions.js';
import { AdminFeedback } from './pages/admin/AdminFeedback.js';
import { AdminLegal } from './pages/admin/AdminLegal.js';
import { AdminPrivacyRequests } from './pages/admin/AdminPrivacyRequests.js';
import { AdminAudit } from './pages/admin/AdminAudit.js';
import { PolicyPage } from './pages/legal/PolicyPage.js';
import { PrivacyRequest } from './pages/legal/PrivacyRequest.js';
import { Contact } from './pages/legal/Contact.js';
import { Categories } from './pages/Categories.js';
import { NotFound } from './pages/NotFound.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { About } from './pages/About.js';

function RequireAuth({ children, role }: { children: ReactNode; role?: 'TUTOR' | 'ADMIN' }) {
  const { user, loading, hasRole } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (role && !hasRole(role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export function App() {
  const { loading } = useAuth();
  if (loading) {
    return <Layout><Spinner /></Layout>;
  }
  return (
    <Layout>
      {/* Inside Layout, not around it: a crashing page should still leave the
          header, footer and feedback button usable so the user can navigate
          away or report it, rather than blanking the entire app. */}
      <ErrorBoundary>
          <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/tutors/:id" element={<TutorProfile />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/terms" element={<PolicyPage path="terms" />} />
          <Route path="/privacy" element={<PolicyPage path="privacy" />} />
          <Route path="/community-guidelines" element={<PolicyPage path="community-guidelines" />} />
          <Route path="/prohibited-services" element={<PolicyPage path="prohibited-services" />} />
          <Route path="/cookies" element={<PolicyPage path="cookies" />} />
          <Route path="/subprocessors" element={<PolicyPage path="subprocessors" />} />
          <Route path="/privacy-request" element={<PrivacyRequest />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/about" element={<About />} />
          <Route path="/safety" element={<PolicyPage path="safety" />} />

          <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
          <Route path="/tutor/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
          <Route path="/tutor/feed" element={<RequireAuth role="TUTOR"><RequestFeed /></RequireAuth>} />
          <Route path="/tutor/responses" element={<RequireAuth role="TUTOR"><MyResponses /></RequireAuth>} />

          <Route path="/requests" element={<RequireAuth><MyRequests /></RequireAuth>} />
          <Route path="/requests/new" element={<RequireAuth><CreateRequest /></RequireAuth>} />
          <Route path="/requests/:id" element={<RequireAuth><RequestDetail /></RequireAuth>} />

          <Route path="/messages" element={<RequireAuth><Messages /></RequireAuth>} />
          <Route path="/messages/:id" element={<RequireAuth><Messages /></RequireAuth>} />
          <Route path="/engagements" element={<RequireAuth><Engagements /></RequireAuth>} />
          <Route path="/notifications" element={<RequireAuth><Notifications /></RequireAuth>} />

          <Route path="/admin" element={<RequireAuth role="ADMIN"><AdminDashboard /></RequireAuth>} />
          <Route path="/admin/applications" element={<RequireAuth role="ADMIN"><Applications /></RequireAuth>} />
          <Route path="/admin/applications/:id" element={<RequireAuth role="ADMIN"><ApplicationDetail /></RequireAuth>} />
          <Route path="/admin/users" element={<RequireAuth role="ADMIN"><AdminUsers /></RequireAuth>} />
          <Route path="/admin/reports" element={<RequireAuth role="ADMIN"><AdminReports /></RequireAuth>} />
          <Route path="/admin/reports/:id" element={<RequireAuth role="ADMIN"><ReportDetail /></RequireAuth>} />
          <Route path="/admin/reviews" element={<RequireAuth role="ADMIN"><AdminReviews /></RequireAuth>} />
          <Route path="/admin/requests" element={<RequireAuth role="ADMIN"><AdminRequests /></RequireAuth>} />
          <Route path="/admin/taxonomy" element={<RequireAuth role="ADMIN"><AdminTaxonomy /></RequireAuth>} />
          <Route path="/admin/subject-suggestions" element={<RequireAuth role="ADMIN"><AdminSubjectSuggestions /></RequireAuth>} />
          <Route path="/admin/feedback" element={<RequireAuth role="ADMIN"><AdminFeedback /></RequireAuth>} />
          <Route path="/admin/legal" element={<RequireAuth role="ADMIN"><AdminLegal /></RequireAuth>} />
          <Route path="/admin/privacy-requests" element={<RequireAuth role="ADMIN"><AdminPrivacyRequests /></RequireAuth>} />
          <Route path="/admin/audit" element={<RequireAuth role="ADMIN"><AdminAudit /></RequireAuth>} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </ErrorBoundary>
    </Layout>
  );
}
