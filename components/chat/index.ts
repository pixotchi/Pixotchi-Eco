// Only ChatButton is consumed from this barrel (app/(game)/page.tsx).
//
// Do NOT re-export ChatDialog / ChatMessages / ChatInput / ChatProfileDialog here.
// ChatButton loads ChatDialog via next/dynamic; re-exporting the dialog surface
// from this barrel puts it back in the eager graph and defeats that split
// (previously ~64 KB of chat code in the first-load bundle, plus a transitive
// eager path to ethereum-identity-kit's stylesheet via ChatProfileDialog).
//
// Import the other chat components directly from their module instead.
export { default as ChatButton } from './chat-button';
