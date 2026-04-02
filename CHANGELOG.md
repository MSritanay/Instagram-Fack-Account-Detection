CHANGELOG.md
============

## [1.1.0] - 2026-02-13

### Added
- Centralized logging system using `winston` on the server.
- `/api/log` endpoint on the server to receive logs from the client.
- Client-side logging utility to send logs to the server.
- Logging for all database operations in `analysis.ts`.
- Logging for dashboard data fetching in `UserDashboard.tsx`.
- Logging for navigation clicks in `UserDashboard.tsx`.

### Changed
- Corrected server startup logging in `index.ts` to use the new centralized logger.