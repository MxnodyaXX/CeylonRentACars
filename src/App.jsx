import { useCallback, useState } from 'react';
import { IconSprite } from './components/Icon';
import PageLoader from './components/PageLoader';
import Header from './components/Header';
import Hero from './components/Hero';
import PopularVehicles from './components/PopularVehicles';
import { Categories, Faq, HowItWorks, Locations, Promo, Reviews, WhyUs } from './components/Sections';
import Footer from './components/Footer';
import { useApp } from './context/AppContext';
import { useScrollReveal } from './hooks/useMotion';
import { HERO_SLIDES } from './data/site';

function Toast() {
  const { toast } = useApp();
  return (
    <div className={`toast${toast.visible ? ' is-show' : ''}`} role="status" aria-live="polite">
      {toast.message}
    </div>
  );
}

export default function App() {
  // True once the loader rows start to split; everything else times its entrance from here
  const [revealed, setRevealed] = useState(false);
  const onReveal = useCallback(() => {
    document.documentElement.classList.remove('is-loading'); // un-pauses the CSS entrance animations
    setRevealed(true);
  }, []);

  useScrollReveal(revealed);

  return (
    <>
      <IconSprite />
      <PageLoader heroImage={HERO_SLIDES[0].img} onReveal={onReveal} />
      <Header />
      <main>
        <Hero revealed={revealed} />
        <PopularVehicles />
        <Categories />
        <Locations />
        <HowItWorks />
        <WhyUs />
        <Promo />
        <Reviews />
        <Faq />
      </main>
      <Footer />
      <Toast />
    </>
  );
}
