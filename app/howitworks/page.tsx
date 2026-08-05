import PipelineApp from "@/components/pipeline-app";

/**
 * `/howitworks/` — the explainer, at its own address.
 *
 * Worth a route of its own rather than a scroll position on Overview: it is the
 * page you send someone who has not used this yet, and a link that lands them on
 * a dashboard of numbers they have no context for is a link that answers the
 * wrong question. The header's "How it works" sheet still shows the same words
 * from anywhere, which is the surface for a user already mid-triage.
 */
export default function HowItWorksPage() {
  return <PipelineApp initialTab="howitworks" />;
}
