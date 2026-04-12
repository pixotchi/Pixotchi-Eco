const ANDROID_PATTERN = /Android/i;
const ANDROID_WEBVIEW_MARKER_PATTERN = /\bwv\b/i;
const CHROME_WEBVIEW_PATTERN =
  /Version\/[\d.]+\s+Chrome\/[\d.]+\s+Mobile\s+Safari\/[\d.]+/i;

export function isAndroidWebViewUserAgent(userAgent: string): boolean {
  if (!userAgent || !ANDROID_PATTERN.test(userAgent)) {
    return false;
  }

  return (
    ANDROID_WEBVIEW_MARKER_PATTERN.test(userAgent) ||
    CHROME_WEBVIEW_PATTERN.test(userAgent)
  );
}

export function isAndroidWebView(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  return isAndroidWebViewUserAgent(navigator.userAgent || "");
}
