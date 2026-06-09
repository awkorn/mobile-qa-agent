# Maestro Generator Prompt

Generate Maestro YAML for the highest-value mobile E2E journey. Prefer stable `id` selectors where available, visible text assertions where stable, and explicit waits through `assertVisible` rather than fixed sleeps.

Include setup assumptions and keep the flow short enough to run in smoke CI.
