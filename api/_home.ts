// The app's home base, for the Gemini prompts (#227). The app reads it from
// src/data/home.ts, which api/ may not import (it would pull the SPA into the
// function), so it's repeated here; _home.test.ts fails if the two drift.
export const HOME_BASE = 'San Jose, CA';
