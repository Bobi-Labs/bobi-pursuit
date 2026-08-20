import PipelineApp from "@/components/pipeline-app";

/**
 * `/searches/` — the searches you tuned, kept in one place.
 *
 * Its own tab rather than a strip on Job Sites, because those answer different
 * questions. Job Sites is "where could I look"; this is "the four searches I
 * already tuned and come back to every morning". Burying the second inside the
 * first is what made the operator ask where saved searches even were.
 *
 * It is also the landing site for the extension's "Save this search" handoff.
 */
export default function SearchesPage() {
  return <PipelineApp initialTab="searches" />;
}
