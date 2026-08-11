export type Role = 'STUDENT' | 'TUTOR' | 'ADMIN';

export interface SelfUser {
  id: number;
  email: string;
  displayName: string;
  bio: string | null;
  roles: Role[];
  status: 'ACTIVE' | 'SUSPENDED';
  avatarUrl: string | null;
  emailVerified: boolean;
  termsAccepted: boolean;
  /** Self-declared under 18. Lessons this account arranges itself are online only. */
  isMinor: boolean;
  createdAt: string;
}

export interface Money {
  cents: number;
  currency: string;
  display: string;
}

export interface PublicUser {
  id: number;
  displayName: string;
  avatarUrl: string | null;
}

export interface AppConfig {
  appEnv: 'development' | 'demo' | 'production';
  showDemoBanner: boolean;
  demoLoginEnabled: boolean;
  demoBannerText: string;
  /** Present so the interface only asks a tutor about income when the number
   *  is actually used to calculate something. */
  commission: {
    enabled: boolean;
    ratePercent: number;
    flatCents: number;
    freeEngagements: number;
  };
}

export interface SearchResult {
  id: number;
  userId: number;
  displayName: string;
  avatarUrl: string | null;
  headline: string | null;
  country: string | null;
  city: string | null;
  deliveryMode: string;
  hourlyRate: Money | null;
  averageRating: number;
  ratingCount: number;
  subjects: string[];
  verified: boolean;
  verifications: Verification[];
}

export interface Verification {
  type: 'IDENTITY_DOCUMENT' | 'QUALIFICATION_DOCUMENT' | 'EMAIL_CONFIRMED';
  label: string;
  checkedAt: string;
  expiresAt: string | null;
}

export interface PageMeta { total: number; page: number; pageSize: number; totalPages: number; }
