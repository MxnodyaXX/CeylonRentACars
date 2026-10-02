import { useState, useEffect } from 'react';
import CarSVG, { vehicleBodyColor } from './CarSVG';

// Map brand+model to their exact English Wikipedia article title
const WIKI_TITLES: Record<string, string> = {
  'toyota prius':      'Toyota Prius',
  'toyota axio':       'Toyota Corolla Axio',
  'toyota aqua':       'Toyota Aqua',
  'toyota hiace':      'Toyota HiAce',
  'toyota premio':     'Toyota Premio',
  'toyota vitz':       'Toyota Vitz',
  'toyota rush':       'Toyota Rush',
  'toyota rav4':       'Toyota RAV4',
  'suzuki wagonr':     'Suzuki Wagon R',
  'suzuki alto':       'Suzuki Alto',
  'suzuki swift':      'Suzuki Swift',
  'honda fit':         'Honda Fit',
  'honda jazz':        'Honda Jazz',
  'honda vezel':       'Honda HR-V',
  'honda grace':       'Honda Grace',
  'honda crv':         'Honda CR-V',
  'nissan dayz':       'Nissan Dayz',
  'nissan note':       'Nissan Note',
  'nissan x-trail':    'Nissan X-Trail',
  'mitsubishi lancer': 'Mitsubishi Lancer',
  'mitsubishi outlander': 'Mitsubishi Outlander',
  'mazda demio':       'Mazda Demio',
};

// In-memory cache so each model is only fetched once per session
const imgCache: Record<string, string | 'failed'> = {};

interface Props {
  brand: string;
  model: string;
  color?: string;
  bodyColor?: string;
  className?: string;
  /** Clips to a circle (for leaderboard avatars) */
  circle?: boolean;
  /** A specific uploaded/known photo for this vehicle — takes priority over the Wikipedia lookup */
  imageUrl?: string;
}

export default function VehicleImage({
  brand, model, color, bodyColor, className = '', circle = false, imageUrl,
}: Props) {
  const key      = `${brand} ${model}`.toLowerCase().replace(/\s+/g, ' ').trim();
  const title    = WIKI_TITLES[key] ?? `${brand} ${model}`;
  const shape    = circle ? 'rounded-full' : 'rounded-xl';
  const [customFailed, setCustomFailed] = useState(false);

  const [src,     setSrc]     = useState<string | null>(
    imgCache[key] && imgCache[key] !== 'failed' ? imgCache[key] as string : null
  );
  const [loading, setLoading] = useState(!(key in imgCache));
  const [failed,  setFailed]  = useState(imgCache[key] === 'failed');

  useEffect(() => {
    if (imageUrl && !customFailed) return; // using the supplied photo — no lookup needed
    if (key in imgCache) return;

    const controller = new AbortController();

    fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { signal: controller.signal }
    )
      .then((r) => r.json())
      .then((data) => {
        // Prefer a larger version if URL contains a pixel dimension
        let url: string | null = data.thumbnail?.source ?? null;
        if (url) {
          url = url.replace(/\/\d+px-/, '/480px-');
          imgCache[key] = url;
          setSrc(url);
        } else {
          imgCache[key] = 'failed';
          setFailed(true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          imgCache[key] = 'failed';
          setFailed(true);
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [key, title, imageUrl, customFailed]);

  /* Supplied photo — highest priority */
  if (imageUrl && !customFailed) {
    return (
      <img
        src={imageUrl}
        alt={`${brand} ${model}`}
        className={`object-cover ${shape} ${className}`}
        onError={() => setCustomFailed(true)}
      />
    );
  }

  /* Loading skeleton */
  if (loading) {
    return <div className={`bg-navy-100 animate-pulse ${shape} ${className}`} />;
  }

  /* Real photo */
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={`${brand} ${model}`}
        className={`object-cover ${shape} ${className}`}
        onError={() => setFailed(true)}
      />
    );
  }

  /* CarSVG fallback */
  return (
    <CarSVG
      brand={brand}
      model={model}
      bodyColor={bodyColor ?? vehicleBodyColor(color)}
      className={className}
    />
  );
}
