import { Prisma, type Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest } from '../../lib/errors.js';
import { money, publicUser } from '../../lib/serializers.js';
import { activeVerifications } from '../../lib/verification.js';

// Ensures the user has a tutor profile to work on and holds the TUTOR role.
export async function getOrCreateProfile(userId: number) {
  const existing = await prisma.tutorProfile.findUnique({ where: { userId } });
  if (existing) return existing;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const roles: Role[] = user.roles.includes('TUTOR') ? user.roles : [...user.roles, 'TUTOR'];

  const [, profile] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { roles } }),
    prisma.tutorProfile.create({ data: { userId, status: 'DRAFT' } }),
  ]);
  return profile;
}

export const fullProfileInclude = {
  user: true,
  subjects: { include: { subject: { include: { category: true } } } },
  levels: { orderBy: { sortOrder: 'asc' } },
  availability: { orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] },
  qualifications: { orderBy: { createdAt: 'asc' } },
  verifications: { orderBy: { checkedAt: 'desc' } },
} satisfies Prisma.TutorProfileInclude;

type FullProfile = Prisma.TutorProfileGetPayload<{ include: typeof fullProfileInclude }>;

// Owner-facing view: includes private document links + editable state.
export function serializeOwnProfile(p: FullProfile) {
  return {
    id: p.id,
    status: p.status,
    headline: p.headline,
    experience: p.experience,
    teachingStyle: p.teachingStyle,
    deliveryMode: p.deliveryMode,
    country: p.country,
    city: p.city,
    locationNote: p.locationNote,
    travelRadiusKm: p.travelRadiusKm,
    availabilityNote: p.availabilityNote,
    hourlyRate: money(p.hourlyRateCents, p.currency),
    hourlyRateCents: p.hourlyRateCents,
    currency: p.currency,
    yearsExperience: p.yearsExperience,
    changeRequestNote: p.changeRequestNote,
    averageRating: p.averageRating,
    ratingCount: p.ratingCount,
    submittedAt: p.submittedAt,
    approvedAt: p.approvedAt,
    subjects: p.subjects.map((s) => ({
      subjectId: s.subjectId,
      name: s.subject.name,
      category: s.subject.category?.name ?? null,
      priceCents: s.priceCents,
      price: money(s.priceCents ?? p.hourlyRateCents, p.currency),
    })),
    levels: p.levels.map((l) => ({ id: l.id, name: l.name })),
    availability: p.availability.map((a) => ({
      dayOfWeek: a.dayOfWeek,
      startMinute: a.startMinute,
      endMinute: a.endMinute,
    })),
    qualifications: p.qualifications.map((q) => ({
      id: q.id,
      title: q.title,
      institution: q.institution,
      year: q.year,
      documentName: q.documentName,
      hasDocument: !!q.documentKey,
      documentUrl: q.documentKey ? `/api/files/qualification/${q.id}` : null,
      verified: !!q.verifiedAt,
    })),
    verifications: activeVerifications(p.verifications),
  };
}

// Public view: safe for anyone. Never exposes document keys or private notes.
export async function serializePublicProfile(p: FullProfile) {
  const [completedEngagements, reviews] = await Promise.all([
    prisma.engagement.count({ where: { tutorProfileId: p.id, status: 'COMPLETED' } }),
    prisma.review.findMany({
      where: { tutorProfileId: p.id, status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { student: { select: { id: true, displayName: true, avatarKey: true } } },
    }),
  ]);
  const verifiedQualifications = p.qualifications.filter((q) => q.verifiedAt).length;

  return {
    id: p.id,
    userId: p.user.id,
    displayName: p.user.displayName,
    avatarUrl: publicUser(p.user).avatarUrl,
    headline: p.headline,
    experience: p.experience,
    teachingStyle: p.teachingStyle,
    deliveryMode: p.deliveryMode,
    country: p.country,
    city: p.city,
    locationNote: p.locationNote,
    travelRadiusKm: p.travelRadiusKm,
    availabilityNote: p.availabilityNote,
    yearsExperience: p.yearsExperience,
    currency: p.currency,
    hourlyRate: money(p.hourlyRateCents, p.currency),
    status: p.status,
    averageRating: p.averageRating,
    ratingCount: p.ratingCount,
    subjects: p.subjects.map((s) => ({
      subjectId: s.subjectId,
      name: s.subject.name,
      category: s.subject.category?.name ?? null,
      price: money(s.priceCents ?? p.hourlyRateCents, p.currency),
    })),
    levels: p.levels.map((l) => ({ id: l.id, name: l.name })),
    availability: p.availability.map((a) => ({
      dayOfWeek: a.dayOfWeek,
      startMinute: a.startMinute,
      endMinute: a.endMinute,
    })),
    // Public sees that a qualification exists and whether it is verified —
    // never the underlying private document.
    qualifications: p.qualifications.map((q) => ({
      id: q.id,
      title: q.title,
      institution: q.institution,
      year: q.year,
      verified: !!q.verifiedAt,
    })),
    // Named, specific checks -- e.g. "Qualification document checked" with a
    // date -- never a generic "Verified" claim. This is the actual trust
    // signal shown on the profile; verifiedQualifications below is a count
    // kept for backward compatibility.
    verifications: activeVerifications(p.verifications),
    trustIndicators: {
      verifiedQualifications,
      completedEngagements,
      reviewCount: p.ratingCount,
      memberSince: p.user.createdAt,
    },
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      categoryRatings: r.categoryRatings,
      createdAt: r.createdAt,
      student: publicUser(r.student),
      tutorResponse: r.tutorResponse,
      tutorRespondedAt: r.tutorRespondedAt,
    })),
  };
}

// Enforces a minimum complete profile before it can be submitted for review.
type LevelTrack = 'ACADEMIC' | 'PROFESSIONAL';

/**
 * Which level vocabularies this profile's subjects actually use.
 *
 * Levels are stored per profile, not per subject, so a tutor who teaches both
 * NCEA calculus and SEO needs both ladders offered to them. Returning the union
 * is what makes that work; picking one track per profile would force them to
 * mis-describe half of what they teach.
 *
 * Empty when no subjects are chosen yet -- the caller decides what that means,
 * because "you have not got there yet" and "this subject needs no levels" are
 * different situations.
 */
export function applicableLevelTracks(
  // category is nullable: a subject can be archived out of its category and
  // still be attached to a profile. Such a subject contributes no tracks
  // rather than defaulting to one, so it cannot silently reintroduce the
  // school ladder for a professional profile.
  subjects: Array<{ subject: { category: { levelTracks: LevelTrack[] } | null } }>,
): LevelTrack[] {
  const tracks = new Set<LevelTrack>();
  for (const s of subjects) for (const t of s.subject.category?.levelTracks ?? []) tracks.add(t);
  // Academic first, matching the order levels are displayed in.
  return (['ACADEMIC', 'PROFESSIONAL'] as const).filter((t) => tracks.has(t));
}

export function assertSubmittable(p: FullProfile): void {
  const problems: string[] = [];
  if (!p.headline?.trim()) problems.push('Add a headline.');
  if (!p.experience?.trim()) problems.push('Describe your experience.');
  if (!p.teachingStyle?.trim()) problems.push('Describe your teaching style.');
  if (p.subjects.length === 0) problems.push('Add at least one subject.');
  if (p.levels.length === 0) {
    // Worded for the ladder they were actually shown. "Add at least one
    // teaching level" reads as a demand for a school year to someone teaching
    // welding, which is how the NCEA-only list went unnoticed for so long.
    const tracks = applicableLevelTracks(p.subjects);
    const onlyProfessional = tracks.length === 1 && tracks[0] === 'PROFESSIONAL';
    problems.push(
      onlyProfessional
        ? 'Add at least one experience level you teach.'
        : 'Add at least one level you teach.',
    );
  }
  // Deliberately NOT rejecting levels from a track the subjects do not use.
  // Every tutor who signed up before this split had only the academic list to
  // choose from, so enforcing a match would make their existing profile
  // unsubmittable the next time they edited it -- punishing them for a
  // limitation that was ours.
  if (p.hourlyRateCents == null) problems.push('Set your default hourly rate.');
  // Country is required of everyone, including online-only tutors anywhere in
  // the world. Teaching online is deliberately unrestricted by location -- but
  // a learner deciding whether to message someone needs to know which country
  // they are in, because that is what decides whether a lesson time is
  // plausible for both of them. A profile with no country reads as evasive
  // rather than global.
  if (!p.country) problems.push('Add the country you are in.');

  // City is only needed for in-person, where a learner has to physically get
  // there. Asking an online tutor for their city collects a more precise
  // location than the service has any use for.
  if ((p.deliveryMode === 'IN_PERSON' || p.deliveryMode === 'BOTH') && !p.city) {
    problems.push('Add your city for in-person lessons.');
  }
  if (problems.length > 0) {
    throw badRequest('Your profile is not ready to submit yet.', { problems });
  }
}

export async function loadFullProfileByUser(userId: number): Promise<FullProfile | null> {
  return prisma.tutorProfile.findUnique({ where: { userId }, include: fullProfileInclude });
}
