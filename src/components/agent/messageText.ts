import {
  stripExecutionPlanMarkup,
  stripPlanOptionMarkup,
  stripReviewDeltaMarkup,
  stripReviewPlanMarkup,
  stripStepVerdictMarkup
} from '../../lib/planOptions';

/** Scrub planner/reviewer structured XML that local models leave in the bubble. */
export function scrubStructuredMarkup(text: string): string {
  return stripExecutionPlanMarkup(
    stripStepVerdictMarkup(
      stripReviewDeltaMarkup(stripReviewPlanMarkup(stripPlanOptionMarkup(text || '')))
    )
  );
}
