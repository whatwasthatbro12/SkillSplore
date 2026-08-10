// Central source of truth for what SkillSplore does and does not check.
//
// This is the single most important thing on the site to get right and keep
// consistent. SkillSplore does not verify identity, qualifications, police
// records or right to work, and has no capacity to. Everything on a profile is
// supplied by the person themselves.
//
// The risk is not saying too little -- it is implying too much. A platform
// that lists people, moderates listings and shows a "Trust" panel reads as
// though it has vetted them, even with no explicit claim anywhere. A reader
// who books someone because the site felt official is exactly the harm these
// strings exist to prevent, and exactly the liability the company cannot
// afford.
//
// Rules for editing this file:
//   - Never add a word implying a check that does not happen ("verified",
//     "approved", "trusted", "screened", "background-checked").
//   - "Approved" refers to a listing passing content moderation. It says
//     nothing about the person, so never use it near their credentials.
//   - If a real check is ever introduced, name it specifically and date it --
//     "Photo ID checked, March 2027" -- never a generic badge.

/** The core statement. Short enough to sit next to a button. */
export const NO_VERIFICATION_SHORT =
  'SkillSplore does not verify identity or qualifications.';

/** For the point of decision -- contacting or booking someone. */
export const DUE_DILIGENCE_NOTICE =
  `${NO_VERIFICATION_SHORT} Anything on this profile is stated by the person themselves. `
  + 'Please check whatever matters to you — qualifications, insurance, references — directly '
  + 'with them before arranging lessons.';

/** For the qualifications block, where the claims actually appear. */
export const QUALIFICATIONS_UNCHECKED =
  'Supplied by this person. SkillSplore has not checked these — please confirm anything '
  + 'that matters to you directly with them.';

/** For tutors, on the form where they enter their own credentials. */
export const CREDENTIALS_SELF_DECLARED =
  'Share whatever helps someone decide — degrees, certificates, registrations, years of '
  + 'practice. These are shown as your own statements, not as anything SkillSplore has '
  + 'checked. Describe them accurately: misrepresenting a qualification is grounds for '
  + 'removal, and may be an offence.';

/** Explains what admin approval of a listing does and does not mean. */
export const APPROVAL_MEANS =
  'Listings are reviewed before they appear, for content and for the platform rules. That '
  + 'review does not confirm anyone’s identity, qualifications or suitability.';
