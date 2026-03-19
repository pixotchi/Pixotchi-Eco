import { NextResponse } from "next/server";
import { PIXOTCHI_BASE_APP_REFERRAL_URL } from "@/lib/pixotchi-links";

export function GET() {
  return NextResponse.redirect(PIXOTCHI_BASE_APP_REFERRAL_URL, { status: 307 });
}
