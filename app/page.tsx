import PipelineApp from "@/components/pipeline-app";

/**
 * The only route.
 *
 * A server component whose whole job is to mount the client shell. Under
 * `output: 'export'` this file is executed by Node at build time and its output
 * becomes `out/index.html` — which is exactly why the shell, and not this file,
 * is where anything touching the browser lives.
 */
export default function Home() {
  return <PipelineApp />;
}
