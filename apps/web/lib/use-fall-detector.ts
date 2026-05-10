'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

export type DetectorStatus = 'idle' | 'requesting' | 'active' | 'unsupported' | 'denied';

interface FallDetectorOptions {
  onFallDetected: (confidence: number) => void;
  spikeThreshold?: number;  // m/s² — anything above this fires
  cooldownMs?: number;      // ms before next detection allowed
}

export function useFallDetector({
  onFallDetected,
  spikeThreshold = 20,   // well above walking (~12), catches hard throws
  cooldownMs = 8000,
}: FallDetectorOptions) {
  const [status, setStatus] = useState<DetectorStatus>('idle');
  const [magnitude, setMagnitude] = useState(0);

  const callbackRef = useRef(onFallDetected);
  useEffect(() => { callbackRef.current = onFallDetected; }, [onFallDetected]);

  const firedRef = useRef(false);
  const listenerRef = useRef<((e: DeviceMotionEvent) => void) | null>(null);
  const lastDisplayRef = useRef(0);

  const stop = useCallback(() => {
    if (listenerRef.current) {
      window.removeEventListener('devicemotion', listenerRef.current);
      listenerRef.current = null;
    }
    setStatus('idle');
    setMagnitude(0);
  }, []);

  const start = useCallback(() => {
    firedRef.current = false;

    const handler = (e: DeviceMotionEvent) => {
      const acc = e.accelerationIncludingGravity;
      if (!acc || acc.x == null || acc.y == null || acc.z == null) return;

      const mag = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2);

      // Throttle display
      const now = Date.now();
      if (now - lastDisplayRef.current > 100) {
        lastDisplayRef.current = now;
        setMagnitude(Math.round(mag * 10) / 10);
      }

      // Spike detected and not in cooldown — fire
      if (mag > spikeThreshold && !firedRef.current) {
        firedRef.current = true;
        const confidence = Math.min(0.95, 0.6 + (mag - spikeThreshold) / 30);
        console.log('[FallDetector] FALL — mag:', mag.toFixed(1), 'conf:', confidence.toFixed(2));
        callbackRef.current(Math.round(confidence * 100) / 100);

        setTimeout(() => { firedRef.current = false; }, cooldownMs);
      }
    };

    listenerRef.current = handler;
    window.addEventListener('devicemotion', handler);
    setStatus('active');
  }, [spikeThreshold, cooldownMs]);

  const requestPermission = useCallback(async () => {
    if (typeof window === 'undefined') return;
    setStatus('requesting');

    const DeviceMotionEventAny = DeviceMotionEvent as any;
    if (typeof DeviceMotionEventAny.requestPermission === 'function') {
      try {
        const result = await DeviceMotionEventAny.requestPermission();
        if (result === 'granted') { start(); } else { setStatus('denied'); }
      } catch { setStatus('denied'); }
      return;
    }

    if (typeof DeviceMotionEvent === 'undefined') { setStatus('unsupported'); return; }
    start();
  }, [start]);

  useEffect(() => () => stop(), [stop]);

  return { status, magnitude, requestPermission, stop };
}
