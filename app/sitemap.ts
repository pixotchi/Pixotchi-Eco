import type { MetadataRoute } from "next";
const BASE_URL = process.env.NEXT_PUBLIC_URL ?? "https://mini.pixotchi.tech";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const entries: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
  ];

  return entries;
}

