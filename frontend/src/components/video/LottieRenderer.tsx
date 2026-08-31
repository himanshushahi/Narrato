import React, { useState, useEffect } from 'react';
import { Lottie, LottieAnimationData } from '@remotion/lottie';
import { delayRender, continueRender, useCurrentFrame, useVideoConfig, spring } from 'remotion';
import { getMediaUrlSync } from '../../utils/mediaUrl';

export interface LottieRendererProps {
  animation_data?: LottieAnimationData | Record<string, any>;
  src?: string;
  lottie_url?: string;
  loop?: boolean;
  playback_rate?: number;
  direction?: 'forward' | 'backward';
  style?: React.CSSProperties;
}

// Fallback Lottie pulse circle if loading fails or data empty
const FALLBACK_LOTTIE: LottieAnimationData = {
  v: '5.7.4',
  fr: 60,
  ip: 0,
  op: 120,
  w: 200,
  h: 200,
  nm: 'Pulse',
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: 'Circle',
      sr: 1,
      ks: {
        o: { k: [{ t: 0, s: [100] }, { t: 60, s: [40] }, { t: 120, s: [100] }] },
        r: { k: 0 },
        p: { k: [100, 100, 0] },
        a: { k: [0, 0, 0] },
        s: { k: [{ t: 0, s: [80, 80, 100] }, { t: 60, s: [110, 110, 100] }, { t: 120, s: [80, 80, 100] }] },
      },
      shapes: [
        {
          ty: 'el',
          s: { k: [100, 100] },
          p: { k: [0, 0] },
          nm: 'Path',
        },
        {
          ty: 'st',
          c: { k: [0, 0.83, 1, 1] },
          w: { k: 8 },
          o: { k: 100 },
          nm: 'Stroke',
        },
      ],
      ip: 0,
      op: 120,
      st: 0,
    } as any,
  ],
};

export const LottieRenderer: React.FC<LottieRendererProps> = ({
  animation_data,
  src,
  lottie_url,
  loop = true,
  playback_rate = 1,
  direction = 'forward',
  style = {},
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [data, setData] = useState<LottieAnimationData | null>(() => (animation_data as LottieAnimationData) || null);
  const [handle] = useState(() => (src || lottie_url) && !animation_data ? delayRender('Fetching Lottie JSON') : null);

  const targetUrl = lottie_url || src;

  const continuedRef = React.useRef(false);
  const safeContinue = React.useCallback(() => {
    if (handle !== null && !continuedRef.current) {
      continuedRef.current = true;
      continueRender(handle);
    }
  }, [handle]);

  useEffect(() => {
    if (animation_data) {
      setData(animation_data as LottieAnimationData);
      safeContinue();
      return;
    }

    if (!targetUrl) {
      setData(FALLBACK_LOTTIE);
      safeContinue();
      return;
    }

    let active = true;
    const resolved = targetUrl.startsWith('http') ? targetUrl : getMediaUrlSync(targetUrl);

    fetch(resolved)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (active) {
          setData(json);
          safeContinue();
        }
      })
      .catch((err) => {
        console.warn('Failed to load Lottie animation JSON:', err);
        if (active) {
          setData(FALLBACK_LOTTIE);
          safeContinue();
        }
      });

    return () => {
      active = false;
      safeContinue();
    };
  }, [targetUrl, animation_data, safeContinue]);

  const entrance = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 90, mass: 0.8 },
  });

  if (!data) return null;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${entrance})`,
        opacity: entrance,
        ...style,
      }}
    >
      <Lottie
        animationData={data}
        playbackRate={playback_rate}
        direction={direction}
        loop={loop}
        style={{
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
};
