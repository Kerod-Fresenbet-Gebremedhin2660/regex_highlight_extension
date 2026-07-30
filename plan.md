# Reading Companion Feature Roadmap

## Summary

This document provides a selectable, ID-based roadmap for evolving the extension into a Chromium-first reading companion. It records the current baseline, proposed user-facing features, required engineering foundations, planned interfaces, and the rules for selecting and executing individual improvements.

Creating this roadmap does not authorize or implement any listed feature. Feature implementation begins only when a roadmap ID is explicitly selected.

## Current Baseline

Baseline recorded at commit `2260ab5` on July 30, 2026.

- Manifest V3 extension restricted by an internal site allowlist, initially targeting Archive of Our Own and FanFiction.net.
- Shadow-DOM reading overlay with regex validation, flags, whole-word matching, colored alternatives, saved searches, match previews, navigation, scrollbar markers, SPA restoration, and context-menu quick-add.
- Worker-assisted matching and batched DOM updates.
- Production build passes with `npm run build`.
- No automated test suite currently exists.
- Installation documentation is stale and the root and build manifests conflict.
- Settings are split between page-origin `localStorage`, `chrome.storage.local`, and `chrome.storage.sync`.

Each roadmap item is expected to contain or acquire:

- Status
- Goal and user value
- User-visible behavior
- Dependencies
- Implementation notes
- Acceptance criteria
- Estimated effort
- Risks and edge cases

## Status Definitions

| Status | Meaning |
|---|---|
| `Proposed` | Documented for consideration but not selected. |
| `Selected` | Explicitly chosen for upcoming implementation. |
| `In Progress` | Implementation has started. |
| `Blocked` | Work cannot continue until a recorded dependency or decision is resolved. |
| `Done` | Acceptance criteria and required verification have passed. |
| `Deferred` | Intentionally postponed without removing it from the roadmap. |

## Selectable Feature Roadmap

All items initially have status `Proposed`.

### `RC-01` — Named Highlight Profiles

- **Status:** `Proposed`
- **Priority:** P1
- **Estimated effort:** Medium
- **Goal:** Let readers organize highlights by story, fandom, research topic, or personal reading purpose instead of maintaining one regex.
- **Planned behavior:**
  - Create, rename, duplicate, and delete profiles.
  - Store ordered highlight rules inside each profile.
  - Activate one profile per tab.
  - Remember a default profile for a work or site.
  - Prevent profile deletion without confirmation when it contains rules or site assignments.
- **Dependencies:** `BASE-01`, `BASE-02`, `BASE-03`
- **Acceptance criteria:**
  - Profile changes persist across browser restarts.
  - Switching profiles removes the previous profile’s highlights and applies the new profile without reloading the page.
  - Profile names are validated and duplicate names are handled clearly.
  - Existing saved patterns remain available after migration.

### `RC-02` — Character, Alias, and Theme Groups

- **Status:** `Proposed`
- **Priority:** P1
- **Estimated effort:** Medium
- **Goal:** Treat related names or phrases as one reading entity while keeping their matches recognizable.
- **Planned behavior:**
  - A rule can represent a character, location, relationship, theme, warning, or custom category.
  - Multiple aliases share the rule’s label and color.
  - Literal matching is the safe default.
  - Advanced regex remains available per rule.
  - Case sensitivity and whole-word behavior become per-rule settings.
  - Show counts for each rule and, where useful, individual aliases.
- **Dependencies:** `RC-01`, `BASE-02`, `BASE-03`
- **Acceptance criteria:**
  - Literal aliases are escaped correctly and cannot accidentally become regex.
  - Alias matching respects case and whole-word settings.
  - Adding, editing, disabling, and removing an alias updates highlights predictably.
  - Invalid regex rules remain editable but cannot disrupt other enabled rules.

### `RC-03` — Site, Work, and Page-Region Scoping

- **Status:** `Proposed`
- **Priority:** P1
- **Estimated effort:** Medium
- **Goal:** Apply the right profile automatically and avoid highlighting menus, comments, and unrelated page content.
- **Planned behavior:**
  - Assign profiles site-wide or to a specific work/path.
  - Use the most-specific matching path assignment first, followed by the site default and then a temporary tab override.
  - Allow matching to be restricted to the main reading region or a custom CSS selector.
  - Preview whether a selector resolves before saving it.
  - Fall back safely to the page body when an optional selector stops resolving.
- **Dependencies:** `RC-01`, `BASE-01`, `BASE-05`
- **Acceptance criteria:**
  - Profile selection is deterministic when several assignments match.
  - Subdomains and paths are normalized consistently.
  - Invalid selectors are rejected without disabling the extension.
  - SPA navigation recalculates the assignment and content region.

### `RC-04` — Functional Popup Dashboard

- **Status:** `Proposed`
- **Priority:** P1
- **Estimated effort:** Medium
- **Goal:** Turn the popup into the primary control surface for the current page.
- **Planned behavior:**
  - Show whether the current site has permission.
  - Request or remove site access through clear user actions.
  - Select and enable or disable the active profile.
  - Display rule and match counts.
  - Provide quick search, clear, resume, and manage-profile actions.
  - Explain unsupported and restricted browser pages instead of silently failing.
- **Dependencies:** `RC-01`, `RC-03`, `BASE-02`, `BASE-05`
- **Acceptance criteria:**
  - Popup state matches the active tab without one-second polling.
  - Actions return visible success or error states.
  - Opening the popup on a disallowed site gives a usable permission flow.
  - The popup does not claim that the widget is active when no content script is available.

### `RC-05` — Reader-Friendly Quick Capture

- **Status:** `Proposed`
- **Priority:** P1
- **Estimated effort:** Small
- **Goal:** Add selected names or phrases to the active profile without manually editing regex alternations.
- **Planned behavior:**
  - Add selected text as an escaped literal through the context menu.
  - Add it as a new rule or as an alias of an existing rule.
  - Default to a new literal rule when no active profile or suitable target exists.
  - Open or reveal the widget after capture and show what was added.
- **Dependencies:** `RC-01`, `RC-02`
- **Acceptance criteria:**
  - Regex metacharacters in selected text are treated literally.
  - Duplicate aliases are detected case-sensitively or insensitively according to the rule.
  - Capture works when the widget is minimized or hidden.
  - Failures do not discard the selected text without feedback.

### `RC-06` — Group-Aware Navigation

- **Status:** `Proposed`
- **Priority:** P1
- **Estimated effort:** Medium
- **Goal:** Make large result sets navigable by entity rather than as one undifferentiated list.
- **Planned behavior:**
  - Filter the match list and minimap by profile group or rule.
  - Make next and previous navigation respect the active filter.
  - Show nearby text context and the rule responsible for each match.
  - Keep the currently active match visible in the result list.
  - Use virtualization or bounded rendering for large result sets.
- **Dependencies:** `RC-01`, `RC-02`, `BASE-02`
- **Acceptance criteria:**
  - Filtered and unfiltered counters are unambiguous.
  - Navigation wraps consistently within the active filter.
  - Changing filters preserves the current match when it remains eligible.
  - Hundreds or thousands of matches do not create an equally large popup DOM.

### `RC-07` — Reading Sessions and Resume Points

- **Status:** `Proposed`
- **Priority:** P2
- **Estimated effort:** Medium
- **Goal:** Help readers return to their last position in long works without silently moving the page.
- **Planned behavior:**
  - Store the last reading position and active profile per work.
  - Support optional manual bookmarks.
  - Make resuming an explicit action in the popup or widget.
  - Resolve positions using URL, text quote, and nearby context fallbacks.
  - Report when a saved position can no longer be resolved.
- **Dependencies:** `RC-01`, `RC-03`, `BASE-01`
- **Acceptance criteria:**
  - Merely opening a page never forces an unexpected scroll.
  - Resume data survives reloads and browser restarts.
  - Normal URL query or hash changes do not create uncontrolled duplicate sessions.
  - Removing a work assignment offers an explicit choice about its session data.

### `RC-08` — Dynamic-Page and Cross-Element Matching

- **Status:** `Proposed`
- **Priority:** P1
- **Estimated effort:** Large
- **Goal:** Highlight content reliably on dynamically updated reading pages and across harmless inline markup.
- **Planned behavior:**
  - Highlight newly inserted chapter text through debounced updates.
  - Match phrases split across inline elements such as emphasis or links when DOM-safe.
  - Avoid editable controls, scripts, styles, and extension UI.
  - Cancel stale searches and discard stale results after navigation or profile changes.
  - Restore original page structure as closely as possible when highlights are cleared.
- **Dependencies:** `BASE-02`, `BASE-03`
- **Acceptance criteria:**
  - Dynamic insertion does not repeatedly wrap existing highlights.
  - Cross-element matches preserve visible text and page interactions.
  - Clearing highlights does not remove unrelated page listeners or controls.
  - Rapid searches and SPA navigation cannot apply stale matches.

### `RC-09` — Content Treatment Rules

- **Status:** `Proposed`
- **Priority:** P2
- **Estimated effort:** Large
- **Goal:** Let readers emphasize or temporarily conceal content according to their preferences.
- **Planned behavior:**
  - Configure each rule to highlight, dim, blur, or collapse content.
  - Never permanently delete matched page content.
  - Provide accessible reveal controls and a global reveal-all action.
  - Show counts for concealed matches without exposing their text unexpectedly.
  - Restore all treated content when a profile is disabled.
- **Dependencies:** `RC-01`, `RC-02`, `RC-06`, `BASE-02`
- **Acceptance criteria:**
  - Hidden content remains recoverable in one action.
  - Keyboard and screen-reader users can reveal content.
  - Treatment rules do not conceal extension controls.
  - Overlapping rules follow a documented and deterministic precedence.

### `RC-10` — Local Backup and Shareable Profile Packs

- **Status:** `Proposed`
- **Priority:** P2
- **Estimated effort:** Medium
- **Goal:** Protect local data and allow profiles to be moved or shared without a cloud account.
- **Planned behavior:**
  - Export selected profiles or all extension data as versioned JSON.
  - Validate and preview imports before writing.
  - Offer explicit merge or replacement behavior.
  - Detect stable-ID and name conflicts.
  - Reject invalid or unsupported newer formats without partial modification.
- **Dependencies:** `RC-01`, `BASE-01`, `BASE-03`
- **Acceptance criteria:**
  - Export followed by import preserves supported data.
  - Import validation is side-effect-free.
  - Replacement requires confirmation and creates a recoverable pre-import backup.
  - Sensitive page text and browsing history are excluded unless explicitly part of selected bookmarks or notes.

### `RC-11` — Chapter Statistics and Result Export

- **Status:** `Proposed`
- **Priority:** P3
- **Estimated effort:** Medium
- **Goal:** Summarize the active page’s entities and make visible results portable.
- **Planned behavior:**
  - Show counts by rule and alias for the current page.
  - Export visible results and context as JSON or CSV.
  - Respect active filters and page-region scope.
  - Avoid building a cross-site reading history by default.
- **Dependencies:** `RC-02`, `RC-06`, `BASE-01`
- **Acceptance criteria:**
  - Counts match the currently rendered and filtered results.
  - CSV escapes commas, quotes, and line breaks correctly.
  - Export indicates the profile, page URL, timestamp, and active filters.
  - Statistics can be cleared without deleting profiles.

### `RC-12` — Accessibility and Personalization

- **Status:** `Proposed`
- **Priority:** P1
- **Estimated effort:** Medium
- **Goal:** Make the extension comfortable and operable across platforms, visual needs, and input methods.
- **Planned behavior:**
  - Customizable highlight palettes with contrast-aware defaults.
  - High-contrast and reduced-motion modes.
  - Scalable extension UI that behaves predictably with browser zoom.
  - Complete keyboard operation and visible focus.
  - Windows/Linux `Ctrl` equivalents for current macOS-only interactions.
  - Manifest-declared Chromium commands that users can remap.
- **Dependencies:** `BASE-03`, `BASE-04`
- **Acceptance criteria:**
  - Core search, profile switching, filtering, and navigation work without a pointer.
  - Controls have meaningful names and status changes are announced.
  - Text and essential UI meet WCAG AA contrast targets.
  - Reduced-motion mode removes smooth scrolling and decorative animation.

### `RC-13` — Match Notes and Reader Annotations

- **Status:** `Proposed`
- **Priority:** P3
- **Estimated effort:** Large
- **Goal:** Attach personal observations to entities, bookmarks, and passages.
- **Planned behavior:**
  - Add notes to a profile rule, manual bookmark, or specific passage.
  - Store notes locally.
  - Resolve passage notes through text and nearby context rather than brittle DOM indices alone.
  - Mark unresolved annotations and allow manual reattachment.
  - Include notes only in explicit backup/export operations.
- **Dependencies:** `RC-01`, `RC-07`, `BASE-01`
- **Acceptance criteria:**
  - Notes persist without modifying the source page.
  - Unresolved notes are retained and reported rather than silently deleted.
  - Removing an associated rule or bookmark requires an explicit note-retention decision.
  - Notes never leave the device unless the user exports them.

## Recommended Initial Feature Slice

The recommended first user-visible release consists of:

1. `RC-01` — Named highlight profiles
2. `RC-02` — Character, alias, and theme groups
3. `RC-04` — Functional popup dashboard
4. `RC-05` — Reader-friendly quick capture

This recommendation does not select or authorize those features automatically. Their required foundation items must be included in the implementation proposal presented before work begins.

## Required Foundations

### `BASE-01` — Versioned Local Data Layer

- **Status:** `Proposed`
- Make `chrome.storage.local` canonical for profiles, assignments, sessions, and settings.
- Define explicit schema versions and sequential migrations.
- Lazily migrate legacy per-origin data when an allowed site is visited.
- Mark each origin as migrated and stop dual-writing afterward.
- Centralize storage validation, defaults, error handling, and change notifications.
- Avoid requesting `unlimitedStorage` unless measured usage demonstrates a real need.

Chromium recommends extension storage instead of content-script `localStorage`, because Web Storage belongs to the host origin, is unavailable to service workers, and can be cleared with browsing history. See the [Chrome storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage).

### `BASE-02` — Typed Architecture and Matching Safety

- **Status:** `Proposed`
- Split the large UI and highlighter modules into storage, matching, DOM rendering, navigation, and messaging services.
- Replace ad-hoc messages with typed request and response contracts.
- Add search cancellation, execution time limits, configurable match caps, zero-length-match handling, and clear partial-result/error states.
- Keep expensive matching outside the UI thread.
- Ensure outdated worker results cannot mutate the current page.
- Establish deterministic handling for overlapping rules.

### `BASE-03` — Automated Verification

- **Status:** `Proposed`
- Add unit tests for pure rule, storage, scoping, and import logic.
- Add DOM integration tests for matching and cleanup.
- Add installed-extension end-to-end tests for permissions, popup messaging, context menus, and persistence.
- Add representative local fixtures resembling long-form reading sites without depending on live third-party pages.
- Run type checking, tests, and the production build in a single verification workflow.

### `BASE-04` — Packaging and Documentation

- **Status:** `Proposed`
- Establish one source manifest and generate or copy the distributable manifest from it.
- Document that unpacked installation uses the built `dist` directory.
- Add extension icons and release metadata.
- Correct unsupported Firefox and all-sites claims.
- Document permissions, local data handling, keyboard commands, known limitations, and development commands.
- Add a release checklist covering versioning, build output, manual smoke tests, and packaging.

### `BASE-05` — Least-Privilege Site Activation

- **Status:** `Proposed`
- Replace required `<all_urls>` content-script execution with user-approved optional host access.
- Request site access only from an explicit user action.
- Dynamically register or inject the content script for approved hosts.
- Keep a visible list of approved sites and allow access to be removed.
- Handle restricted browser pages and revoked permissions clearly.

Chromium supports runtime optional host permissions and programmatic content-script registration. See the [Permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions) and [Scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting).

## Planned Internal Interfaces

These interfaces are targets for selected features and are not external web APIs.

### `StorageEnvelope`

- Schema version
- Profiles
- Site assignments
- Reading sessions
- Extension settings
- Completed migrations

### `HighlightProfile`

- Stable ID
- Name
- Ordered rules
- Optional scope
- Creation and update timestamps

### `HighlightRule`

- Stable ID
- Label
- Literal or regex mode
- Aliases or pattern
- Regex flags
- Whole-word and case behavior
- Color
- Treatment action
- Enabled state

### `SiteAssignment`

- Hostname
- Optional path matcher
- Optional content selector
- Profile ID
- Assignment precedence

### `ReadingSession`

- Stable work identity
- Current URL
- Active profile
- Scroll or text anchor
- Manual bookmarks
- Update timestamp

### `ExportEnvelope`

- Format version
- Export timestamp
- Exported extension version
- Selected data categories
- Validated local data

### Extension Messaging

Replace ad-hoc extension messages with a discriminated request/response union covering:

- Active-tab state
- Permission state
- Profile creation and selection
- Rule updates
- Search execution and cancellation
- Match previews and navigation
- Reading-session resume
- Structured errors

### Keyboard Commands

Declare platform-aware extension commands for widget toggle and match navigation. Chromium commands support platform-specific default keys and user remapping through the browser’s extension shortcuts page. See the [Commands API](https://developer.chrome.com/docs/extensions/reference/api/commands).

## Execution Rules

1. Referencing a roadmap ID authorizes only that item.
2. If an unselected dependency is required, present the dependency bundle before implementation.
3. Before implementing a selected item:
   - Change its status to `Selected`.
   - Add an implementation checklist beneath the item.
   - Record exact UI behavior, data changes, migrations, edge cases, and tests.
   - Add the selection and material decisions to the decision log.
4. Change the status to `In Progress` only when implementation starts.
5. Do not silently expand one feature into unrelated roadmap items.
6. Mark an item `Done` only after its acceptance criteria and verification pass.
7. Record blockers and rejected alternatives in the decision log rather than silently changing the feature.

## Test Strategy

### Unit Tests

- Literal escaping
- Alias compilation
- Regex flags and validation
- Whole-word behavior
- Rule overlap precedence
- Site and path scoping precedence
- Storage migrations
- Import validation and conflict handling
- Message contracts
- Reading-anchor normalization

### DOM Integration Tests

- Excluded and editable elements
- Nested inline elements
- Highlight cleanup
- Dynamic insertion
- SPA navigation
- Zero-length patterns
- Search cancellation
- Large match sets
- Overlapping rules
- Content treatment reveal and restoration

### Installed-Extension Tests

- Permission onboarding and removal
- Allowed and disallowed pages
- Restricted browser pages
- Popup-to-tab messaging
- Context-menu capture
- Reload and SPA navigation
- Profile and session restoration
- Browser zoom
- Missing content script
- Invalid or unavailable page region

### Accessibility Checks

- Keyboard-only operation
- Visible focus
- Focus restoration
- Screen-reader labels
- Status announcements
- WCAG AA contrast
- Reduced motion
- Zoom and text scaling

### Completion Gate

Every completed feature must pass:

- Type checking
- Production build
- Targeted tests for the selected feature
- Existing regression tests
- Manual verification on local AO3-like and FanFiction-like fixtures
- Review of its acceptance checklist

## Decision Log

| Date | IDs | Decision | Reason |
|---|---|---|---|
| 2026-07-30 | Roadmap | Focus the product on reading-companion workflows. | The intended direction prioritizes long-form reading rather than a general developer regex utility. |
| 2026-07-30 | Roadmap | Target Chromium first. | Chrome and Edge receive the initial compatibility and release effort; Firefox is deferred. |
| 2026-07-30 | `BASE-01`, `RC-10` | Use local-first storage with explicit JSON backup and restore. | Keeps reading data on-device and avoids cloud accounts, quotas, and network dependencies. |
| 2026-07-30 | Roadmap | Include engineering foundations with visible features. | Reliable storage, permissions, testing, packaging, accessibility, and performance are required to ship features safely. |

## Assumptions and Defaults

- The product is a reading companion rather than a general developer regex utility.
- Chromium and Manifest V3 are the initial browser targets.
- Firefox compatibility is deferred until explicitly selected as a future roadmap item.
- Data remains local-first with no cloud service, account system, telemetry, or required network connection.
- Existing saved patterns and settings must be preserved through migration where technically recoverable.
- Lookarounds remain disabled until matching-safety work explicitly demonstrates acceptable cancellation and performance.
- Existing behavior should remain compatible unless the selected item explicitly replaces it.
- Feature implementation begins only after the user selects roadmap IDs by referencing this file.
