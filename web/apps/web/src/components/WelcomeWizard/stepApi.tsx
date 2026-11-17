'use client';

import { createContext, useContext, useEffect, useRef } from 'react';

/** What a step can tell the wizard around it. */
export interface StepApi {
  /** The user has done something in this step, so it is not "skipped" when they leave. */
  markDone: () => void;
}

/**
 * Work a step does when the user leaves it — saving what they typed. Returns whether it saved
 * anything (which makes the step done) and throws to keep the user on the step with the message.
 */
export type StepCommit = () => Promise<boolean | void>;

/** How a step wants the footer's forward button (Next, and Finish) to behave right now. */
export interface StepForward {
  /** The forward button reads "Skip", not "Next", and is not the primary button. */
  skip?: boolean;
  /**
   * Asked before going forward with Next/Skip or Finish — never on Back or close. Resolves to
   * whether to go on; false keeps the user on the step.
   */
  guard?: () => Promise<boolean>;
}

export interface StepHost extends StepApi {
  setCommit: (commit: StepCommit | null) => void;
  setForward: (forward: StepForward | null) => void;
}

export const StepContext = createContext<StepHost>({
  markDone: () => {},
  setCommit: () => {},
  setForward: () => {},
});

export function useStep(): StepApi {
  return useContext(StepContext);
}

/** Register what the wizard should run when the user leaves this step (Next, Back, Finish, close). */
export function useCommitOnLeave(commit: StepCommit): void {
  const { setCommit } = useContext(StepContext);
  // Always the latest closure, registered once, so a step does not re-register on every keystroke.
  const latest = useRef(commit);
  latest.current = commit;
  useEffect(() => {
    setCommit(() => latest.current());
    return () => setCommit(null);
  }, [setCommit]);
}

/**
 * Say how this step's forward button reads, and what to ask before going forward. The guard is
 * always the latest one passed; only a change of `skip` re-registers.
 */
export function useForward(forward: StepForward): void {
  const { setForward } = useContext(StepContext);
  const latest = useRef(forward);
  latest.current = forward;
  const skip = !!forward.skip;
  useEffect(() => {
    setForward({ skip, guard: () => latest.current.guard?.() ?? Promise.resolve(true) });
  }, [setForward, skip]);
  useEffect(() => () => setForward(null), [setForward]);
}
