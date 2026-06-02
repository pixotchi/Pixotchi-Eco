import * as React from "react";

import { Button, type ButtonProps } from "./button";

export interface GameActionButtonProps extends Omit<ButtonProps, "variant"> {
  tone?: "primary" | "success" | "warning" | "danger" | "neutral" | "special";
}

const toneToVariant: Record<NonNullable<GameActionButtonProps["tone"]>, ButtonProps["variant"]> = {
  primary: "game",
  success: "success",
  warning: "warning",
  danger: "danger",
  neutral: "neutral",
  special: "special",
};

const GameActionButton = React.forwardRef<HTMLButtonElement, GameActionButtonProps>(
  ({ tone = "primary", ...props }, ref) => (
    <Button ref={ref} variant={toneToVariant[tone]} {...props} />
  ),
);
GameActionButton.displayName = "GameActionButton";

export { GameActionButton };
