# Portfolio polish — DevPulse

## Goal
Improve the public-facing presentation of DevPulse without changing application behavior.

## Scope
- Replace the README's screenshot placeholder with the real dashboard reference image.
- Add a concise portfolio-oriented overview near the top of the README.
- Keep the existing technical documentation and architecture details intact.
- Document the current repository status accurately.
- Do not alter application code, dependencies, database schema, authentication, or API behavior.

## Files inspected
- README.md
- AGENTS.md
- CLAUDE.md
- package.json
- design/dashboard.png
- design/gap-report.png
- design/job-description.png
- design/skills.png
- design/trends.png
- design/user-profile.png

## Decisions
- Treat this as documentation/portfolio cleanup, not a product feature.
- Preserve the existing detailed README because it contains useful architectural evidence.
- Surface the strongest product screenshot near the top and link additional UI references later.
- Keep secrets and environment values out of the README.

## Acceptance criteria
- README opens with a clear one-paragraph product explanation.
- A real repository image replaces the placeholder screenshot.
- README links to the main UI reference images.
- Existing setup, architecture, security, data-source, pipeline, and matching documentation remains available.
- No application behavior changes.

## Verification
- Re-read the updated README on the branch.
- Compare the branch against main and confirm only documentation files changed.
- Confirm the commit exists on the feature branch.
