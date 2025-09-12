"use client";

import { useState, useEffect } from 'react';

export function useCountdown(targetTimestamp: number) {
  const [timeRemaining, setTimeRemaining] = useState("00h:00m:00s");

  useEffect(() => {
    // If the target is 0 or in the past, don't start the timer.
    if (!targetTimestamp || targetTimestamp < Math.floor(Date.now() / 1000)) {
      setTimeRemaining("00h:00m:00s");
      return;
    }

    const updateTimer = () => {
      const now = Math.floor(Date.now() / 1000); // Current time in seconds
      const timeLeft = targetTimestamp - now;

      if (timeLeft <= 0) {
        setTimeRemaining("00h:00m:00s");
        return;
      }

      const hours = Math.floor(timeLeft / 3600);
      const minutes = Math.floor((timeLeft % 3600) / 60);
      const seconds = timeLeft % 60;

      const formattedTime = `${hours.toString().padStart(2, '0')}h:${minutes.toString().padStart(2, '0')}m:${seconds.toString().padStart(2, '0')}s`;
      setTimeRemaining(formattedTime);
    };

    updateTimer();
    
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [targetTimestamp]);

  return timeRemaining;
}
