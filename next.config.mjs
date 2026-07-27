import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the free tier ships as flat files with ZERO env vars.
  // No basePath — works at a root domain, from `npx serve out`, or file://.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // Pin the project root. Without this Turbopack walks up, finds the PARENT
  // repo's pnpm-lock.yaml, infers the wrong root, and tries to compile the
  // private app's middleware into the free build. (Same fix as
  // bobi-worktracker/free — inherited lesson, not re-learned.)
  turbopack: { root: __dirname },
};
export default nextConfig;
