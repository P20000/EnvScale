import { LandingScrollHero } from "./LandingScrollHero";
import { ScrollStoryline } from "./ScrollStoryline";
import { LandingScrollFooter } from "./LandingScrollFooter";

interface LandingPageProps {
  onGetStarted: () => void;
}

export function LandingPage({ onGetStarted }: LandingPageProps) {
  const handleScrollToStoryline = () => {
    const el = document.getElementById("storyline");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#111318] text-[#E6E1E5] font-sans antialiased overflow-x-hidden selection:bg-[#284568] selection:text-[#D3E3FD]">
      {/* Very Beginning of Scroll: Hero with Prominent 'Get Started' Button & Zero Navigation Bar */}
      <LandingScrollHero
        onGetStarted={onGetStarted}
        onScrollToStoryline={handleScrollToStoryline}
      />

      {/* Scroll-Driven Animation & Information Storyline */}
      <ScrollStoryline onGetStarted={onGetStarted} />

      {/* Quiet Technical Footer */}
      <LandingScrollFooter onGetStarted={onGetStarted} />
    </div>
  );
}

export default LandingPage;
