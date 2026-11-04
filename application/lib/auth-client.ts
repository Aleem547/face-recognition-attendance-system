"use client";
import { createAuthClient } from "better-auth/react";

// The browser uses same-origin requests. No database URL or secret is exposed.
export const authClient = createAuthClient();
