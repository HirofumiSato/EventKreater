# トレーサビリティ（コード → 文書）

*生成物: `npm run docs:gen`（scripts/gen-traceability.mjs）。手で編集しないでください。*

原稿に書かれたリポジトリ内パスを逆引きし、どのコードをどの文書が説明しているかを並べます。
冒頭で実装前の設計と断っている文書は、現在の構成と一致しないため対象外です。

- 対象文書: 96（実装前の設計 15 件は除外）
- 文書から参照されているコードパス: 225
- API ルート: 73（どの文書にも URL が無いもの 1）
- 文書が指すが実在しないパス: 5（既知 5 / 新規 0）

## コード → 文書

| コード | 参照する文書 |
| --- | --- |
| `prisma/migrations` | `AGENTS.md` / [docs/database.rst](database.rst) / `llms.txt` |
| `prisma/migrations/20261021150000_pricing_campaigns` | [docs/pricing_campaign_requirements.md](pricing_campaign_requirements.md) |
| `prisma/migrations/20261021150000_pricing_campaigns/migration.sql` | [docs/DBschema.md](DBschema.md) / [docs/pricing_campaign_requirements.md](pricing_campaign_requirements.md) |
| `prisma/migrations/20261022140000_participant_waitlist/migration.sql` | [docs/issues/waitlist.md](issues/waitlist.md) |
| `prisma/migrations/20261022160000_organizer_profile/migration.sql` | [docs/issues/organizer-profile.md](issues/organizer-profile.md) |
| `prisma/schema.prisma` | `AGENTS.md` / [docs/README.md](README.md) / [docs/archive/index.rst](archive/index.rst) / [docs/database.rst](database.rst) / [docs/deploy.rst](deploy.rst) / [docs/issues/cohost-revenue-allocation.md](issues/cohost-revenue-allocation.md) / [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) / [docs/issues/organizer-event-calendar.md](issues/organizer-event-calendar.md) / [docs/issues/organizer-revenue-dashboard.md](issues/organizer-revenue-dashboard.md) / [docs/issues/participant-calendar.md](issues/participant-calendar.md) / [docs/issues/waitlist.md](issues/waitlist.md) / [docs/pricing_campaign_requirements.md](pricing_campaign_requirements.md) / [docs/testing/ci.rst](testing/ci.rst) / `llms.txt` |
| `public/samples` | [docs/ui-review/home-audit.md](ui-review/home-audit.md) |
| `public/samples/flyer-autumn.jpg` | [docs/ui-review/home-audit.md](ui-review/home-audit.md) |
| `scripts/check-doc-links.mjs` | [docs/README.md](README.md) / [docs/index.rst](index.rst) |
| `scripts/ci-scope.mjs` | [docs/onboarding.md](onboarding.md) / [docs/testing/ci.rst](testing/ci.rst) |
| `scripts/lib/docs-util.mjs` | [docs/README.md](README.md) |
| `services/flyer` | [docs/testing/ci.rst](testing/ci.rst) |
| `services/flyer/AGENTS.md` | `AGENTS.md` / [docs/README.md](README.md) / [docs/onboarding.md](onboarding.md) / `llms.txt` |
| `services/flyer/mypy.ini` | `services/flyer/AGENTS.md` |
| `services/flyer/README.md` | [docs/README.md](README.md) |
| `services/flyer/requirements.txt` | [docs/testing/ci.rst](testing/ci.rst) |
| `services/flyer/src` | `AGENTS.md` / [docs/README.md](README.md) / [docs/archive/index.rst](archive/index.rst) |
| `services/flyer/src/adapters/image_generator/dalle_image_generator.py` | [docs/flyer/libraries/httpx.rst](flyer/libraries/httpx.rst) / [docs/flyer/libraries/openai.rst](flyer/libraries/openai.rst) |
| `services/flyer/src/adapters/prompt_engine/openai_prompt_engine.py` | [docs/flyer/libraries/openai.rst](flyer/libraries/openai.rst) |
| `services/flyer/src/adapters/renderer` | [docs/flyer/libraries/index.rst](flyer/libraries/index.rst) / [docs/flyer/libraries/pillow.rst](flyer/libraries/pillow.rst) / `services/flyer/README.md` |
| `services/flyer/src/adapters/renderer/layout_calculator.py` | `services/flyer/AGENTS.md` |
| `services/flyer/src/adapters/wiring.py` | `services/flyer/AGENTS.md` |
| `services/flyer/src/api/errors.py` | [docs/flyer/libraries/fastapi.rst](flyer/libraries/fastapi.rst) / [docs/flyer/reference/http.rst](flyer/reference/http.rst) / [docs/flyer/sphinx_structure.rst](flyer/sphinx_structure.rst) |
| `services/flyer/src/api/routes.py` | [docs/flyer/catchup/python_project.rst](flyer/catchup/python_project.rst) / [docs/flyer/libraries/fastapi.rst](flyer/libraries/fastapi.rst) / [docs/flyer/libraries/index.rst](flyer/libraries/index.rst) / [docs/flyer/reference/http.rst](flyer/reference/http.rst) / [docs/flyer/sphinx_structure.rst](flyer/sphinx_structure.rst) / [docs/flyer/swagger.rst](flyer/swagger.rst) / `services/flyer/README.md` |
| `services/flyer/src/domain/exceptions.py` | `services/flyer/AGENTS.md` |
| `services/flyer/src/domain/models.py` | [docs/flyer/libraries/index.rst](flyer/libraries/index.rst) / [docs/flyer/libraries/pydantic.rst](flyer/libraries/pydantic.rst) / [docs/flyer/swagger.rst](flyer/swagger.rst) / `services/flyer/README.md` |
| `services/flyer/src/infrastructure/storage/local_candidate_store.py` | `services/flyer/AGENTS.md` |
| `services/flyer/src/main.py` | [docs/flyer/architecture.rst](flyer/architecture.rst) / [docs/flyer/catchup/python_project.rst](flyer/catchup/python_project.rst) / [docs/flyer/libraries/fastapi.rst](flyer/libraries/fastapi.rst) / [docs/flyer/local_run.rst](flyer/local_run.rst) / [docs/flyer/reference/http.rst](flyer/reference/http.rst) / [docs/flyer/sphinx_structure.rst](flyer/sphinx_structure.rst) / `llms.txt` / `services/flyer/AGENTS.md` |
| `services/flyer/src/ports` | `services/flyer/AGENTS.md` |
| `services/flyer/tests` | [docs/testing/ci.rst](testing/ci.rst) |
| `services/flyer/tests/support.py` | [docs/flyer/testing/design.rst](flyer/testing/design.rst) / `services/flyer/AGENTS.md` |
| `services/flyer/tests/test_adapters.py` | [docs/flyer/libraries/pytest.rst](flyer/libraries/pytest.rst) / [docs/flyer/testing/design.rst](flyer/testing/design.rst) |
| `services/flyer/tests/test_api_integration.py` | [docs/flyer/libraries/pytest.rst](flyer/libraries/pytest.rst) / [docs/flyer/testing/design.rst](flyer/testing/design.rst) |
| `services/flyer/tests/test_domain.py` | [docs/flyer/libraries/pytest.rst](flyer/libraries/pytest.rst) / [docs/flyer/testing/design.rst](flyer/testing/design.rst) |
| `services/flyer/tests/test_renderer.py` | [docs/flyer/libraries/pytest.rst](flyer/libraries/pytest.rst) / [docs/flyer/testing/design.rst](flyer/testing/design.rst) |
| `src/app` | `AGENTS.md` / [docs/README.md](README.md) / [docs/archive/index.rst](archive/index.rst) / [docs/event-page/index.rst](event-page/index.rst) |
| `src/app/account/email/verify/page.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/app/account/page.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/app/api` | `AGENTS.md` / [docs/README.md](README.md) / [docs/archive/index.rst](archive/index.rst) / [docs/event-page/index.rst](event-page/index.rst) / [docs/index.rst](index.rst) / [docs/sitemap.rst](sitemap.rst) / [docs/testing/design.rst](testing/design.rst) / [docs/testing/scope.rst](testing/scope.rst) / [docs/testing/vitest/basics.rst](testing/vitest/basics.rst) |
| `src/app/api/v1` | `AGENTS.md` |
| `src/app/api/v1/admin/pricing-campaigns` | [docs/pricing_campaign_requirements.md](pricing_campaign_requirements.md) |
| `src/app/api/v1/admin/session/route.ts` | [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) |
| `src/app/api/v1/auth/local/route.ts` | [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) |
| `src/app/api/v1/auth/verification/route.ts` | [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) |
| `src/app/api/v1/auth/verify/route.ts` | [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) |
| `src/app/api/v1/billing/checkout` | [docs/onboarding.md](onboarding.md) |
| `src/app/api/v1/billing/checkout/one-time/route.ts` | [docs/backend_api_implementation_spec.md](backend_api_implementation_spec.md) |
| `src/app/api/v1/billing/checkout/subscription/route.ts` | [docs/backend_api_implementation_spec.md](backend_api_implementation_spec.md) |
| `src/app/api/v1/billing/checkout/verify/route.ts` | [docs/backend_api_implementation_spec.md](backend_api_implementation_spec.md) |
| `src/app/api/v1/billing/portal/route.ts` | [docs/backend_api_implementation_spec.md](backend_api_implementation_spec.md) |
| `src/app/api/v1/billing/quota/route.ts` | [docs/backend_api_implementation_spec.md](backend_api_implementation_spec.md) |
| `src/app/api/v1/internal/billing/notices/route.ts` | [docs/pricing_campaign_requirements.md](pricing_campaign_requirements.md) |
| `src/app/api/v1/invitations/[code]/route.ts` | [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) |
| `src/app/api/v1/organizer/events/[id]/clone/route.ts` | [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) |
| `src/app/api/v1/organizer/events/[id]/invitations/route.ts` | [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) |
| `src/app/api/v1/organizer/events/[id]/participants/[participantId]/receipt/route.ts` | [docs/issues/cohost-revenue-allocation.md](issues/cohost-revenue-allocation.md) / [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) / [docs/issues/waitlist.md](issues/waitlist.md) |
| `src/app/api/v1/organizer/events/[id]/participants/[participantId]/route.ts` | [docs/issues/organizer-revenue-dashboard.md](issues/organizer-revenue-dashboard.md) / [docs/issues/waitlist.md](issues/waitlist.md) |
| `src/app/api/v1/organizer/events/[id]/participants/route.ts` | [docs/issues/organizer-revenue-dashboard.md](issues/organizer-revenue-dashboard.md) |
| `src/app/api/v1/organizer/events/[id]/publish/route.ts` | [docs/issues/draft-checkout-and-publish.md](issues/draft-checkout-and-publish.md) |
| `src/app/api/v1/organizer/events/[id]/revenue/route.ts` | [docs/issues/cohost-revenue-allocation.md](issues/cohost-revenue-allocation.md) |
| `src/app/api/v1/organizer/events/[id]/route.ts` | [docs/issues/draft-checkout-and-publish.md](issues/draft-checkout-and-publish.md) / [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) |
| `src/app/api/v1/organizer/events/route.ts` | [docs/issues/organizer-event-calendar.md](issues/organizer-event-calendar.md) |
| `src/app/api/v1/organizer/revenue/route.ts` | [docs/issues/cohost-revenue-allocation.md](issues/cohost-revenue-allocation.md) / [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) |
| `src/app/api/v1/public/events/[id]/route.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) / [docs/issues/public-organizer-page.md](issues/public-organizer-page.md) / [docs/onboarding.md](onboarding.md) |
| `src/app/api/v1/public/events/[id]/rsvp/route.ts` | [docs/issues/organizer-revenue-dashboard.md](issues/organizer-revenue-dashboard.md) / [docs/issues/waitlist.md](issues/waitlist.md) |
| `src/app/api/v1/public/events/route.ts` | [docs/issues/draft-checkout-and-publish.md](issues/draft-checkout-and-publish.md) / [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) |
| `src/app/api/v1/public/pricing/route.ts` | [docs/pricing_campaign_requirements.md](pricing_campaign_requirements.md) |
| `src/app/api/v1/user/calendar/route.ts` | [docs/issues/participant-calendar.md](issues/participant-calendar.md) |
| `src/app/api/v1/user/hydrate/route.ts` | [docs/issues/organizer-revenue-dashboard.md](issues/organizer-revenue-dashboard.md) |
| `src/app/api/v1/user/participations/route.ts` | [docs/issues/participant-calendar.md](issues/participant-calendar.md) |
| `src/app/api/v1/webhooks/stripe/route.ts` | [docs/backend_api_implementation_spec.md](backend_api_implementation_spec.md) / [docs/stripe.rst](stripe.rst) / [docs/testing/first-cases.rst](testing/first-cases.rst) |
| `src/app/attendance.css` | [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) / [docs/issues/organizer-event-calendar.md](issues/organizer-event-calendar.md) / [docs/issues/participant-calendar.md](issues/participant-calendar.md) / [docs/issues/waitlist.md](issues/waitlist.md) / [docs/ui-review/home-audit.md](ui-review/home-audit.md) |
| `src/app/auth/register/page.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/app/auth/verify/page.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) |
| `src/app/console/events/page.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) / [docs/issues/organizer-home-screen-flow.md](issues/organizer-home-screen-flow.md) |
| `src/app/console/layout.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/app/console/login/page.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) |
| `src/app/console/page.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/app/console/payments/page.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/app/console/pricing/page.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/pricing_campaign_requirements.md](pricing_campaign_requirements.md) |
| `src/app/console/users/page.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/app/events/[id]/EventPageClient.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/onboarding.md](onboarding.md) |
| `src/app/events/[id]/page.tsx` | [docs/archive/index.rst](archive/index.rst) / [docs/onboarding.md](onboarding.md) |
| `src/app/invitations/[code]/page.tsx` | [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) |
| `src/app/mypage/page.tsx` | [docs/issues/organizer-home-screen-flow.md](issues/organizer-home-screen-flow.md) |
| `src/app/organizer/calendar/page.tsx` | [docs/issues/organizer-event-calendar.md](issues/organizer-event-calendar.md) |
| `src/app/organizer/events/[id]/edit/page.tsx` | [docs/issues/draft-checkout-and-publish.md](issues/draft-checkout-and-publish.md) / [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) |
| `src/app/organizer/events/[id]/participants/page.tsx` | [docs/issues/organizer-revenue-dashboard.md](issues/organizer-revenue-dashboard.md) |
| `src/app/organizer/events/[id]/revenue/page.tsx` | [docs/issues/cohost-revenue-allocation.md](issues/cohost-revenue-allocation.md) |
| `src/app/organizer/events/new/page.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/draft-checkout-and-publish.md](issues/draft-checkout-and-publish.md) / [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) |
| `src/app/organizer/events/page.tsx` | [docs/issues/draft-checkout-and-publish.md](issues/draft-checkout-and-publish.md) / [docs/issues/organizer-event-calendar.md](issues/organizer-event-calendar.md) / [docs/issues/organizer-home-screen-flow.md](issues/organizer-home-screen-flow.md) / [docs/issues/organizer-revenue-dashboard.md](issues/organizer-revenue-dashboard.md) / [docs/issues/public-organizer-page.md](issues/public-organizer-page.md) |
| `src/app/organizer/profile/page.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/organizer-profile.md](issues/organizer-profile.md) |
| `src/app/organizer/register-required/page.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/organizer-home-screen-flow.md](issues/organizer-home-screen-flow.md) |
| `src/app/organizer/revenue/page.tsx` | [docs/issues/cohost-revenue-allocation.md](issues/cohost-revenue-allocation.md) / [docs/issues/organizer-event-calendar.md](issues/organizer-event-calendar.md) / [docs/issues/organizer-home-screen-flow.md](issues/organizer-home-screen-flow.md) |
| `src/app/organizers/[userId]/events/page.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/public-organizer-page.md](issues/public-organizer-page.md) |
| `src/app/organizers/[userId]/page.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/organizer-profile.md](issues/organizer-profile.md) |
| `src/app/page.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) / [docs/issues/organizer-event-calendar.md](issues/organizer-event-calendar.md) / [docs/issues/organizer-revenue-dashboard.md](issues/organizer-revenue-dashboard.md) / [docs/ui-review/home-audit.md](ui-review/home-audit.md) |
| `src/app/participant/history/page.tsx` | [docs/issues/waitlist.md](issues/waitlist.md) |
| `src/app/participant/page.tsx` | [docs/issues/waitlist.md](issues/waitlist.md) |
| `src/app/robots.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/app/service/page.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) / [docs/issues/organizer-event-calendar.md](issues/organizer-event-calendar.md) / [docs/issues/organizer-revenue-dashboard.md](issues/organizer-revenue-dashboard.md) / [docs/pricing_campaign_requirements.md](pricing_campaign_requirements.md) |
| `src/app/terms/page.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/pricing_campaign_requirements.md](pricing_campaign_requirements.md) |
| `src/components/common/CalendarEventModal.tsx` | [docs/issues/participant-calendar.md](issues/participant-calendar.md) |
| `src/components/common/CalendarMonth.tsx` | [docs/issues/participant-calendar.md](issues/participant-calendar.md) / [docs/issues/public-organizer-page.md](issues/public-organizer-page.md) |
| `src/components/common/Navbar.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/participant-calendar.md](issues/participant-calendar.md) / [docs/ui-review/home-audit.md](ui-review/home-audit.md) |
| `src/components/common/SiteChrome.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/lib` | `AGENTS.md` / [docs/testing/design.rst](testing/design.rst) |
| `src/lib/auth-links.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/organizer-home-screen-flow.md](issues/organizer-home-screen-flow.md) |
| `src/lib/calendar.ts` | [docs/issues/participant-calendar.md](issues/participant-calendar.md) / [docs/issues/public-organizer-page.md](issues/public-organizer-page.md) / [docs/issues/waitlist.md](issues/waitlist.md) |
| `src/lib/crypto.ts` | [docs/backend_api_implementation_spec.md](backend_api_implementation_spec.md) |
| `src/lib/http.ts` | [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) / [docs/local.rst](local.rst) |
| `src/lib/ids.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/lib/prisma.ts` | [docs/database.rst](database.rst) / [docs/overall_system_requirements_common.md](overall_system_requirements_common.md) / [docs/overall_system_requirements_common_review.md](overall_system_requirements_common_review.md) / [docs/testing/vitest/basics.rst](testing/vitest/basics.rst) |
| `src/lib/problem.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) / [docs/onboarding.md](onboarding.md) |
| `src/lib/schemas.ts` | [docs/backend_api_implementation_spec.md](backend_api_implementation_spec.md) / [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/draft-checkout-and-publish.md](issues/draft-checkout-and-publish.md) / [docs/issues/organizer-profile.md](issues/organizer-profile.md) / [docs/testing/first-cases.rst](testing/first-cases.rst) |
| `src/lib/serializers.ts` | [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) / [docs/issues/organizer-event-calendar.md](issues/organizer-event-calendar.md) / [docs/issues/participant-calendar.md](issues/participant-calendar.md) / [docs/issues/public-organizer-page.md](issues/public-organizer-page.md) / [docs/issues/waitlist.md](issues/waitlist.md) |
| `src/lib/site.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/participant-calendar.md](issues/participant-calendar.md) / [docs/local.rst](local.rst) / [docs/overall_system_requirements_common.md](overall_system_requirements_common.md) / [docs/ui-review/home-audit.md](ui-review/home-audit.md) |
| `src/modules` | `AGENTS.md` / [docs/testing/design.rst](testing/design.rst) |
| `src/modules/account/components` | [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) |
| `src/modules/account/components/AccountInfoPanel.tsx` | [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) |
| `src/modules/account/components/PasswordPanel.tsx` | [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) |
| `src/modules/account/components/PhoneChangePanel.tsx` | [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) |
| `src/modules/account/components/WithdrawPanel.tsx` | [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) |
| `src/modules/account/lib/account.ts` | [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) |
| `src/modules/admin/components/AdminChrome.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/modules/admin/lib/directory.ts` | [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) |
| `src/modules/attendance/components/DynamicRsvpBox.tsx` | [docs/issues/waitlist.md](issues/waitlist.md) |
| `src/modules/attendance/components/ParticipantListTable.tsx` | [docs/issues/waitlist.md](issues/waitlist.md) |
| `src/modules/auth` | [docs/archive/index.rst](archive/index.rst) |
| `src/modules/auth/components/AuthEntryScreen.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) |
| `src/modules/auth/components/LoginChallengeForm.tsx` | [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) |
| `src/modules/auth/lib/auth-mode.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/modules/auth/lib/auth.ts` | [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) |
| `src/modules/auth/lib/cookies.ts` | [docs/deploy.rst](deploy.rst) |
| `src/modules/auth/lib/guards.ts` | [docs/backend_api_implementation_spec.md](backend_api_implementation_spec.md) / [docs/issues/cohost-revenue-allocation.md](issues/cohost-revenue-allocation.md) / [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) / [docs/issues/organizer-revenue-dashboard.md](issues/organizer-revenue-dashboard.md) |
| `src/modules/auth/lib/hydrate.ts` | [docs/backend_api_implementation_spec.md](backend_api_implementation_spec.md) / [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) |
| `src/modules/auth/lib/login-challenge.ts` | [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) |
| `src/modules/auth/lib/phone.ts` | [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) |
| `src/modules/auth/lib/rate-limit.ts` | [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) |
| `src/modules/auth/lib/rate-limits.ts` | [docs/backend_api_implementation_spec.md](backend_api_implementation_spec.md) / [docs/deploy.rst](deploy.rst) / [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) / [docs/overall_system_requirements_common.md](overall_system_requirements_common.md) |
| `src/modules/billing` | [docs/issues/organizer-revenue-dashboard.md](issues/organizer-revenue-dashboard.md) |
| `src/modules/billing/components/PricingModal.tsx` | [docs/issues/draft-checkout-and-publish.md](issues/draft-checkout-and-publish.md) / [docs/pricing_campaign_requirements.md](pricing_campaign_requirements.md) |
| `src/modules/billing/components/VerifyPaymentBanner.tsx` | [docs/issues/draft-checkout-and-publish.md](issues/draft-checkout-and-publish.md) |
| `src/modules/billing/hooks/useEventQuota.ts` | [docs/issues/draft-checkout-and-publish.md](issues/draft-checkout-and-publish.md) |
| `src/modules/billing/lib/billing.ts` | [docs/pricing_campaign_requirements.md](pricing_campaign_requirements.md) / [docs/stripe.rst](stripe.rst) |
| `src/modules/billing/lib/campaigns.ts` | [docs/pricing_campaign_requirements.md](pricing_campaign_requirements.md) |
| `src/modules/billing/lib/notices.ts` | [docs/pricing_campaign_requirements.md](pricing_campaign_requirements.md) |
| `src/modules/billing/lib/plans.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/modules/billing/lib/pricing.ts` | [docs/pricing_campaign_requirements.md](pricing_campaign_requirements.md) |
| `src/modules/billing/lib/quota.ts` | [docs/local.rst](local.rst) / [docs/onboarding.md](onboarding.md) / [docs/testing/first-cases.rst](testing/first-cases.rst) / [docs/testing/vitest/basics.rst](testing/vitest/basics.rst) |
| `src/modules/billing/lib/stripe.ts` | [docs/stripe.rst](stripe.rst) |
| `src/modules/events/components` | [docs/onboarding.md](onboarding.md) |
| `src/modules/events/components/EventCard.tsx` | [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) / [docs/issues/organizer-event-calendar.md](issues/organizer-event-calendar.md) / [docs/issues/organizer-home-screen-flow.md](issues/organizer-home-screen-flow.md) |
| `src/modules/events/components/EventFormSections.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/modules/events/components/EventMetaCard.tsx` | [docs/issues/public-organizer-page.md](issues/public-organizer-page.md) |
| `src/modules/events/components/EventStepForm.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/modules/events/components/OrganizerInviteCard.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/modules/events/lib/capacity.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/modules/events/lib/events.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/draft-checkout-and-publish.md](issues/draft-checkout-and-publish.md) / [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) / [docs/issues/organizer-revenue-dashboard.md](issues/organizer-revenue-dashboard.md) / [docs/issues/waitlist.md](issues/waitlist.md) / [docs/onboarding.md](onboarding.md) |
| `src/modules/events/lib/guest-limit.ts` | [docs/backend_api_implementation_spec.md](backend_api_implementation_spec.md) / [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/modules/events/lib/pricing-mode.ts` | [docs/issues/organizer-revenue-dashboard.md](issues/organizer-revenue-dashboard.md) |
| `src/modules/events/lib/referrer.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/modules/events/lib/rsvp-status.ts` | [docs/issues/waitlist.md](issues/waitlist.md) / [docs/onboarding.md](onboarding.md) |
| `src/modules/events/lib/steps.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/modules/events/types.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/organizer-event-calendar.md](issues/organizer-event-calendar.md) |
| `src/modules/flyers` | [docs/onboarding.md](onboarding.md) |
| `src/modules/flyers/lib/flyer.ts` | [docs/deploy.rst](deploy.rst) |
| `src/modules/flyers/lib/upload-limit.ts` | [docs/deploy.rst](deploy.rst) |
| `src/modules/media/lib/listings.ts` | [docs/overall_system_requirements_common.md](overall_system_requirements_common.md) |
| `src/modules/organizers/components/CalendarView.tsx` | [docs/issues/organizer-event-calendar.md](issues/organizer-event-calendar.md) / [docs/issues/participant-calendar.md](issues/participant-calendar.md) |
| `src/modules/organizers/components/OrganizerPageView.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/modules/organizers/components/OrganizerProfileForm.tsx` | [docs/issues/organizer-home-screen-flow.md](issues/organizer-home-screen-flow.md) |
| `src/modules/organizers/components/OrganizerProfileView.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) |
| `src/modules/organizers/components/OrganizerTabs.tsx` | [docs/issues/organizer-event-calendar.md](issues/organizer-event-calendar.md) |
| `src/modules/organizers/lib/calendar.ts` | [docs/issues/organizer-event-calendar.md](issues/organizer-event-calendar.md) / [docs/issues/participant-calendar.md](issues/participant-calendar.md) |
| `src/modules/organizers/lib/invitations.ts` | [docs/issues/cohost-revenue-allocation.md](issues/cohost-revenue-allocation.md) / [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) |
| `src/modules/organizers/lib/names.ts` | [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) |
| `src/modules/organizers/lib/profile-store.ts` | [docs/issues/organizer-profile.md](issues/organizer-profile.md) |
| `src/modules/organizers/lib/profile.ts` | [docs/issues/organizer-profile.md](issues/organizer-profile.md) |
| `src/modules/organizers/lib/public-page.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/public-organizer-page.md](issues/public-organizer-page.md) |
| `src/modules/organizers/types.ts` | [docs/issues/organizer-profile.md](issues/organizer-profile.md) |
| `src/modules/participants/components/ParticipantCalendarView.tsx` | [docs/issues/public-organizer-page.md](issues/public-organizer-page.md) |
| `src/modules/participants/lib/calendar.ts` | [docs/issues/participant-calendar.md](issues/participant-calendar.md) |
| `src/modules/participants/lib/participations.ts` | [docs/issues/participant-calendar.md](issues/participant-calendar.md) / [docs/issues/waitlist.md](issues/waitlist.md) |
| `src/modules/participants/lib/rsvp.ts` | [docs/issues/waitlist.md](issues/waitlist.md) |
| `src/modules/participants/types.ts` | [docs/issues/participant-calendar.md](issues/participant-calendar.md) |
| `src/modules/revenue/components` | [docs/issues/organizer-revenue-dashboard.md](issues/organizer-revenue-dashboard.md) |
| `src/modules/revenue/components/RevenueSummaryLedger.tsx` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/cohost-revenue-allocation.md](issues/cohost-revenue-allocation.md) |
| `src/modules/revenue/lib/allocation.ts` | [docs/backend_api_implementation_spec.md](backend_api_implementation_spec.md) / [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/cohost-revenue-allocation.md](issues/cohost-revenue-allocation.md) |
| `src/modules/revenue/lib/revenue.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/cohost-revenue-allocation.md](issues/cohost-revenue-allocation.md) / [docs/issues/organizer-revenue-dashboard.md](issues/organizer-revenue-dashboard.md) / [docs/issues/waitlist.md](issues/waitlist.md) |
| `tests/integration` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/testing/ci.rst](testing/ci.rst) / [docs/testing/design.rst](testing/design.rst) / [docs/testing/first-cases.rst](testing/first-cases.rst) / [docs/testing/index.rst](testing/index.rst) / [docs/testing/local-run.rst](testing/local-run.rst) / [docs/testing/scope.rst](testing/scope.rst) / [docs/testing/vitest/basics.rst](testing/vitest/basics.rst) / [docs/testing/vitest/index.rst](testing/vitest/index.rst) / [docs/testing/vitest/run-cycle.rst](testing/vitest/run-cycle.rst) |
| `tests/integration/auth-attempts.test.ts` | [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) / [docs/testing/scope.rst](testing/scope.rst) |
| `tests/integration/draft-publish.test.ts` | [docs/issues/draft-checkout-and-publish.md](issues/draft-checkout-and-publish.md) |
| `tests/integration/guest-limit.test.ts` | [docs/testing/scope.rst](testing/scope.rst) / [docs/testing/vitest/basics.rst](testing/vitest/basics.rst) |
| `tests/integration/helpers.ts` | [docs/testing/vitest/basics.rst](testing/vitest/basics.rst) |
| `tests/integration/hydrate.test.ts` | [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) / [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) / [docs/testing/ci.rst](testing/ci.rst) / [docs/testing/scope.rst](testing/scope.rst) |
| `tests/integration/organizer-profile.test.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/organizer-profile.md](issues/organizer-profile.md) |
| `tests/integration/organizers.test.ts` | [docs/issues/event-owner-and-cohosts.md](issues/event-owner-and-cohosts.md) |
| `tests/integration/public-organizer-page.test.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/public-organizer-page.md](issues/public-organizer-page.md) |
| `tests/integration/revenue.test.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/cohost-revenue-allocation.md](issues/cohost-revenue-allocation.md) / [docs/testing/scope.rst](testing/scope.rst) |
| `tests/integration/waitlist.test.ts` | [docs/issues/waitlist.md](issues/waitlist.md) |
| `tests/setup/db.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/testing/ci.rst](testing/ci.rst) / [docs/testing/local-run.rst](testing/local-run.rst) / [docs/testing/vitest/basics.rst](testing/vitest/basics.rst) / [docs/testing/vitest/index.rst](testing/vitest/index.rst) / [docs/testing/vitest/practice.rst](testing/vitest/practice.rst) / [docs/testing/vitest/run-cycle.rst](testing/vitest/run-cycle.rst) |
| `tests/unit` | [docs/testing/ci.rst](testing/ci.rst) / [docs/testing/first-cases.rst](testing/first-cases.rst) / [docs/testing/index.rst](testing/index.rst) / [docs/testing/scope.rst](testing/scope.rst) / [docs/testing/vitest/basics.rst](testing/vitest/basics.rst) / [docs/testing/vitest/index.rst](testing/vitest/index.rst) / [docs/testing/vitest/practice.rst](testing/vitest/practice.rst) / [docs/testing/vitest/run-cycle.rst](testing/vitest/run-cycle.rst) |
| `tests/unit/allocation.test.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/cohost-revenue-allocation.md](issues/cohost-revenue-allocation.md) |
| `tests/unit/auth-links.test.ts` | [docs/issues/organizer-home-screen-flow.md](issues/organizer-home-screen-flow.md) |
| `tests/unit/auth-mode.test.ts` | [docs/testing/scope.rst](testing/scope.rst) |
| `tests/unit/auth-rate-limits.test.ts` | [docs/issues/auth-attempt-limits.md](issues/auth-attempt-limits.md) / [docs/testing/scope.rst](testing/scope.rst) |
| `tests/unit/checkout-intent.test.ts` | [docs/issues/draft-checkout-and-publish.md](issues/draft-checkout-and-publish.md) |
| `tests/unit/ci-scope.test.mjs` | [docs/testing/ci.rst](testing/ci.rst) |
| `tests/unit/event-capacity.test.ts` | [docs/testing/scope.rst](testing/scope.rst) |
| `tests/unit/event-details.test.ts` | [docs/testing/scope.rst](testing/scope.rst) |
| `tests/unit/event-payload-schema.test.ts` | [docs/issues/draft-checkout-and-publish.md](issues/draft-checkout-and-publish.md) / [docs/testing/scope.rst](testing/scope.rst) |
| `tests/unit/event-steps.test.ts` | [docs/testing/scope.rst](testing/scope.rst) |
| `tests/unit/flyer-quota.test.ts` | [docs/testing/scope.rst](testing/scope.rst) |
| `tests/unit/guest-draft.test.ts` | [docs/issues/draft-checkout-and-publish.md](issues/draft-checkout-and-publish.md) / [docs/issues/organizer-home-screen-flow.md](issues/organizer-home-screen-flow.md) |
| `tests/unit/guest-edit-window.test.ts` | [docs/testing/scope.rst](testing/scope.rst) / [docs/testing/vitest/basics.rst](testing/vitest/basics.rst) |
| `tests/unit/hydration-quota.test.ts` | [docs/testing/scope.rst](testing/scope.rst) |
| `tests/unit/organizer-calendar.test.ts` | [docs/issues/organizer-event-calendar.md](issues/organizer-event-calendar.md) / [docs/issues/participant-calendar.md](issues/participant-calendar.md) / [docs/issues/waitlist.md](issues/waitlist.md) |
| `tests/unit/organizer-profile.test.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/organizer-profile.md](issues/organizer-profile.md) |
| `tests/unit/participant-calendar.test.ts` | [docs/issues/participant-calendar.md](issues/participant-calendar.md) / [docs/issues/waitlist.md](issues/waitlist.md) |
| `tests/unit/problem.test.ts` | [docs/testing/design.rst](testing/design.rst) / [docs/testing/local-run.rst](testing/local-run.rst) / [docs/testing/scope.rst](testing/scope.rst) / [docs/testing/vitest/basics.rst](testing/vitest/basics.rst) |
| `tests/unit/public-organizer-page.test.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/public-organizer-page.md](issues/public-organizer-page.md) |
| `tests/unit/referrer.test.ts` | [docs/testing/scope.rst](testing/scope.rst) |
| `tests/unit/revenue.test.ts` | [docs/front_implementation_spec.md](front_implementation_spec.md) / [docs/issues/cohost-revenue-allocation.md](issues/cohost-revenue-allocation.md) / [docs/issues/waitlist.md](issues/waitlist.md) / [docs/testing/scope.rst](testing/scope.rst) |
| `tests/unit/rsvp-status.test.ts` | [docs/issues/waitlist.md](issues/waitlist.md) / [docs/onboarding.md](onboarding.md) |

## 文書が指すが実在しないパス

| パス | 種別 | 参照する文書 |
| --- | --- | --- |
| `src/lib/db.ts` | 既知 | [docs/README.md](README.md) / [docs/overall_system_requirements_common_review.md](overall_system_requirements_common_review.md) |
| `src/lib/guards.ts` | 既知 | [docs/README.md](README.md) / [docs/backend_api_implementation_spec.md](backend_api_implementation_spec.md) |
| `src/lib/quota.ts` | 既知 | [docs/README.md](README.md) / [docs/overall_system_requirements_common_review.md](overall_system_requirements_common_review.md) |
| `src/lib/response.ts` | 既知 | [docs/README.md](README.md) |
| `src/types/event.ts` | 既知 | [docs/README.md](README.md) / [docs/front_implementation_spec.md](front_implementation_spec.md) |

既知のものは `scripts/lib/docs-util.mjs` の `KNOWN_MISSING` に登録されています。新規は仕様書か実装のどちらかを直します。

## どの文書にも URL が出てこない API ルート

- `GET /api/v1/flyer-assets` — `src/app/api/v1/flyer-assets/route.ts`

`docs/backend_api_implementation_spec.md` に追記するか、不要なら実装を消します。
