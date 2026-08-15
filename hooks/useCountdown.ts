"use client";

import { useState, useEffect } from 'react';

export function useCountdown(targetTimestamp: number, showSeconds: boolean = true) {
  const [timeRemaining, setTimeRemaining] = useState(showSeconds ? "00h:00m:00s" : "00h:00m");

  useEffect(() => {
    const zeroLabel = showSeconds ? "00h:00m:00s" : "00h:00m";

    // If the target is 0 or in the past, don't start the timer.
    if (!targetTimestamp || targetTimestamp < Math.floor(Date.now() / 1000)) {
      setTimeRemaining(zeroLabel);
      return;
    }

    let interval: ReturnType<typeof setInterval> | null = null;
    let finished = false;

    const stop = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };

    const updateTimer = () => {
      const now = Math.floor(Date.now() / 1000); // Current time in seconds
      const timeLeft = targetTimestamp - now;

      if (timeLeft <= 0) {
        setTimeRemaining(zeroLabel);
        // The countdown is over - stop ticking instead of recomputing the same
        // string every second for the rest of the component's lifetime.
        finished = true;
        stop();
        return;
      }

      const totalHours = Math.floor(timeLeft / 3600);
      const minutes = Math.floor((timeLeft % 3600) / 60);
      const seconds = timeLeft % 60;

      // If more than 96 hours, display days:hours instead of overflowing hours
      if (totalHours >= 96) {
        const days = Math.floor(totalHours / 24);
        const hoursRemainder = totalHours % 24;
        const formatted = showSeconds
          ? `${days}d:${hoursRemainder.toString().padStart(2, '0')}h:${minutes.toString().padStart(2, '0')}m:${seconds.toString().padStart(2, '0')}s`
          : `${days}d:${hoursRemainder.toString().padStart(2, '0')}h:${minutes.toString().padStart(2, '0')}m`;
        setTimeRemaining(formatted);
        return;
      }

      const formattedTime = showSeconds
        ? `${totalHours.toString().padStart(2, '0')}h:${minutes.toString().padStart(2, '0')}m:${seconds.toString().padStart(2, '0')}s`
        : `${totalHours.toString().padStart(2, '0')}h:${minutes.toString().padStart(2, '0')}m`;
      setTimeRemaining(formattedTime);
    };

    updateTimer();

    if (!finished) {
      interval = setInterval(updateTimer, 1000);
    }

    return stop;
  }, [targetTimestamp, showSeconds]);

  return timeRemaining;
}
