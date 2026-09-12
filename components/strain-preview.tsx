'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useDocumentVisible } from '@/hooks/useDocumentVisible';
import { useQuietMotion } from '@/lib/motion';
import styles from './strain-preview.module.css';

const STRAINS = [1, 2, 3, 4, 5];

/** A quiet introduction to the collectible art, without moving the surrounding UI. */
export function StrainPreview() {
  const container = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<Set<number>>(() => new Set());
  const [inView, setInView] = useState(false);
  const documentVisible = useDocumentVisible();
  const quiet = useQuietMotion();
  const ready = loaded.size === STRAINS.length;

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return <div ref={container} className={styles.preview}
    data-still={quiet || !ready}
    data-paused={!inView || !documentVisible}>
    <div className={styles.art} role="img" aria-label="A preview of five Pixotchi plant strains">
      {STRAINS.map((strain, index) => <Image key={strain}
        src={`/ipfs/strain${strain}/20.svg`} alt="" width={176} height={176}
        loading="eager" className={styles.strain}
        style={{ animationDelay: `${index === 0 ? 0 : (index - STRAINS.length) * 3}s` }}
        onLoad={() => setLoaded(previous => new Set(previous).add(strain))} />)}
    </div>
  </div>;
}
