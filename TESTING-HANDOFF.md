# Backend changes and testing handoff: Esports Professional roles

Written so the work can be picked up from git. Nothing here was committed by the assistant; the owner commits and pushes.
The end-to-end tests live in the frontend repo: see `Allync/e2e/TESTING-HANDOFF.md` (status, how to run, what is left).

## Backend changes
**Roles (Esports professional group)**
- `src/users/dto/set-roles.dto.ts`: `esports_professional` added; `ESPORTS_PRO_SUBROLES = coach, creative, social`.
- `src/users/users.service.ts` (`setRoles`): the group needs at least one sub-role; a sub-role needs the group; the default role can't be the group itself.
- `src/users/entities/user.entity.ts` + migration `src/migrations/1793600000000-AddEsportsProfessionalRole.ts`: `primaryRole` widened to 32 chars;
  existing coach/creative/social users get `esports_professional` added. **Run the migration.**
- Seeds `seed-demo-coaches.ts`, `seed-demo-creators.ts` include `esports_professional`.
- `src/users/users.service.spec.ts` (new): the rules above.

**Bug fix: coaching deal privacy**
- `src/coaching/coaching.service.ts` `getDeal()` + `coaching.controller.ts`: `GET /coaching/deals/:id` is now readable only by the deal's coach,
  the club's President / General Secretary and staff; anyone else gets a 404. Unit test in `coaching.service.spec.ts`.

**New notifications**
- Creator told when a design sells (`creator.designSold`, sent after the purchase commits; not for free designs; buyer not named):
  `src/store/store.service.ts` (`charge` now returns the sale; `NotificationsService` injected; `store.module.ts` imports `NotificationsModule`).
- Staff told when a design is waiting for review (`creator.designSubmitted`, new design or a change to a live one):
  `src/creators/creators.service.ts` (`notifyStaff`).
- Other side told when a sponsorship request is withdrawn (`sponsorship.cancelled`): `src/sponsors/sponsors.service.ts` (`cancel`).
- Unit tests added in `creators.service.spec.ts`, `sponsors.service.spec.ts`; `store.service.spec.ts` updated for the new constructor argument.

**Other**
- `src/sponsors/sponsors-upload.ts`: the 1 MB logo check and the 5 MB banner/multer file-size limit were removed (as requested).
- `package-lock.json` changed from `npm audit fix` (vulnerabilities 19 -> 10; the rest need breaking upgrades). Tests still pass.

## Verify
`npx vitest run` -> 390 passed (last run).
