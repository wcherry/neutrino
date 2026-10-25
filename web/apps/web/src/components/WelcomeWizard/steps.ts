/**
 * The welcome wizard's steps, and the rules for what the list beside them says about each.
 *
 * Kept free of React so the rules — which steps there are, when Back and Next are available, what
 * counts as skipped — can be tested on their own.
 */

export type StepId = 'key' | 'look' | 'profile' | 'ai' | 'calendar' | 'files' | 'invite';

export interface StepDef {
  id: StepId;
  /** The name in the list on the left. */
  label: string;
  /** The heading over the step's body. */
  heading: string;
  intro: string;
  /** Where the step's settings live once the wizard is gone. */
  footnote: string;
}

export const STEPS: readonly StepDef[] = [
  {
    id: 'key',
    label: 'Encryption key',
    heading: 'Your encryption key',
    intro: 'Your key was created before this window opened.',
    footnote: 'Manage it in Settings › Security.',
  },
  {
    id: 'look',
    label: 'Look & theme',
    heading: 'Make it yours',
    intro: 'Pick a look, an accent and a theme. Each one applies as soon as you choose it.',
    footnote: 'Change these later in Settings › Appearance.',
  },
  {
    id: 'profile',
    label: 'Your profile',
    heading: 'How should people see you?',
    intro: 'Shown on files you share, comments and in shared spaces. Your email stays private.',
    footnote: 'Edit your profile later from the account menu.',
  },
  {
    id: 'ai',
    label: 'AI assistant',
    heading: 'Bring your own AI',
    intro:
      'Writing help in Docs, Explore in Sheets, slide drafts and photo tools use an AI provider you choose, with your own key.',
    footnote: 'Change or remove your key later in Settings › AI Assistant.',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    heading: 'See all your calendars in one place',
    intro: 'Connect the calendars you already use and their events appear next to yours.',
    footnote: 'Connect or disconnect later in Settings › Calendar.',
  },
  {
    id: 'files',
    label: 'Bring your files',
    heading: 'Bring your files with you',
    intro:
      'Choose folders from this computer, or bring your Google data. The import runs in the background, so you can carry on or finish while it works.',
    footnote: 'Later: New › Import folders in Drive, or Import in the account menu for Google Takeout.',
  },
  {
    id: 'invite',
    label: 'Invite friends',
    heading: 'Neutrino is better with people you trust',
    intro:
      'Sharing an encrypted file needs the other person to have a key. Invite them and it just works.',
    footnote: 'Invite more people any time from Invite friends in the account menu.',
  },
];

/** The step the wizard opens on: the one after the encryption key, which is already done. */
export const FIRST_STEP = 1;
export const LAST_STEP = STEPS.length - 1;

export type StepStatus = 'done' | 'current' | 'skipped' | 'upcoming';

/**
 * What the list shows for step `index`. The encryption key is done before the wizard opens, so it
 * always is. Any other step is done once the user has done something in it, skipped once they have
 * left it having done nothing, and upcoming until then.
 */
export function statusOf(
  index: number,
  current: number,
  done: ReadonlySet<StepId>,
  left: ReadonlySet<StepId>,
): StepStatus {
  const id = STEPS[index].id;
  if (id === 'key') return 'done';
  if (index === current) return 'current';
  if (done.has(id)) return 'done';
  if (left.has(id)) return 'skipped';
  return 'upcoming';
}

/** Back is not available on the first step the wizard shows (step 2 of 7). */
export const canGoBack = (current: number): boolean => current > FIRST_STEP;
/** Next is not available on the last step, where Finish is the way on. */
export const canGoNext = (current: number): boolean => current < LAST_STEP;
