import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bobi-Pursuit — your job hunt, organized and scored",
  description:
    "Capture jobs from anywhere, triage them on a pipeline, and score them against your own profile. Free, local-first — your data never leaves your browser.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      {/* `overflow-x-hidden` is belt-and-braces: the shell is a `h-dvh` flex
          column whose only scrollers are internal, so the page itself should
          never scroll in either axis.

          The colours come from the token layer in `globals.css`, not from a
          palette utility — `bg-background`/`text-foreground` are the same two
          classes the self-hosted dashboard's body wears, so the two products
          start from an identical canvas. */}
      <body className="overflow-x-hidden bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
