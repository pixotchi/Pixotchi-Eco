"use client";

import { Component, type ReactNode } from 'react';

/** Isolate one damaged indexer record without losing the rest of the feed. */
export class ActivityRowBoundary extends Component<{ children: ReactNode; record: unknown }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: { record: unknown }) {
    if (this.state.failed && previous.record !== this.props.record) this.setState({ failed: false });
  }
  render() {
    return this.state.failed
      ? <p className="px-2 py-3 text-sm text-muted-foreground">This activity entry is temporarily unavailable. Other activity is shown below.</p>
      : this.props.children;
  }
}
