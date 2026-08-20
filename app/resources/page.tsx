import PipelineApp from "@/components/pipeline-app";

/**
 * `/resources/` — CV help, interview practice, pay research, your rights.

 * Separate from Job Sites deliberately. "Where do I find work" and "how do I
 * apply well" are different questions asked on different days, and folding them
 * into one list means the person looking for a cover-letter checker scrolls
 * past forty job boards to reach it.
 */
export default function ResourcesPage() {
  return <PipelineApp initialTab="resources" />;
}
