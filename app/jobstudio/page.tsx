import PipelineApp from "@/components/pipeline-app";

/**
 * `/jobstudio/` — Job Studio, at its own address.
 *
 * Prerendered at build time into `out/jobstudio/index.html`, same as every other
 * route here. Landing cold shows the "no job selected" state, because which job
 * you were reading is view state and this tier keeps no session on any server to
 * remember it.
 */
export default function JobStudioPage() {
  return <PipelineApp initialTab="studio" />;
}
