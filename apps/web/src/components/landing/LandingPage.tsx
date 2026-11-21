import { LandingVideoHero } from "./LandingVideoHero";
import { ScrollStoryline } from "./ScrollStoryline";
import { LandingScrollFooter } from "./LandingScrollFooter";

interface LandingPageProps {
  onGetStarted: () => void;
}

export function LandingPage({ onGetStarted }: LandingPageProps) {
  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-800 font-sans antialiased overflow-x-clip selection:bg-blue-600 selection:text-white">
      {/* Brand Hero with Centered Logo & Mandala Art */}
      <LandingVideoHero onGetStarted={onGetStarted} />

      {/* Light Mode Slideshow: Diagram Cards on Left, Courgette Info on Right */}
      <ScrollStoryline />

      {/* Technical Footer */}
      <LandingScrollFooter onGetStarted={onGetStarted} />
    </div>
  );
}

export default LandingPage;
