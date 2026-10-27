import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/terms", "/privacy", "/refunds"].map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: new Date()
  }));
}
