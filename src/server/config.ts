// The demo's settings, from .env.local. See .env.example.

import "server-only";

export const PORTAL_URL = (process.env.PORTAL_URL ?? "https://larkspur-care-demo.19pine.workers.dev").replace(/\/$/, "");
export const PORTAL_EMAIL = process.env.PORTAL_EMAIL ?? "jordan.lee@example.com";
/** Handed to Pine as a secret: the agent types $PORTAL_PASSWORD and never sees the value. */
export const portalSecrets = () => ({ PORTAL_PASSWORD: process.env.PORTAL_PASSWORD ?? "AeroPure-2026" });
