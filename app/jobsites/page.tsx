import PipelineApp from "@/components/pipeline-app";

/**
 * `/jobsites/` — the directory of where postings live.

 * Its own route because it is the one page in this app worth sending someone
 * who has never used it. A link that lands a stranger on an empty dashboard
 * answers the wrong question; a link that lands them on seventy-six job sites,
 * with honest notes on each, is useful before they have captured anything.
 */
export default function JobsitesPage() {
  return <PipelineApp initialTab="jobsites" />;
}
