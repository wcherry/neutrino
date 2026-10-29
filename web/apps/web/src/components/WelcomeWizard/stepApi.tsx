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

export interface StepHost extends StepApi {
  setCommit: (commit: StepCommit | null) => void;
}

export const StepContext = createContext<StepHost>({ markDone: () => {}, setCommit: () => {} });

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
