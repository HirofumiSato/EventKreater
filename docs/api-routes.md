# API ルート一覧

*生成物: `npm run docs:gen`（scripts/gen-api-routes.mjs）。手で編集しないでください。*

`src/app/api/**/route.ts` を走査した結果です。ディレクトリ構造がそのまま URL になり、ルートグループ `(...)` は URL に含めません。
仕様の列は `docs/backend_api_implementation_spec.md` の表と本文に、同じメソッドとパスがあるかで判定しています。

- ルートファイル: 78
- エンドポイント（メソッド × パス）: 94
- 仕様書に記載: 88
- 実装のみ（仕様書に記載なし）: 6
- 仕様書のみ（実装なし）: 0

## 一覧

| メソッド | パス | 認可 | 仕様 | 実装ファイル |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/events` | 必須（requireAdmin） | あり | `src/app/api/v1/admin/events/route.ts` |
| GET | `/api/v1/admin/payments` | 必須（requireAdmin） | あり | `src/app/api/v1/admin/payments/route.ts` |
| GET | `/api/v1/admin/pricing-campaigns` | 必須（requireAdmin） | あり | `src/app/api/v1/admin/pricing-campaigns/route.ts` |
| POST | `/api/v1/admin/pricing-campaigns` | 必須（requireAdmin） | あり | `src/app/api/v1/admin/pricing-campaigns/route.ts` |
| GET | `/api/v1/admin/pricing-campaigns/[id]` | 必須（requireAdmin） | あり | `src/app/api/v1/admin/pricing-campaigns/[id]/route.ts` |
| PATCH | `/api/v1/admin/pricing-campaigns/[id]` | 必須（requireAdmin） | あり | `src/app/api/v1/admin/pricing-campaigns/[id]/route.ts` |
| POST | `/api/v1/admin/pricing-campaigns/[id]/stop` | 必須（requireAdmin） | あり | `src/app/api/v1/admin/pricing-campaigns/[id]/stop/route.ts` |
| GET | `/api/v1/admin/session` | 必須（requireAdmin） | あり | `src/app/api/v1/admin/session/route.ts` |
| POST | `/api/v1/admin/session` | 必須（requireAdmin） | あり | `src/app/api/v1/admin/session/route.ts` |
| DELETE | `/api/v1/admin/session` | 必須（requireAdmin） | あり | `src/app/api/v1/admin/session/route.ts` |
| GET | `/api/v1/admin/users` | 必須（requireAdmin） | あり | `src/app/api/v1/admin/users/route.ts` |
| PATCH | `/api/v1/admin/users/[id]` | 必須（requireAdmin） | あり | `src/app/api/v1/admin/users/[id]/route.ts` |
| GET | `/api/v1/auth/google` | なし | あり | `src/app/api/v1/auth/google/route.ts` |
| GET | `/api/v1/auth/google/callback` | なし | あり | `src/app/api/v1/auth/google/callback/route.ts` |
| POST | `/api/v1/auth/local` | なし | あり | `src/app/api/v1/auth/local/route.ts` |
| GET | `/api/v1/auth/login-challenge` | なし | あり | `src/app/api/v1/auth/login-challenge/route.ts` |
| POST | `/api/v1/auth/login-challenge` | なし | あり | `src/app/api/v1/auth/login-challenge/route.ts` |
| POST | `/api/v1/auth/login-challenge/confirm` | なし | あり | `src/app/api/v1/auth/login-challenge/confirm/route.ts` |
| POST | `/api/v1/auth/logout` | なし | あり | `src/app/api/v1/auth/logout/route.ts` |
| POST | `/api/v1/auth/phone/confirm` | 条件付き（resolveOptionalUserId） | あり | `src/app/api/v1/auth/phone/confirm/route.ts` |
| POST | `/api/v1/auth/phone/start` | 条件付き（resolveOptionalUserId） | あり | `src/app/api/v1/auth/phone/start/route.ts` |
| GET | `/api/v1/auth/session` | 条件付き（resolveOptionalUserId） | あり | `src/app/api/v1/auth/session/route.ts` |
| POST | `/api/v1/auth/verification` | なし | あり | `src/app/api/v1/auth/verification/route.ts` |
| POST | `/api/v1/auth/verify` | なし | あり | `src/app/api/v1/auth/verify/route.ts` |
| POST | `/api/v1/billing/checkout/one-time` | 必須（requireUserId） | あり | `src/app/api/v1/billing/checkout/one-time/route.ts` |
| POST | `/api/v1/billing/checkout/subscription` | 必須（requireUserId） | あり | `src/app/api/v1/billing/checkout/subscription/route.ts` |
| POST | `/api/v1/billing/checkout/verify` | 必須（requireUserId） | あり | `src/app/api/v1/billing/checkout/verify/route.ts` |
| POST | `/api/v1/billing/portal` | 必須（requireUserId） | あり | `src/app/api/v1/billing/portal/route.ts` |
| GET | `/api/v1/billing/quota` | 必須（requireUserId） | あり | `src/app/api/v1/billing/quota/route.ts` |
| GET | `/api/v1/flyer-assets` | なし | あり | `src/app/api/v1/flyer-assets/route.ts` |
| POST | `/api/v1/flyer-assets` | なし | あり | `src/app/api/v1/flyer-assets/route.ts` |
| DELETE | `/api/v1/flyer-assets/[id]` | なし | なし | `src/app/api/v1/flyer-assets/[id]/route.ts` |
| GET | `/api/v1/flyer-assets/[id]/image` | なし | あり | `src/app/api/v1/flyer-assets/[id]/image/route.ts` |
| POST | `/api/v1/flyers/candidates` | なし | あり | `src/app/api/v1/flyers/candidates/route.ts` |
| GET | `/api/v1/flyers/candidates/[id]` | なし | あり | `src/app/api/v1/flyers/candidates/[id]/route.ts` |
| POST | `/api/v1/flyers/candidates/[id]/layouts` | なし | あり | `src/app/api/v1/flyers/candidates/[id]/layouts/route.ts` |
| POST | `/api/v1/flyers/candidates/[id]/palettes` | なし | あり | `src/app/api/v1/flyers/candidates/[id]/palettes/route.ts` |
| POST | `/api/v1/flyers/candidates/types` | なし | あり | `src/app/api/v1/flyers/candidates/types/route.ts` |
| POST | `/api/v1/flyers/generate` | なし | あり | `src/app/api/v1/flyers/generate/route.ts` |
| GET | `/api/v1/flyers/quota` | なし | あり | `src/app/api/v1/flyers/quota/route.ts` |
| POST | `/api/v1/flyers/uploads` | なし | あり | `src/app/api/v1/flyers/uploads/route.ts` |
| GET | `/api/v1/geo/postal-codes/[code]` | なし | なし | `src/app/api/v1/geo/postal-codes/[code]/route.ts` |
| POST | `/api/v1/internal/billing/notices` | なし | あり | `src/app/api/v1/internal/billing/notices/route.ts` |
| GET | `/api/v1/invitations/[code]` | 条件付き（resolveAuthContext, resolveOptionalUserId） | あり | `src/app/api/v1/invitations/[code]/route.ts` |
| POST | `/api/v1/invitations/[code]` | 条件付き（resolveAuthContext, resolveOptionalUserId） | なし | `src/app/api/v1/invitations/[code]/route.ts` |
| GET | `/api/v1/organizer/events` | 条件付き（collectGuestTokenHashes, resolveUserId） | あり | `src/app/api/v1/organizer/events/route.ts` |
| GET | `/api/v1/organizer/events/[id]` | 条件付き（assertGuestEditWindow, assertLockHolder, assertOrganizer, assertOwner） | あり | `src/app/api/v1/organizer/events/[id]/route.ts` |
| PUT | `/api/v1/organizer/events/[id]` | 条件付き（assertGuestEditWindow, assertLockHolder, assertOrganizer, assertOwner） | あり | `src/app/api/v1/organizer/events/[id]/route.ts` |
| DELETE | `/api/v1/organizer/events/[id]` | 条件付き（assertGuestEditWindow, assertLockHolder, assertOrganizer, assertOwner） | あり | `src/app/api/v1/organizer/events/[id]/route.ts` |
| POST | `/api/v1/organizer/events/[id]/clone` | 条件付き（assertOrganizer） | あり | `src/app/api/v1/organizer/events/[id]/clone/route.ts` |
| POST | `/api/v1/organizer/events/[id]/draft` | 条件付き（assertOrganizer） | あり | `src/app/api/v1/organizer/events/[id]/draft/route.ts` |
| POST | `/api/v1/organizer/events/[id]/invitations` | 条件付き（assertRegisteredOwner） | あり | `src/app/api/v1/organizer/events/[id]/invitations/route.ts` |
| POST | `/api/v1/organizer/events/[id]/lifecycle` | 条件付き（assertOwner） | あり | `src/app/api/v1/organizer/events/[id]/lifecycle/route.ts` |
| POST | `/api/v1/organizer/events/[id]/lock` | 条件付き（assertGuestEditWindow, assertOrganizer） | あり | `src/app/api/v1/organizer/events/[id]/lock/route.ts` |
| DELETE | `/api/v1/organizer/events/[id]/lock` | 条件付き（assertGuestEditWindow, assertOrganizer） | あり | `src/app/api/v1/organizer/events/[id]/lock/route.ts` |
| GET | `/api/v1/organizer/events/[id]/organizers` | 条件付き（assertOrganizer） | なし | `src/app/api/v1/organizer/events/[id]/organizers/route.ts` |
| DELETE | `/api/v1/organizer/events/[id]/organizers/[organizerId]` | 条件付き（assertRegisteredOwner） | なし | `src/app/api/v1/organizer/events/[id]/organizers/[organizerId]/route.ts` |
| GET | `/api/v1/organizer/events/[id]/participants` | 条件付き（assertRegisteredOrganizer） | あり | `src/app/api/v1/organizer/events/[id]/participants/route.ts` |
| PATCH | `/api/v1/organizer/events/[id]/participants/[participantId]` | 条件付き（assertRegisteredOrganizer） | あり | `src/app/api/v1/organizer/events/[id]/participants/[participantId]/route.ts` |
| DELETE | `/api/v1/organizer/events/[id]/participants/[participantId]` | 条件付き（assertRegisteredOrganizer） | あり | `src/app/api/v1/organizer/events/[id]/participants/[participantId]/route.ts` |
| GET | `/api/v1/organizer/events/[id]/participants/[participantId]/receipt` | 条件付き（assertRegisteredOrganizer） | あり | `src/app/api/v1/organizer/events/[id]/participants/[participantId]/receipt/route.ts` |
| POST | `/api/v1/organizer/events/[id]/participants/[participantId]/receipt` | 条件付き（assertRegisteredOrganizer） | あり | `src/app/api/v1/organizer/events/[id]/participants/[participantId]/receipt/route.ts` |
| POST | `/api/v1/organizer/events/[id]/publish` | 条件付き（assertOrganizer） | あり | `src/app/api/v1/organizer/events/[id]/publish/route.ts` |
| GET | `/api/v1/organizer/events/[id]/reminders` | 条件付き（assertRegisteredOrganizer） | あり | `src/app/api/v1/organizer/events/[id]/reminders/route.ts` |
| POST | `/api/v1/organizer/events/[id]/reminders` | 条件付き（assertRegisteredOrganizer） | あり | `src/app/api/v1/organizer/events/[id]/reminders/route.ts` |
| GET | `/api/v1/organizer/events/[id]/revenue` | 条件付き（assertRegisteredOrganizer） | あり | `src/app/api/v1/organizer/events/[id]/revenue/route.ts` |
| PUT | `/api/v1/organizer/events/[id]/revenue/allocation` | 条件付き（assertRegisteredOwner） | あり | `src/app/api/v1/organizer/events/[id]/revenue/allocation/route.ts` |
| GET | `/api/v1/organizer/profile` | 必須（requireOrganizerAccount） | あり | `src/app/api/v1/organizer/profile/route.ts` |
| PUT | `/api/v1/organizer/profile` | 必須（requireOrganizerAccount） | あり | `src/app/api/v1/organizer/profile/route.ts` |
| GET | `/api/v1/organizer/revenue` | 必須（requireOrganizerAccount） | あり | `src/app/api/v1/organizer/revenue/route.ts` |
| POST | `/api/v1/public/events` | 条件付き（collectGuestTokenHashes, resolveUserId） | あり | `src/app/api/v1/public/events/route.ts` |
| GET | `/api/v1/public/events/[id]` | 条件付き（collectGuestTokenHashes, resolveOptionalUserId） | あり | `src/app/api/v1/public/events/[id]/route.ts` |
| GET | `/api/v1/public/events/[id]/receipt` | 条件付き（resolveUserId） | あり | `src/app/api/v1/public/events/[id]/receipt/route.ts` |
| POST | `/api/v1/public/events/[id]/rsvp` | 条件付き（resolveOptionalUserId） | あり | `src/app/api/v1/public/events/[id]/rsvp/route.ts` |
| DELETE | `/api/v1/public/events/[id]/rsvp` | 条件付き（resolveOptionalUserId） | あり | `src/app/api/v1/public/events/[id]/rsvp/route.ts` |
| GET | `/api/v1/public/organizers/[userId]` | なし | あり | `src/app/api/v1/public/organizers/[userId]/route.ts` |
| GET | `/api/v1/public/organizers/[userId]/events` | 条件付き（resolveOptionalUserId） | あり | `src/app/api/v1/public/organizers/[userId]/events/route.ts` |
| GET | `/api/v1/public/pricing` | なし | あり | `src/app/api/v1/public/pricing/route.ts` |
| DELETE | `/api/v1/user` | 必須（requireUserId） | あり | `src/app/api/v1/user/route.ts` |
| GET | `/api/v1/user/calendar` | 必須（requireUserId） | なし | `src/app/api/v1/user/calendar/route.ts` |
| POST | `/api/v1/user/email` | 必須（requireUserId） | あり | `src/app/api/v1/user/email/route.ts` |
| POST | `/api/v1/user/email/confirm` | 条件付き（resolveOptionalUserId） | あり | `src/app/api/v1/user/email/confirm/route.ts` |
| POST | `/api/v1/user/hydrate` | 必須（requireUserId） | あり | `src/app/api/v1/user/hydrate/route.ts` |
| GET | `/api/v1/user/participations` | 必須（requireUserId） | あり | `src/app/api/v1/user/participations/route.ts` |
| POST | `/api/v1/user/password` | 必須（requireUserId, readAuthToken） | あり | `src/app/api/v1/user/password/route.ts` |
| POST | `/api/v1/user/phone` | 必須（requireUserId） | あり | `src/app/api/v1/user/phone/route.ts` |
| POST | `/api/v1/user/phone/confirm` | 必須（requireUserId, readAuthToken） | あり | `src/app/api/v1/user/phone/confirm/route.ts` |
| GET | `/api/v1/user/profile` | 必須（requireUserId） | あり | `src/app/api/v1/user/profile/route.ts` |
| PATCH | `/api/v1/user/profile` | 必須（requireUserId） | あり | `src/app/api/v1/user/profile/route.ts` |
| POST | `/api/v1/user/reauth` | 必須（requireUserId） | あり | `src/app/api/v1/user/reauth/route.ts` |
| GET | `/api/v1/venues` | なし | あり | `src/app/api/v1/venues/route.ts` |
| DELETE | `/api/v1/venues/[id]` | なし | あり | `src/app/api/v1/venues/[id]/route.ts` |
| POST | `/api/v1/voice/transcriptions` | なし | あり | `src/app/api/v1/voice/transcriptions/route.ts` |
| POST | `/api/v1/webhooks/stripe` | なし | あり | `src/app/api/v1/webhooks/stripe/route.ts` |

## 実装にあって仕様書に無いもの

- `DELETE /api/v1/flyer-assets/[id]` — `src/app/api/v1/flyer-assets/[id]/route.ts`
- `GET /api/v1/geo/postal-codes/[code]` — `src/app/api/v1/geo/postal-codes/[code]/route.ts`
- `POST /api/v1/invitations/[code]` — `src/app/api/v1/invitations/[code]/route.ts`
- `GET /api/v1/organizer/events/[id]/organizers` — `src/app/api/v1/organizer/events/[id]/organizers/route.ts`
- `DELETE /api/v1/organizer/events/[id]/organizers/[organizerId]` — `src/app/api/v1/organizer/events/[id]/organizers/[organizerId]/route.ts`
- `GET /api/v1/user/calendar` — `src/app/api/v1/user/calendar/route.ts`

仕様書側に追記するか、実装が不要なら削除します。`docs/README.md` の既知の乖離にも同じ内容を書きます。

## 仕様書にあって実装が無いもの

なし。
