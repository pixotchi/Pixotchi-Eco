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

      const totalHours = Math.floor(timeLeft / 3600);
      const minutes = Math.floor((timeLeft % 3600) / 60);
      const seconds = timeLeft % 60;

      // If more than 96 hours, display days:hours instead of overflowing hours
      if (totalHours >= 96) {
        const days = Math.floor(totalHours / 24);
        const hoursRemainder = totalHours % 24;
        const formatted = `${days}d:${hoursRemainder.toString().padStart(2, '0')}h:${minutes.toString().padStart(2, '0')}m:${seconds.toString().padStart(2, '0')}s`;
        setTimeRemaining(formatted);
        return;
      }

      const formattedTime = `${totalHours.toString().padStart(2, '0')}h:${minutes.toString().padStart(2, '0')}m:${seconds.toString().padStart(2, '0')}s`;
      setTimeRemaining(formattedTime);
    };

    updateTimer();
    
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [targetTimestamp]);

  return timeRemaining;
}
