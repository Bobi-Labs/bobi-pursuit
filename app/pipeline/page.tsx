import PipelineApp from "@/components/pipeline-app";

/**
 * `/pipeline/` — the board, at its own address.
 *
 * A real folder under `app/`, so `output: 'export'` writes a real
 * `out/pipeline/index.html`: a hard reload of this URL lands on the board rather
 * than at Overview, and there is no server or rewrite layer in this tier that
 * could have faked it. Like `app/page.tsx` this is a server component executed
 * by Node at build time, which is why it does nothing but mount the client
 * shell and name the tab.
 */
export default function PipelinePage() {
  return <PipelineApp initialTab="pipeline" />;
}
